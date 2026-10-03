import fs from "fs";
import path from "path";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */
function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Error parsing JSON file: ${filePath}`, err);
    return null;
  }
}


/* ------------------ Normalize types ------------------ */
function normalizeType(param) {
  if (!param) return param;
  if (/^uint/.test(param)) return "uint256";
  if (/^int/.test(param)) return "int256";
  return param;
}

/* ------------------ For Interfaces ------------------ */
function isInterfaceLike(fn) {
  // 1. Obvious interface contracts (IERC20, IERC721, etc.)
  if (
    fn.contract?.startsWith("I") &&
    fn.visibility === "external"
  ) {
    return true;
  }

  // 2. No executable logic AND external
  const hasLogic =
    (fn.stateReads?.length || 0) > 0 ||
    (fn.stateWrites?.length || 0) > 0 ||
    (fn.callGraph?.length || 0) > 0 ||
    (fn.externalCalls?.length || 0) > 0 ||
    (fn.valueTransfers?.length || 0) > 0;

  if (!hasLogic && fn.visibility === "external") {
    return true;
  }

  return false;
}



/* ------------------ Load ALL Slither ------------------ */
function loadAllSlither(filePath) {
    const slither = readJSON(filePath);
  if (!slither) {
    console.warn(`⚠️ Slither JSON not found: ${filePath}`);
    return [];
  }
  return [slither]; // return as array for indexSlither

}

/* ------------------ Helper: Get Contract Name & Signature ------------------ */
function getContractAndSignature(el) {
  let fn = null;
  let contractName = null;
  let signature = null;
  let file = null;

  if (el.type === "function") {
    fn = el;
    signature = el.type_specific_fields?.signature;

    // Use Slither's parent info if available
    contractName = el.type_specific_fields?.parent?.name || null;

    // Always capture the actual source file
    file =
      el.source_mapping?.filename_short ||
      el.source_mapping?.filename_relative ||
      "unknown.sol";
  }

  return { fn, contractName, signature, file };
}


/* ------------------ Slither Index ------------------ */
function indexSlither(slitherFiles) {
  const index = {};

  for (const slither of slitherFiles) {
    for (const detector of slither?.results?.detectors || []) {
      for (const el of detector.elements || []) {
        const { fn, contractName, signature, file } = getContractAndSignature(el);
        if (!fn || !signature || !file) continue;

        // Normalize parameters
        const normalizedParams = (el.type_specific_fields?.parameters || []).map(normalizeType);

        const key = `${path.basename(file)}::${contractName || ""}::${signature}(${normalizedParams.join(",")})`;
        if (!index[key]) index[key] = [];

        index[key].push({
          check: detector.check,
          description: detector.description,
          impact: detector.impact,
          confidence: detector.confidence,
          scope: contractName ? "contract" : "file"
        });
      }
    }
  }

  return index;
}

/* ------------------ Function Key ------------------ */

function getFunctionKey(fn) {
  // Normalize the file name
  const file = path.basename(fn.file || fn.source_mapping?.filename_relative || "unknown.sol");

  // Contract name
  const contract = fn.contract || fn.type_specific_fields?.parent?.name || "";

  // Function signature
  let signature = fn.signature || fn.type_specific_fields?.signature || fn.function || fn.name || "";

  // Remove trailing parentheses if necessary
  signature = signature.replace(/\(\)$/, "");

  // Normalize parameters
  let params = fn.parameters || [];
  if (!params.length && signature.includes("(")) {
    const match = signature.match(/\((.*)\)/);
    if (match && match[1].trim()) params = match[1].split(",").map(s => s.trim());
  }

  return `${file}::${contract}::${signature}(${params.join(",")})`;
}



/* ------------------ Severity ------------------ */
function computeSeverity(findings = []) {
  const weights = { High: 3, Medium: 2, Low: 1 };
  return findings.reduce((sum, f) => sum + (weights[f.impact] || 0), 0);
}

/* ------------------ Merge Slither into Functions ------------------ */
function mergeSlither(functions, slitherIndex) {
  return functions.map(fn => {
    const key = getFunctionKey(fn);
    let findings = key ? slitherIndex[key] || [] : [];

    const seen = new Set();
    findings = findings.filter(f => {
      const str = JSON.stringify(f);
      if (seen.has(str)) return false;
      seen.add(str);
      return true;
    });

    return {
      ...fn,
      slitherFindings: findings,
      severityScore: computeSeverity(findings),
      interfaceLike: isInterfaceLike(fn)
    };
  });
}

/* ------------------ Constructor Extraction ------------------ */
function extractConstructors(analysis) {
  return analysis
    .filter(f => f.type === "constructor" || f.function === "constructor")
    .map(c => ({
      contract: c.contract,
      parameters: c.parameters || [],
      writes: c.stateWrites || [],
      immutables: c.immutables || [],
      invariants: c.invariants || []
    }));
}

/* ------------------ Dependency Resolution ------------------ */
function attachDependencies(contractDir, fn, slitherIndex, visited) {
  if (!fn.internalCalls?.length) return fn;

  const dependencies = [];

  for (const call of fn.internalCalls) {
    const visitKey = `${call.contract}:${call.function}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    const analysisFile = path.join(contractDir, `${call.contract}.analysis.json`);
    const analysis = readJSON(analysisFile);
    if (!analysis) continue;

    const targetFns = analysis.filter(f => f.signature === call.function || f.function === call.function);
    const constructors = extractConstructors(analysis);

    const merged = mergeSlither(targetFns, slitherIndex)
      .map(f => attachDependencies(contractDir, f, slitherIndex, visited));

    dependencies.push({
      contract: call.contract,
      constructors,
      functions: merged
    });
  }

  return { ...fn, dependencies };
}

/* ------------------ Main Merge ------------------ */
export async  function mergeContractForAI(contractFolder) {
  const contractDir = path.join(BASE_DIR, contractFolder,"analysis");
  const slitherDir = path.join(BASE_DIR, contractFolder,"project","contracts", `${contractFolder}.slither.json`);

  const analysisFile = path.join(contractDir, "analysis.json");
  const analysis = readJSON(analysisFile);
  if (!analysis) {
    console.warn(`❌ No analysis.json for ${contractFolder}`);
    return;
  }

  const constructors = extractConstructors(analysis);
  const slitherFiles = loadAllSlither(slitherDir);
  if(!slitherFiles){console.log("slither file not found!")
    return;
  }
  const slitherIndex = indexSlither(slitherFiles);

  const functionAnalysis = analysis.filter(f => f.function !== "constructor");
  const mergedFunctions = mergeSlither(functionAnalysis, slitherIndex)
    .map(fn => attachDependencies(contractDir, fn, slitherIndex, new Set()));

  const merged = {
    contract: contractFolder,
    constructors,
    functions: mergedFunctions
  };

  const outFile = path.join(contractDir, "merged_analysis.json");
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));

  console.log(`✔ merged_analysis.json created for ${contractFolder}`);
}


  const [, , contractId] = process.argv;

  if (!contractId) {
    console.error("Usage: node merger.js <contractId>");
    process.exit(1);
  }

  try {
    mergeContractForAI(contractId);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
