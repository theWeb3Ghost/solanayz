// src/phase1-knowledge/repoCloner.js
import simpleGit from 'simple-git';
import fs from 'fs-extra';
import path from 'path';

class cloneRepo {
  constructor(outputDir = './data/knownHacks') {
    this.outputDir = outputDir;
  }

  async #ensureOutputDir() {
    await fs.mkdirp(this.outputDir);
  }

  async cloneDeFiHackLabs() {
    await this.#ensureOutputDir();

    const repoUrl = 'https://github.com/SunWeb3Sec/DeFiHackLabs.git';
    const targetDir = path.join(this.outputDir, 'DeFiHackLabs');

    console.log(`📦 Cloning DeFiHackLabs into: ${targetDir}`);

    if (await fs.pathExists(targetDir)) {
      console.log('✅ Directory exists → pulling latest changes...');
      const git = simpleGit(targetDir);
      await git.pull();
    } else {
      console.log('📥 Directory missing → cloning fresh...');
      const git = simpleGit();
      await git.clone(repoUrl, targetDir);
    }

    console.log('✅ Done!');
    return targetDir;
  }

  async cloneCustomRepo(repoUrl, name) {
    await this.#ensureOutputDir();

    const targetDir = path.join(this.outputDir, name);
    console.log(`📦 Cloning ${name} into ${targetDir}`);

    if (!(await fs.pathExists(targetDir))) {
      const git = simpleGit();
      await git.clone(repoUrl, targetDir);
    }

    return targetDir;
  }
}

export default cloneRepo;
