import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import semver from "semver";

// import { promisify } from "util";

// const execAsync = promisify(exec);
const BASE_DIR = path.join("fetcher", "contracts");

/* ---------------- SOLC ---------------- */

function generateExternalRemappings(projectDir) {
  const remappings = [];

  const knownDeps = [
    "@openzeppelin/contracts",
    "@openzeppelin/contracts-upgradeable",
    "@chainlink",
    "@uniswap/v3-core",
    "@uniswap/v3-periphery",
    "solmate",
    "solady",
    "prb-math",
    "forge-std",
    "erc721a",
    "@gnosis.pm/safe-contracts",
    "multicall",
  ];

  for (const dep of knownDeps) {
    const libSrc = path.join(projectDir, "lib", dep, "src");
    const libRoot = path.join(projectDir, "lib", dep);

    if (fs.existsSync(libSrc)) remappings.push(`${dep}/=lib/${dep}/src/`);
    else if (fs.existsSync(libRoot)) remappings.push(`${dep}/=lib/${dep}/`);
  }

  return remappings;
}


function detectInternalLibRemappings(projectDir) {
  const remappings = [];
  const base = path.join(projectDir, "src", "lib");

  if (!fs.existsSync(base)) return remappings;

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const nestedSrc = path.join(base, entry.name, "src");
    if (fs.existsSync(nestedSrc)) {
      remappings.push(`${entry.name}/=src/lib/${entry.name}/src/`);
    }
  }

  return remappings;
}



function normalizeSolc(version) {
  if (!version || typeof version !== "string") return "0.8.20";
  return version.replace(/^v/, "").split("+")[0];
}



function hasVendorizedDep(projectDir, depName) {
  const mapping = {
    "openzeppelin-contracts": "@openzeppelin",
    "openzeppelin-contracts-upgradeable": "@openzeppelin",
    "solady": "solady",
    "solmate": "solmate",
    "prb-math": "prb-math",
    "forge-std": "forge-std",
    "erc721a": "erc721a",
    "safe-contracts": "@gnosis.pm/safe-contracts",
    "multicall": "multicall",
  };

  const prefix = mapping[depName];
  if (!prefix) return false;

  const pathsToCheck = [
    path.join(projectDir, "src", prefix),            // src/<dep>
    path.join(projectDir, "src", prefix, "src"),    // src/<dep>/src
    path.join(projectDir, "lib", prefix),           // lib/<dep>
    path.join(projectDir, "lib", prefix, "src"),    // lib/<dep>/src
  ];

  return pathsToCheck.some(p => fs.existsSync(p));
}


/* ---------------- UTIL ---------------- */

// async function run(cmd, cwd) {
//   try {
//     await execAsync(cmd, { cwd, stdio: "inherit" });
//     return true;
//   } catch {
//     return false;
//   }
// }





function runForge(cmd, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: "inherit" });
    child.on("close", code => resolve(code === 0));
    child.on("error", err => reject(err));
  });
}

async function ensureGit(projectDir) {
  if (fs.existsSync(path.join(projectDir, ".git"))) return;

  console.log("Initializing git repository");

  const commands = [
    ["git", ["init"]],
    ["git", ["config", "user.name", "Temp"]],
    ["git", ["config", "user.email", "temp@example.com"]],
  ];

  for (const [cmd, args] of commands) {
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: projectDir, stdio: "inherit" });
      child.on("close", code => code === 0 ? resolve(true) : reject(new Error(`${cmd} failed`)));
      child.on("error", reject);
    });
  }

  console.log("✔ Git repo initialized");
}

function warnOnMissingRemappings(solFiles, remappings) {
  const prefixes = remappings.map(r => r.split("/=")[0]);

  for (const f of solFiles) {
    for (const imp of extractImports(f)) {
      if (imp.startsWith(".") || imp.startsWith("/")) continue;

      const parts = imp.split("/");
      const pkg = imp.startsWith("@")
        ? parts.slice(0, 2).join("/") // @scope/name
        : parts[0];

      if (!prefixes.includes(pkg)) {
        console.warn(`⚠️ No remapping for import: ${imp}`);
      }
    }
  }
}


function extractImports(file) {
  const src = fs.readFileSync(file, "utf8");
  const re = /import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g;
  return [...src.matchAll(re)].map(m => m[1]);
}

function findSolFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? findSolFiles(p) : e.name.endsWith(".sol") ? [p] : [];
  });
}

/* ---------------- DEPENDENCIES ---------------- */

const DEP_MAP = [
  { match: /^@openzeppelin\/contracts-upgradeable/, getRepo: () => "openzeppelin/openzeppelin-contracts-upgradeable@v4.9.3" },
  { match: /^@openzeppelin\/contracts/, getRepo: (v) => {const version = v || "0.8.20"; if (semver.lt(version, "0.8.15")) return "openzeppelin/openzeppelin-contracts@v4.8.0";
     return "openzeppelin/openzeppelin-contracts@v4.9.3";}
  },
  { match: /^@chainlink\//, getRepo: () => "smartcontractkit/chainlink" },
  { match: /^@uniswap\/v2-/, getRepo: () => "Uniswap/v2-core" },
  { match: /^@uniswap\/v3-/, getRepo: () => ["Uniswap/v3-core", "Uniswap/v3-periphery"] },
  {match: /^solmate\//, getRepo: () => "transmissions11/solmate"},
  {match: /^solady\//,getRepo: () => "Vectorized/solady"},
  {match: /^prb-math\//,getRepo: () => "PaulRBerg/prb-math"},
  {match: /^forge-std\//, getRepo: () => "foundry-rs/forge-std"},
  {match: /^erc721a\//,getRepo: () => "chiru-labs/ERC721A"},
  {match: /^@gnosis\.pm\/safe-contracts/, getRepo: () => "gnosis/safe-contracts"},
  {match: /^multicall\//,getRepo: () => "makerdao/multicall"}
];

function detectDeps(solFiles, solcVersion) {
  const deps = new Set();

  for (const file of solFiles) {
    for (const imp of extractImports(file)) {
      for (const d of DEP_MAP) {
        if (d.match.test(imp)) {
          const repo = d.getRepo(solcVersion);
          Array.isArray(repo) ? repo.forEach(r => deps.add(r)) : deps.add(repo);
        }
      }
    }
  }
  return [...deps];
}
async function installDeps(projectDir, solFiles) {
  const deps = detectDeps(solFiles, "0.8.20"); // your existing function

  for (const dep of deps) {
    const repoName = dep.split("/")[1].split("@")[0];

    if (hasVendorizedDep(projectDir, repoName)) {
      console.log(`ℹ Vendorized dependency detected (${repoName}), skipping install`);
      continue;
    }

    console.log(`ℹ Installing missing dependency ${dep}`);
    await runForge(`forge install ${dep}`, projectDir);
  }
}

/* ---------------- FOUNDRY CONFIG ---------------- */
function writeFoundryToml(projectDir, solc, optimizer, runs, remappings) {
  const toml = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
cache_path = "cache"

optimizer = ${optimizer}
optimizer_runs = ${runs}
solc_version = "${solc}"

remappings = [
${[...new Set(remappings)].map(r => `  "${r}"`).join(",\n")}
]
`.trim();

  fs.writeFileSync(path.join(projectDir, "foundry.toml"), toml);
}


/* ---------------- BUILD ---------------- */

async function buildProject(addr) {
  const baseDir = path.join(BASE_DIR, addr);
  const projectDir = path.join(baseDir, "project");
  if (!fs.existsSync(projectDir)) return;

  // 1️⃣ Load metadata for solc version / optimizer
  let solc = "0.8.20";
  let optimizer = true;
  let runs = 200;

  const metadataPath = path.join(baseDir, "metadata.json");
  if (fs.existsSync(metadataPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      solc = normalizeSolc(m?.compilerVersion) || solc;
      optimizer = m?.optimizerEnabled ?? optimizer;
      runs = m?.optimizerRuns ?? runs;
    } catch {}
  }

  // 2️⃣ Find all Solidity files
  const solFiles = findSolFiles(path.join(projectDir, "src"));
  if (!solFiles.length) {
    console.warn(`⚠️ No Solidity files found for ${addr}`);
    return;
  }

  // 3️⃣ Install missing dependencies
  await installDeps(projectDir, solFiles);

  // 4️⃣ Generate remappings dynamically
const remappings = [
  ...generateExternalRemappings(projectDir),
  ...detectInternalLibRemappings(projectDir),
];

warnOnMissingRemappings(solFiles, remappings);

  // 5️⃣ Write foundry.toml
  writeFoundryToml(projectDir, solc, optimizer, runs, remappings);

  // 6️⃣ Ensure git repo
  await ensureGit(projectDir);

  // 7️⃣ Build the project
  console.log(`Building ${addr}...`);
  const ok = await runForge("forge build", projectDir);

  // 8️⃣ Save build state
  const state = {
    status: ok ? "buildable" : "unbuildable",
    timestamp: new Date().toISOString()
  };

  if (!ok) console.error(`⚠ Build failed for ${addr}. Check forge output above.`);

  fs.writeFileSync(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2)
  );

  console.log(`✔ Finished processing ${addr} (status=${state.status})`);
}

/* ---------------- MAIN ---------------- */

export async function runForgeBuilder() {
  for (const addr of fs.readdirSync(BASE_DIR)) {
    await buildProject(addr);
  }
  console.log("✓ All projects processed");
}
