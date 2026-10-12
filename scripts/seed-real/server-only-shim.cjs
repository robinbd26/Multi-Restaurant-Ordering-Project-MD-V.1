/* eslint-disable @typescript-eslint/no-require-imports -- a `node --require` preload must be CommonJS */
// Lets `npm run seed:real` (a plain Node + tsx process) import the app's own
// service layer. Those modules start with `import "server-only"`, a marker that
// Next's bundler resolves to an empty module. Plain Node cannot resolve it, so
// this preload points it at the same empty module Next uses. Nothing else is
// redirected.
const Module = require("node:module");

const empty = require.resolve("next/dist/compiled/server-only/empty.js");
const original = Module._resolveFilename;
Module._resolveFilename = function resolveServerOnly(request, ...rest) {
  if (request === "server-only") return empty;
  return original.call(this, request, ...rest);
};
