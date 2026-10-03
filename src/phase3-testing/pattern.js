import fs from "fs";
import path from "path";
import process from "process";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/* ------------------ Pattern Detection ------------------ */

export function detectPatternBugs(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");

  const pathsPath = path.join(dir, "expanded_paths.json");
  const deltaPath = path.join(dir, "state_deltas.json");

  if (!fs.existsSync(pathsPath) || !fs.existsSync(deltaPath)) {
    throw new Error("Missing expanded_paths.json or state_deltas.json");
  }

  const expanded = readJSON(pathsPath);
  const deltas = readJSON(deltaPath);

  const findings = [];

  for (let i = 0; i < expanded.paths.length; i++) {
    const pathObj = expanded.paths[i];
    const deltaObj = deltas.paths[i];

    const externalCalls = pathObj.externalCalls || [];
    const stateWrites = pathObj.stateWrites || [];
    const deltasList = deltaObj.deltas || [];

    /* -------- Reentrancy Window -------- */
    if (externalCalls.length > 0 && stateWrites.length > 0) {
      findings.push(makeFinding(
        "reentrancy-window",
        pathObj,
        "External call combined with state mutation"
      ));
    }

    /* -------- Unsafe External Before Write -------- */
    if (externalCalls.some(c => c.ordering === "before_state_write")) {
      findings.push(makeFinding(
        "external-before-state",
        pathObj,
        "External call occurs before state update"
      ));
    }

    /* -------- Supply Inflation -------- */
    const supplyDeltas = deltasList.filter(d => d.kind === "supply");
    if (supplyDeltas.length > 0) {
      findings.push(makeFinding(
        "supply-inflation",
        pathObj,
        "Supply-modifying logic detected"
      ));
    }

    /* -------- Balance Inflation -------- */
    const balanceAdds = deltasList.filter(
      d => d.kind === "balance" && d.op === "+="
    );
    if (balanceAdds.length > 0) {
      findings.push(makeFinding(
        "balance-inflation",
        pathObj,
        "Balance increases detected"
      ));
    }

    /* -------- Reentrancy Lock Misuse -------- */
    const usesLock = deltasList.some(d =>
      d.sourceVar && d.sourceVar.match(/reentrancy|lock/i)
    );
    if (usesLock && externalCalls.length > 0) {
      findings.push(makeFinding(
        "lock-misuse",
        pathObj,
        "Reentrancy lock present but external calls exist"
      ));
    }

    /* -------- Pause Bypass -------- */
    const pauseWrite = deltasList.some(d =>
      d.sourceVar && d.sourceVar.match(/pause|paused/i)
    );
    if (pauseWrite && externalCalls.length > 0) {
      findings.push(makeFinding(
        "pause-bypass",
        pathObj,
        "Pause variable modified but execution continues"
      ));
    }

    /* -------- Dangerous Payable -------- */
    const valueTransfers = pathObj.valueTransfers || [];
    if (valueTransfers.length > 0 && externalCalls.length > 0) {
      findings.push(makeFinding(
        "unsafe-value-transfer",
        pathObj,
        "ETH transfer combined with external execution"
      ));
    }
  }

  const outDir = path.join(dir, "derived");
  fs.mkdirSync(outDir, { recursive: true });

  writeJSON(
    path.join(outDir, "pattern_bugs.json"),
    {
      contract: expanded.contract,
      findings
    }
  );

  console.log(
    `✔ pattern_bugs.json written (${findings.length} findings)`
  );
}

/* ------------------ Finding Builder ------------------ */

function makeFinding(type, pathObj, reason) {
  return {
    type,
    severity: severityFor(type),
    entrypoint: pathObj.entrypoint,
    callSequence: pathObj.callSequence,
    reason
  };
}

function severityFor(type) {
  switch (type) {
    case "reentrancy-window":
    case "supply-inflation":
      return "high";
    case "balance-inflation":
    case "external-before-state":
      return "medium";
    default:
      return "low";
  }
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node pattern_bugs.js <contractId>");
  process.exit(1);
}

try{
  detectPatternBugs(contractId)
  } catch (err) {
  console.error(err.message);
  process.exit(1);
};
}
