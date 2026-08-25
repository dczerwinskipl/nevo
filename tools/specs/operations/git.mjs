import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runGit(root, args, options = {}) {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return result.stdout.trim();
}

export async function getDirtyRecords(root) {
  const result = await execFileAsync('git', ['-C', root, 'status', '--porcelain=v1', '-z'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const fields = result.stdout.split('\0').filter(f => f.length > 0);
  const records = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const status = field.slice(0, 2);
    const path = field.slice(3);
    const isRenameOrCopy = status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C';
    if (isRenameOrCopy) {
      records.push({ status, path, oldPath: fields[++i] });
    } else {
      records.push({ status, path });
    }
  }
  return records;
}

export async function getDirtyPathsAsync(root) {
  const records = await getDirtyRecords(root);
  const paths = [];
  for (const r of records) {
    paths.push(r.path);
    if (r.oldPath) paths.push(r.oldPath);
  }
  return paths;
}

export async function isWorkingTreeCleanAsync(root) {
  const status = await runGit(root, ['status', '--porcelain']);
  return status === '';
}

export async function getCurrentBranchAsync(root) {
  return runGit(root, ['branch', '--show-current']);
}

export async function getCurrentRevisionAsync(root) {
  return runGit(root, ['rev-parse', 'HEAD']);
}
export async function getAheadBehindAsync(root, branch) {
  try {
    const out = await runGit(root, ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`]);
    const [behind, ahead] = out.split(/\s+/).map(Number);
    return { hasUpstream: true, ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { hasUpstream: false, ahead: 0, behind: 0 };
  }
}

export async function addAndCommitAsync(root, paths, message) {
  await execFileAsync('git', ['-C', root, 'add', '--', ...paths], { encoding: 'utf8' });
  await execFileAsync('git', ['-C', root, 'commit', '-m', message], { encoding: 'utf8' });
}

export async function commitAllAsync(root, message) {
  await execFileAsync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  await execFileAsync('git', ['-C', root, 'commit', '-m', message], { encoding: 'utf8' });
}

export async function pushAsync(root, branch) {
  await execFileAsync('git', ['-C', root, 'push', 'origin', branch], { encoding: 'utf8' });
}
