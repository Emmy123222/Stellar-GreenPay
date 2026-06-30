// __mocks__/expo-local-authentication.js
const LocalAuthentication = {
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
};

module.exports = LocalAuthentication;
