import fs from "fs";
import path from "path";
import process from "process";

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ------------------ Utils ------------------ */
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/* ------------------ Delta Inference ------------------ */
function inferDelta(write) {
  const v = write.var || "";

  // Flags / Locks
  if (v.match(/lock|paused|enabled|sealed/i)) {
    return {
      kind: "flag",
      sourceVar: v,
      op: "=",
      value: "changed"
    };
  }

  // ERC20 / ERC721 / ERC1155 balances
  if (v.match(/balance|balances|ownerToIds/i)) {
    return {
      kind: "balance",
      target: extractIndex(v),
      op: inferOp(write),
      value: inferValue(write),
      asset: inferAsset(v),
      sourceVar: v
    };
  }

  // Supply tracking
  if (v.match(/totalSupply|numTokens|supply|total/i)) {
    return {
      kind: "supply",
      op: inferOp(write),
      value: inferValue(write),
      asset: inferAsset(v),
      sourceVar: v
    };
  }

  // Approval logic
  if (v.match(/approval|allowance/i)) {
    return {
      kind: "approval",
      target: extractIndex(v),
      op: "=",
      value: "assigned",
      sourceVar: v
    };
  }

  // Ownership
  if (v.match(/owner|idToOwner/i)) {
    return {
      kind: "ownership",
      target: extractIndex(v),
      op: "=",
      value: "changed",
      sourceVar: v
    };
  }

  // Counters / indices
  if (v.match(/nonce|counter|index|count/i)) {
    return {
      kind: "counter",
      op: inferOp(write),
      value: inferValue(write),
      sourceVar: v
    };
  }

  // Fallback
  return {
    kind: "unknown",
    sourceVar: v
  };
}

/* ------------------ Helpers ------------------ */
function extractIndex(v) {
  const m = v.match(/\[(.*?)\]/);
  return m ? m[1] : undefined;
}

function inferOp(write) {
  if (write.op) return write.op;
  if (write.value === "push") return "+=";
  if (write.value === "pop") return "-=";
  return "=";
}

function inferValue(write) {
  if (typeof write.value === "number") return write.value;
  if (write.value === "push" || write.value === "pop") return 1;
  if (write.value === "++") return 1;
  if (write.value === "--") return -1;
  return "?";
}

function inferAsset(v) {
  if (v.match(/id|token|nft/i)) return "token";
  if (v.match(/coin|amount|wei|eth/i)) return "currency";
  return "unknown";
}

/* ------------------ Main ------------------ */
export function buildStateDeltas(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");
  const pathsPath = path.join(dir, "expanded_paths.json");

  if (!fs.existsSync(pathsPath)) {
    throw new Error("expanded_paths.json missing");
  }

  const expanded = readJSON(pathsPath);
  const results = [];

  for (const pathObj of expanded.paths) {
    const deltas = [];

    for (const w of pathObj.stateWrites || []) {
      deltas.push(inferDelta(w));
    }

    results.push({
      entrypoint: pathObj.entrypoint,
      callSequence: pathObj.callSequence,
      deltas,
      rawWrites: pathObj.stateWrites,
      confidence: inferConfidence(deltas)
    });
  }

  writeJSON(
    path.join(dir, "state_deltas.json"),
    {
      contract: expanded.contract,
      paths: results
    }
  );

  console.log(`✔ state_deltas.json written (${results.length} paths)`);
}

function inferConfidence(deltas) {
  if (deltas.some(d => d.kind === "unknown")) return "low";
  if (deltas.length === 0) return "medium";
  return "high";
}

/* ------------------ CLI ------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;
if (!contractId) {
  console.error("Usage: node state_delta.js <contractId>");
  process.exit(1);
}

buildStateDeltas(contractId)};
