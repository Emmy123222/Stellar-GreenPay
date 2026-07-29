# test(leaderboard): cover `?onlyVerified=true` filter with Donor A / Donor B fixtures

## Summary

The `GET /api/leaderboard` route supports an `?onlyVerified=true` query parameter that filters out donors who have ever donated to an unverified project. This behaviour had no test coverage, leaving a gap where a regression could go undetected. This PR adds a dedicated test suite with two donor fixtures — one who donated only to verified projects (Donor A) and one who donated to both verified and unverified projects (Donor B) — and asserts that only Donor A appears when the filter is active.

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor
- [x] **Testing**
- [ ] Smart contract change

## Related Issue

Closes #

## Testing

- [x] Tested locally on Testnet
- [x] No TypeScript / Rust errors
- [ ] Docs updated if needed

### Tests added

```
GET /api/leaderboard — onlyVerified filter
  ✓ returns only Donor A when onlyVerified=true (Donor B donated to unverified projects)
  ✓ does not include Donor B in the results when onlyVerified=true
  ✓ sends a SQL query containing the verified-only filter when onlyVerified=true
  ✓ does not apply the verified filter when onlyVerified is absent
```

| Fixture | Donations | Appears in `?onlyVerified=true` response |
|---------|-----------|------------------------------------------|
| **Donor A** (`GDDD…`) | Verified projects only | ✅ |
| **Donor B** (`GEEE…`) | Verified **and** unverified projects | ❌ |

Run locally with:

```bash
cd backend
npm test -- --testPathPattern=leaderboard --no-coverage
```

**Result: 16/16 tests pass** (8 pre-existing + 4 new)

## Screenshots (if UI change)

N/A — backend test-only change, no UI affected.
