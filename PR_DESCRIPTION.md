# test(leaderboard): add `onlyVerified` filter tests

## Summary

Adds a new `GET /api/leaderboard — onlyVerified filter` test suite to `backend/src/routes/leaderboard.test.js` covering the `?onlyVerified=true` query parameter.

## What changed

**`backend/src/routes/leaderboard.test.js`**

Added a new `describe` block with two donor fixtures and four tests:

| Fixture | Donations |
|---------|-----------|
| Donor A (`GDDD…`) | Verified projects only |
| Donor B (`GEEE…`) | Both verified **and** unverified projects |

| # | Test | Assertion |
|---|------|-----------|
| 1 | `returns only Donor A when onlyVerified=true` | Response has exactly one entry; its `publicKey` matches Donor A |
| 2 | `does not include Donor B in the results when onlyVerified=true` | Donor B's public key is absent from all response entries |
| 3 | `sends a SQL query containing the verified-only filter` | The SQL string passed to `pool.query` contains both `verified = false` (exclusion subquery) and `verified = true` (inclusion subquery) |
| 4 | `does not apply the verified filter when onlyVerified is absent` | Both donors appear in results; SQL lacks the verified filter |

## How to test

```bash
cd backend
npm test -- --testPathPattern=leaderboard --no-coverage
```

All 16 tests pass (8 pre-existing + 4 new `onlyVerified` + 4 pre-existing limit tests).

## Checklist

- [x] Tests cover the happy path (Donor A returned)
- [x] Tests cover the exclusion case (Donor B absent)
- [x] Tests verify the SQL filter is applied (or not applied) correctly
- [x] No production code changed
- [x] All existing tests continue to pass
