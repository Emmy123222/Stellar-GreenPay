// __mocks__/utils/notifications.js
//
// Shared default Jest mock for `mobile/utils/notifications.ts`. Jest's
// `__mocks__` directory convention auto-applies this module to every
// `import { … } from '../utils/notifications'` / `require('../utils/notifications')`
// in the test suite, so individual tests no longer need to repeat the
// factory. Previously each test file inlined a near-identical block listing
// every named export the screen touched; that drifted (HomeScreen added
// `setupNotificationListener` and `getUnreadNotificationCount` after the
// initial draft, accessibility.test missed one for two PRs).
//
// Per-test overrides:
//
//   import * as notifUtils from '../utils/notifications';
//   jest.spyOn(notifUtils, 'getPushToken').mockResolvedValue('tok');
//
// (or hooks-side: `(LA.x as jest.Mock).mockResolvedValueOnce(...)`)
//
// Why the subscription shape matters:
//   `app/index.tsx`'s cleanup runs `subscription.remove()`. Under our
//   `expo-modules-core` Proxy stub, `Notifications.addNotificationReceivedListener`
//   is an empty class instance whose `.remove` method is undefined; without
//   this mock every HomeScreen / accessibility test crashes at unmount with
//   `TypeError: subscription.remove is not a function`.

'use strict';

// `__esModule: true` lives INSIDE the literal module.exports object below
// (NOT via Object.defineProperty on the default `{}`).
//
// Why inside, not via defineProperty:
//   `module.exports = {...}` reassigns the export wholesale. Calling
//   `Object.defineProperty(module.exports, '__esModule', …)` BEFORE that
//   reassignment would set the flag on Node's default empty `module.exports`
//   object, which is then discarded — Babel's interop check sees the
//   REPLACEMENT object without `__esModule` and treats the named exports
//   as snapshot bindings. That breaks `import * as notifUtils from
//   '../utils/notifications'` in ProjectDetailScreen.test.tsx because
//   every `jest.spyOn(notifUtils, 'X').mockResolvedValueOnce(…)`
//   override inside `beforeEach` would target the snapshot getter and
//   silently fail to take effect. Putting `__esModule: true` directly
//   in the literal object avoids that race entirely.

// Subscription factory used by both listener-setter exports. Returning a
// FRESH `{ remove: jest.fn() }` object per call (rather than a single
// module-level const) prevents `.mock.calls` from accumulating across
// tests in a suite that skips `jest.clearAllMocks()`. Module-level
// state in this shim is module-load-time only — everything else is
// per-call so a future test in a new file won't leak assertion state
// into the rest of the suite.
const makeNoopSubscription = () => ({ remove: jest.fn() });

module.exports = {
  // MUST be the first key in this literal — see the long-form comment at
  // the top of the file for why inline placement is required.
  __esModule: true,

  // ── async getters ──────────────────────────────────────────────────────────
  requestNotificationPermissions: jest.fn().mockResolvedValue(null),
  getPushToken: jest.fn().mockResolvedValue(null),
  registerDeviceToken: jest.fn().mockResolvedValue(true),
  getFollowedProjects: jest.fn().mockResolvedValue([]),
  getNotificationLastSeen: jest.fn().mockResolvedValue(null),
  markNotificationsSeen: jest.fn().mockResolvedValue(new Date().toISOString()),
  getUnreadNotificationCount: jest.fn().mockResolvedValue(0),

  // ── success/failure setters (default to `false` so accidental assertion
  //    on `.toHaveBeenCalledWith(...)` reads as "called but did not succeed") ──
  followProject: jest.fn().mockResolvedValue(false),
  unfollowProject: jest.fn().mockResolvedValue(false),

  // ── subscription setters — fresh { remove: jest.fn() } per call ────────────
  // NOTE: `jest.mockImplementation(...)` keeps the factory attached across
  // `jest.clearAllMocks()` calls (today's contract in this suite). If a
  // future test ever calls `jest.mockReset()` instead, the factory is wiped
  // and these mocks would return `undefined`; consumers would surface
  // `Cannot read properties of undefined (reading 'remove')`. Stick with
  // `jest.clearAllMocks()` in beforeEach OR add `setup*Listener.mockImplementation(makeNoopSubscription)`
  // to the same beforeEach.
  setupNotificationListener: jest.fn().mockImplementation(makeNoopSubscription),
  setupNotificationResponseListener: jest.fn().mockImplementation(makeNoopSubscription),
};
