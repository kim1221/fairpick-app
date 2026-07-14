// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('@granite-js/react-native/jest').config({
  rootDir: __dirname,
  moduleNameMapper: {
    '@babel/runtime(.*)': `${path.dirname(require.resolve('@babel/runtime/package.json'))}$1`,
  },
  // backend route tests use Node's built-in test runner and have their own
  // `backend/npm test`; loading them in React Native Jest executes both runners.
  testPathIgnorePatterns: ['/node_modules/', '/backend/'],
});

module.exports = config;
