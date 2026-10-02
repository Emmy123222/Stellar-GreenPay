// Simple CommonJS mock for `uuid` used only during Jest tests.
module.exports = {
  v4: function v4() {
    // Return a deterministic UUID for tests; individual tests can still stub if needed.
    return "00000000-0000-4000-8000-000000000000";
  },
};
