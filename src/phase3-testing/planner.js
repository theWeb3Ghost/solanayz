// planner.js
import fs from "fs";
import path from "path";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

export function plannerAgent(folder) {
  const mergedPath = path.join(
    BASE_DIR,
    folder,
    "analysis",
    "merged_analysis.json"
  );

  const merged = JSON.parse(fs.readFileSync(mergedPath, "utf8"));

  const plan = {
    run: {
      invariants: false,
      forgeHarness: false,
      mythril: false,
      echidna: false,
      manticore: false,

      // consumers (always true for now)
      aiHypotheses: true,
      attackGraph: true
    },
    focusFunctions: [],
    riskLevel: "low"
  };

  for (const fn of merged.functions) {
    if (!fn.entrypoint) continue;

    if (fn.stateWrites?.length) {
      plan.run.invariants = true;
      plan.run.forgeHarness = true;
      plan.run.echidna = true;
    }

    if (fn.externalCalls?.length || fn.valueTransfers?.length) {
      plan.run.mythril = true;
      plan.focusFunctions.push(
        `${fn.contract}.${fn.function}`
      );
    }

    if (fn.severityScore >= 4) {
      plan.run.manticore = true;
      plan.riskLevel = "high";
    }
  }

  // Persist for debugging / UI
  const planPath = path.join(
    BASE_DIR,
    folder,
    "analysis",
    "derived",
    "plan.json"
  );

  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  return plan;
}
