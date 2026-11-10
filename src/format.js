'use strict';

function formatHuman(result) {
  const lines = [];
  const manifestCount = (result.manifests || []).length;
  const lockCount = (result.lockfiles || []).length;
  lines.push(`LockGate Lite checked ${manifestCount} package.json file${manifestCount === 1 ? '' : 's'} and ${lockCount} lockfile${lockCount === 1 ? '' : 's'}.`);

  if (result.scanErrors && result.scanErrors.length) {
    lines.push('');
    lines.push('Scan issues:');
    for (const err of result.scanErrors) {
      lines.push(`  - ${err.file}: ${err.message}`);
    }
  }

  if (!result.findings.length) {
    if (manifestCount === 0 && lockCount === 0) {
      lines.push('No package manifests or lockfiles found.');
    } else {
      lines.push('OK — lockfiles and CI install commands look frozen.');
    }
    return `${lines.join('\n')}\n`;
  }

  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');

  if (errors.length) {
    lines.push('');
    lines.push(`Errors (${errors.length}):`);
    for (const f of errors) {
      lines.push(`  [${f.code}] ${f.message}`);
    }
  }
  if (warnings.length) {
    lines.push('');
    lines.push(`Warnings (${warnings.length}):`);
    for (const f of warnings) {
      lines.push(`  [${f.code}] ${f.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { formatHuman };
