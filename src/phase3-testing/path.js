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

/* ------------------ Path Expansion ------------------ */

export function expandPaths(contractId) {
  const dir = path.join(
    BASE_DIR,
    contractId,
    "analysis"
  );

  const classifiedPath = path.join(dir, "classified_functions.json");
  if (!fs.existsSync(classifiedPath)) {
    throw new Error("classified_functions.json missing");
  }

  const classified = readJSON(classifiedPath);

  const allFunctions = [
    ...classified.entrypoints,
    ...classified.inline
  ];

  const fnIndex = new Map();
  for (const fn of allFunctions) {
    const key = `${fn.contract}.${fn.function}`;
    fnIndex.set(key, fn);
  }

  const paths = [];

  for (const entry of classified.entrypoints) {
    walk(
      entry,
      [],
      new Set(),
      paths,
      fnIndex
    );
  }

  const output = {
    contract: classified.contract,
    paths
  };

  writeJSON(
    path.join(dir, "expanded_paths.json"),
    output
  );

  console.log(`✔ expanded_paths.json written (${paths.length} paths)`);
}

/* ------------------ DFS Walker ------------------ */

function walk(fn, stack, visited, paths, fnIndex) {
  const key = `${fn.contract}.${fn.function}`;
  if (visited.has(key)) return;

  visited.add(key);

  const newStack = [...stack, fn];

  const internalCalls =
    fn.callGraph?.filter(c => c.kind === "internal") || [];

  if (internalCalls.length === 0) {
    paths.push(buildPath(newStack));
    return;
  }

  for (const call of internalCalls) {
    const targetKey = `${fn.contract}.${call.to.split(".").pop()}`;
    const target = fnIndex.get(targetKey);
    if (!target) continue;

    walk(
      target,
      newStack,
      new Set(visited),
      paths,
      fnIndex
    );
  }
}

/* ------------------ Path Builder ------------------ */

function buildPath(sequence) {
  const stateWrites = [];
  const externalCalls = [];
  const valueTransfers = [];
  const slitherFindings = [];

  for (const fn of sequence) {
    stateWrites.push(...(fn.stateWrites || []));
    externalCalls.push(...(fn.externalCalls || []));
    valueTransfers.push(...(fn.valueTransfers || []));
    slitherFindings.push(...(fn.slitherFindings || []));
  }

  const hasExternalCall = externalCalls.length > 0;
  const hasStateWrite = stateWrites.length > 0;

  return {
    entrypoint: `${sequence[0].contract}.${sequence[0].function}`,
    callSequence: sequence.map(
      f => `${f.contract}.${f.function}`
    ),
    stateWrites,
    externalCalls,
    valueTransfers,
    slitherFindings,
    riskFlags: {
      reentrancyWindow: hasExternalCall && hasStateWrite,
      storageMutation: hasStateWrite
    }
  };
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;
if (!contractId) {
  console.error("Usage: node expand_paths.js <contractId>");
  process.exit(1);
}

try{expandPaths(contractId)} catch (err) {
  console.error(err.message);
  process.exit(1);
}};
}
