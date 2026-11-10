'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/main');

function capture(env, cwd) {
  const lines = [];
  const code = run({ ...env }, { cwd, log: (s) => lines.push(s) });
  return { code, lines };
}

describe('LockGate Lite action', () => {
  it('passes on a clean npm ci repo', () => {
    const cwd = path.join(__dirname, 'fixtures/clean');
    const { code, lines } = capture({ INPUT_ROOT: '.' }, cwd);
    assert.equal(code, 0, lines.join('\n'));
    assert.ok(lines.some((l) => /OK/i.test(l)), lines.join('\n'));
  });

  it('fails on mixed lockfiles and npm install in CI', () => {
    const cwd = path.join(__dirname, 'fixtures/drift');
    const { code, lines } = capture({ INPUT_ROOT: '.' }, cwd);
    assert.equal(code, 1);
    assert.ok(lines.some((l) => l.includes('mixed-lockfiles')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('unfrozen-ci')), lines.join('\n'));
  });

  it('returns 1 when the scan root is missing', () => {
    const { code, lines } = capture({ INPUT_ROOT: 'does-not-exist' }, __dirname);
    assert.equal(code, 1);
    assert.ok(lines.some((l) => /::error/.test(l)));
  });

  it('writes GitHub outputs when GITHUB_OUTPUT is set', () => {
    const out = path.join(os.tmpdir(), `lglite-out-${process.pid}.txt`);
    try {
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const cwd = path.join(__dirname, 'fixtures/drift');
      const { code } = capture({ INPUT_ROOT: '.', GITHUB_OUTPUT: out }, cwd);
      assert.equal(code, 1);
      const text = fs.readFileSync(out, 'utf8');
      assert.match(text, /^ok=false$/m);
      assert.match(text, /^codes=.*mixed-lockfiles/m);
      assert.match(text, /^codes=.*unfrozen-ci/m);
    } finally {
      try { fs.unlinkSync(out); } catch { /* ignore */ }
    }
  });

  it('honors the ignore input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lglite-ign-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'root',
      version: '1.0.0',
      dependencies: { 'left-pad': '^1.3.0' },
    }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    fs.mkdirSync(path.join(dir, 'examples', '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'examples', 'package.json'), JSON.stringify({
      name: 'ex',
      version: '1.0.0',
      dependencies: { debug: '^4.0.0' },
    }));
    fs.writeFileSync(path.join(dir, 'examples', 'package-lock.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'examples', 'yarn.lock'), '# yarn lockfile v1\n');
    fs.writeFileSync(path.join(dir, 'examples', '.github', 'workflows', 'ci.yml'), 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n');
    try {
      const unfiltered = capture({ INPUT_IGNORE: '' }, dir);
      assert.equal(unfiltered.code, 1, unfiltered.lines.join('\n'));
      const skipped = capture({ INPUT_IGNORE: 'examples' }, dir);
      assert.equal(skipped.code, 0, skipped.lines.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a library repo that gitignores lockfiles and runs npm install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lglite-lib-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'lib',
      version: '1.0.0',
      dependencies: { debug: '^4.0.0' },
    }));
    fs.writeFileSync(path.join(dir, '.gitignore'), 'package-lock.json\nyarn.lock\n');
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n');
    try {
      const { code, lines } = capture({ INPUT_ROOT: '.' }, dir);
      assert.equal(code, 0, lines.join('\n'));
      assert.ok(lines.some((l) => /library policy/.test(l) || /missing-lockfile/.test(l)), lines.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 1 for an unknown lockfile-policy input', () => {
    const cwd = path.join(__dirname, 'fixtures/clean');
    const { code, lines } = capture({ INPUT_ROOT: '.', 'INPUT_LOCKFILE-POLICY': 'maybe' }, cwd);
    assert.equal(code, 1);
    assert.ok(lines.some((l) => /Unknown lockfile-policy/.test(l)), lines.join('\n'));
  });
});
