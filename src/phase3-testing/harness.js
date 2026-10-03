import fs from "fs";
import path from "path";
import process from "process";
import { ensureForgeStd } from "./validateforge.js";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

/* ------------------ Forge Harness Generation ------------------ */

export function generateForgeHarness(contractId) {
  const projectDir = path.join(BASE_DIR, contractId, "project");
  const analysisDir = path.join(BASE_DIR, contractId, "analysis");
   ensureForgeStd(projectDir);
  const srcDir = path.join(projectDir, "src");
  const testDir = path.join(projectDir, "test");
  // const contractsDir = path.join(projectDir, "contracts");

  const classifiedPath = path.join(
    analysisDir,
    "classified_functions.json"
  );

  const invariantsPath = path.join(
    analysisDir,
    "derived",
    "invariants.json"
  );

  if (!fs.existsSync(classifiedPath)) {
    throw new Error("classified_functions.json missing. Run classify.js first.");
  }

  const classified = readJSON(classifiedPath);
  const invariants = fs.existsSync(invariantsPath)
    ? readJSON(invariantsPath)
    : [];

  /* -------- determine primary contract -------- */

  const primary =
    classified.entrypoints?.[0]?.contract ||
    classified.inline?.[0]?.contract;

  if (!primary) {
    console.log(`⏭️ No deployable contract for ${contractId}`);
    return;
  }

  /* =======================================================
     1️⃣ Generate Handlers.sol (FUZZ DRIVER)
     ======================================================= */

  const handlerFunctions = (classified.entrypoints || [])
    .map(fn => {
      if (!fn.function) return null;

      return `
  function call_${fn.function}() public {
    target.${fn.function}();
  }`;
    })
    .filter(Boolean)
    .join("\n");

  const handlersSol = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../src/${primary}.sol";

contract Handlers {
  ${primary} public target;

  constructor(${primary} _target) {
    target = _target;
  }

${handlerFunctions}
}
`;

  writeFile(
    path.join(testDir, "Handlers.sol"),
    handlersSol
  );

  console.log(`✔ Handlers.sol generated (${classified.entrypoints.length} entrypoints)`);

  /* =======================================================
     2️⃣ Generate Invariants.t.sol (ASSERTIONS ONLY)
     ======================================================= */

  if (!invariants || invariants.length === 0) {
    console.log(`⚠ No invariants found for ${contractId}, skipping Invariants.t.sol`);
    return;
  }

  const invariantTests = invariants
    .map((inv, i) => `
  function invariant_${i}() public {
    assert(${inv});
  }`)
    .join("\n");

  const invariantsSol = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./Handlers.sol";
import "../src/${primary}.sol";

contract InvariantsTest is Test {
  ${primary} target;
  Handlers handler;

  function setUp() public {
    target = new ${primary}();
    handler = new Handlers(target);

    // Restrict fuzzing to handler
    target = ${primary}(address(handler));
  }

${invariantTests}
}
`;

  writeFile(
    path.join(testDir, "Invariants.t.sol"),
    invariantsSol
  );

  console.log(`✔ Invariants.t.sol generated (${invariants.length} invariants)`);
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node harness.js <contractId>");
  process.exit(1);
}

try {
  generateForgeHarness(contractId);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}}
