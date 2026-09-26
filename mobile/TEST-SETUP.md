# mobile/ Test Setup

## TL;DR

The mobile Jest rig is a non-obvious five-piece system that bridges three
incompatible packages in our dependency tree:

- `jest-expo@~57` (preset, expects `expo-modules-core`)
- `@testing-library/react-native@14` (a.k.a. RNTL@14 — imports a non-existent `test-renderer` package and uses React 18.3-style `act`)
- `react@18.2.0` (older than what RNTL@14 expects)
- `expo-notifications`, `expo-secure-store`, etc. (downstream deps importing named classes from `expo-modules-core`)

Without these workarounds every test either crashes during module-load
(`Super expression must either be null or a function` / `extends undefined`)
or, if a future test file blindly re-introduces `jest.useFakeTimers()`,
will hang at the 5s Jest default waiting for `waitFor()` to poll (see
Lessons learned below).

## The five pieces

### 1. `EXPO_PUBLIC_USE_RN_FETCH=1` in `scripts.test`

`expo/src/winter/fetch.*` has a broken `FetchResponse` chain under Node
that throws `Super expression must either be null or a function` at
test-load time. Setting `EXPO_PUBLIC_USE_RN_FETCH=1` switches the runtime
to the React Native fetch shim, which sidesteps the chain entirely. Drop
this env var and `mobile/__tests__/ProjectDetailScreen.test.tsx` reverts
to that crash on the very first `import`.

### 2. `moduleNameMapper["^test-renderer$"]` → `__mocks__/test-renderer.js`

`@testing-library/react-native@14`'s `dist/render.js` does
`require("test-renderer")`. There is no `test-renderer` package in
`node_modules` — the React team ships `react-test-renderer` instead. The
redirect points at the shim below. Drop it and every `render()` call
throws `(0, _testRenderer.createRoot) is not a function`.

### 3. `mobile/__mocks__/test-renderer.js` — the shim

Re-exports the real `react-test-renderer` PLUS `createRoot` (which RT@18
doesn't expose from its default entry, only from `.development.js`) and
`actImplementation` (which `dist/act.js` actually reads — its parameter
name in the stack trace is misleading). Both are declared as literal
`function name(...) { ... }` so the export is unconditionally a function
regardless of `react-test-renderer` API drift.

### 4. `mobile/__mocks__/expo-modules-core.js` — the durable Proxy stub

Expo packages (`expo-notifications`, `expo-secure-store`, etc.) import
many named classes from `expo-modules-core` (`CodedError`,
`UnavailabilityError`, `ProxyNativeModule`, `NotificationTimeoutError`).
Babel's `_interopRequireWildcard` enumerates the Proxy's `ownKeys` and
crashes if any unknown key surfaces as `undefined`. We use a Proxy whose
`ownKeys` trap returns `new Set([...Reflect.ownKeys(target), ...Object.keys(KNOWN_SHAPES)])`
where `KNOWN_SHAPES` is a curated class-shaped fallback map. The
`Reflect.ownKeys(target)` piece is non-negotiable: it forwards the real
function's `length`/`name`/`prototype`, which V8 (beyond the ES spec)
requires every proxy `ownKeys` trap to include. Without it Jest throws
`ownKeys on proxy: trap result did not include 'prototype'`. With it,
every unknown class import succeeds without per-class whack-a-mole.

### 5. `mobile/__mocks__/utils/notifications.js` — shared notification-surface mock

This piece is unique in that it is **not auto-applied**: jest does NOT
auto-resolve `__mocks__/` for application-scoped (non-`node_modules`)
modules. Each test file that imports from `mobile/utils/notifications`
must explicitly opt in via:

```js
// Factory-less jest.mock — picks up the __mocks__/utils/notifications.js
// default exports as the surface for this test run.
jest.mock('../utils/notifications');
```

The mock supplies stable defaults for every named export in
`utils/notifications.ts`, including a `{ remove: jest.fn() }`
subscription shape for both listener setters. Without this stable shape,
every HomeScreen / accessibility test crashes at RNTL `afterEach` unmount
with `TypeError: subscription.remove is not a function` because the
underlying `expo-modules-core` Proxy stub returns an empty class instance
for `Notifications.addNotificationReceivedListener`.

Per-test overrides use the standard `jest.spyOn(notifUtils, 'X')` pattern.
`ProjectDetailScreen.test.tsx` keeps an explicit factory because its
suite asserts specific call patterns per-test via
`(notifUtils.X as jest.Mock).mockResolvedValueOnce(…)` — the auto-mock's
default `mockResolvedValue(false)` would break those.

## Supplementary polyfills (`setupFiles`)

Two setupFiles fill the WinterCG/Web globals and React 18 `act`:

**`mobile/jest.web-globals-polyfill.js`** — empty-class fallbacks for
`ReadableStream` / `Blob` / `FormData` / `Headers` (gated by
`typeof globalThis.X === 'undefined'`).

**`mobile/jest.globals-polyfill.js`** — sets
`globalThis.IS_REACT_ACT_ENVIRONMENT = true` first thing, then forces
`React.__esModule = true` (so `_interopRequireWildcard` returns the
original React module, not a snapshot) and assigns
`React.act = ReactTestRenderer.act` (React 18.2's CJS exports don't
expose `act`; RNTL@14's `dist/act.js` does `const reactAct = React.act`
and crashes on undefined).

## Lessons learned (read before debugging)

- **`jest.useFakeTimers()` breaks `waitFor()`.** The Testing Library
  `waitFor()` polls via `setTimeout` every 50ms; under fake timers the
  poll never fires and tests time out at the 5s default. *Do not call
  `jest.useFakeTimers()` in test files that use `waitFor()`.* See
  `mobile/__tests__/ProjectDetailScreen.test.tsx` for the canonical
  pattern (fake-timer calls removed and documented inline).

- **`render()` is async in RNTL@14.** Tests must `await
  renderWithTheme(...)` / `render(...)`. Forgetting the `await` surfaces
  as `screen.getByText is not a function` (because `screen` ends up being
  the unresolved Promise).

- **Animated-component `act()` warnings are a known TestRenderer-vs-RN-Animated
  interaction.** RN Animated state updates emit
  `warnIfUpdatesNotWrappedWithActDEV`. They do not fail tests, but they
  flood test output. Wrap renders in `await act(...)` if the noise is
  unacceptable; otherwise leave them — silencing them via a polyfill would
  suppress real signal from genuinely-unwrapped updates elsewhere.

## Files at a glance

| File | Why it exists |
|---|---|
| `mobile/package.json` | `scripts.test` env, `moduleNameMapper`, `setupFiles` |
| `mobile/__mocks__/test-renderer.js` | RNTL@14 → RT@18 bridge |
| `mobile/__mocks__/expo-modules-core.js` | Durable Proxy stub for expo internals |
| `mobile/__mocks__/utils/notifications.js` | Shared notification-surface defaults (opt-in per test file via factory-less `jest.mock('../utils/notifications')`) |
| `mobile/jest.web-globals-polyfill.js` | Web globals empty-class fallbacks |
| `mobile/jest.globals-polyfill.js` | `React.act` + `IS_REACT_ACT_ENVIRONMENT` |

## Verifying the rig is intact

```sh
# Smoke test — if you see zero passing suites, one of the five pieces
# is broken. The exact passing-test count will drift as the suite
# evolves; treat "≥ 1 passing suite" as the bar, not a precise number.
EXPO_PUBLIC_USE_RN_FETCH=1 npx jest --no-coverage --no-cache \
  __tests__/ProjectDetailScreen.test.tsx 2>&1 | grep -E 'Tests:|Test Suites:'
```

The failure-mode → piece mapping is documented at the top of this file.
