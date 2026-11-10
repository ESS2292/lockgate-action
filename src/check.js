'use strict';

const { classifyInstall, extractRunScriptsFromWorkflow } = require('./commands');

function posixJoin(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function findLockfilesInDir(collected, dir) {
  return collected.lockfiles.filter((l) => l.dir === dir);
}

function ancestorLockfiles(collected, dir) {
  const parts = dir ? dir.split('/') : [];
  const out = [];
  for (let i = parts.length; i >= 0; i -= 1) {
    const d = parts.slice(0, i).join('/');
    out.push(...findLockfilesInDir(collected, d));
  }
  return out;
}

function managersIn(lockfiles) {
  return [...new Set(lockfiles.map((l) => l.manager))];
}

function yarnIsBerry(lockfiles) {
  return lockfiles.some((l) => l.manager === 'yarn' && l.yarnBerry);
}

/**
 * Lite analyze: mixed / missing lockfiles, packageManager mismatch, and
 * unfrozen GitHub Actions installs. Does not compare npm manifests to
 * lockfiles, and does not inspect Dockerfiles or ignore files.
 */
function analyze(collected) {
  const findings = [];
  const manifests = collected.manifests || [];

  const byDir = new Map();
  for (const lock of collected.lockfiles) {
    if (!byDir.has(lock.dir)) byDir.set(lock.dir, []);
    byDir.get(lock.dir).push(lock);
  }
  for (const [dir, locks] of byDir) {
    const managers = managersIn(locks);
    if (managers.length > 1) {
      const names = locks.map((l) => l.name).join(' and ');
      const where = dir || '.';
      findings.push({
        severity: 'error',
        code: 'mixed-lockfiles',
        file: posixJoin(dir, locks[0].name),
        message: `${where} has lockfiles from more than one package manager (${names}). Teams that mix them get different trees depending on who installs.`,
        managers,
      });
    }
  }

  for (const manifest of manifests) {
    const locks = ancestorLockfiles(collected, manifest.dir);
    if (locks.length === 0) {
      const pkg = manifest.json || {};
      const hasDeps = Boolean(
        (pkg.dependencies && Object.keys(pkg.dependencies).length)
        || (pkg.devDependencies && Object.keys(pkg.devDependencies).length)
        || (pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).length),
      );
      findings.push({
        severity: hasDeps ? 'error' : 'warning',
        code: 'missing-lockfile',
        file: manifest.file,
        message: hasDeps
          ? `${manifest.file} has dependencies but no package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lock in this directory or above.`
          : `${manifest.file} has no lockfile in this directory or above. A lockfile is still recommended so \`npm ci\` (and the others) can freeze an install.`,
      });
    }
  }

  for (const manifest of manifests) {
    if (!manifest.packageManager) continue;
    const locks = findLockfilesInDir(collected, manifest.dir);
    const nearest = locks.length ? locks : ancestorLockfiles(collected, manifest.dir);
    if (!nearest.length) continue;
    const managers = managersIn(nearest);
    if (!managers.includes(manifest.packageManager)) {
      findings.push({
        severity: 'error',
        code: 'package-manager-mismatch',
        file: manifest.file,
        message: `${manifest.file} sets packageManager to ${manifest.packageManager}, but the lockfile in scope is for ${managers.join(', ')}.`,
        packageManager: manifest.packageManager,
        managers,
      });
    }
  }

  for (const wf of collected.workflows) {
    const scripts = extractRunScriptsFromWorkflow(wf.text);
    for (const script of scripts) {
      const classified = classifyInstall(script.command);
      for (const inst of classified) {
        if (inst.addingPackage) continue;
        if (inst.frozen) continue;
        const loc = `${wf.file}:${script.line}`;
        if (inst.kind === 'pnpm' && inst.implicitCiDefault) {
          findings.push({
            severity: 'warning',
            code: 'implicit-frozen-ci',
            file: wf.file,
            message: `${loc} runs \`${inst.raw.trim()}\` without --frozen-lockfile. pnpm freezes by default when CI=true, but making the flag explicit is safer.`,
          });
          continue;
        }
        if (inst.kind === 'yarn') {
          const yarnLocks = collected.lockfiles.filter((l) => l.manager === 'yarn');
          if (yarnLocks.length && yarnIsBerry(yarnLocks)) {
            findings.push({
              severity: 'warning',
              code: 'implicit-frozen-ci',
              file: wf.file,
              message: `${loc} runs \`${inst.raw.trim()}\` without --immutable. Yarn Berry freezes by default on CI; Yarn 1 does not. Make the flag explicit.`,
            });
            continue;
          }
        }
        const suggested = inst.kind === 'npm'
          ? 'npm ci'
          : inst.kind === 'yarn'
            ? 'yarn install --frozen-lockfile (Yarn 1) or yarn install --immutable (Berry)'
            : inst.kind === 'bun'
              ? 'bun ci or bun install --frozen-lockfile'
              : `${inst.kind} install --frozen-lockfile`;
        findings.push({
          severity: 'error',
          code: 'unfrozen-ci',
          file: wf.file,
          message: `${loc} runs \`${inst.raw.trim()}\`, which can update the lockfile or resolve a different tree. Use ${suggested}.`,
        });
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const key = `${f.code}|${f.file}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }

  const errors = unique.filter((f) => f.severity === 'error');
  return {
    ok: errors.length === 0,
    root: collected.root,
    manifests: manifests.map((m) => m.file),
    lockfiles: collected.lockfiles.map((l) => l.file),
    findings: unique,
    scanErrors: collected.scanErrors || [],
  };
}

module.exports = { analyze };
