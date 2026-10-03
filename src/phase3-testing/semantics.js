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

/* ------------------ Semantic Violations ------------------ */

export function detectSemanticViolations(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");

  const deltaPath = path.join(dir, "state_deltas.json");
  const pathsPath = path.join(dir, "expanded_paths.json");
  const classifiedPath = path.join(dir, "classified_functions.json");

  if (
    !fs.existsSync(deltaPath) ||
    !fs.existsSync(pathsPath) ||
    !fs.existsSync(classifiedPath)
  ) {
    throw new Error("Required analysis files missing");
  }

  const deltas = readJSON(deltaPath);
  const paths = readJSON(pathsPath);
  const classified = readJSON(classifiedPath);

  const violations = [];

  /* ------------------ Index Helpers ------------------ */

  const readsIndex = new Map();
  const writesIndex = new Map();

  for (const p of paths.paths) {
    for (const w of p.stateWrites || []) {
      writesIndex.set(w.var, true);
    }
    for (const c of p.externalCalls || []) {
      if (c.conditionVars) {
        for (const v of c.conditionVars) {
          readsIndex.set(v, true);
        }
      }
    }
  }

  /* ------------------ Per Path Checks ------------------ */

  for (const pathObj of deltas.paths) {
    const { entrypoint, deltas: ds } = pathObj;

    /* ---- Supply without cap ---- */
    if (
      ds.some(d => d.kind === "supply") &&
      !ds.some(d => d.sourceVar.match(/cap|max|limit/i))
    ) {
      violations.push(makeViolation(
        "uncapped-supply",
        entrypoint,
        "Supply changes without explicit cap"
      ));
    }

    /* ---- Pause flag not enforced ---- */
    const pauseWrite = ds.some(d =>
      d.sourceVar?.match(/pause|paused/i)
    );
    if (pauseWrite) {
      violations.push(makeViolation(
        "pause-not-enforced",
        entrypoint,
        "Pause variable modified but no enforcement detected"
      ));
    }

    /* ---- Reentrancy lock cosmetic ---- */
    const lockUsed = ds.some(d =>
      d.sourceVar?.match(/reentrancy|lock/i)
    );
    if (lockUsed) {
      violations.push(makeViolation(
        "cosmetic-lock",
        entrypoint,
        "Reentrancy lock written but semantics not enforced"
      ));
    }

    /* ---- Ownership mutation ---- */
    if (ds.some(d => d.kind === "ownership")) {
      violations.push(makeViolation(
        "ownership-change",
        entrypoint,
        "Ownership modified – verify access control"
      ));
    }
  }

  /* ------------------ Global Semantic Checks ------------------ */

  for (const varName of writesIndex.keys()) {
    if (!readsIndex.has(varName)) {
      violations.push(makeViolation(
        "write-only-variable",
        "*",
        `Variable ${varName} is written but never read`
      ));
    }
  }

  /* ------------------ Output ------------------ */

  const outDir = path.join(dir, "derived");
  fs.mkdirSync(outDir, { recursive: true });

  writeJSON(
    path.join(outDir, "semantic_violations.json"),
    {
      contract: deltas.contract,
      violations
    }
  );

  console.log(
    `✔ semantic_violations.json written (${violations.length} violations)`
  );
}

/* ------------------ Helpers ------------------ */

function makeViolation(type, entrypoint, reason) {
  return {
    type,
    severity: severityFor(type),
    entrypoint,
    reason
  };
}

function severityFor(type) {
  switch (type) {
    case "uncapped-supply":
    case "ownership-change":
      return "high";
    case "pause-not-enforced":
    case "cosmetic-lock":
      return "medium";
    default:
      return "low";
  }
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;
if (!contractId) {
  console.error("Usage: node semantic_violations.js <contractId>");
  process.exit(1);
}

try{detectSemanticViolations(contractId)} catch (err) {
  console.error(err.message);
  process.exit(1);
};}
