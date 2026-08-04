// __mocks__/expo-local-authentication.js
const LocalAuthentication = {
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),

  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1]), // FINGERPRINT

  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1]),
  // Mirror real expo-local-authentication so per-test overrides line up.

  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },

  LocalAuthenticationResult: {},


};

module.exports = LocalAuthentication;
