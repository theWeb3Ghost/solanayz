import fs from "fs";
import path from "path";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/* ------------------ Attack Graph Builder ------------------ */

export function buildAttackGraph(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");

  const hypoPath = path.join(dir, "adversarial", "attack_hypotheses.json");
  if (!fs.existsSync(hypoPath)) {
    console.log(`⏭️ No attack hypotheses for ${contractId}`);
    return;
  }

  const expandedPath = path.join(dir, "expanded_paths.json");
  const classifiedPath = path.join(dir, "classified_functions.json");

  const hypotheses = readJSON(hypoPath);
  const expanded = readJSON(expandedPath);
  const classified = readJSON(classifiedPath);

  const entrypoints = new Set(
    (classified.entrypoints || []).map(
      f => `${f.contract}.${f.function}`
    )
  );

  const validPaths = expanded.paths || [];

  const attacks = [];

  for (const h of hypotheses) {
    const sequences = [];

    for (const fnObj of h.suspected_functions || []) {
       const fn = typeof fnObj === "string" ? fnObj : fnObj.name;
       const normalized = fn.includes(".") ? fn : `${classified.contract}.${fn}`;

      // Find all execution paths starting from this function
      const matching = validPaths.filter(
        p => p.entrypoint === normalized
      );

      for (const m of matching) {
        // Strategy: repeat sequence if supply / balance attack
        if (
          h.attack_type.includes("supply") ||
          h.attack_type.includes("inflation")
        ) {
          sequences.push([
            normalized,
            normalized,
            normalized
          ]);
        } else {
          sequences.push(m.callSequence);
        }
      }
    }

    for (const seq of sequences) {
      attacks.push({
        attack_id: h.attack_id,
        attack_type: h.attack_type,
        confidence: h.confidence,
        sequence: seq,
        affected_state: h.signals?.state_deltas || [],
        preconditions: h.preconditions || [],
        postconditions: h.postconditions || [],
        source: "ai_hypothesis"
      });
    }
  }

  const outPath = path.join(
    dir,
    "derived",
    "attack_graph.json"
  );

  writeJSON(outPath, {
    contract: classified.contract,
    attacks
  });

  console.log(
    `✔ attack_graph.json written for ${contractId} (${attacks.length} attacks)`
  );
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node attack_graph.js <contractId>");
  process.exit(1);
}

buildAttackGraph(contractId)
};
