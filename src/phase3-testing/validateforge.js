import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

export function ensureForgeStd(projectDir) {
  const libDir = path.join(projectDir, "lib");
  const forgeStdDir = path.join(libDir, "forge-std");

  if (fs.existsSync(forgeStdDir)) return;

  console.log("📦 forge-std not found, installing...");
  fs.mkdirSync(libDir, { recursive: true });

  // Attempt forge install only if git repo
  if (isGitRepo(projectDir)) {
    try {
      execSync("forge install foundry-rs/forge-std", {
        cwd: projectDir,
        stdio: "inherit"
      });
    } catch (e) {
      console.warn("⚠ forge install failed, falling back to git clone");
    }
  }

  // Fallback: plain git clone (works everywhere)
  if (!fs.existsSync(forgeStdDir)) {
    execSync(
      "git clone https://github.com/foundry-rs/forge-std lib/forge-std",
      {
        cwd: projectDir,
        stdio: "inherit"
      }
    );
  }

  if (!fs.existsSync(forgeStdDir)) {
    throw new Error("forge-std install incomplete");
  }

  console.log("✔ forge-std installed");
}
