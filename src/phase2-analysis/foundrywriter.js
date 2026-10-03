import fs from "fs";
import path from "path";

// ================= CONFIG =================
const BASE_DIR = path.join("fetcher", "contracts");
// ==========================================

// ---------- helpers ----------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dst) {
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------- main ----------
export function runFoundryWriter() {
  for (const addr of fs.readdirSync(BASE_DIR)) {
    const baseDir = path.join(BASE_DIR, addr);
    const rawSrc = path.join(baseDir, "src");
    if (!fs.existsSync(rawSrc)) continue;

    const projectDir = path.join(baseDir, "project");

    console.log(`\n=== Preparing Foundry project for ${addr} ===`);

    // Create project structure
    ensureDir(projectDir);
    ensureDir(path.join(projectDir, "src"));
    ensureDir(path.join(projectDir, "lib"));
    ensureDir(path.join(projectDir, "test"));
    ensureDir(path.join(projectDir, "out"));
    ensureDir(path.join(projectDir, "cache"));

    // Copy Solidity sources
    copyDir(rawSrc, path.join(projectDir, "src"));

    console.log("✓ Sources copied, project skeleton ready");
  }
}
