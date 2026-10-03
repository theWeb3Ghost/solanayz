import fs from "fs";
import path from "path";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* =========================
   Utils
========================= */

const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));

const writeFile = (p, c) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
};

function extractPragma(solPath) {
  const src = fs.readFileSync(solPath, "utf8");
  const m = src.match(/pragma solidity\s+([^;]+);/);
  return m ? m[1].trim() : "^0.8.0";
}

function extractFunctionParams(solSrc, fnName) {
  const regex = new RegExp(`${fnName}\\s*\\(([^)]*)\\)`);
  const match = solSrc.match(regex);
  if (!match) return [];
  const paramStr = match[1].trim();
  if (!paramStr) return [];
  return paramStr.split(",").map(p => {
    const parts = p.trim().split(/\s+/);
    return parts[0]; // type only
  });
}

function genArgsFromSol(fnName, src) {
  const re =
    fnName === "constructor"
      ? /constructor\s*\(([^)]*)\)/
      : new RegExp(`function\\s+${fnName}\\s*\\(([^)]*)\\)`);

  const m = src.match(re);
  if (!m || !m[1].trim()) return "";

  return m[1]
    .split(",")
    .map(p => {
      const type = p.trim().replace(/\s+\w+$/, ""); // remove variable name

      // Handle arrays (like uint256[], uint256[] memory)
      if (/\[\d*\]\s*(memory|calldata)?$/.test(type)) {
        const clean = type.replace(/\s*(memory|calldata)/g, "").trim();

      
          // Create an empty array of the base type with size 0
          return `new ${clean}(0)`;  // Correct: new uint256(0) or new bytes(0)
        }
      

      // Handle other types AFTER array handling
      if (type.includes("address payable")) return "payable(address(this))";
      if (type === "address") return "address(this)";
      if (type.startsWith("uint") || type.startsWith("int")) return "1"; // Default scalar value
      if (type === "bool") return "true";
      if (type === "string") return `"test"`;
      if (type.startsWith("bytes")) return `hex"00"`;

      return "0"; // Default fallback for unknown types
    })
    .join(", ");
}






function findWithdrawLike(fnMeta) {
  return Object.values(fnMeta).find(f =>
    /withdraw|claim|refund|payout/i.test(f.function) &&
    (f.mutability === "payable" || f.valueTransfers?.includes("ETH"))
  );
}


function inferReentrancyTarget(attacks, fnMeta) {
  for (const attack of attacks || []) {
    if (attack.attack_type !== "reentrancy") continue;

    for (const step of attack.sequence || []) {
      const [, fn] = step.split(".");
      const meta = fnMeta[fn];
      if (meta) return meta;
    }
  }
  return null;
}
function getParamType(p) {
  if (!p) return "";

  if (typeof p === "string") {
    if (p === "unknown") return "uint256[]";
    return p;
  }

  if (typeof p.type === "string") return p.type;

  if (typeof p.type === "object") {
    if (p.type.type === "array" && p.type.base) {
      return `${p.type.base}[]`;
    }
  }

  if (typeof p.var_type === "string") return p.var_type;

  return "";
}



function extractConstructorParamTypes(src) {
  const m = src.match(/constructor\s*\(([^)]*)\)/);
  if (!m || !m[1].trim()) return [];

  return m[1]
    .split(",")
    .map(p => {
      // remove parameter name, keep type only
      // e.g. "address payable _beneficiary" → "address payable"
      const parts = p.trim().split(/\s+/);
      if (parts.length <= 1) return parts[0];
      return parts.slice(0, parts.length - 1).join(" ");
    });
}



/* =========================
   Classified normalization
========================= */

function normalizeClassified(raw) {
  // Case 1: already normalized
  if (raw.functions && Array.isArray(raw.functions)) {
    return raw;
  }

  // Case 2: flat array of functions (your current case)
  if (Array.isArray(raw)) {
    return {
      functions: raw,
      entrypoints: raw.filter(f => f.entrypoint === true),
      inline: []
    };
  }

  // Case 3: slither-style export
  if (raw.entrypoints || raw.inline) {
    return {
      functions: [
        ...(raw.entrypoints || []),
        ...(raw.inline || [])
      ],
      entrypoints: raw.entrypoints || [],
      inline: raw.inline || []
    };
  }

  throw new Error("Unknown classified_functions.json shape");
}


function inferPrimaryContract(classified) {
  return classified.functions.find(f =>
    f.entrypoint &&
    !f.interfaceLike &&
    f.contract
  )?.contract;
}

/* =========================
   Dependency analysis
========================= */

function buildDependencyMaps(classified, primary) {
  const observableFns = new Map();
  const stateDeps = {};
  const fnMeta = {};

  for (const fn of classified.functions) {
    if (fn.contract !== primary) continue;

    fnMeta[fn.function] = fn;

    if (
      (fn.visibility === "public" || fn.visibility === "external") &&
      fn.mutability === "view" &&
      !fn.interfaceLike
    ) {
      observableFns.set(fn.function, fn);

      for (const r of fn.stateReads || []) {
        if (!stateDeps[r.var]) stateDeps[r.var] = new Set();
        stateDeps[r.var].add(fn.function);
      }
    }
  }

  return { observableFns, stateDeps, fnMeta };
}

function getAttackWrittenState(attack, fnMeta) {
  const written = new Set();
  for (const step of attack.sequence || []) {
    const [, fn] = step.split(".");
    for (const w of fnMeta[fn]?.stateWrites || []) {
      written.add(w.var);
    }
  }
  return written;
}

function selectObservableProbes(written, stateDeps) {
  const probes = new Set();
  for (const s of written) {
    for (const fn of stateDeps[s] || []) probes.add(fn);
  }
  return [...probes];
}

/* =========================
   Heuristics
========================= */

function attackTransfersETH(attack, fnMeta) {
  return attack.sequence?.some(step => {
    const [, fn] = step.split(".");
    return (
      /withdraw|claim|refund|payout/i.test(fn) ||
      fnMeta[fn]?.valueTransfers?.includes("ETH")
    );
  });
}

function detectERCStandard(classified, primary) {
  const fns = classified.functions.filter(f => f.contract === primary);
  if (fns.some(f => f.function === "balanceOf" && f.parameters?.length === 1))
    return "ERC20";
  if (fns.some(f => f.function === "ownerOf"))
    return "ERC721";
  return null;
}

/* =========================
   Main generator
========================= */

export function generateForgeTest(contractId) {
  const projectDir = path.join(BASE_DIR, contractId, "project");
  const contractsDir = path.join(projectDir, "contracts");
  const srcDir = path.join(projectDir, "src");
  const testDir = path.join(projectDir, "test");

  const attackGraph = readJSON(path.join(contractsDir, "derived/attack_graph.json"));
  const classifiedRaw = readJSON(path.join(contractsDir, "classified_functions.json"));
  const classified = normalizeClassified(classifiedRaw);

  const primary = inferPrimaryContract(classified);
  if (!primary) return;

  const solPath = path.join(srcDir, `${primary}.sol`);
  const src = fs.readFileSync(solPath, "utf8");
  const pragma = extractPragma(solPath);
  const ctorArgs = genArgsFromSol("constructor", src);


  const { observableFns, stateDeps, fnMeta } =
    buildDependencyMaps(classified, primary);

  /* -------- internal harness -------- */

  const internalFns = new Set();
  for (const a of attackGraph.attacks || []) {
    for (const step of a.sequence || []) {
      const [, fn] = step.split(".");
      if (fnMeta[fn]?.visibility === "internal") internalFns.add(fn);
    }
  }

  const needsHarness = internalFns.size > 0;
  const targetContract = needsHarness ? `${primary}Harness` : primary;

  let harnessSrc = "";
  if (needsHarness) {
  // extract parent constructor parameter types
 const parentCtorTypes = extractConstructorParamTypes(src);

const parentCtorParams = parentCtorTypes
  .map((p, i) => `${p} a${i}`)
  .join(", ");

const parentCtorPass = parentCtorTypes
  .map((_, i) => `a${i}`)
  .join(", ");
  harnessSrc = `
contract ${primary}Harness is ${primary} {
  constructor(${parentCtorParams}) ${primary}(${parentCtorPass}) {}
${[...internalFns].map(fn => {
  const params = fnMeta[fn].parameters || [];
  const sig = params.map((p, i) => `${p} a${i}`).join(", ");
  const pass = params.map((_, i) => `a${i}`).join(", ");
  return `  function expose_${fn}(${sig}) external { ${fn}(${pass}); }`;
}).join("\n")}
}
`;
}


  /* -------- reentrancy attacker -------- */

const withdrawFn = inferReentrancyTarget(
  attackGraph.attacks,
  fnMeta
);

if (!withdrawFn) {
  console.warn("⚠ Reentrancy attack found, but no callable function resolved");
}


const attackerContract = withdrawFn
  ? `
contract ReentrancyAttacker {
  ${targetContract} target;

  constructor(${targetContract} _t) {
    target = _t;
  }

  receive() external payable {
    try target.${withdrawFn.function}(${genArgsFromSol(
        withdrawFn.function,
        src
      )}) {} catch {}
  }

  function attack() external payable {
    target.${withdrawFn.function}(${genArgsFromSol(
        withdrawFn.function,
        src
      )});
  }
}
`
  : "";



  /* -------- tests -------- */

  let testBody = "";
  let i = 0;

  for (const attack of attackGraph.attacks || []) {
    i++;

    const written = getAttackWrittenState(attack, fnMeta);
    const probes = selectObservableProbes(written, stateDeps);
    const observeETH = attackTransfersETH(attack, fnMeta);

  const calls = (attack.sequence || []).map(step => {
  const [, fn] = step.split(".");
  const meta = fnMeta[fn];
  if (!meta || meta.visibility === "private") return null;
 const args = genArgsFromSol(fn, src); // handles arrays now
  if (meta.visibility === "internal") return `target.expose_${fn}(${args});`;
  if (meta.mutability === "payable") return `target.${fn}{value: 1 ether}(${args});`;
  return `target.${fn}(${args});`;
}).filter(Boolean).join("\n");

    testBody += `
function test_${attack.attack_id}_${i}() public {
  address attacker = address(0xBEEF);
  vm.deal(attacker, 100 ether);

  uint balBefore;
  if (${observeETH}) balBefore = attacker.balance;

  vm.startPrank(attacker);
${calls}
  vm.stopPrank();

${
  probes.length
    ? probes.map((fn, j) => {
        const retType = fnMeta[fn]?.returns?.[0] || "uint256";

const isValue =
  ["uint256", "uint", "int", "bool", "address"].includes(retType);

if (isValue) {
  return `
  ${retType} before${j};
  ${retType} after${j};
  try target.${fn}() returns (${retType} r) { before${j} = r; } catch {}
  try target.${fn}() returns (${retType} r2) { after${j} = r2; } catch {}
  assert(before${j} != after${j});
  `;
}

return `
  bytes32 before${j};
  bytes32 after${j};
  try target.${fn}() returns (bytes memory r) { before${j} = keccak256(r); } catch {}
  try target.${fn}() returns (bytes memory r2) { after${j} = keccak256(r2); } catch {}
  assert(before${j} != after${j});
`;

      }).join("\n")
    : "// no observable state"
}


  if (${observeETH}) {
    assert(attacker.balance > balBefore);
  }
}
`;
  }

  /* -------- final output -------- */

  const out = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ${pragma};
pragma abicoder v2;

import "../lib/forge-std/src/Test.sol";
import "../src/${primary}.sol";

${harnessSrc}
${attackerContract}

contract AttackTest is Test {
  ${targetContract} target;

  function setUp() public {
    target = new ${targetContract}(${ctorArgs});
  }

${testBody}
}
`;

  writeFile(path.join(testDir, "AttackTest.t.sol"), out);
  console.log(`✔ Full agentic Forge tests generated for ${contractId}`);
}

/* -------- CLI -------- */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;
if (!contractId) process.exit(0);
 generateForgeTest(contractId)
};
