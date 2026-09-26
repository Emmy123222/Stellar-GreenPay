/**
 * __mocks__/rn-batched-bridge.js
 *
 * Drop-in replacement for `react-native/Libraries/BatchedBridge/NativeModules`
 * used by `jest-expo@57`'s preset setup. `jest-expo@57` was authored against
 * `@react-native/jest-preset@^0.85.0`+, where that file is published as an
 * ES module with a `.default` export. The Stellar-GreenPay mobile workspace
 * pins `react-native@0.74.1`, where the same path is plain CommonJS
 * (`module.exports = NativeModules`) and `require(...).default` is therefore
 * `undefined`. The first thing jest-expo's setup.js does with the result is
 * `Object.defineProperty(mockNativeModules, 'ImageLoader', ...)` which throws
 * "Object.defineProperty called on non-object" on the undefined value before
 * any test code ever runs.
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

module.exports = {
  __esModule: true,
  default: mockNativeModules,
};
