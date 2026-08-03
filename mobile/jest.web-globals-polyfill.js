/* eslint-disable no-undef */
// jest.web-globals-polyfill.js
//
// Standalone polyfill for the WinterCG/Web runtime globals that jsdom and
// Node (under 18) lack. Expo Router (`expo/src/winter/runtime.native.ts`)
// and other WinterCG-dependent packages probe these at module-load time:
//   if (!globalThis.ReadableStream) throw new Error(...)
//   if (typeof globalThis.Blob === 'undefined') throw new Error(...)
// and downstream babel transforms error out if the probes fire.
//
// This file is intentionally separate from `jest.globals-polyfill.js` so
// the Web globals can be installed as the first user setupFile entry
// (closest to the preset's setupFiles in Jest's load order). Each entry
// is gated by `typeof globalThis.X === 'undefined'` so a healthy Node
// 18+ environment keeps its native implementations.
//
// Empty classes are sufficient: feature-detection checks
// (typeof === 'function', instanceof X, new X()) pass, while method
// calls (X.prototype.get/set/append) crash. The issue-168 AC suite does
// not exercise method-level semantics, so an empty class is the minimum
// surface that unblocks the test runtime.

'use strict';

const POLYFILLS = ['ReadableStream', 'Blob', 'FormData', 'Headers'];

for (const name of POLYFILLS) {
  if (typeof globalThis[name] === 'undefined') {
    // eslint-disable-next-line no-global-assign
    globalThis[name] = class {};
  }
}
