const axios = {
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => axios),
  defaults: { headers: { common: {} } },
};
module.exports = axios;
module.exports.default = axios;
