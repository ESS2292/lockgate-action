'use strict';

const { scan } = require('./scan');
const { analyze } = require('./check');

/**
 * Run a LockGate Lite check against a project root.
 * Mixed / missing lockfiles, packageManager mismatch, and unfrozen CI only.
 * @param {object} options
 * @param {string} options.root
 * @param {string[]} [options.ignore]
 * @param {string} [options.lockfilePolicy] auto | library | app
 * @param {boolean} [options.skipFixtures] default true
 */
function runCheck(options) {
  const collected = scan(options.root, {
    ignore: options.ignore,
    skipFixtures: options.skipFixtures,
  });
  return analyze(collected, { lockfilePolicy: options.lockfilePolicy });
}

module.exports = { runCheck };
