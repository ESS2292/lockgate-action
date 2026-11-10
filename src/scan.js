'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'tmp',
  'temp',
  '.turbo',
  '.output',
  'target',
]);

const LOCKFILES = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};

const ALL_LOCK_NAMES = Object.keys(LOCKFILES);

function isWorkflowFile(rel, name) {
  const norm = rel.replace(/\\/g, '/');
  return (
    (norm.includes('.github/workflows/') || norm.includes('.github/actions/'))
    && (name.endsWith('.yml') || name.endsWith('.yaml'))
  );
}

function walk(root, ignorePrefixes) {
  const files = [];
  const prefixes = (ignorePrefixes || []).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));

  function skipped(rel) {
    const n = rel.replace(/\\/g, '/');
    return prefixes.some((p) => n === p || n.startsWith(`${p}/`));
  }

  function rec(dir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (skipped(rel)) continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        rec(path.join(dir, ent.name), rel);
      } else if (ent.isFile()) {
        files.push({ rel, name: ent.name, abs: path.join(dir, ent.name) });
      }
    }
  }
  rec(root, '');
  return files;
}

function readText(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { error: err.message };
  }
}

function parsePackageManagerField(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  const m = v.match(/^([^@]+)@/);
  if (!m) return v;
  return m[1].toLowerCase();
}

function scan(root, options = {}) {
  const absRoot = path.resolve(root);
  const files = walk(absRoot, options.ignore || []);
  const result = {
    root: absRoot,
    manifests: [],
    lockfiles: [],
    workflows: [],
    scanErrors: [],
  };

  for (const f of files) {
    if (f.name === 'package.json') {
      const text = readText(f.abs);
      if (typeof text !== 'string') {
        result.scanErrors.push({ file: f.rel, message: `cannot read package.json: ${text.error}` });
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        result.scanErrors.push({ file: f.rel, message: `invalid JSON: ${err.message}` });
        continue;
      }
      result.manifests.push({
        file: f.rel,
        dir: path.posix.dirname(f.rel.replace(/\\/g, '/')) === '.' ? '' : path.posix.dirname(f.rel.replace(/\\/g, '/')),
        json,
        packageManager: parsePackageManagerField(json.packageManager),
      });
    } else if (LOCKFILES[f.name]) {
      const text = readText(f.abs);
      const dir = path.posix.dirname(f.rel.replace(/\\/g, '/'));
      const rec = {
        file: f.rel,
        name: f.name,
        manager: LOCKFILES[f.name],
        dir: dir === '.' ? '' : dir,
        text: typeof text === 'string' ? text : null,
        json: null,
      };
      if (typeof text !== 'string') {
        result.scanErrors.push({ file: f.rel, message: `cannot read lockfile: ${text.error}` });
      } else if (f.name === 'yarn.lock') {
        rec.yarnBerry = /^__metadata:/m.test(text) || text.includes('__metadata:');
      }
      result.lockfiles.push(rec);
    } else if (isWorkflowFile(f.rel, f.name)) {
      const text = readText(f.abs);
      if (typeof text !== 'string') {
        result.scanErrors.push({ file: f.rel, message: `cannot read workflow: ${text.error}` });
        continue;
      }
      result.workflows.push({ file: f.rel, text });
    }
  }

  return result;
}

module.exports = { scan, LOCKFILES, ALL_LOCK_NAMES, SKIP_DIRS, parsePackageManagerField };
