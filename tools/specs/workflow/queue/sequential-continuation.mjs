import fs from 'node:fs';
import path from 'node:path';

export function getSequentialContinuationBaseDir(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'sequential-continuation');
}

export function getSequentialContinuationDir(repoRoot, changeSlug) {
  return path.join(getSequentialContinuationBaseDir(repoRoot), changeSlug);
}

export function saveSequentialContinuationChain(repoRoot, changeSlug, chain) {
  if (!repoRoot || !changeSlug || !chain?.chainId) return null;
  const dir = getSequentialContinuationDir(repoRoot, changeSlug);
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = path.join(dir, `${chain.chainId}.json`);
  const tmpPath = path.join(dir, `${chain.chainId}.${Date.now()}.tmp`);

  const payload = JSON.stringify({
    ...chain,
    updatedAt: new Date().toISOString(),
  }, null, 2);

  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, finalPath);
  return chain;
}

export function loadSequentialContinuationChain(repoRoot, changeSlug, chainId) {
  if (!repoRoot || !chainId) return null;

  if (changeSlug) {
    const filePath = path.join(getSequentialContinuationDir(repoRoot, changeSlug), `${chainId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  // Scan across change slugs if changeSlug is not specified
  const baseDir = getSequentialContinuationBaseDir(repoRoot);
  if (!fs.existsSync(baseDir)) return null;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const candidatePath = path.join(baseDir, entry.name, `${chainId}.json`);
      if (fs.existsSync(candidatePath)) {
        try {
          return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function listSequentialContinuationChains(repoRoot, changeSlug) {
  if (!repoRoot || !changeSlug) return [];
  const dir = getSequentialContinuationDir(repoRoot, changeSlug);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.tmp'));
  const chains = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      chains.push(data);
    } catch {}
  }
  return chains;
}

export function getActiveSequentialContinuationChain(repoRoot, changeSlug) {
  const chains = listSequentialContinuationChains(repoRoot, changeSlug);
  return chains.find(c => c.status === 'running') || null;
}
