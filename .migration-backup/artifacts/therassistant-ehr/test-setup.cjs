// CJS-side hook for `pnpm test`. Registers a Node `require` handler
// for `.css` files so component imports like
// `import styles from "./Foo.module.css"` return an identity proxy
// (`styles.foo` -> "foo") instead of crashing the CJS loader. Mirrors
// the ESM hook in `test-css-loader.mjs`.
"use strict";

const Module = require("node:module");

// Stub Next's `server-only` package for unit tests so we can import library
// modules that guard themselves with `import "server-only"`. The real package
// throws when bundled into client code; in Node tests it just needs to exist.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
  if (request === "server-only") return require.resolve("./test-server-only-stub.cjs");
  return origResolve.call(this, request, parent, ...rest);
};

Module._extensions[".css"] = function cssExtension(mod) {
  mod.exports = new Proxy(
    {},
    { get: (_t, k) => (typeof k === "string" ? k : "") },
  );
};

if (process.env.DEBUG_TEST_SETUP) {
  console.error("[test-setup.cjs] .css extension registered");
}
