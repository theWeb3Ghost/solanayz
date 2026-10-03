// Install first: npm install @xenova/transformers
import { pipeline } from "@xenova/transformers";

// Helper: mean-pool token embeddings
function meanPool(arrayEmbeddings, dim = 384) {
    const numTokens = arrayEmbeddings.length / dim;
    const sentenceEmbedding = new Array(dim).fill(0);

    for (let t = 0; t < numTokens; t++) {
        for (let i = 0; i < dim; i++) {
            sentenceEmbedding[i] += arrayEmbeddings[t * dim + i];
        }
    }
    for (let i = 0; i < dim; i++) {
        sentenceEmbedding[i] /= numTokens;
    }
    return sentenceEmbedding;
}

// Cosine similarity
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getSentenceEmbedding(text, embedder) {
    const embeddings = await embedder(text);
    const arrayEmbeddings = embeddings[0].data;
    return meanPool(arrayEmbeddings);
}

async function main() {
    const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    // Example sentences
    const sentences = [
        "I love crypto and DeFi hacks",
        "I enjoy blockchain security challenges",
        "The weather today is sunny"
    ];

    // Compute embeddings
    const embeddings = [];
    for (const s of sentences) {
        embeddings.push(await getSentenceEmbedding(s, embedder));
    }

    // Compare similarities
    console.log("Similarity (A↔B):", cosineSimilarity(embeddings[0], embeddings[1])); // related
    console.log("Similarity (A↔C):", cosineSimilarity(embeddings[0], embeddings[2])); // unrelated
    console.log("Similarity (B↔C):", cosineSimilarity(embeddings[1], embeddings[2])); // unrelated
}

main();



// so i htink im overoding myself at this poubt so i get source code from etherscan put then im a folder// the create a foundry cscaffold copt thw folder to foundry src/// so all the files coppy there ... but i run itno a big problem before i forge build .. what i do is if the open sourec libraries arent installed i install them and create remappings for them if theyre i leave them like that so appaernly there are some imports  thta do not ocrrectly map maube the dev had his own remappings  so i thpought is it possible for all imports .sol it checks the path where it pounts if its there leave it if it isnt it scasn through all the folders and find where it is and then resolve the mapping to that path so if those two arent available then installing if its open is then possible i will paste my forge buildr to show what ove done need help because some of my contracts arent resolving imports ocrrect;y 