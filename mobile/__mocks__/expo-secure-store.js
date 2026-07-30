// __mocks__/expo-secure-store.js
const SecureStore = {
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};

module.exports = SecureStore;
