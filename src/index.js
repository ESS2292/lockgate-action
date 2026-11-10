'use strict';

const { scan } = require('./scan');
const { analyze } = require('./check');

/**
 * Run a LockGate Lite check against a project root.
 * Mixed / missing lockfiles, packageManager mismatch, and unfrozen CI only.
 * @param {object} options
 * @param {string} options.root
 * @param {string[]} [options.ignore]
 */
function runCheck(options) {
  const collected = scan(options.root, { ignore: options.ignore });
  return analyze(collected);
}

module.exports = { runCheck };
