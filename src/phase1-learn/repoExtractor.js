import fs from "fs-extra";
import path from "path";

export default class HackExtractor {
  constructor(repoDir) {
    this.repoDir = repoDir;
  }

  // ============================================================
  // MAIN ENTRY
  // ============================================================
  async run() {
    console.log("🔍 Extracting hacks from:", this.repoDir);

    const readmes = await this.collectAllReadmes();
    console.log(`📄 Found ${readmes.length} README files.`);

    const manifest = [];

    for (const readmePath of readmes) {
      const rootReadmeText = await fs.readFile(readmePath, "utf8");

      // Extract items like:
      // [20251201 yETH](2025-12/yeth/README.md#section)
      const incidents = this.extractIncidentRefs(rootReadmeText);

      for (const incident of incidents) {
        const { date, protocol, link, anchor } = incident;

        // Resolve where the incident README actually is
        const incidentReadmePath = await this.resolveReadmePath(readmePath, link);
        if (!incidentReadmePath) {
          console.warn(`⚠ Missing README for ${protocol}: ${link}`);
          continue;
        }

        const incidentReadmeText = await fs.readFile(incidentReadmePath, "utf8");

        // Extract only the relevant incident section
        const section = this.extractIncidentSection(incidentReadmeText, date, anchor);
        if (!section) {
          console.warn(`⚠ Could not locate section for: ${protocol} (${anchor ?? date})`);
          continue;
        }

        // ⛔ FIX: Extract only contracts from the incident section
        const contracts = await this.extractContracts(section, incidentReadmePath);

        // Loss value
        const loss =
          this.extractLoss(section) || this.extractLoss(incidentReadmeText) || null;

        // Extract test command only from relevant README
        const testMatch = incidentReadmeText.match(/forge test[^\n]+/i);
        const test_command = testMatch ? testMatch[0].trim() : null;

        // Final object
        manifest.push({
          id: `${date}-${protocol.replace(/\s+/g, "_")}`,
          protocol,
          date,
          readme: incidentReadmePath,
          title: protocol,
          folder: path.dirname(incidentReadmePath),
          vulnerability: this.extractVulnerability(section),
          loss,
          test_command,

          contract_files: contracts.map(c => c.file),
          contracts,

          references: this.extractReferences(section),

          snippet: contracts
            .map(c => c.content)
            .join("\n")
            .slice(0, 4000),
        });
      }
    }

    const outFile = path.join(this.repoDir, "manifest.json");
    await fs.writeJson(outFile, manifest, { spaces: 2 });

    console.log(`\n✅ Wrote ${manifest.length} entries → ${outFile}`);
    return manifest;
  }

  // ============================================================
  // READMEs RECURSIVE SCAN
  // ============================================================
  async collectAllReadmes() {
    const result = [];

    const walk = async dir => {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        const stat = await fs.stat(full);

        if (stat.isDirectory()) {
          await walk(full);
        } else if (item.toLowerCase() === "readme.md") {
          result.push(full);
        }
      }
    };

    await walk(this.repoDir);
    return result;
  }

  // ============================================================
  // INCIDENT LINK PARSING
  // ============================================================
  extractIncidentRefs(text) {
    const matches = [...text.matchAll(/\[(\d{8})\s+([^\]]+)\]\(([^)]+)\)/g)];

    return matches.map(m => {
      let [_, date, protocol, link] = m;
      let file = link;
      let anchor = null;

      if (file.includes("#")) {
        [file, anchor] = file.split("#");
      }

      return { date, protocol, link: file, anchor };
    });
  }

  async resolveReadmePath(fromReadme, link) {
    if (!link || link.startsWith("#")) {
      return fromReadme;
    }

    const base = path.dirname(fromReadme);
    const resolved = path.join(base, link);

    if (await fs.pathExists(resolved)) {
      const stat = await fs.stat(resolved);

      if (stat.isDirectory()) {
        const readmeInFolder = path.join(resolved, "README.md");
        return (await fs.pathExists(readmeInFolder)) ? readmeInFolder : null;
      }

      return resolved;
    }

    return null;
  }

  // ============================================================
  // SECTION EXTRACTION
  // ============================================================
 extractIncidentSection(fullReadme, date, anchor) {
  const lines = fullReadme.split("\n");

  // Normalize anchor
  let normAnchor = anchor
    ? anchor.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : null;

  let startIndex = -1;

  // 1️⃣ Try to match anchor-based section
  if (normAnchor) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim().toLowerCase();

      // match any header level
      if (/^#{1,6}\s+/.test(l)) {
        const cleaned = l.replace(/^#{1,6}\s+/, "").replace(/[^a-z0-9]+/g, "-");

        if (cleaned.includes(normAnchor)) {
          startIndex = i;
          break;
        }
      }
    }
  }

  // 2️⃣ Fallback: match by date
  if (startIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(date)) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) return null;

  // 3️⃣ Extract until the next header of equal or higher level
  let section = [];
  const startLine = lines[startIndex];
  const headerLevel = startLine.match(/^#+/)?.[0].length || 3;

  for (let i = startIndex; i < lines.length; i++) {
    if (
      i !== startIndex &&
      /^#{1,6}\s+/.test(lines[i]) &&
      lines[i].match(/^#+/)?.[0].length <= headerLevel
    ) {
      break; // stop
    }
    section.push(lines[i]);
  }

  return section.join("\n");
}


  // ============================================================
  // CONTRACT EXTRACTION (SECTION-ONLY!)
  // ============================================================
  async extractContracts(sectionText, readmePath) {
    // Match markdown links to .sol files: [name.sol](relative/path.sol)
    const solMatches = [...sectionText.matchAll(/\[([^\]]+\.sol)\]\(([^)]+)\)/gi)];
    const results = [];

    for (const m of solMatches) {
      const solFile = m[1];
      const rel = m[2];

      // Resolve relative path
      const base = path.dirname(readmePath);
      const abs = path.join(base, rel);

      let content = "";
      if (await fs.pathExists(abs)) {
        content = await fs.readFile(abs, "utf8");
      }

      results.push({
        file: rel,
        content: content.slice(0, 4000),
        functions: this.extractFunctions(content),
        references: this.extractReferences(content),
      });
    }

    return results;
  }

  extractFunctions(source) {
    if (!source) return [];
    const out = [];
    const re = /function\s+(\w+)\s*\(/g;
    let m;
    while ((m = re.exec(source))) out.push(m[1]);
    return out;
  }

  // ============================================================
  // METADATA EXTRACTION
  // ============================================================
  extractLoss(text) {
    const m = text.match(/(?:Loss|Lost|Funds Lost|Lost Funds)[\s:]*([\d.,$MK ]+)/i);
    return m ? m[1].trim() : null;
  }

  extractReferences(text) {
    return text.match(/https?:\/\/[^\s)]+/g) || [];
  }

  extractVulnerability(section) {
  const first = section.split("\n").find(l => l.trim());
  if (!first) return "Unknown";

  // Remove markdown header symbols
  const clean = first.replace(/^#+\s*/, "").trim();

  // Split by "-" and take the last non-empty part
  const parts = clean.split("-").map(p => p.trim()).filter(Boolean);
  if (parts.length > 0) {
    return parts[parts.length - 1]; // last part only
  }

  return clean;
}

}
