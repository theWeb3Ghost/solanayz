// server.js
import fs from "fs";
import path from "path";
import { analyzeContract } from "./contractParser.js";
import { runSlither } from "./runslither.js";
import { runFoundryWriter } from "./foundrywriter.js";
import { runForgeBuilder } from "./forgebuilder.js";
import { runFlattener } from "./flattener.js";

const BASE_DIR = path.join("fetcher", "contracts");

async function runPipeline(singleFolder = null) {
  const folders = singleFolder ? [singleFolder] : fs.readdirSync(BASE_DIR);
  const failedContracts = [];

  for (const folder of folders) {
    const contractPath = path.join(BASE_DIR, folder);
    if (!fs.statSync(contractPath).isDirectory()) continue;
    console.log(`\n=== Processing folder: ${folder} ===`);

    try {
      // 1️⃣ Run foundrywriter.js
      console.log("🔹 Running foundrywriter...");
      await runFoundryWriter();

      // 2️⃣ Run forgebuilder.js
      console.log("🔹 Running forgebuilder...");
      await runForgeBuilder();

      // 3️⃣ Run flattener.js
      console.log("🔹 Running flattener...");
      await runFlattener(folder);

      // 4️⃣ Run Slither
      console.log("🔹 Running Slither...");
      const slitherOk = await runSlither(folder);
      if (!slitherOk) {
        console.warn(`⚠️ Slither failed for ${folder}`);
        failedContracts.push(folder);
        continue;
      }

      // 5️⃣ Run contractParser.js
      console.log("🔹 Running contractParser...");
      try {
        await analyzeContract(folder); // ensure we wait if analyzeContract becomes async
        console.log(`✔ Contract analysis for ${folder} completed`);
      } catch (err) {
        console.error(`❌ Contract analysis failed for ${folder}: ${err.message}`);
        failedContracts.push(folder);
      }

    } catch (err) {
      console.error(`⚠️ Error processing folder ${folder}: ${err.message}`);
      failedContracts.push(folder);
    }
  }

  // Save failed contracts
  fs.writeFileSync(
    path.join(BASE_DIR, "failedContracts.json"),
    JSON.stringify([...new Set(failedContracts)], null, 2)
  );

  console.log("\n✅ Pipeline complete. Failed contracts logged to failedContracts.json");
  return failedContracts;
}

// ----------------- CLI -----------------
const arg = process.argv[2]; // optional folder name
runPipeline(arg).catch(err => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
