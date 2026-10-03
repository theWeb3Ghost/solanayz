import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

function runMythril(contractPath, flatFile, folder, focusFunctions) {
  return new Promise((resolve, reject) => {
    const mythril = "/mnt/c/Users/user/agentic/main/mythril-env/bin/myth";

    const proc = spawn(mythril, [
      "analyze",
      contractPath,
      "--strategy","dfs",
      "--max-depth","15",
      "--call-depth-limit","5",
      "--solver-timeout","3000",
      "--execution-timeout","180",
      "-o",
      "json"
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => stdout += d);
    proc.stderr.on("data", d => stderr += d);

    proc.on("close", code => {
      if (code !== 0) {
        console.error(stderr);
        return reject(new Error(`Mythril failed on ${flatFile}`));
      }

      let mythFindings = [];
      try {
        const json = JSON.parse(stdout);
        if (Array.isArray(json.issues)) {
          mythFindings = json.issues
            .filter(i => !focusFunctions.length || focusFunctions.includes(i.function))
            .map(i => ({
              issue: i.swcID || i.title,
              source: "mythril",
              confidence: i.severity,
              functions: [i.function || "unknown"],
              description: i.description || i.swcDescription
            }));
        }
      } catch {
        console.warn(`⚠ JSON parse failed for ${flatFile}`);
      }

      const derivedDir = path.join(
        BASE_DIR, folder, "project", "contracts", "derived"
      );
      fs.mkdirSync(derivedDir, { recursive: true });

      fs.writeFileSync(
        path.join(derivedDir, `mythril_report_${flatFile}.json`),
        JSON.stringify(mythFindings, null, 2)
      );

      resolve(mythFindings);
    });
  });
}

export async function runMythrilAgent(folder, focusFunctions = []) {
  const contractsDir = path.join(BASE_DIR, folder, "project", "contracts");
  const flatFiles = fs.readdirSync(contractsDir).filter(f => f.endsWith(".flat.sol"));

  if (!flatFiles.length) {
    throw new Error("No flattened contracts found");
  }

  const allFindings = [];

  for (const flatFile of flatFiles) {
    const contractPath = path.join(contractsDir, flatFile);
    const findings = await runMythril(contractPath, flatFile, folder, focusFunctions);
    allFindings.push(...findings);
    console.log(`✔ Mythril finished: ${flatFile}`);
  }

  const patternPath = path.join(
    BASE_DIR, folder, "project", "contracts", "derived", "pattern_bugs.json"
  );

  fs.writeFileSync(
    patternPath,
    JSON.stringify({ contract: folder, findings: allFindings }, null, 2)
  );
}



// const testFolder = "c24a36"; // Example folder in the 'contracts' directory
// const focusFunctions = [    "PolsStake.setRewardToken",
//     "PolsStake.removeOtherERC20Tokens"]; // Example function(s) to focus on

// // Run the test
// runMythrilAgent(testFolder, focusFunctions)
//   .then(() => {
//     console.log("Test completed!");
//   })
//   .catch((err) => {
//     console.error("Test failed:", err);
//   });