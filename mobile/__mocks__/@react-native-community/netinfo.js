/**
 * __mocks__/@react-native-community/netinfo.js
 *
 * `@react-native-community/netinfo` is a native module: the real package
 * reads `NativeModules.RNCNetInfo` at import time and throws
 *
 *     NativeModule.RNCNetInfo is null. To fix this issue try these steps: …
 *
 * before any test in the importing file can run. `app/donate/[id].tsx`
 * calls `NetInfo.fetch()` to short-circuit a donation when the device is
 * offline, so this mock keeps the default export callable and reports a
 * connected network by default.
 *
 * Registered through jest `moduleNameMapper` in package.json so every
 * suite picks it up — the same approach already used for the `axios`,
 * `expo-local-authentication`, `expo-secure-store` and
 * `react-native-maps` mocks.
 *
 * Tests that need a specific connectivity state use the standard pattern:
 *
 *     const NetInfo = require('@react-native-community/netinfo').default;
 *     NetInfo.fetch.mockResolvedValueOnce({ isConnected: false });
 */
const DEFAULT_STATE = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
};

/** Every state the module can report is derived from this one record. */
function makeState(overrides) {
  return Object.assign({ type: 'unknown' }, DEFAULT_STATE, overrides || {});
}

const NetInfo = {
  fetch: jest.fn(() => Promise.resolve(makeState())),
  refresh: jest.fn(() => Promise.resolve(makeState())),
  addEventListener: jest.fn(() => () => {}),
  useNetInfo: jest.fn(() => makeState()),
  fetchWifiInfo: jest.fn(() => Promise.resolve(null)),
  configure: jest.fn(),
};

module.exports = {
  __esModule: true,
  default: NetInfo,
  // Named exports, for the rare `import { useNetInfo } from …` call site.
  fetch: NetInfo.fetch,
  refresh: NetInfo.refresh,
  addEventListener: NetInfo.addEventListener,
  useNetInfo: NetInfo.useNetInfo,
  fetchWifiInfo: NetInfo.fetchWifiInfo,
  configure: NetInfo.configure,
  // Exposed so a suite can assert on (or re-stub) the default state.
  __state: DEFAULT_STATE,
  __makeState: makeState,
};
