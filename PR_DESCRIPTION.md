# test(jobs): add `?status` and `?clientPublicKey` filter tests

## Summary

Adds test coverage for the `GET /api/jobs` query filters. The route supports
`?status=in_escrow|completed` (pipe-separated list) and `?clientPublicKey=G…`
independently or combined, but neither filter had any tests. This PR introduces
`backend/src/routes/jobs.test.js` with 15 tests across four suites.

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor
- [x] **Testing**
- [ ] Smart contract change

## Related Issue

Closes #757

## Testing

- [x] Tested locally on Testnet
- [x] No TypeScript / Rust errors
- [ ] Docs updated if needed

### Fixtures

| Fixture | Status | Client |
|---------|--------|--------|
| `JOB_IN_ESCROW_A` | `in_escrow` | Client A |
| `JOB_COMPLETED_A` | `completed` | Client A |
| `JOB_OPEN_B` | `open` | Client B |
| `JOB_IN_ESCROW_B` | `in_escrow` | Client B |

### Test suites

```
GET /api/jobs — status filter (4 tests)
  ✓ returns only in_escrow and completed jobs when status=in_escrow|completed
  ✓ does not return the open job when status=in_escrow|completed
  ✓ passes the parsed status array to pool.query
  ✓ returns all jobs when no status filter is provided

GET /api/jobs — clientPublicKey filter (4 tests)
  ✓ returns only Client A jobs when clientPublicKey=CLIENT_A
  ✓ does not return Client B jobs when filtering by Client A
  ✓ passes clientPublicKey as a query parameter to pool.query
  ✓ returns an empty array when no jobs exist for the given client

GET /api/jobs — status + clientPublicKey combined filter (5 tests)
  ✓ returns only Client A in_escrow jobs when both filters are applied
  ✓ excludes Client B jobs when clientPublicKey is Client A
  ✓ excludes open jobs when status filter is in_escrow|completed
  ✓ passes both status array and clientPublicKey to pool.query
  ✓ returns empty array when no jobs match both filters

GET /api/jobs — response shape (2 tests)
  ✓ maps snake_case DB fields to camelCase in the response
  ✓ sets releaseTransactionHash on completed jobs
```

Run locally with:

```bash
cd backend
npm test -- --testPathPattern=jobs --no-coverage
```

**Result: 15/15 tests pass**

## Screenshots (if UI change)

N/A — backend test-only change, no UI affected.
