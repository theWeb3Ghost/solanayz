import fs from "fs";
import path from "path";

const CONTRACTS_BASE = path.resolve("../phase2-analysis/fetcher/contracts");
const OUTPUT_DIR = "function_inputs";

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sanitize(str) {
  return str.replace(/[^\w]/g, "_");
}

function isDirectory(p) {
  return fs.statSync(p).isDirectory();
}

function clipOne(contractFolder) {
  const contractsDir = path.join(CONTRACTS_BASE, contractFolder, "project", "contracts");
  const mergedPath = path.join(contractsDir, "merged_analysis.json");
  if (!fs.existsSync(mergedPath)) {
    console.warn(`⚠️ Skipping ${contractFolder} (no merged_analysis.json)`);
    return;
  }

  const merged = readJSON(mergedPath);
  const outDir = path.join(contractsDir, OUTPUT_DIR);
  ensureDir(outDir);

  const { contract, constructors, functions } = merged;

  for (const fn of functions) {
    if (!fn.contract || !fn.function) continue;

    const payload = {
      rootContract: contract,
      constructors,
      function: fn,
      metadata: {
        generatedAt: new Date().toISOString(),
        source: "merged_analysis.json"
      }
    };

    const filename = `${sanitize(fn.contract)}_${sanitize(fn.function)}.json`;
    const outPath = path.join(outDir, filename);

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }

  console.log(`✅ ${contractFolder}: ${functions.length} functions clipped`);
}

function collectAvailableFunctions(contractFolder) {
  const outDir = path.join(CONTRACTS_BASE, contractFolder, "project", "contracts", OUTPUT_DIR);
  if (!fs.existsSync(outDir)) return [];

  const files = fs.readdirSync(outDir).filter(f => f.endsWith(".json"));
  const available = [];

  for (const file of files) {
    const fnJson = readJSON(path.join(outDir, file));
    const fn = fnJson.function;
    if (!fn || !fn.contract || !fn.function) continue;
    if (fn.visibility !== "public" && fn.visibility !== "external") continue;
    if (fn.internalCallsOnly) continue;

    available.push({
      contract: fn.contract,
      function: fn.function,
      visibility: fn.visibility,
      modifiers: fn.modifiers || [],
      accessControl: fn.accessControl || null,
      execution: {
        stateReads: fn.stateReads || [],
        stateWrites: fn.stateWrites || [],
        slitherFindings: fn.slitherFindings || [],
        severityScore: fn.severityScore || 0
      }
    });
  }

  return available.sort((a, b) => b.execution.severityScore - a.execution.severityScore);
}

function clipAll() {
  const folders = fs.readdirSync(CONTRACTS_BASE).filter(f => isDirectory(path.join(CONTRACTS_BASE, f)));
  for (const folder of folders) clipOne(folder);
  console.log("🎯 Finished clipping ALL contracts");
}

export { clipOne, clipAll, collectAvailableFunctions };
