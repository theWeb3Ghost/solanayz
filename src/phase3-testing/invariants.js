import fs from "fs";
import path from "path";
import process from "process";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/* ------------------ Invariant Generator ------------------ */

export function generateInvariants(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");
  const deltaPath = path.join(dir, "state_deltas.json");

  if (!fs.existsSync(deltaPath)) {
    throw new Error("state_deltas.json not found. Run create_deltas first.");
  }

  const deltas = readJSON(deltaPath);
  const invariants = new Set();

  for (const [fn, data] of Object.entries(deltas)) {
    for (const d of data.deltas || []) {
     switch (d.kind) {
  case "balance":
  case "supply":
  case "counter":
    invariants.add(`${d.sourceVar} >= 0`);
    break;
  case "ownership":
  case "approval":
  case "flag":
    invariants.add(`${d.sourceVar} != null`);
    break;
  case "unknown":
    invariants.add(`${d.sourceVar} in [0,1]`);
    break;
}

    }
  }

  const outPath = path.join(dir, "derived", "invariants.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeJSON(outPath, Array.from(invariants));

  console.log(`✔ invariants.json written for ${contractId}`);
  console.log(`  → ${invariants.size} invariants generated`);
  return Array.from(invariants);
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;
if (!contractId) {
  console.error("Usage: node invariants.js <contractId>");
  process.exit(1);
}

try {
  generateInvariants(contractId);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
}