/**
 * Swiftly - Lightweight HTTP client (CommonJS entry)
 * @author hiudy
 * @license MIT
 */

'use strict';

// Unwrap the default export so `require('swiftly')` returns the client
// function directly (with all static methods attached), like the original API.
const bundle = require('./dist/index.cjs');
const swiftly = bundle.default || bundle;

module.exports = swiftly;
module.exports.default = swiftly;