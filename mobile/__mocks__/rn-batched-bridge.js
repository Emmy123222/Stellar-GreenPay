/**
 * __mocks__/rn-batched-bridge.js
 *
 * Drop-in replacement for `react-native/Libraries/BatchedBridge/NativeModules`
 * used by jest-expo's preset setup. Two shapes must be served from one stub:
 *
 *  - `jest-expo@51` (the preset this workspace actually runs — `expo@~51`)
 *    does `require(thisPath)` and reads `UIManager` etc. directly off the
 *    returned object.
 *  - `jest-expo@57` does `require(thisPath).default`, because on newer
 *  `@react-native/jest-preset` versions that file is published as an ES
 *  module with a `.default` export. With `react-native@0.74.1` the real
 *  path is plain CommonJS, so `.default` would be `undefined` and
 *  `Object.defineProperty` would throw "called on non-object".
 *
 * The export at the bottom therefore exposes the proxy as BOTH the module
 * root and its own `.default`.
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

// Dual-compatible export:
//  - `jest-expo@51` (SDK 51 preset) does `require(thisPath)` and then reads
//    `NativeModules.UIManager` etc. directly off the returned object, so the
//    proxy itself must be the export.
//  - `jest-expo@57` does `require(thisPath).default`, so we also expose the
//    proxy as its own `.default` plus the `__esModule` flag.
mockNativeModules.__esModule = true;
mockNativeModules.default = mockNativeModules;
module.exports = mockNativeModules;
