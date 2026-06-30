// __mocks__/@react-native-async-storage/async-storage.js
const store = {};

const AsyncStorage = {
  getItem: jest.fn().mockImplementation((key) => Promise.resolve(store[key] ?? null)),
  setItem: jest.fn().mockImplementation((key, value) => {
    store[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn().mockImplementation((key) => {
    delete store[key];
    return Promise.resolve();
  }),
  clear: jest.fn().mockImplementation(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    return Promise.resolve();
  }),
  __store: store,
};

module.exports = AsyncStorage;
