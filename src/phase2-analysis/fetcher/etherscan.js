import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import process from "process";

// ================== INPUT ==================
const addresses = JSON.parse(
  fs.readFileSync(new URL("./connn.json", import.meta.url), "utf8")
);
// ===========================================

// ================== CONFIG ==================
const ETHERSCAN_API_KEY = "4EYREXP17RX2Z7ESFI1PQQT5VM46C61F34";
const BASE_URL = "https://api.etherscan.io";
const OUT_DIR = "contracts";
const RATE_LIMIT_DELAY_MS = 250;
const chainId=999;
// ============================================

if (!ETHERSCAN_API_KEY) {
  throw new Error("Missing ETHERSCAN_API_KEY");
}

// ---------- helpers ----------

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSource(address) {
  const url =
    `${BASE_URL}/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
if (!json.result || !Array.isArray(json.result) || !json.result[0]) {
  console.error("Raw Etherscan response:", json);
  throw new Error("Invalid Etherscan response");
}

  return json.result[0];
}

function parseSource(sourceCode) {
  if (!sourceCode) return null;

  const trimmed = sourceCode.trim();

  if (trimmed.startsWith("{")) {
    let jsonText = trimmed;

    // Handle double-wrapped JSON
    if (jsonText.startsWith("{{") && jsonText.endsWith("}}")) {
      jsonText = jsonText.slice(1, -1);
    }

    try {
      const parsed = JSON.parse(jsonText);
      return { type: "multi", files: parsed.sources || parsed };
    } catch {
      // fall through
    }
  }

  return { type: "single", content: sourceCode };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSourceFiles(baseSrcDir, parsedSource, contractName, prefix = "") {
  if (!parsedSource) return;

  if (parsedSource.type === "single") {
    const filename = `${prefix}${contractName || "Contract"}.sol`;
    fs.writeFileSync(
      path.join(baseSrcDir, filename),
      parsedSource.content,
      "utf8"
    );
    return;
  }

  for (const [relativePath, fileObj] of Object.entries(parsedSource.files)) {
    const cleanRelPath = prefix + relativePath.replace(/^\/+/, "");
    const fullPath = path.join(baseSrcDir, cleanRelPath);
    ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, fileObj.content, "utf8");
  }
}

// ---------- main ----------

async function main() {
  for (const entry of addresses) {
    const address =
  typeof entry === "string"
    ? entry.toLowerCase()
    : entry.address?.toLowerCase();

if (!address) continue;
    const addrNo0x = address.replace(/^0x/, "");
    const folderName = addrNo0x.slice(0, 6);

    const contractDir = path.join(OUT_DIR, folderName);
    const srcDir = path.join(contractDir, "src");

    console.log(`Processing ${address}`);

    try {
      ensureDir(srcDir);

      const info = await fetchSource(address);

      if (!info.SourceCode) {
        console.log("  - Not verified, skipping");
        continue;
      }

      const isProxy = info.Proxy === "1";
      const implementationAddress = info.Implementation
        ? info.Implementation.toLowerCase()
        : null;

      // Save proxy or main contract
      const parsedSource = parseSource(info.SourceCode);
      writeSourceFiles(
        srcDir,
        parsedSource,
        info.ContractName,
        isProxy ? "Proxy_" : ""
      );

      if (isProxy && implementationAddress) {
        console.log(`  - Proxy detected → ${implementationAddress}`);
        await delay(RATE_LIMIT_DELAY_MS);

        const implementationInfo = await fetchSource(implementationAddress);

        if (implementationInfo.SourceCode) {
          const parsedImpl = parseSource(implementationInfo.SourceCode);
          writeSourceFiles(
            srcDir,
            parsedImpl,
            implementationInfo.ContractName,
            "Implementation_"
          );
        } else {
          console.log("  - Implementation not verified");
        }
      }

      const metadata = {
        address,
        implementation: implementationAddress,
        contractName: info.ContractName,
        compilerVersion: info.CompilerVersion,
        optimizerEnabled: info.OptimizationUsed === "1",
        optimizerRuns: info.Runs ? Number(info.Runs) : null,
      };

      fs.writeFileSync(
        path.join(contractDir, "metadata.json"),
        JSON.stringify(metadata, null, 2),
        "utf8"
      );

      console.log("  - Done");
    } catch (err) {
      console.error(`  - Failed: ${err.message}`);
    }

    await delay(RATE_LIMIT_DELAY_MS);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
