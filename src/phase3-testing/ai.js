import fs from "fs";
import path from "path";

/* ================= CONFIG ================= */

const BASE_DIR = path.resolve("../phase2-analysis/fetcher/contracts");

/* ================= UTILS ================= */

function logAIFailure(contractDir, error, stage = "ai_attack_hypotheses") {
  const failurePath = path.join(
    contractDir,
    "ai_failures.json"
  );

  const existing = fs.existsSync(failurePath)
    ? JSON.parse(fs.readFileSync(failurePath, "utf8"))
    : [];

  existing.push({
    stage,
    error: error.message || String(error),
    timestamp: new Date().toISOString()
  });

  fs.writeFileSync(
    failurePath,
    JSON.stringify(existing, null, 2)
  );
}


function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function normalizeStateVar(v) {
  if (!v) return null;
  // extract identifier-like token
  const m = v.match(/[a-zA-Z_][a-zA-Z0-9_]*/);
  return m ? m[0] : null;
}

async function safeCallAI(prompt) {
  try {
    const raw = await callAI(prompt);
    try {
      return JSON.parse(raw); // attempt strict parse
    } catch (e) {
      // fallback: try to extract JSON-like substring
      const match = raw.match(/\[.*\]/s); // matches outermost array
      if (match) return JSON.parse(match[0]);
      throw new Error("AI_RETURNED_INVALID_JSON");
    }
  } catch (err) {
    console.error("⚠️ AI call failed:", err.message);
    return []; // return empty array to keep pipeline moving
  }
}

async function callAIWithRetry(prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await safeCallAI(prompt);
      if (result) return result;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`⏳ Retry AI call (${attempt + 1})`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // exponential backoff
    }
  }
}


/* ================= SIGNAL SUMMARIZATION ================= */

function summarizeSignals(patterns, semantics, deltas) {
  return {
    patterns: patterns?.issues || [],
    semanticViolations: semantics?.violations || [],
    stateVars: [
      ...new Set(
        (deltas.paths || [])
          .flatMap(p => p.deltas || [])
          .map(d => d.sourceVar)
          .filter(Boolean)
      )
    ]
  };
}

/* ================= AI PROMPT ================= */

function buildPrompt(context) {
  return `
YOU ARE A SMART CONTRACT ATTACK ANALYST.

YOU ARE NOT ALLOWED TO:
- write Solidity
- write code
- reference line numbers
- invent functions or variables

YOU MUST:
- infer attacker goals
- connect known vulnerability patterns
- propose plausible multi-step attacks

INPUT SIGNALS (STRUCTURED, TRUSTED):

PATTERN BUGS:
${JSON.stringify(context.patterns, null, 2)}

SEMANTIC VIOLATIONS:
${JSON.stringify(context.semanticViolations, null, 2)}

STATE VARIABLES THAT MUTATE:
${JSON.stringify(context.stateVars, null, 2)}

OUTPUT REQUIREMENTS (STRICT JSON ARRAY):

Each item must follow this schema:
{
  "attack_id": string,
  "description": string,
  "attack_type": string,
  "confidence": "low" | "medium" | "high",
  "signals": {
    "patterns": string[],
    "semantic_violations": string[],
    "state_deltas": string[]
  },
  "suspected_functions": string[],
  "preconditions": string[],
  "postconditions": string[]
}
CRITICAL OUTPUT FORMAT RULES:

- state_vars MUST be an array of EXACT state variable names
- DO NOT include explanations inside state_vars
- Human explanations go ONLY in the "description" field

EXAMPLE (CORRECT):
{
  "issue": "unbounded_supply",
  "state_vars": ["numTokens"],
  "description": "numTokens increments without an upper bound"
}

EXAMPLE (WRONG):
{
  "state_vars": ["numTokens increments without upper bound"]
}

CONFIDENCE RULES:
- HIGH: pattern + semantic + state delta
- MEDIUM: pattern + delta OR semantic + delta
- LOW: pattern only

If no plausible attack exists, output an empty array [].
`;
}

/* ================= AI CALL ================= */
/* Replace this with your fetch() or local model call */

async function callAI(prompt) {
  const res = await fetch("https://keyrot.onrender.com/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const json = await res.json();
  return json.choices[0].message.content;
}

/* ================= VALIDATION ================= */

function validateHypotheses(hypotheses, knownFunctions, knownVars) {
  if (!Array.isArray(hypotheses)) {
    throw new Error("AI_OUTPUT_NOT_ARRAY");
  }

  for (const h of hypotheses) {
    if (
      !h.attack_id ||
      !h.attack_type ||
      !h.confidence ||
      !h.signals
    ) {
      throw new Error("INVALID_HYPOTHESIS_SCHEMA");
    }

    /* ---- function validation ---- */
    h.suspected_functions = (h.suspected_functions || []).map(fn => {
      if (!knownFunctions.includes(fn)) {
        // Mark unknown functions directly in the JSON
        return { name: fn, known: false };
      }
      return { name: fn, known: true };
    });

    /* ---- state delta validation (STRICT) ---- */
    h.signals.state_deltas = (h.signals.state_deltas || []).map(v => {
  const normalized = normalizeStateVar(v);
  return { name: normalized || v, known: knownVars.includes(v) };
});


    /* ---- confidence ---- */
    if (!["low", "medium", "high"].includes(h.confidence)) {
      throw new Error(`INVALID_CONFIDENCE:${h.confidence}`);
    }
  }

  return hypotheses; // now the hypotheses are annotated
}


/* ================= MAIN ================= */

export async function generateAttackHypotheses(contractId) {
  const dir = path.join(BASE_DIR, contractId, "analysis");

try{

  const patternPath = path.join(dir, "derived", "pattern_bugs.json");
  const semanticPath = path.join(dir, "derived", "semantic_violations.json");
  const deltaPath = path.join(dir, "state_deltas.json");
  const classifiedPath = path.join(dir, "classified_functions.json");

  if (
    !fs.existsSync(patternPath) ||
    !fs.existsSync(semanticPath) ||
    !fs.existsSync(deltaPath) ||
    !fs.existsSync(classifiedPath)
  ) {
    console.log(`⏭️ Skipping ${contractId} (missing inputs)`);
    return;
  }

    const patterns = readJSON(patternPath);
    const semantics = readJSON(semanticPath);
    const deltas = readJSON(deltaPath);
    const classified = readJSON(classifiedPath);

   const knownFunctions = [
  ...(classified.entrypoints || []).map(f => `${f.contract}.${f.function}`),
  ...(classified.inline || []).map(f => `${f.contract}.${f.function}`),
  ...(classified.boundaries || []).map(f => `${f.contract}.${f.function}`)
];

   const allContractVars = (classified.contracts || [])
  .flatMap(c => c.stateVars || [])
  .map(v => v.name);

const knownVars = [
  ...new Set([
    ...allContractVars,
    ...(deltas.paths || [])
      .flatMap(p => p.deltas || [])
      .map(d => d.sourceVar)
      .filter(Boolean)
  ])
];

    const context = summarizeSignals(patterns, semantics, deltas);
    const prompt = buildPrompt(context);


const hypotheses = await callAIWithRetry(prompt);


    validateHypotheses(hypotheses, knownFunctions, knownVars);

    const outPath = path.join(
      dir,
      "adversarial",
      "attack_hypotheses.json"
    );

    writeJSON(outPath, hypotheses);

    console.log(
      `✔ attack_hypotheses.json written for ${contractId} (${hypotheses.length} hypotheses)`
    );

  } catch (err) {
    // 🔒 LOG, DON'T CRASH
    logAIFailure(dir, err, "attack_hypotheses");

    console.error(
      `⚠️ AI hypothesis failed for ${contractId}: ${err.message}`
    );

   
    return;
  }
}


/* ================= CLI ================= */
if (import.meta.url === `file://${process.argv[1]}`) {
const [, , contractId] = process.argv;

if (!contractId) {
  console.error("Usage: node 09_ai_attack_hypotheses.js <contractId>");
  process.exit(1);
}

generateAttackHypotheses(contractId)
  .then(() => {
    console.log(`✔ Finished AI hypothesis step for ${contractId}`);
  })
  .catch(err => {
    // This should NEVER trigger now, but keep as safety net
    console.error(`🔥 UNHANDLED ERROR: ${err.message}`);
  });
}
