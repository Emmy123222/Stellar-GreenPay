/**
 * Tests for popup.ts Freighter wallet integration
 */

describe('GreenPay Popup - Freighter Integration', () => {
  beforeEach(() => {
    // Clean up DOM before each test
    document.body.innerHTML = `
      <form id="donation-form"></form>
      <div id="wallet-address"></div>
      <div id="wallet-info"></div>
      <button id="connect-btn">Connect Wallet</button>
      <div id="status-message"></div>
      <input id="custom-amount-input" />
      <button id="settings-btn">Settings</button>
    `;
    delete (window as any).freighter;
  });

  describe('Freighter Missing on DOMContentLoaded', () => {
    test('should render error message when Freighter is not installed', (done) => {
      // Simulate Freighter not being installed
      (window as any).freighter = undefined;

      // Trigger the DOMContentLoaded event
      const event = new Event('DOMContentLoaded');
      document.dispatchEvent(event);

      // Wait a tick for async operations
      setTimeout(() => {
        const form = document.getElementById('donation-form');
        expect(form).toBeTruthy();
        
        // Check that the form contains the error message
        const html = form!.innerHTML;
        expect(html).toContain('Freighter Wallet Required');
        expect(html).toContain('Install Freighter Wallet');
        expect(html).toContain('https://www.freighter.app/');
        done();
      }, 100);
    });

    test('should not crash when Freighter is undefined', (done) => {
      (window as any).freighter = undefined;

      expect(() => {
        const event = new Event('DOMContentLoaded');
        document.dispatchEvent(event);
      }).not.toThrow();

      setTimeout(() => {
        // If we get here without crashing, the test passes
        done();
      }, 100);
    });
  });

  describe('Freighter Present', () => {
    beforeEach(() => {
      // Mock Freighter extension
      (window as any).freighter = {
        getPublicKey: jest.fn().mockResolvedValue('GBZXN3XVFC2TYZF7PJKX5CZRFF7YXLMPG7D5VVPYP3AJXTD32HV2D3'),
        signTransaction: jest.fn(),
      };
    });

    test('should allow popup to load without error when Freighter is available', (done) => {
      expect(() => {
        const event = new Event('DOMContentLoaded');
        document.dispatchEvent(event);
      }).not.toThrow();

      setTimeout(() => {
        const form = document.getElementById('donation-form');
        // Form should exist and should NOT contain error message
        expect(form).toBeTruthy();
        expect(form!.innerHTML).not.toContain('Freighter Wallet Required');
        done();
      }, 100);
    });
  });
});
