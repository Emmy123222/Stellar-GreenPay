const axios = {
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => axios),
  defaults: { headers: { common: {} } },
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};
module.exports = axios;
module.exports.default = axios;

