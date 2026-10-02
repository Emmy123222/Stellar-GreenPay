/**
 * __mocks__/rn-batched-bridge.js
 *
 * Drop-in replacement for `react-native/Libraries/BatchedBridge/NativeModules`
 * used by the `jest-expo` preset setup. The Stellar-GreenPay mobile workspace
 * pins `react-native@0.74.1` + `jest-expo@51`, where that path is plain
 * CommonJS (`module.exports = NativeModules`). `jest-expo/src/preset/setup.js`
 * assigns the `require(...)` result straight to a local named
 * `mockNativeModules` and then calls `Object.defineProperty(mockNativeModules, …)`
 * on it, so the module has to export the mock object *itself* — not a
 * `{ default }` wrapper. The previous revision exported `{ __esModule, default }`,
 * which left `mockNativeModules` as that plain wrapper object: `UIManager` was
 * never defined on it, so the `ViewManagerAdapter_*` loop at setup.js:120-127
 * threw `Object.defineProperty called on non-object` and every mobile suite
 * died before a single test ran.
 *
 * We still expose `__esModule` / `default` so the same file keeps working with
 * `jest-expo@57`+, whose RN copy is a real ES module and reads `.default`.
 *
 * Register this stub via jest `moduleNameMapper` so jest-expo receives a
 * Proxy-backed `mockNativeModules` object that satisfies every defineProperty
 * / get probe. We do not change Expo SDK pins, jest-expo, react-native, or
 * react versions — purely a test-runtime shim.
 *
 * Keys covered (matches jest-expo/src/preset/setup.js probes):
 *   - ImageLoader / ImageViewManager (Object.defineProperty on root mock)
 *   - LinkingManager (Object.defineProperty with `get: () => mockNativeModules.Linking`)
 *   - UIManager (Object.defineProperty per view manager adapter)
 *   - NativeUnimoduleProxy.viewManagersMetadata (forEach later)
 */
const viewManagerTarget = { viewManagersMetadata: {} };

const subModuleProxy = (target) =>
  new Proxy(target, {
    defineProperty: (t, prop, descriptor) => {
      t[prop] =
        typeof descriptor.value !== 'undefined'
          ? descriptor.value
          : typeof descriptor.get === 'function'
          ? descriptor.get()
          : undefined;
      return true;
    },
    get: (t, prop) => (prop in t ? t[prop] : undefined),
    set: (t, prop, value) => {
      t[prop] = value;
      return true;
    },
  });

const mockNativeModules = subModuleProxy({
  ImageLoader: undefined,
  ImageViewManager: undefined,
  Linking: undefined,
  UIManager: subModuleProxy(viewManagerTarget),
  NativeUnimoduleProxy: subModuleProxy(viewManagerTarget),
});

// Export the proxy directly — see the header for why `module.exports` must BE
// the mock object rather than a `{ default }` wrapper.
module.exports = mockNativeModules;
module.exports.__esModule = true;
module.exports.default = mockNativeModules;
