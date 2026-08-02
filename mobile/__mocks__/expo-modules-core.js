// __mocks__/expo-modules-core.js
//
// Jest-only stub for `expo-modules-core` (root + subpath imports),
// wired in via package.json `moduleNameMapper` with the regex
// `^expo-modules-core(.*)$` so the same file impersonates every import from
// the package — including the
// `expo-modules-core/src/polyfill/dangerous-internal` subpath that
// `jest-expo@57`'s preset setup calls in its module init phase.
//
// Why the stub exists
// -------------------
// mobile pins `expo@~57.0.0`, `jest-expo@~57.0.0`, `react-native@0.74.1` but
// does NOT list `expo-modules-core` as a direct dependency. `jest-expo@57`
// requires it at preset-setup time, so mobile can't run tests without an
// alternate source. The stub keeps the production bundle untouched and
// gives the suite a fast, deterministic runtime surface.
//
// Design rationale
// ----------------
// Babel's `_interopRequireWildcard` (used for every `import * as` and most
// named-import chains when `__esModule` is false or the consumer doesn't
// opt out) iterates the imported module via `for...in` / `Object.keys` to
// build a namespace object. Without custom Proxy traps, Babel's iteration
// only sees properties physically on the underlying target. Each new named
// export imported by a downstream package would otherwise resolve to
// `undefined` and surface a brand-new test failure.
//
// The Proxy traps below ensure:
//   - any unknown property access enum / destructuring returns either a
//     constructable class (`SafeFallbackClass`) or the curated mock from
//     `KNOWN_SHAPES`,
//   - `stub.default` resolves to the stub itself (so the CJS
//     interop-default convention is honoured),
//   - Proxy invariants are kept (we avoid Reflect.ownKeys because
//     functions' `length`/`name`/`prototype` properties are non-configurable
//     which would force us to return non-configurable descriptors and
//     destabilise the trap surface — using `Object.keys` restricts the
//     enumeration to user-land enumerable own keys).

'use strict';

const { EventEmitter } = require('events');

// SafeFallbackClass: universal default for any class-shaped named export we
// haven't curated. Real ES class — `typeof === 'function'` (satisfies
// Babel's `_inherits` check) and has a real `.prototype` chain (so `new
// SafeFallbackClass(...)` works regardless of argument count).
class SafeFallbackClass {}

// KNOWN_SHAPES maps every named import we've seen downstream packages
// (e.g. expo-notifications, expo-router) reach for on `expo-modules-core`
// to an explicit mock of the right kind:
//
//   - Class-shaped exports (UnavailabilityError, CodedError, ProxyNativeModule,
//     NativeModule, SharedObject, SharedRef, Subscription) point at
//     `SafeFallbackClass` so `new EMC.X(...)` and `class Y extends EMC.X {}`
//     both succeed.
//   - Function-shaped exports (uuid, createPermissionHook, …) point at
//     factory `jest.fn(...)`s so the consumer's call expression returns a
//     deterministic jest-mock-aware value rather than an instantiated
//     class instance.
//
// NOT in KNOWN_SHAPES: NotificationTimeoutError. It is DEFINED in
// expo-notifications/NotificationsHandler.ts (extending CodedError
// locally) — it is NOT imported from `expo-modules-core` and therefore
// would be dead-code if added here.

const KNOWN_SHAPES = {
  // ── Class-shaped exports (constructable) ─────────────────────────────────
  UnavailabilityError: SafeFallbackClass,
  CodedError: SafeFallbackClass,
  ProxyNativeModule: SafeFallbackClass,
  NativeModule: class NativeModule {},
  SharedObject: class SharedObject {},
  SharedRef: class SharedRef {},
  Subscription: SafeFallbackClass, // used in NotificationsHandler as a class for type annotations

  // ── Function-shaped exports (callable as plain functions) ────────────────
  // `uuid()` from expo-modules-core returns a string (used by
  // ServerRegistrationModule.*.ts). Returning a real string (not a class
  // instance) keeps `JSON.stringify({ id: uuid() })`-style call sites
  // honest.
  uuid: jest.fn(() => 'mock-uuid-0000-0000'),
  // `createPermissionHook(options)` is a higher-order function that
  // returns a React-style hook. The first call must return a callable
  // function; that function may itself be a hook returning a Promise.
  // The simplest honest shape that won't trip a "not a function" check
  // when downstream code does `usePermissions()` is a function-of-fn.
  createPermissionHook: jest.fn().mockImplementation(
    () => () => Promise.resolve(null),
  ),
};

// `safeCall` keeps the previous mock-function return value for the
// `safeNative` Proxy instance so existing jest-expo preset probes that
// counted `.mock.calls` continue to see consistent behavior.
const safeCall = jest.fn();
const safeNative = new Proxy(
  function () {},
  {
    get: () => safeCall,
    has: () => true,
  }
);

// Eagerly populate `globalThis.expo` so jest-expo's preset setup which
// destructures `const { EventEmitter, NativeModule, SharedObject } =
// globalThis.expo` succeeds before any other module reads from that
// global. Mirrors the same surface via a permissive Proxy.
function permissiveExpoGlobal() {
  if (typeof globalThis === 'undefined') return undefined;
  const backing = {};
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
      // Concrete shapes jest-expo destructures from globalThis.expo.
      if (prop === 'EventEmitter') return EventEmitter;
      if (prop === 'NativeModule') return KNOWN_SHAPES.NativeModule;
      if (prop === 'SharedObject') return KNOWN_SHAPES.SharedObject;
      if (prop === 'SharedRef') return KNOWN_SHAPES.SharedRef;
      if (prop === 'modules') return modulesRegistry;
      return SafeFallbackClass;
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

installExpoGlobalPolyfill();

// `underlying` is the Proxy target. Properties physically present here are
// discoverable by Babel's `_interopRequireWildcard` iteration (via
// `Object.keys`). We attach the keys we want to expose explicitly so direct
// property access (`stub.SomeKey`) and Babel's for-in-style copy both
// succeed.
const underlying = function () {};
Object.assign(underlying, {
  __esModule: true,
  // Spread KNOWN_SHAPES so the explicit mirror on `underlying` matches
  // what the Proxy `get` and `getOwnPropertyDescriptor` traps report.
  ...KNOWN_SHAPES,
  NativeModulesProxy: {
    viewManagersMetadata: {},
    expoModulesCoreProvider: {},
  },
  requireNativeModule: jest.fn(() => safeNative),
  requireOptionalNativeModule: jest.fn(() => safeNative),
  requireNativeViewManager: jest.fn(() => safeNative),
  EventEmitter,
  installExpoGlobalPolyfill: jest.fn(() => installExpoGlobalPolyfill()),
  Platform: { OS: process.env.NODE_TEST_PLATFORM || 'ios' },
});

// `stub` is the Proxy that wraps `underlying`. Traps:
//   - `has`: any property name reads as present, so feature-detect
//     `'foo' in stub` keeps working.
//   - `ownKeys` / `getOwnPropertyDescriptor`: enumerate user-land keys
//     (Object.keys) plus KNOWN_SHAPES; return configurable / enumerable
//     descriptors with the curated value. `Object.keys` (not
//     `Reflect.ownKeys`) is used to avoid the function-native
//     non-configurable `length`/`name`/`prototype` keys which would
//     otherwise force non-configurable descriptors and break Proxy
//     invariants on V8.
//   - `get`: returns true for `__esModule`, the stub itself for
//     `default`, otherwise target's own / KNOWN_SHAPES / SafeFallbackClass.
//   - `default` is writable per `getOwnPropertyDescriptor` so that any
//     CJS interop that tries `Module.default = X` does not crash.
//
// We deliberately do NOT add `module.exports.default = stub` at the end:
// `get('default')` already returns `stub`, so the assignment would try
// to redefine a non-writable property and crash with "TypeError:
// Cannot redefine property: default".
const stub = new Proxy(underlying, {
  has() {
    // Every probe reads as "present" so feature-detect branches
    // (`'foo' in stub`) keep flowing rather than misrouting.
    return true;
  },
  ownKeys(target) {
    const keys = new Set();
    // Reflect.ownKeys returns ALL own keys (enumerable + non-enumerable,
    // string + symbol). V8 enforces strict invariants on Proxy ownKeys:
    // any non-configurable own property of the target MUST be reported.
    // Function targets have `length`, `name`, `prototype` as own props;
    // reporting them keeps V8 from raising
    // `'ownKeys' on proxy: trap result did not include 'prototype'`.
    for (const k of Reflect.ownKeys(target)) keys.add(k);
    for (const k of Object.keys(KNOWN_SHAPES)) keys.add(k);
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target, prop) {
    // For target's own keys (incl. non-configurable function-native ones),
    // return the real descriptor. `Reflect.getOwnPropertyDescriptor`
    // returns `configurable: true` for `length`/`name`/`prototype` of a
    // plain function, so this satisfies the Proxy invariant.
    if (Reflect.ownKeys(target).includes(prop)) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
    if (Object.prototype.hasOwnProperty.call(KNOWN_SHAPES, prop)) {
      return {
        value: KNOWN_SHAPES[prop],
        writable: true,
        enumerable: true,
        configurable: true,
      };
    }
    // For any other property name Babel enumerates that we haven't
    // curated, return a constructable class so class-extension chains
    // don't explode.
    return {
      value: SafeFallbackClass,
      writable: true,
      enumerable: true,
      configurable: true,
    };
  },
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return stub;
    // Surface target's prototype/length/name transparently so consumers
    // that read `function.prototype` or inspect function-arities don't
    // see a fake SafeFallbackClass.
    if (Reflect.ownKeys(target).includes(prop)) {
      return Reflect.get(target, prop);
    }
    if (Object.prototype.hasOwnProperty.call(KNOWN_SHAPES, prop)) {
      return KNOWN_SHAPES[prop];
    }
    return SafeFallbackClass;
  },
});

module.exports = stub;
