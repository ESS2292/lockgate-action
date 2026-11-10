'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { runCheck } = require('./index');
const { formatHuman } = require('./format');

function getInput(name, env) {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined ? '' : String(v).trim();
}

function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function appendFile(file, text) {
  if (!file) return;
  try {
    fs.appendFileSync(file, text, 'utf8');
  } catch {
    /* summary/output files are best-effort */
  }
}

function setOutput(env, name, value) {
  appendFile(env.GITHUB_OUTPUT, `${name}=${String(value).replace(/[\r\n]/g, ' ')}\n`);
}

function buildSummary(result, { fatal, root }) {
  const lines = ['## LockGate Lite', ''];
  if (fatal) {
    lines.push(`:x: **Setup error:** ${fatal}`);
  } else if (result.ok) {
    const n = (result.lockfiles || []).length;
    lines.push(`:white_check_mark: Lockfiles and CI install commands look frozen (${n} lockfile${n === 1 ? '' : 's'} found).`);
  } else {
    const errors = result.findings.filter((f) => f.severity === 'error');
    lines.push(':x: The install is not frozen.', '', '| Code | Message |', '| --- | --- |');
    for (const f of errors) {
      lines.push(`| \`${f.code}\` | ${f.message.replace(/\|/g, '\\|')} |`);
    }
  }
  if (result && result.findings && result.findings.some((f) => f.severity === 'warning')) {
    const warnings = result.findings.filter((f) => f.severity === 'warning');
    lines.push('', `Warnings (${warnings.length}), not failing the job:`);
    for (const f of warnings) lines.push(`- \`${f.code}\`: ${f.message}`);
  }
  lines.push(
    '',
    `Scan root: \`${root}\`. Checks: mixed or missing lockfiles, packageManager mismatch, unfrozen CI installs.`,
    '',
    '---',
    'Need npm manifest-vs-lockfile sync, Dockerfile COPY/RUN checks, `--json`, or a local CLI? The full LockGate CLI covers those. Lite stays a GitHub Action.',
    ''
  );
  return lines.join('\n');
}

/**
 * Runs the action. Returns the exit code instead of exiting so tests can call it.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ log?: (s: string) => void, cwd?: string }} [io]
 */
function run(env = process.env, io = {}) {
  const log = io.log || ((s) => process.stdout.write(s + '\n'));
  const cwd = io.cwd || env.GITHUB_WORKSPACE || process.cwd();
  const rootInput = getInput('root', env) || '.';
  const ignore = getInput('ignore', env)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const root = path.resolve(cwd, rootInput);

  const failSetup = (msg) => {
    log(`::error title=LockGate Lite::${escapeData(msg)}`);
    setOutput(env, 'ok', 'false');
    setOutput(env, 'errors', '0');
    setOutput(env, 'warnings', '0');
    setOutput(env, 'codes', '');
    appendFile(env.GITHUB_STEP_SUMMARY, buildSummary(null, { fatal: msg, root: rootInput }));
    return 1;
  };

  let stat;
  try {
    stat = fs.statSync(root);
  } catch (err) {
    return failSetup(`Cannot read scan root "${rootInput}": ${err.message}`);
  }
  if (!stat.isDirectory()) {
    return failSetup(`Scan root is not a directory: ${rootInput}`);
  }

  const result = runCheck({ root, ignore });
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const codes = [...new Set(errors.map((f) => f.code))].join(',');

  setOutput(env, 'ok', result.ok ? 'true' : 'false');
  setOutput(env, 'errors', String(errors.length));
  setOutput(env, 'warnings', String(warnings.length));
  setOutput(env, 'codes', codes);

  for (const f of errors) {
    log(`::error title=LockGate Lite::${escapeData(`[${f.code}] ${f.message}`)}`);
  }
  for (const f of warnings) {
    log(`::warning title=LockGate Lite::${escapeData(`[${f.code}] ${f.message}`)}`);
  }

  log(formatHuman(result).trimEnd());
  appendFile(env.GITHUB_STEP_SUMMARY, buildSummary(result, { root: rootInput }));
  return result.ok ? 0 : 1;
}

function main() {
  const code = run(process.env);
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = { run, getInput, buildSummary };
