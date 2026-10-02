/* eslint-disable no-undef */
// jest.globals-polyfill.js
//
// Polyfill React.act for @testing-library/react-native v14.
//
// `dist/act.js` does:
//   const React = _interopRequireWildcard(require('react'));
//   const reactAct = React.act;
//   const _act = withGlobalActEnvironment(reactAct);
//
// React 18.2.0 (the installed version) does NOT expose `act` on its CJS
// exports. When `React.__esModule` is falsy, `_interopRequireWildcard`
// creates a NEW object that snapshots React's enumerable properties at
// require-time. If `act` is undefined at that moment, the new object
// never gets `act` even if we mutate the original React module afterwards.
//
// The fix is two-part:
//   1. Set `React.__esModule = true` BEFORE any consumer requires react.
//      This forces `_interopRequireWildcard` to return the original React
//      module directly, so subsequent mutations propagate.
//   2. Set `React.act = ReactTestRenderer.act` so the function is available
//      when `act.js` reads `React.act`.
//
// `react-test-renderer.act` is the canonical implementation behind React 18's
// internal `act` anyway, so borrowing it is safe.
//
// The Web globals polyfill (ReadableStream/Blob/FormData/Headers) lives in
// a separate `jest.web-globals-polyfill.js` file so it can be ordered
// before this entry in `package.json`'s `setupFiles` array.

'use strict';

// Belt-and-suspenders: @testing-library/react-native@14.0.1's `dist/act.js`
// calls `getIsReactActEnvironment()` and sets `IS_REACT_ACT_ENVIRONMENT = true`
// around `act(...)`. On some Jest/React combos the flag is the actual gate
// for whether React flushes micro-tasks inside `act`. Set it FIRST so it's
// present before any consumer (including the preset's setupFiles) probes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
React.__esModule = true;
const ReactTestRenderer = require('react-test-renderer');
if (typeof React.act === 'undefined' && typeof ReactTestRenderer.act === 'function') {
  React.act = ReactTestRenderer.act;
}
