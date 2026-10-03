import fs from "fs";
import path from "path";

// Import functions from your scripts
import { mergeContractForAI } from "./merger.js";
import {classifyContract } from "./classify.js";
import { expandPaths } from "./path.js";
import {buildStateDeltas} from "./delta.js";
import { generateInvariants} from "./invariants.js";
import {generateForgeHarness} from "./harness.js";
import {detectPatternBugs} from "./pattern.js";
import { detectSemanticViolations} from "./semantics.js";
import {generateAttackHypotheses} from "./ai.js";
import {buildAttackGraph} from "./attackgraph.js";

import {plannerAgent} from "./planner.js";
// import { runMythrilAgent } from "./mythrilAgent.js";



const CONTRACTS_BASE = path.resolve("../phase2-analysis/fetcher/contracts");

// Utility: list all contract folders
function listAllFolders() {
  return fs
    .readdirSync(CONTRACTS_BASE)
    .filter(f => fs.statSync(path.join(CONTRACTS_BASE, f)).isDirectory());
}

// Main server loop
async function processFolder(folder) {
  console.log(`\n🚀 Processing folder: ${folder}`);

  try {
    console.log("1️⃣  Merging analysis...");
     await mergeContractForAI(folder);

    console.log("🧠 Planning...");
      const plan = plannerAgent(folder);

    console.log("2 classifying analysis...");
    classifyContract(folder);
    
    console.log("3 creating path analysis...");
    expandPaths(folder);

    
    console.log("4 build state delta analysis...");
    buildStateDeltas(folder);

    console.log("5 generate invariant analysis...");
    if (plan.run.invariants) generateInvariants(folder);
//from here there are two paths if theres invariant generate t.sol along the line test a
//other line is pattern and semantics wed com back here 
    console.log("6 forgeHarness analysis...");
    if (plan.run.forgeHarness) generateForgeHarness(folder);
// so theres a branch remember invarinats to harsness if t.sol// 
//pattern bugs after too if no invaritant move straight to pattern bugs 

   console.log("7 pattern bugs analysis...")
   detectPatternBugs(folder);

    console.log("8 semantics checks...")
     detectSemanticViolations(folder);
       
    console.log("running ai..")
    await generateAttackHypotheses(folder);


    //doing this later amen
// ptternbug
//     if (plan.run.mythril) await runMythrilAgent(folder, plan.focusFunctions);
//semantic 
// if (plan.run.echidna) await runEchidnaAgent(folder);
// both
// if (plan.run.manticore) await runManticoreAgent(folder, plan.focusFunctions);




    console.log(" attack graph...")
    buildAttackGraph(folder); 
 

 



    console.log(`✅ Finished processing folder: ${folder}`);
  } catch (err) {
    console.error(`❌ Error processing ${folder}:`, err);
  }
}

// CLI arg: folder name or "all"
const arg = process.argv[2];

(async () => {
  let folders = [];
  if (!arg || arg.toLowerCase() === "all") {
    folders = listAllFolders();
  } else {
    folders = [arg];
  }

  for (const folder of folders) {
    await processFolder(folder);
  }

  console.log("\n🎉 All done!");
})();
