import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

// Base directory for projects
const BASE_DIR = path.join("fetcher", "contracts");

// Path to your Python environment with Slither installed
const SLITHER_PYTHON = "/mnt/c/Users/user/agentic/main/slither-env/bin/python";

// ---------------- UTILITY ----------------
function detectSolVersion(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/pragma solidity\s+([^\s;]+);/);
  return match ? match[1].replace(/[\^=]/g, "") : null;
}

function readFoundryRemappings(projectPath) {
  const toml = path.join(projectPath, "foundry.toml");
  if (!fs.existsSync(toml)) return null;
  const content = fs.readFileSync(toml, "utf8");
  const m = content.match(/^\s*remappings\s*=\s*\[([^\]]+)\]/m);
  if (!m) return null;
  return m[1].split(",").map(s => s.replace(/['"]/g, "").trim()).join(",");
}

// ---------------- CORE SLITHER RUN ----------------
async function runSlitherOnFile(filePath, jsonPath, projectPath) {
  const solVersion = detectSolVersion(filePath);
  const remappings = readFoundryRemappings(projectPath);

  if (solVersion) {
    console.log(`Detected Solidity version for ${filePath}: ${solVersion}`);
    try { await execAsync(`solc-select install ${solVersion}`); } catch {}
    await execAsync(`solc-select use ${solVersion}`);
  }

  let cmd = `${SLITHER_PYTHON} -m slither ${filePath} --json ${jsonPath} --fail-none`;
  if (remappings) cmd += ` --solc-args="--allow-paths . --remappings ${remappings}"`;

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    if (stdout) console.log(stdout);
    if (stderr) console.warn(`⚠️ Slither warnings:\n${stderr}`);
    console.log(`✔ Slither output saved to ${jsonPath}`);
    return true;
  } catch (err) {
    console.error(`❌ Slither failed on ${filePath}:`, err.stderr || err.message);
    return false;
  }
}

// ---------------- AGGREGATE JSON ----------------
function aggregateSlitherJsons(tempJsons, finalJsonPath) {
  const merged = {
    contracts: {},
    results: {
      detectors: [],
      printers: []
    },
    info: {}
  };

  for (const f of tempJsons) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));

    if (data.contracts) {
      Object.assign(merged.contracts, data.contracts);
    }

    if (data.results?.detectors) {
      merged.results.detectors.push(...data.results.detectors);
    }

    if (data.results?.printers) {
      merged.results.printers.push(...data.results.printers);
    }

    if (data.info) {
      Object.assign(merged.info, data.info);
    }
  }

  fs.writeFileSync(finalJsonPath, JSON.stringify(merged, null, 2));

  for (const f of tempJsons) fs.unlinkSync(f);

  console.log(`✔ Aggregated Slither JSON saved to ${finalJsonPath}`);
}


// ---------------- PROCESS PROJECT ----------------
async function processProject(projectPath) {
  const stateFile = path.join(projectPath, "state.json");
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.status === "unbuildable") return;
  }

  const dirsToSearch = [];
  const contractsDir = path.join(projectPath, "contracts");
  const srcDir = path.join(projectPath, "src");
  if (fs.existsSync(contractsDir)) dirsToSearch.push(contractsDir);
  if (fs.existsSync(srcDir)) dirsToSearch.push(srcDir);

  if (!dirsToSearch.length) return;

  // ---------------- Try flat.sol first ----------------
  let outputJson;
  if (fs.existsSync(contractsDir)) {
    const flatFile = fs.readdirSync(contractsDir).find(f => f.endsWith(".flat.sol"));
    if (flatFile) {
      const flatPath = path.join(contractsDir, flatFile);
      outputJson = flatPath.replace(/\.flat\.sol$/, ".slither.json");
      const success = await runSlitherOnFile(flatPath, outputJson, projectPath);
      if (success) return; // Flat.sol succeeded
      console.warn(`⚠️ Slither failed on flat.sol, falling back to per-file analysis.`);
    }
  }

  // ---------------- FALLBACK: per-file analysis ----------------
  const tempJsons = [];

  function findSolFiles(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...findSolFiles(p));
      else if (p.endsWith(".sol") && !p.endsWith(".flat.sol")) out.push(p);
    }
    return out;
  }

  let solFiles = [];
  for (const d of dirsToSearch) solFiles.push(...findSolFiles(d));

  if (!solFiles.length) {
    console.warn(`⚠️ No .sol files found for fallback in ${dirsToSearch.join(", ")}`);
    return;
  }

for (const f of solFiles) {
  const tempJson = f + ".slither.tmp.json";
  const success = await runSlitherOnFile(f, tempJson, projectPath);

  if (!success) continue;

  // 🔍 Validate Slither output
  const data = JSON.parse(fs.readFileSync(tempJson, "utf8"));

  if (
    !data.contracts &&
    !data.results?.detectors?.length
  ) {
    console.warn(`⚠️ Slither produced no findings for ${f}`);
    // Optional: skip adding empty results
    continue;
  }

  tempJsons.push(tempJson);
}


  if (tempJsons.length) {
    if (!outputJson) outputJson = path.join(contractsDir || srcDir, "project.slither.json");
    aggregateSlitherJsons(tempJsons, outputJson);
  }
}

// ---------------- PUBLIC API ----------------
export async function runSlither(addr) {
  try {
    const projectPath = path.join(BASE_DIR, addr, "project");
    if (!fs.existsSync(projectPath)) return false;
    await processProject(projectPath);
    return true;
  } catch (err) {
    console.error(`❌ Slither failed for ${addr}:`, err.message);
    return false;
  }
}

// import { exec } from "child_process";
// import fs from "fs";
// import path from "path";
// import { promisify } from "util";

// const execAsync = promisify(exec);

// // BASE_DIR pointing to fetcher/contracts
// const BASE_DIR = path.join("fetcher", "contracts");

// async function runSlitherOnFlat(flatPath) {
//   const outputJson = flatPath.replace(/\.flat\.sol$/, ".slither.json");

//   try {
//     // 1️⃣ Read pragma line from the flat file
//     const content = fs.readFileSync(flatPath, "utf8");
//     const pragmaMatch = content.match(/pragma solidity\s+([^\s;]+);/);
// let version = null;

// if (pragmaMatch) {
//   version = pragmaMatch[1].replace(/[\^=]/g, ""); // remove ^ or =
//   console.log(`Detected Solidity version for ${flatPath}: ${version}`);

//   try {
//     await execAsync(`solc-select install ${version}`);
//     console.log(`✔ Installed solc ${version}`);
//   } catch (installErr) {
//     if (!installErr.stderr.includes("already installed")) {
//       console.warn(`⚠️ Failed to install solc ${version}: ${installErr.message}`);
//     }
//   }

//   await execAsync(`solc-select use ${version}`);
//   console.log(`Using solc ${version}`);
// } else {
//   console.warn(`⚠️ No pragma found in ${flatPath}, using default solc`);
// }

// // Run Slither
// console.log(`Running Slither on ${flatPath}...`);
// try {
//  const slitherPython = "/mnt/c/Users/user/agentic/main/slither-env/bin/python"; // Adjusted path
//  const { stdout, stderr } = await execAsync(
//   `${slitherPython} -m slither ${flatPath} --json ${outputJson} --fail-none`,
//   { timeout: 60000 }
// );


//   if (stdout) console.log(stdout);
//   if (stderr) console.warn(`⚠️ Slither warnings:\n${stderr}`);
//   console.log(`✔ Slither output saved to ${outputJson}`);
//   return true; // success
// } catch (err) {
//   // err may contain stdout and stderr
//   if (err.stdout) console.log(err.stdout);
//   if (err.stderr) console.error(`❌ Slither error:\n${err.stderr}`);
//   else console.error(`❌ Slither error:\n${err.message}`);
//   return false; // failure
//   }}
// catch (err) {
//     console.warn(`⚠️ Error processing ${flatPath}:\n${err.stderr || err.message}`);
//     return false; // failure
//   }}
// async function processProject(projectPath) {
//   const stateFile = path.join(projectPath, "state.json");
//   if (fs.existsSync(stateFile)) {
//     const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
//     if (state.status === "unbuildable") {
//       console.log(`Skipping unbuildable project at ${projectPath}`);
//       return;
//     }
//   }

//   const contractsDir = path.join(projectPath, "contracts");
//   if (!fs.existsSync(contractsDir)) return;

//   const files = fs.readdirSync(contractsDir);
//   const flatFiles = files.filter(f => f.endsWith(".flat.sol"));

//   for (const flatFile of flatFiles) {
//     const flatPath = path.join(contractsDir, flatFile);
//     await runSlitherOnFlat(flatPath);
//   }
// }

// export async function runSlither(addr) {
//   try {
//     const projectPath = path.join(BASE_DIR, addr, "project");
//     if (!fs.existsSync(projectPath)) return false;

//     await processProject(projectPath);
//     return true;
//   } catch (err) {
//     console.error(`❌ Slither failed for ${addr}:`, err.message);
//     return false;
//   }
// }


