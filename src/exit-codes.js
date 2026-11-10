'use strict';

/** Successful check — no violations. */
const PASS = 0;
/** Check found violations (mixed lockfiles, out of sync, unfrozen install, …). */
const VIOLATIONS = 1;
/** Usage error or scan root missing / unreadable. */
const USAGE_OR_FILE = 2;

module.exports = { PASS, VIOLATIONS, USAGE_OR_FILE };
