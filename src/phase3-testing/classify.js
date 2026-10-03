import fs from "fs";
import path from "path";
import process from "process";



const BASE_DIR = path.resolve(
  "../phase2-analysis/fetcher/contracts"
);

/* ------------------ Utils ------------------ */

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/* ------------------ Classifier ------------------ */

export function classifyContract(contractId) {
  const contractDir = path.join(
    BASE_DIR,
    contractId,
    "analysis"
  );

  const mergedPath = path.join(contractDir, "merged_analysis.json");

  if (!fs.existsSync(mergedPath)) {
    throw new Error(`❌ merged_analysis.json not found for ${contractId}`);
  }

  const merged = readJSON(mergedPath);

  const entrypoints = [];
  const inline = [];
  const boundaries = [];

  for (const fn of merged.functions) {
    // Constructors already extracted
    if (fn.function === "constructor") continue;

    // 1. Interface-like / boundary
    if (fn.interfaceLike === true) {
      boundaries.push(fn);
      continue;
    }

    // 2. External/public entrypoints
    if (fn.visibility === "external" || fn.visibility === "public") {
      entrypoints.push(fn);
      continue;
    }

    // 3. Internal/private logic
    inline.push(fn);
  }

  const output = {
    contract: merged.contract,
    constructors: merged.constructors,
    summary: {
      entrypoints: entrypoints.length,
      inline: inline.length,
      boundaries: boundaries.length
    },
    entrypoints,
    inline,
    boundaries
  };

  const outPath = path.join(contractDir, "classified_functions.json");
  writeJSON(outPath, output);

  console.log(`✔ classified_functions.json written for ${contractId}`);
  console.log(
    `  → entrypoints: ${entrypoints.length}, inline: ${inline.length}, boundaries: ${boundaries.length}`
  );

  return output;
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node classify.js <contractId>");
  process.exit(1);
}

try {
  classifyContract(contractId);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}}
