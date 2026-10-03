// src/phase1/main.js
import cloneRepo from './cloneRepo.js';
import HackExtractor from './repoExtractor.js';
import path from 'path';
import { exec } from 'child_process';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
console.log("DEBUG VECTOR =", process.env.VECTOR);

// Helper to run another JS file (vectorizer.js) as a child process
function runVectorizer() {
  return new Promise((resolve, reject) => {
    const vectorizerPath = path.resolve('./src/phase1-learn/vectorizer.js');

    const proc = exec(
      `node "${vectorizerPath}"`,
      {
        env: {
          ...process.env     // 🔥 THIS PASSES ALL .env VARIABLES TO vectorizer.js
        }
      },
      (error, stdout, stderr) => {
        if (error) return reject(error);
        if (stderr) console.error(stderr);
        console.log(stdout);
        resolve();
      }
    );
  });
}


// ------------------------
// Main orchestrator
// ------------------------
async function main() {
  console.log('🚀 Starting Phase1 Pipeline');

  // 1️⃣ Clone the repo
  const cloner = new cloneRepo();
  const repoDir = await cloner.cloneDeFiHackLabs();

  // 2️⃣ Extract hack data
  const extractor = new HackExtractor(repoDir);
  const manifest = await extractor.run();
  console.log(`📦 Extracted ${manifest.length} hacks.`);

  // 3️⃣ Vectorize
  if (process.env.VECTOR) {
    console.log('🧠 Running vectorizer...');
    try {
      await runVectorizer();
      console.log('✅ Vectorizer finished.');
    } catch (err) {
      console.error('❌ Vectorizer failed:', err);
    }
  }

  console.log('🎉 Phase1 Pipeline complete!');
}

// ------------------------
// Auto-run
// ------------------------
  main().catch(err => {
    console.error('❌ Phase1 Pipeline failed:', err);
    process.exit(1);
  });

