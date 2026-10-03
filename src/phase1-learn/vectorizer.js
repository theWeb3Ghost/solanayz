import fs from 'fs-extra';
import path from 'path';
import 'dotenv/config';
import { pipeline } from '@xenova/transformers';

// -----------------------------
// Config
// -----------------------------
const REPO = process.env.HACK_REPO;
if (!REPO) throw new Error("HACK_REPO env variable not set");

const MANIFEST = path.join(REPO, 'DeFiHackLabs', 'manifest.json');
if (!process.env.VECTOR) throw new Error("VECTOR env variable not set");
const OUT = process.env.VECTOR;

// -----------------------------
// Helper: sanitize text
// -----------------------------
function sanitizeText(text) {
  return text.replace(/[^\x00-\x7F]/g, "").trim();
}

// -----------------------------
// Main vectorizer
// -----------------------------
async function main() {
  console.log('🚀 Loading local embedding model...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ Local model loaded!');

  const manifest = await fs.readJson(MANIFEST);
  const out = [];

  for (const item of manifest) {
    // -----------------------------
    // Build text to embed
    // -----------------------------
    const rawText = [
      item.protocol || "",
      item.vulnerability || "",
      item.loss ? `Loss: ${item.loss}` : "",
      item.contract_files?.join(", ") || "",
      item.snippet || ""
    ].join("\n");

    const textToSend = sanitizeText(rawText).slice(0, 4000);

    if (!textToSend) {
      console.warn("⚠ Skipping empty text for", item.folder);
      continue;
    }

    try {
      // -----------------------------
      // Embed locally
      // -----------------------------
      const embeddingRaw = await embedder(textToSend, {
  pooling: 'mean',
  normalize: true,
});

      // Some models return nested arrays [tokens x dim]; mean-pool to get a sentence embedding
      const embedding = Array.from(embeddingRaw.data);
      // -----------------------------
      // Push vector
      // -----------------------------
      out.push({
        id: item.id,
        text: textToSend.slice(0, 2000),
        embedding,
        meta: {
          protocol: item.protocol,
          vulnerability: item.vulnerability,
          loss: item.loss,
          date: item.date,
          contract_files: item.contract_files,
        }
      });

      console.log('✅ Vectorized', item.id);

    } catch (e) {
      console.error('❌ Vectorize failed for', item.id, e.message);
      // Push dummy zero vector
      const dim = 384;
      out.push({
        id: item.id,
        text: textToSend.slice(0, 2000),
        embedding: Array(dim).fill(0),
        meta: {
          protocol: item.protocol,
          vulnerability: item.vulnerability,
          loss: item.loss,
          date: item.date,
          contract_files: item.contract_files,
        }
      });
    }
  }

  // -----------------------------
  // Save vectors
  // -----------------------------
  await fs.mkdirp(path.dirname(OUT));
  await fs.writeJson(OUT, out, { spaces: 2 });
  console.log('✅ Wrote', out.length, 'vectors →', OUT);
}

// -----------------------------
// Auto-run
// -----------------------------
main().catch(err => {
  console.error("❌ Vectorizer failed:", err);
  process.exit(1);
});

export default main;
