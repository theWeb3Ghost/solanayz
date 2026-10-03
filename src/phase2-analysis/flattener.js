import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_DIR = path.join("fetcher", "contracts");


function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function findSolFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findSolFiles(p));
    else if (p.endsWith(".sol")) out.push(p);
  }
  return out;
}

function buildImportedSet(files) {
  const imported = new Set();

  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const dir = path.dirname(file);

    for (const m of code.matchAll(/import\s+["']([^"']+)["']/g)) {
      const imp = m[1];
      if (imp.startsWith(".")) {
        imported.add(path.resolve(dir, imp));
      }
    }
  }
  return imported;
}

function hasConcreteContract(code) {
  const clean = stripComments(code);

  const contracts = clean.match(/(^|\s)contract\s+\w+/g) || [];
  const abstracts = clean.match(/(^|\s)abstract\s+contract\s+\w+/g) || [];

  return contracts.length > abstracts.length;
}

/* ---------------- core logic ---------------- */

async function flattenProject(addr) {
  const projectDir = path.join(BASE_DIR, addr, "project");
  const stateFile = path.join(projectDir, "state.json");
  const srcDir = path.join(projectDir, "src");
  const contractsDir = path.join(projectDir, "contracts");

  if (!fs.existsSync(projectDir) || !fs.existsSync(stateFile)) return;

  const { status } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (status !== "buildable") {
    console.log(`Skipping ${addr}, status=${status}`);
    return;
  }

  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(contractsDir, { recursive: true });

  /* 1️⃣ collect files */
  const solFiles = findSolFiles(srcDir);
  if (!solFiles.length) return;

  /* 2️⃣ build import graph */
  const imported = buildImportedSet(solFiles);

  /* 3️⃣ find entry roots */
  const roots = solFiles.filter(
    f => !imported.has(path.resolve(f))
  );

  /* 4️⃣ keep only deployable ones */
  const entryFiles = roots.filter(f =>
    hasConcreteContract(fs.readFileSync(f, "utf8"))
  );

  if (!entryFiles.length) {
    console.warn(`⚠️ No entry contracts found for ${addr}`);
    return;
  }

  /* 5️⃣ flatten each entry (separately) */
  for (const entry of entryFiles) {
  const rel = path
    .relative(projectDir, entry)
    .replace(/\\/g, "/");

  console.log(`Flattening ${addr}: ${rel}`);

  try {
    const { stdout } = await execAsync(
      `forge flatten "${rel}"`,
      { cwd: projectDir, shell: true }
    );

    const cleaned = stdout
      .replace(/SPDX-License-Identifier:.*\n/g, "")
      .replace(/pragma solidity[^;]*;/g, "")
      .trim();

    const header = `// SPDX-License-Identifier: UNLICENSED\npragma solidity ^0.8.0;\n\n`;

    const outName =
      entryFiles.length === 1
        ? `${addr}.flat.sol`
        : `${addr}.${path.basename(entry, ".sol")}.flat.sol`;

    const outPath = path.join(contractsDir, outName);

    fs.writeFileSync(outPath, header + cleaned, "utf8");

    console.log(`✔ Flattened file saved: ${outPath}`);
  } catch (err) {
    console.error(`❌ Failed to flatten ${entry}:`, err.message);
  }
}

}

/* ---------------- public API ---------------- */

export async function runFlattener(addr) {
  console.log(`\n=== Processing folder: ${addr} ===`);
  await flattenProject(addr);
}

