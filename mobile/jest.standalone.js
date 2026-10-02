/** Minimal Jest config for running utils tests without the full Expo install. */
module.exports = {
  transform: {
    '\\.tsx?$': [
      '/home/olive_thinkpad/.nvm/versions/node/v24.9.0/lib/node_modules/ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          types: ['jest'],
          typeRoots: [
            '/home/olive_thinkpad/.nvm/versions/node/v24.9.0/lib/node_modules/@types',
          ],
        },
      },
    ],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/@react-native-async-storage/async-storage.js',
  },
};
