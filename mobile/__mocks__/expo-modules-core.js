// __mocks__/expo-modules-core.js
//
// Jest-only stub for `expo-modules-core` (root + subpath imports),
// wired in via package.json `moduleNameMapper` with the regex
// `^expo-modules-core(.*)$` so the same file impersonates every import from
// that package — including the `expo-modules-core/src/polyfill/dangerous-internal`
// subpath that `jest-expo@57`'s preset setup calls at line 319.
//
// Why the stub exists:
// `jest-expo@57` requires `expo-modules-core` at preset-setup time, both as
//   1. `jest.requireActual('expo-modules-core')` (line ~234), and
//   2. `require('expo-modules-core/src/polyfill/dangerous-internal')
//          .installExpoGlobalPolyfill()` (line ~319).
// The package is not part of our pinned dependency list (mobile pins
// `expo@~57.0.0`, `jest-expo@~57.0.0`, `react-native@0.74.1`) and pulling it in
// risks a transitive-version conflict that defeats the surgical approach of
// the previous stubbing commits (#168). A narrow test-runtime shim keeps the
// production bundle untouched and lets the suite run end-to-end.
//
// Surface area covered:
//   - NativeModulesProxy (read by jest-expo for forEach over view managers)
//   - requireNativeModule / requireOptionalNativeModule (no-op callables)
//   - requireNativeViewManager (no-op callable)
//   - EventEmitter — Node's built-in (`emit`, `on`, `off`, `once`,
//     `removeListener`, `listenerCount`, etc. all behave natively)
//   - installExpoGlobalPolyfill (no-op stub for the subpath require)
//   - Platform.OS — defaults to 'ios', overridable via NODE_TEST_PLATFORM so
//     Android-specific code paths can be exercised in tests where needed.
//
// Safety guarantees:
//   - Proxy `has` trap returns `true` for any property, so `'foo' in stub`
//     feature-detect probes in jest-expo don't misroute.
//   - Proxy `get` trap returns `jest.fn()` for any missing property, so a
//     stray `someStub.someMethod()` call crashes on `undefined`-style errors.
//   - `__esModule: true` is set so `import * as EMC` / interop-aware
//     transpilers resolve `default` correctly under both our babel+jest and
//     downstream consumers.

const { EventEmitter } = require('events');

const safeCall = jest.fn();
const safeNative = new Proxy(
  {},
  {
    get: () => safeCall,
    has: () => true,
  }
);

// In the real package, `installExpoGlobalPolyfill()` monkey-patches
// `globalThis.expo` so jest-expo's preset setup (and any module that imports
// `expo-modules-core` from a global context) can pull shapes via
// `const { EventEmitter, NativeModule, SharedObject } = globalThis.expo`
// and later set arbitrary sub-properties (ExpoFetchModule, etc.). To avoid a
// long tail of "Cannot set property X of undefined" errors as jest-expo@57
// probes more shapes, we model `globalThis.expo` as a permissive Proxy — the
// same pattern used for the BatchedBridge/NativeModules shim:
// set / defineProperty silently succeed, get returns a callable jest.fn()
// for missing keys, and `has` lies so feature-detect branches keep flowing.
function permissiveExpoGlobal() {
  if (typeof globalThis === 'undefined') return undefined;
  const backing = {};
  // `modules` is jest-expo@57's native module registry. The preset assigns to
  // `globalThis.expo.modules.ExpoFetchModule` etc. and later queries them by
  // name. A nested Proxy keeps the registry behaviorally identical to a real
  // object while staying forgiving for probes jest-expo hasn't done yet.
  const modulesRegistry = new Proxy({}, {
    set(t, p, v) {
      t[p] = v;
      return true;
    },
    defineProperty(t, p, d) {
      Object.defineProperty(t, p, d);
      return true;
    },
    get(t, p) {
      return p in t ? t[p] : safeNative;
    },
    has() {
      return true;
    },
  });

  const proxy = new Proxy(backing, {
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    defineProperty(target, prop, descriptor) {
      Object.defineProperty(target, prop, descriptor);
      return true;
    },
    get(target, prop) {
      if (prop in target) return target[prop];
      // Concrete shapes jest-expo / expo destructures: provide real values.
      if (prop === 'EventEmitter') return EventEmitter;
      if (prop === 'NativeModule') return class NativeModule {};
      if (prop === 'SharedObject') return class SharedObject {};
      if (prop === 'SharedRef') return class SharedRef {};
      if (prop === 'modules') return modulesRegistry;
      return jest.fn();
    },
    has() {
      return true;
    },
  });
  globalThis.expo = proxy;
  return proxy;
}

function installExpoGlobalPolyfill() {
  permissiveExpoGlobal();
}

// Eagerly populate once so destructuring at jest-expo preset setup time
// (line ~236) succeeds even before requireActual has had a chance to run.
installExpoGlobalPolyfill();

const underlying = {
  __esModule: true,
  NativeModulesProxy: {
    viewManagersMetadata: {},
    expoModulesCoreProvider: {},
  },
  requireNativeModule: jest.fn(() => safeNative),
  // Return a safeNative Proxy rather than null so destructuring at call
  // sites (`const { foo } = requireOptionalNativeModule('bar')`) does not
  // crash with "Cannot destructure property 'foo' of null". Mirrors how the
  // real expo-modules-core exposes an empty shape for absent modules.
  requireOptionalNativeModule: jest.fn(() => safeNative),
  requireNativeViewManager: jest.fn(() => safeNative),
  EventEmitter,
  // Subpath import: `expo-modules-core/src/polyfill/dangerous-internal`
  installExpoGlobalPolyfill: jest.fn(() => installExpoGlobalPolyfill()),
  Platform: { OS: process.env.NODE_TEST_PLATFORM || 'ios' },
};

const stub = new Proxy(underlying, {
  has(target, prop) {
    // Make every probed key look present so feature-detects behave.
    return prop in target || true;
  },
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return stub;
    if (prop in target) return target[prop];
    // Unknown prop — return a no-op jest.fn() so callable invocations
    // silently succeed instead of crashing on `undefined`.
    return jest.fn();
  },
});

module.exports = stub;
module.exports.default = stub;
