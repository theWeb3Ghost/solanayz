// Install first: npm install @xenova/transformers
import { pipeline } from "@xenova/transformers";

async function main() {
    // Load the sentence embedding pipeline
    const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    // Get embeddings for a sentence
    const embeddings = await embedder("Hello world! i am davinf");
     const arrayEmbeddings = embeddings[0].data;
const numTokens = arrayEmbeddings.length / 384; // calculate number of tokens
    const dim = 384;

    // Mean-pool across tokens to get a single sentence embedding
    const sentenceEmbedding = new Array(dim).fill(0);
    for (let t = 0; t < numTokens; t++) {
        for (let i = 0; i < dim; i++) {
            sentenceEmbedding[i] += arrayEmbeddings[t * dim + i];
        }
    }
    for (let i = 0; i < dim; i++) {
        sentenceEmbedding[i] /= numTokens;
    }


    console.log("Embeddings length:", sentenceEmbedding.length);
    console.log("First 5 values:", sentenceEmbedding.slice(0, 5));
}

main();
