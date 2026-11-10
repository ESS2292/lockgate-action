'use strict';

/**
 * A small gitignore / dockerignore matcher. Supports comments, blank lines,
 * a leading slash (root-only), a trailing slash (directories), * and **
 * wildcards, and ! negation. It is not a complete gitignore implementation
 * (no escaped specials, no character classes).
 */

function parseIgnoreRules(text) {
  const rules = [];
  if (!text) return rules;
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let neg = false;
    let pattern = trimmed;
    if (pattern.startsWith('!')) {
      neg = true;
      pattern = pattern.slice(1);
    }
    rules.push({ pattern, neg, dirOnly: pattern.endsWith('/') });
  }
  return rules;
}

function globToRegExp(pattern) {
  let p = pattern;
  if (p.endsWith('/')) p = p.slice(0, -1);
  const rootOnly = p.startsWith('/');
  if (rootOnly) p = p.slice(1);

  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+{}()|[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }

  if (rootOnly) {
    return new RegExp(`^${re}(?:/|$)`);
  }
  return new RegExp(`(?:^|/)${re}(?:/|$)`);
}

function pathIsIgnored(relPath, rules) {
  const norm = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  const asDir = `${norm}/`;
  let ignored = false;
  for (const rule of rules) {
    const re = globToRegExp(rule.pattern);
    const hit = re.test(`${norm}/`) || re.test(asDir) || re.test(norm);
    if (hit) ignored = !rule.neg;
  }
  return ignored;
}

module.exports = { parseIgnoreRules, pathIsIgnored, globToRegExp };
