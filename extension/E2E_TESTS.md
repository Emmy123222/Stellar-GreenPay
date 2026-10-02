# GreenPay Extension E2E Tests

End-to-end tests for the GreenPay Chrome extension using Playwright.

## Setup

### Install Playwright Browsers

```bash
npm ci
npx playwright install chromium
```

## Running Tests

### Local Development

```bash
# Build the extension first
npm run build

# Run E2E tests
npm run test:e2e

# Run tests in UI mode (interactive)
npx playwright test --ui
```

### CI/CD

The E2E tests run automatically on pull requests and pushes to `main`/`develop` branches via the GitHub Actions workflow (`.github/workflows/extension.yml`).

## Test Coverage

The E2E test suite covers:

### 1. Extension Loading (`should load extension and open popup`)
- Loads the extension in Chromium with `--load-extension` flag
- Verifies popup.html opens successfully
- Checks for GreenPay logo in the popup UI

### 2. Project List Display (`should display project list on popup open`)
- Verifies project list container loads
- Confirms at least one project item is rendered (skeleton or real data)
- Tests initial data loading

### 3. Project Selection (`should select a project and show donation form`)
- Clicks the first project item
- Verifies donation form section becomes visible
- Checks for donate button, preset amount buttons, and custom amount input
- Full UI flow from project selection to donation interface

### 4. Freighter Wallet Handling (`should handle missing Freighter gracefully`)
- Verifies UI gracefully handles missing Freighter extension
- Checks for either error message OR connect button
- Ensures no crashes when wallet unavailable

### 5. UI State Management (`should maintain UI state through interactions`)
- Tests preset amount button clicks
- Verifies UI responds to user interactions
- Confirms state changes persist through the flow

## Test Structure

```
extension/
├── e2e/
│   └── donate-flow.spec.ts       # All donation flow tests
├── playwright.config.ts           # Playwright configuration
├── package.json                   # Dependencies & scripts
└── E2E_TESTS.md                   # This file
```

## Key Concepts

### Extension Loading
Tests use Playwright's extension loading capability:
```typescript
const browser = await chromium.launch({
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
  ],
});
```

### Popup URL
The extension popup is accessed via:
```
chrome-extension://{EXTENSION_ID}/popup.html
```

### Waiting for Elements
Tests use Playwright's locators with proper waits:
```typescript
await expect(element).toBeVisible();
await page.locator('.project-item').first().waitFor();
```

## Debugging

### View Test Report

After running tests, view the HTML report:

```bash
npx playwright show-report
```

### Enable Trace

Traces are automatically captured on test failure. View them:

```bash
npx playwright show-trace trace.zip
```

### Debug Mode

Run tests in debug mode with Inspector:

```bash
npx playwright test --debug
```

### Headed Mode

Run tests with UI visible:

```bash
npx playwright test --headed
```

## CI Integration

The GitHub Actions workflow runs E2E tests in:
- **Environment:** Ubuntu latest
- **Browser:** Chromium (headless)
- **Retries:** 2 on failure
- **Workers:** 1 (sequential for reliability)

Test results and artifacts are uploaded after each run:
- Playwright HTML report
- Test logs and traces

## Known Limitations

1. **Project Data**: Tests may use mock/skeleton data if no backend is available. Add `MOCK_PROJECTS=true` to use fixtures.

2. **Freighter Connection**: Cannot fully test Freighter signing flow without a real wallet connection. Tests only verify UI state.

3. **Network Requests**: Tests run in isolated context; API calls may need mocking.

## Adding New Tests

1. Add test cases to `e2e/donate-flow.spec.ts`
2. Follow the test structure:
   ```typescript
   test('should do something', async () => {
     const browser = await chromium.launch({
       args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
     });
     const context = await browser.createContext();
     const page = await context.newPage();
     
     // Test logic here
     
     await browser.close();
   });
   ```

3. Run `npm run test:e2e` to verify

## Troubleshooting

### "Extension not built" error
```bash
npm run build
npm run test:e2e
```

### "Could not determine extension ID" error
- Ensure `--load-extension` path is correct
- Verify manifest.json exists

### Tests timeout
- Increase timeout in `playwright.config.ts`
- Check backend API availability (may need mocking)

### Flaky tests
- Use `.first()` with proper waits
- Avoid strict timing assumptions
- Use Playwright's built-in retry mechanism

## Performance

- Sequential execution (1 worker) ensures stable extension state
- Each test launches a fresh browser context
- Tests take ~5-10 seconds per test in CI

## Future Improvements

- [ ] Mock backend API responses for faster testing
- [ ] Add performance benchmarks
- [ ] Test cross-browser support (Firefox, Safari)
- [ ] Add visual regression testing
- [ ] Test error handling and edge cases
- [ ] Integration with real Freighter wallet (testnet)
