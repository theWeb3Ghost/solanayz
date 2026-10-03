import fs from "fs";
import path from "path";

/* ---------------- IMPORT RESOLUTION SAFETY ---------------- */

export function getBaseRemappings() {
  return [
    ["@openzeppelin/contracts-upgradeable/", "lib/openzeppelin-contracts-upgradeable/contracts/"],
    ["@openzeppelin/contracts/", "lib/openzeppelin-contracts/contracts/"],
    ["@chainlink/", "lib/chainlink/contracts/"],
    ["@uniswap/v3-core/", "lib/v3-core/"],
    ["@uniswap/v3-periphery/", "lib/v3-periphery/"],
    ["solmate/", "lib/solmate/src/"],
    ["solady/", "lib/solady/src/"],
    ["prb-math/", "lib/prb-math/src/"],
    ["forge-std/", "lib/forge-std/src/"],
    ["erc721a/", "lib/ERC721A/"],
    ["@gnosis.pm/safe-contracts/", "lib/safe-contracts/"],
    ["multicall/", "lib/multicall/src/"]
  ];
}

export function resolveImport(imp, projectDir, remappings) {
  for (const [prefix, target] of remappings) {
    if (imp.startsWith(prefix)) {
      const rel = imp.slice(prefix.length);
      return path.join(projectDir, target, rel);
    }
  }
  return null;
}

export function findFilesByName(dir, filename) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(findFilesByName(p, filename));
    } else if (e.name === filename) {
      out.push(p);
    }
  }
  return out;
}

export function tryAutoFixImport(imp, projectDir) {
  const filename = path.basename(imp);
  const libDir = path.join(projectDir, "lib");

  if (!fs.existsSync(libDir)) return null;

  const matches = findFilesByName(libDir, filename);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
   console.warn(
    `⚠ Skipping ambiguous import "${imp}" — multiple matches found:\n` +
    matches.map(m => `  ${m}`).join("\n")
  );
  return null; // skip this import
}

  const found = matches[0];
  const importPrefix = imp.slice(0, imp.lastIndexOf("/") + 1);
  const targetDir = path.dirname(path.relative(projectDir, found)) + "/";

  return [importPrefix, targetDir];
}

export function verifyAndPatchImports(solFiles, projectDir, extractImports) {
  let remappings = getBaseRemappings();
  const added = [];

  for (const file of solFiles) {
    for (const imp of extractImports(file)) {
      const resolved = resolveImport(imp, projectDir, remappings);
      if (resolved && fs.existsSync(resolved)) continue;

     const fix = tryAutoFixImport(imp, projectDir);
  if (!fix) {
  console.warn(`⚠ Skipping unresolvable import: ${imp}`);
  continue; // skip to the next import
}


      remappings.unshift(fix); // highest priority
      added.push(fix);
    }
  }

  return added;
}

export function appendRemappings(projectDir, remappings) {
  if (!remappings.length) return;

  const block =
    `\n# --- auto-generated remappings ---\n` +
    remappings.map(([a, b]) => `"${a}=${b}"`).join(",\n") +
    `\n`;

  fs.appendFileSync(path.join(projectDir, "foundry.toml"), block);
}
