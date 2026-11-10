'use strict';

const FROZEN_FLAGS = new Set([
  '--frozen-lockfile',
  '--immutable',
  '--offline',
]);

function stripComments(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '#') {
      break;
    } else {
      out += c;
    }
  }
  return out.trimEnd();
}

function joinContinuations(text) {
  const lines = String(text).split(/\r?\n/);
  const joined = [];
  let buf = '';
  for (const line of lines) {
    const stripped = stripComments(line);
    if (buf) {
      buf = `${buf} ${stripped.replace(/^\s+/, '')}`;
    } else {
      buf = stripped;
    }
    if (buf.endsWith('\\')) {
      buf = buf.slice(0, -1).trimEnd();
      continue;
    }
    joined.push(buf);
    buf = '';
  }
  if (buf) joined.push(buf);
  return joined;
}

function tokenize(command) {
  const tokens = [];
  let cur = '';
  let quote = null;
  const s = command.trim();
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1];
      i += 1;
      continue;
    }
    if (/\s/.test(c) || c === ';' || c === '&' || c === '|') {
      if (cur) tokens.push(cur);
      cur = '';
      // Treat &&, ||, ; as separators between commands by returning chunks later
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function splitCommandChains(command) {
  // Split on ;, &&, ||, but not inside quotes.
  const parts = [];
  let cur = '';
  let quote = null;
  const s = String(command);
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ';' || (c === '&' && s[i + 1] === '&') || (c === '|' && s[i + 1] === '|')) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      if (c !== ';') i += 1;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function hasFrozenFlag(tokens) {
  return tokens.some((t) => FROZEN_FLAGS.has(t) || t.startsWith('--frozen-lockfile') || t.startsWith('--immutable'));
}

function positionalArgs(tokens, start) {
  const flagsWithValue = new Set([
    '--prefix', '--omit', '--include', '--install-strategy', '--workspace',
    '--tag', '--userconfig', '--cache', '--loglevel', '--registry',
    '--filter', '--dir', '--cwd',
  ]);
  const out = [];
  for (let i = start; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      if (flagsWithValue.has(t) && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        i += 1;
      }
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Classify a single shell command.
 * Returns null when it is not a package-manager install.
 * kind: 'npm' | 'yarn' | 'pnpm' | 'bun'
 * frozen: boolean
 * addingPackage: boolean (npm install lodash, yarn add, …)
 * implicitCiDefault: true when the tool itself freezes on CI=true
 */
function classifyInstall(command) {
  const parts = splitCommandChains(command);
  const results = [];
  for (const part of parts) {
    const tokens = tokenize(part).map((t) => t);
    if (tokens.length === 0) continue;
    const bin = tokens[0].replace(/(\.cmd|\.exe)$/i, '').toLowerCase();
    const args = tokens.slice(1);
    const first = (args[0] || '').toLowerCase();

    if (bin === 'npm') {
      const aliases = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal']);
      if (first === 'ci' || first === 'clean-install' || first === 'ic') {
        results.push({ kind: 'npm', frozen: true, addingPackage: false, implicitCiDefault: false, raw: part });
        continue;
      }
      if (!aliases.has(first) && first !== '') continue;
      // bare `npm` is not an install
      if (!aliases.has(first)) continue;
      const rest = positionalArgs(tokens, 2);
      const addingPackage = rest.some((r) => r !== '.' && r !== './');
      results.push({
        kind: 'npm',
        frozen: false,
        addingPackage,
        implicitCiDefault: false,
        raw: part,
      });
      continue;
    }

    if (bin === 'yarn') {
      if (first === 'add' || first === 'remove' || first === 'upgrade' || first === 'up' || first === 'dlx' || first === 'run' || first === 'exec') {
        continue;
      }
      if (first && first !== 'install' && first.startsWith('-') === false && first !== '') {
        // `yarn build` etc.
        if (first !== 'install') continue;
      }
      // `yarn` or `yarn install` (with optional flags)
      if (first && first !== 'install' && !first.startsWith('-')) continue;
      results.push({
        kind: 'yarn',
        frozen: hasFrozenFlag(tokens),
        addingPackage: false,
        implicitCiDefault: false, // Yarn 1 does not freeze; Berry does on CI — callers decide
        raw: part,
      });
      continue;
    }

    if (bin === 'pnpm') {
      const aliases = new Set(['install', 'i']);
      if (!aliases.has(first)) continue;
      results.push({
        kind: 'pnpm',
        frozen: hasFrozenFlag(tokens),
        addingPackage: positionalArgs(tokens, 2).length > 0,
        implicitCiDefault: true,
        raw: part,
      });
      continue;
    }

    if (bin === 'bun') {
      if (first === 'ci') {
        results.push({ kind: 'bun', frozen: true, addingPackage: false, implicitCiDefault: false, raw: part });
        continue;
      }
      if (first !== 'install' && first !== 'i') continue;
      results.push({
        kind: 'bun',
        frozen: hasFrozenFlag(tokens),
        addingPackage: positionalArgs(tokens, 2).length > 0,
        implicitCiDefault: false,
        raw: part,
      });
    }
  }
  return results;
}

function extractRunScriptsFromWorkflow(text) {
  const scripts = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const block = line.match(/^(\s*)(?:-\s+)?run:\s*(\||>)\s*(?:#.*)?$/);
    if (block) {
      const indent = block[1].length;
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const l = lines[j];
        if (!l.trim()) {
          body.push('');
          continue;
        }
        const thisIndent = l.match(/^(\s*)/)[1].length;
        if (thisIndent <= indent) break;
        body.push(l.slice(thisIndent));
      }
      scripts.push({ line: i + 1, command: body.join('\n') });
      i = j - 1;
      continue;
    }
    const single = line.match(/^\s*(?:-\s+)?run:\s*(.+)$/);
    if (single) {
      let cmd = single[1].trim();
      if ((cmd.startsWith('"') && cmd.endsWith('"')) || (cmd.startsWith("'") && cmd.endsWith("'"))) {
        cmd = cmd.slice(1, -1);
      }
      cmd = stripComments(cmd);
      if (cmd) scripts.push({ line: i + 1, command: cmd });
    }
  }
  return scripts;
}

module.exports = {
  stripComments,
  tokenize,
  splitCommandChains,
  classifyInstall,
  extractRunScriptsFromWorkflow,
};
