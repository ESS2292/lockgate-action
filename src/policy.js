'use strict';

const { pathIsIgnored } = require('./ignore');
const { ALL_LOCK_NAMES } = require('./scan');

/**
 * How LockGate treats a missing or gitignored lockfile.
 *
 * - auto (default): if a lockfile name is gitignored at that directory or
 *   above, treat it as an intentional library policy.
 * - library: always treat the tree as a library (no committed lockfile required).
 * - app: always require a committed lockfile and flag unfrozen installs,
 *   even if the lockfile is gitignored.
 */
function parseLockfilePolicy(value) {
  const v = String(value == null || value === '' ? 'auto' : value).trim().toLowerCase();
  if (v === 'auto' || v === 'library' || v === 'app') return v;
  return null;
}

function ignoreAppliesTo(gi, dir) {
  if (!gi.dir) return true;
  return dir === gi.dir || dir.startsWith(`${gi.dir}/`);
}

function findLockfileIgnore(collected, dir, lockName) {
  const file = dir ? `${dir}/${lockName}` : lockName;
  for (const gi of collected.gitignores || []) {
    if (!ignoreAppliesTo(gi, dir)) continue;
    const relToIgnore = gi.dir ? file.slice(gi.dir.length + 1) : file;
    if (pathIsIgnored(relToIgnore, gi.rules) || pathIsIgnored(lockName, gi.rules)) {
      return gi;
    }
  }
  return null;
}

function ignoredLockfileNames(collected, dir) {
  const names = [];
  let source = null;
  for (const name of ALL_LOCK_NAMES) {
    const gi = findLockfileIgnore(collected, dir, name);
    if (gi) {
      names.push(name);
      if (!source) source = gi;
    }
  }
  return { names, source };
}

function libraryPolicyAt(collected, dir, lockfilePolicy) {
  const policy = parseLockfilePolicy(lockfilePolicy) || 'auto';
  if (policy === 'library') return { active: true, via: 'lockfile-policy' };
  if (policy === 'app') return { active: false, via: 'lockfile-policy' };
  const { names, source } = ignoredLockfileNames(collected, dir);
  if (names.length) {
    return {
      active: true,
      via: 'gitignore',
      names,
      ignoreFile: source.file,
    };
  }
  return { active: false, via: 'auto' };
}

module.exports = {
  parseLockfilePolicy,
  findLockfileIgnore,
  ignoredLockfileNames,
  libraryPolicyAt,
};
