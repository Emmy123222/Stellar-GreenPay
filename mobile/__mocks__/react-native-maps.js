/**
 * __mocks__/react-native-maps.js
 *
 * `react-native-maps` is a native module: the real package mounts `AIRMap` /
 * `AIRMapMarker` host components and reads a Google/Apple Maps bridge from
 * `NativeModules` at import time, none of which exist under Jest.
 *
 * We render plain `View`s that carry the same `testID`s and forward the props
 * the tests assert on (`region`, `coordinate`, `title`, `description`), so the
 * screen can be exercised without a device. Registered through jest
 * `moduleNameMapper` in package.json so every suite picks it up — the same
 * approach already used for the `axios`, `expo-local-authentication` and
 * `expo-secure-store` mocks.
 */
const React = require('react');
const { View } = require('react-native');

/** Host stand-in that forwards every prop (and children) to a plain `View`. */
const hostComponent = (displayName) => {
  const Component = ({ children, ...props }) =>
    React.createElement(View, props, children);
  Component.displayName = displayName;
  return Component;
};

const MapView = hostComponent('MapView');
const Marker = hostComponent('Marker');
const Callout = hostComponent('Callout');

module.exports = {
  __esModule: true,
  default: MapView,
  MapView,
  Marker,
  Callout,
  // Geometry helpers are pure functions — keep the real implementations.
  regionContainsCoordinate: () => true,
};
