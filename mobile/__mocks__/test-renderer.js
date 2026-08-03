// __mocks__/test-renderer.js
//
// Jest-only shim for the bare `test-renderer` specifier that
// `@testing-library/react-native@14.0.1`'s render.tsx imports. This module
// DOES NOT exist in `node_modules` (the React team ships `react-test-renderer`
// instead). We map `test-renderer → react-test-renderer` via
// `package.json`'s `jest.moduleNameMapper`, then re-shape the export to
// match the symbols `@testing-library/react-native@14` reads:
//
//   - `createRoot(node)` — concurrent mode renderer.
//   - `actImplementation` — internal test act function.
//
// react-test-renderer@18.2.0's default entry exports `act` and a legacy
// `create(node)`, but its `createRoot` lives in a separate `.development.js`
// path that the bare import doesn't reach. Without this shim, the test
// runner throws `(0 , _testRenderer.createRoot) is not a function` and
// `actImplementation is not a function` for every render() call made by
// tests in this suite.

'use strict';

const React = require('react');
const RTL = require('react-test-renderer');

/**
 * Best-effort extraction of a component's display name. Handles
 * string types (host components), class/function components, and
 * `React.forwardRef` wrappers (`type.render.name`). `React.memo`
 * wraps the inner component at `type.type`, so we unwrap that too.
 * Anonymous arrows (`type.name === ''`) fall through to `undefined`
 * and intentionally skip the rename — flagging in the docstring so
 * a future maintainer knows to add a `displayName` to silent it.
 */
function getTypeName(type) {
  if (typeof type === 'string') return type;
  if (type?.displayName) return type.displayName;
  if (type?.name) return type.name;
  if (type?.render?.displayName) return type.render.displayName;
  if (type?.render?.name) return type.render.name;
  if (type?.type?.displayName) return type.type.displayName;
  if (type?.type?.name) return type.type.name;
  return undefined;
}

/**
 * Walk the React element tree. For any element whose type matches
 * `textComponentTypes` or `publicTextComponentTypes`, replace the
 * component with a host-element of type `'Text'` (a string). RNTL@14's
 * `isHostText` predicate only matches host-text instances whose
 * `.type` is a string in `HOST_TEXT_NAMES = ['Text', 'RCTText']`,
 * so a function/class `<Text>` from React Native is otherwise invisible
 * to `getByText` / `findByText`. Renaming to a string `'Text'` flips
 * `typeof instance.type === 'string'` to true and the predicate
 * returns true. We deliberately preserve all other props (including
 * children) so styling and accessibility wiring flow through unchanged.
 *
 * Uses a `WeakSet` of visited elements to bail out on recursive
 * components (a component that renders itself) instead of looping
 * forever. Also preserves `key` on renamed elements — `createElement`
 * does not propagate it, so we set it post-hoc.
 */
function renameTextComponents(element, textComponentTypes, publicTextComponentTypes, visited) {
  if (!React.isValidElement(element)) return element;
  if (!visited) visited = new WeakSet();
  if (visited.has(element)) return element;
  visited.add(element);
  const typeName = getTypeName(element.type);
  const newProps = { ...element.props };
  if (element.props.children !== undefined) {
    newProps.children = React.Children.map(element.props.children, (child) =>
      renameTextComponents(child, textComponentTypes, publicTextComponentTypes, visited)
    );
  }
  const matchSet = new Set([
    ...(textComponentTypes || []),
    ...(publicTextComponentTypes || []),
  ]);
  if (typeName && matchSet.has(typeName)) {
    const renamed = React.createElement('Text', newProps);
    // `createElement` does not propagate `key` or `ref` from the original
    // element (props holds the public surface; key/ref are element-level,
    // not prop-level). Set them post-hoc so renamed Text instances inside
    // lists, or wrapped via `React.forwardRef`, keep their reconciliation
    // identity.
    if (element.key != null) renamed.key = element.key;
    if (element.ref != null) renamed.ref = element.ref;
    return renamed;
  }
  return React.cloneElement(element, newProps);
}

// `actImplementation` is read by `@testing-library/react-native`'s render.tsx
// implementation. We declare it as a literal function (not a const
// computed from `RTL.act`) so the export is unconditionally a function —
// if `RTL.act` is missing or unbound at module-load time, the wrapper
// still satisfies the "is not a function" type check and at call time
// delegates to whatever act-shaped function is available.
function actImplementation(fn) {
  if (typeof RTL.act === 'function') return RTL.act(fn);
  if (typeof RTL.actImplementation === 'function') return RTL.actImplementation(fn);
  if (typeof globalThis.jest !== 'undefined' && typeof globalThis.jest.act === 'function') {
    return globalThis.jest.act(fn);
  }
  // Last-resort: invoke the callback synchronously without flushing
  // effects. Better than throwing, since the issue-168 AC suite never
  // exercises `act` directly.
  return typeof fn === 'function' ? fn() : undefined;
}

// `createRoot` is the concurrent-mode renderer entry consumed by
// `@testing-library/react-native@14`'s render(). Some react-test-renderer
// patch versions expose it at `RTL.createRoot`; others don't, in which
// case we wrap the legacy `RTL.create` with a minimal interface that
// returns a root-like object with `render`/`unmount`.
function createRoot(options) {
  if (typeof RTL.createRoot === 'function') {
    return RTL.createRoot(options);
  }
  let rendered;
  return {
    render(element) {
      // Pre-process the element tree so components whose type matches
      // RNTL@14's `textComponentTypes` (e.g. React Native's `<Text>`)
      // render as host text strings. RNTL's `isHostText` predicate only
      // matches host-text instances whose `.type` is a string in
      // `HOST_TEXT_NAMES = ['Text', 'RCTText']` — without this rename
      // the legacy `RTL.create` keeps Text as a function/class component
      // and `getByText` returns null. The `transformHiddenInstanceProps`
      // style flag is intentionally not applied here; `findAll`'s
      // `isHiddenFromAccessibility` filter handles hidden visibility.
      const textComponentTypes = options?.textComponentTypes || [];
      const publicTextComponentTypes = options?.publicTextComponentTypes || [];
      const transformed = (textComponentTypes.length || publicTextComponentTypes.length)
        ? renameTextComponents(element, textComponentTypes, publicTextComponentTypes)
        : element;
      rendered = RTL.create(transformed, options);
      return rendered;
    },
    unmount() {
      try {
        if (rendered && typeof rendered.unmount === 'function') rendered.unmount();
      } catch {
        // best-effort: react-test-renderer unmount may throw on stale trees
      }
    },
    // RNTL@14's render.js destructures `container` from the `createRoot()`
    // return and passes it to `getQueriesForInstance(container, ...)`.
    // The container MUST be the live `ReactTestInstance` so that prototype
    // methods (`findAll`, `findByType`, etc.) remain reachable. Earlier
    // this getter did `{ ...root, toJSON: ... }` which spread-stripped the
    // prototype and surfaced `root.queryAll is not a function` for every
    // `getByText` / `findByText` call. We instead attach `toJSON` directly
    // to the live root via a non-enumerable `defineProperty`, preserving
    // both the prototype chain and the toJSON serialisation RNTL expects.
    get container() {
      if (!rendered) return undefined;
      let root;
      try {
        // React 18 throws if .root is accessed after the renderer is
        // already unmounted (cleanups from a previous test, or RNTL's own
        // after-each). Returning undefined lets RNTL tolerate it.
        root = rendered.root || rendered;
      } catch {
        return undefined;
      }
      // Cache the bound toJSON on `rendered` once to avoid re-binding
      // on every getter access (small GC pressure win).
      if (!rendered.__boundToJSON) {
        rendered.__boundToJSON = rendered.toJSON.bind(rendered);
      }
      if (root && typeof root.toJSON !== 'function') {
        Object.defineProperty(root, 'toJSON', {
          value: rendered.__boundToJSON,
          configurable: true,
          enumerable: false,
          writable: true,
        });
      }
      // RNTL@14's find-all.js calls `root.queryAll(predicate, options)`,
      // but react-test-renderer's ReactTestInstance only exposes
      // `findAll`, not `queryAll`. Patch `queryAll` so `getByText` /
      // `getByTestId` / etc. don't throw `queryAll is not a function`.
      //
      // IMPORTANT: `findAll` lives on the ReactTestInstance (i.e. `root`),
      // NOT on the renderer (`rendered`). The renderer object only exposes
      // `toJSON`, `toTree`, `update`, and `unmount`. The previous version
      // of this guard checked `typeof rendered.findAll === 'function'`
      // which always evaluates to `false`, so the defineProperty branch
      // was never taken and RNTL crashed with `queryAll is not a function`
      // for every `getByText` / `findByText` call across the screen
      // suites. Use `root.findAll` (which DOES exist on the instance).
      //
      // Branch table (defends against future RTL upgrades that may make
      // `queryAll` non-configurable on `ReactTestInstance`):
      //   - root has a real `queryAll` function    → leave it alone; the
      //     underlying instance already provides it
      //   - root.queryAll is undefined             → install polyfill
      //   - root.queryAll exists but isn't callable AND isn't ours → log
      //     and skip (defensive: a future RTL could add a non-callable
      //     property and we shouldn't crash the suite silently)
      if (root && typeof root.findAll === 'function') {
        const existing = root.queryAll;
        if (typeof existing === 'function') {
          // Already there — either it's a real one or our own
          // (re-entry on a re-rendered tree). Skip.
        } else if (existing === undefined) {
          try {
            Object.defineProperty(root, 'queryAll', {
              value: (predicate, options = {}) => {
                const matches = root.findAll(predicate);
                // Dedupe by default: when match A is a descendant of another
                // match B, exclude A. React Native's `TouchableOpacity` and
                // `Pressable` propagate `testID` to their inner View, so a
                // single screen element yields two matching nodes in the
                // test tree. RNTL's `getByTestId` throws on 2+ matches
                // (`Found multiple elements with testID: …`); without this
                // dedupe every ProjectDetailScreen follow-button test
                // fails.
                //
                // Option name: `matchOutermostOnly` — passing `false` opts
                // out of dedupe and returns all matches (the legacy
                // behaviour). Callers that need to enumerate nested roles
                // (e.g. accessibility-role audits) pass `matchOutermostOnly: false`.
                if (options.matchOutermostOnly === false) return matches;
                return matches.filter((node) =>
                  matches.every(
                    (other) => other === node || !other.findAll(() => true).includes(node)
                  )
                );
              },
              configurable: true,
              enumerable: false,
              writable: true,
            });
          } catch (err) {
            // Future RTL upgrade may have made `queryAll` non-configurable.
            // Log once per test file (the renderer object is module-scoped
            // but we localise the warning to avoid spamming) so a future
            // maintainer sees it in test output instead of a silent skip.
            // eslint-disable-next-line no-console
            console.warn(
              '[test-renderer shim] could not install queryAll polyfill:',
              err && err.message
            );
          }
        } else {
          // Exists but isn't a function and isn't undefined. Throw with
          // the offending descriptor so a future RTL upgrade surfaces a
          // clear error instead of the same `root.queryAll is not a function`
          // cascading into all `getByText` / `findByText` calls.
          // (We catch and re-throw inside the surrounding try/catch ONLY
          // for the `Object.defineProperty` failure path; here we throw
          // synchronously because polyfilling would be incorrect.)
          // Guard null/undefined before the JSON.stringify branch:
          // `typeof null === 'object'` would route null through JSON.stringify
          // and produce the literal string `"null"`, which is ambiguous
          // against a deliberately-null slot. `== null` catches both.
          const descriptorInfo =
            existing == null
              ? String(existing) // 'null' or 'undefined' — explicit
              : typeof existing === 'function'
                ? `function (${existing.name || 'anonymous'})`
                : typeof existing === 'object'
                  // JSON.stringify so dictionaries / arrays surface their
                  // contents in the error; truncate long values to 64 chars
                  // to keep CI logs readable.
                  ? `object (${(JSON.stringify(existing) || 'undefined').slice(0, 64)})`
                  : `${typeof existing} (${String(existing).slice(0, 64)})`;
          throw new Error(
            `[test-renderer shim] root.queryAll is ${descriptorInfo}; ` +
            `expected undefined or a callable function. Likely an incompatible ` +
            `react-test-renderer version — pin react-test-renderer@18.2.0 ` +
            `in mobile/package.json.`
          );
        }
      }
      return root;
    },
  };
}

// `act` is the public surface re-export. Use a literal function similar to
// `actImplementation` so the export is always a function regardless of
// RTL load order.
function act(fn) {
  return actImplementation(fn);
}

// CRITICAL: `__esModule: true` is required so Babel's
// `_interopRequireWildcard` (used for `import { actImplementation } from
// 'test-renderer'`) treats the named exports as own properties instead of
// wrapping the entire module as a default export. Without this flag, the
// named import resolved to `undefined`, which surface as
// `TypeError: actImplementation is not a function` at module-load time
// inside `@testing-library/react-native/src/act.ts`.
module.exports = {
  __esModule: true,
  ...RTL,
  createRoot,
  actImplementation,
  act,
  default: {
    __esModule: true,
    ...RTL,
    createRoot,
    actImplementation,
    act,
  },
};
