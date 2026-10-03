import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ utils ------------------ */

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/* ------------------ forge runner ------------------ */

function runForge(contractId) {
  const projectDir = path.join(BASE_DIR, contractId, "project");

  const testDir = path.join(projectDir, "test");
  if (!fs.existsSync(testDir)) {
    console.log(`⏭️ No test directory for ${contractId}`);
    return;
  }

  const reportDir = path.join(
    projectDir,
    "contracts",
    "reports"
  );
  ensureDir(reportDir);

  let rawOutput = "";
  let status = "pass";
  const tests = [];

  try {
    rawOutput = execSync(
      "forge test --match-path test/AttackTest.t.sol --json",
      {
        cwd: projectDir,
        stdio: "pipe",
        encoding: "utf8"
      }
    );
  } catch (err) {
    status = "fail";
    rawOutput =
      err.stdout?.toString() ||
      err.stderr?.toString() ||
      err.message;
  }

  // Minimal, robust parsing
  for (const line of rawOutput.split("\n")) {
    if (line.includes("FAIL")) {
      tests.push({
        test: line.trim(),
        result: "fail",
        reason: "forge assertion / revert",
        trace: null
      });
    }
  }

  const result = {
    status: tests.length ? "fail" : status,
    test_count: tests.length,
    tests,
    raw: rawOutput.slice(0, 20_000) // avoid giant files
  };

  fs.writeFileSync(
    path.join(reportDir, "attack_results.json"),
    JSON.stringify(result, null, 2)
  );

  console.log(
    `✔ Forge executed for ${contractId} (${result.status})`
  );
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node forge_attack_runner.js <contractId>");
  process.exit(0);
}

try {
  runForge(contractId);
} catch (err) {
  console.error(
    `⚠️ Forge runner internal error for ${contractId}: ${err.message}`
  );
}
}