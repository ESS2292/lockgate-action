'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCheck } = require('../src/index');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lglite-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

describe('LockGate Lite checks', () => {
  it('does not treat package-lock.json plus npm-shrinkwrap.json as mixed', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      'npm-shrinkwrap.json': '{"lockfileVersion":3,"packages":{}}\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      assert.ok(!codes(result).includes('mixed-lockfiles'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when a manifest with dependencies has no lockfile', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, false);
      assert.ok(codes(result).includes('missing-lockfile'));
      assert.equal(result.findings.find((f) => f.code === 'missing-lockfile').severity, 'error');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns, and still passes, when a manifest with no dependencies has no lockfile', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      const missing = result.findings.find((f) => f.code === 'missing-lockfile');
      assert.ok(missing);
      assert.equal(missing.severity, 'warning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets a workspace package inherit a parent lockfile', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      'packages/app/package.json': JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
    });
    try {
      const result = runCheck({ root: dir });
      assert.ok(!codes(result).includes('missing-lockfile'), JSON.stringify(result.findings));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when packageManager does not match the lockfile in scope', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        packageManager: 'pnpm@9.12.0',
        dependencies: { 'left-pad': '^1.3.0' },
      }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, false);
      assert.ok(codes(result).includes('package-manager-mismatch'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag npm install some-package as an unfrozen CI install', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm install debug --no-save\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      assert.ok(!codes(result).includes('unfrozen-ci'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on bare pnpm install in CI and does not fail the check', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      const w = result.findings.find((f) => f.code === 'implicit-frozen-ci');
      assert.ok(w);
      assert.equal(w.severity, 'warning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on bare yarn install when yarn.lock is Berry, and errors for Yarn 1', () => {
    const berry = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'yarn.lock': '__metadata:\n  version: 6\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: yarn install\n',
    });
    const classic = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'yarn.lock': '# yarn lockfile v1\n\nleft-pad@^1.3.0:\n  version "1.3.0"\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: yarn install\n',
    });
    try {
      const b = runCheck({ root: berry });
      assert.equal(b.ok, true, JSON.stringify(b.findings));
      assert.ok(b.findings.some((f) => f.code === 'implicit-frozen-ci' && f.severity === 'warning'));

      const c = runCheck({ root: classic });
      assert.equal(c.ok, false);
      assert.ok(codes(c).includes('unfrozen-ci'));
    } finally {
      fs.rmSync(berry, { recursive: true, force: true });
      fs.rmSync(classic, { recursive: true, force: true });
    }
  });

  it('does not flag npm manifest drift or Dockerfile issues (CLI-only checks)', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        dependencies: { 'left-pad': '^1.3.0', debug: '^4.3.4' },
      }),
      'package-lock.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { 'left-pad': '^1.3.0' } },
          'node_modules/left-pad': { version: '1.3.0' },
        },
      }),
      'Dockerfile': 'FROM node:22-alpine\nCOPY package.json .\nRUN npm install\n',
      '.gitignore': 'package-lock.json\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      const unexpected = result.findings.filter((f) => [
        'lockfile-out-of-sync',
        'unfrozen-docker',
        'docker-missing-lockfile',
        'lockfile-ignored',
        'lockfile-dockerignored',
      ].includes(f.code));
      assert.deepEqual(unexpected, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('downgrades a missing gitignored lockfile to a warning and does not flag npm install', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
      '.gitignore': 'package-lock.json\nyarn.lock\npnpm-lock.yaml\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
      const missing = result.findings.find((f) => f.code === 'missing-lockfile');
      assert.ok(missing);
      assert.equal(missing.severity, 'warning');
      assert.match(missing.message, /library policy/);
      assert.ok(!codes(result).includes('unfrozen-ci'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats lockfile-policy=library as a warning without a gitignore, and app still errors', () => {
    const lib = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n',
    });
    const ignored = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
      '.gitignore': 'package-lock.json\n',
      '.github/workflows/ci.yml': 'on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n',
    });
    try {
      const library = runCheck({ root: lib, lockfilePolicy: 'library' });
      assert.equal(library.ok, true, JSON.stringify(library.findings));
      assert.equal(library.findings.find((f) => f.code === 'missing-lockfile').severity, 'warning');
      assert.ok(!codes(library).includes('unfrozen-ci'));

      const app = runCheck({ root: ignored, lockfilePolicy: 'app' });
      assert.equal(app.ok, false);
      assert.equal(app.findings.find((f) => f.code === 'missing-lockfile').severity, 'error');
      assert.ok(codes(app).includes('unfrozen-ci'));
    } finally {
      fs.rmSync(lib, { recursive: true, force: true });
      fs.rmSync(ignored, { recursive: true, force: true });
    }
  });

  it('skips tests/fixtures manifests by default, and includes them when skipFixtures is false', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      'tests/fixtures/demo/package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { debug: '^4.0.0' } }),
      'tests/fixtures/demo/package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      'tests/fixtures/demo/yarn.lock': '# yarn lockfile v1\n',
    });
    try {
      const skipped = runCheck({ root: dir });
      assert.equal(skipped.ok, true, JSON.stringify(skipped.findings));
      assert.ok(!codes(skipped).includes('mixed-lockfiles'));
      const included = runCheck({ root: dir, skipFixtures: false });
      assert.equal(included.ok, false);
      assert.ok(included.findings.some((f) => f.code === 'mixed-lockfiles' && /tests\/fixtures/.test(f.file || f.message)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still errors on mixed lockfiles in an app repo (nightdeck-style)', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { 'left-pad': '^1.3.0' } }),
      'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
      'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    });
    try {
      const result = runCheck({ root: dir });
      assert.equal(result.ok, false);
      assert.ok(result.findings.some((f) => f.code === 'mixed-lockfiles' && f.severity === 'error'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
