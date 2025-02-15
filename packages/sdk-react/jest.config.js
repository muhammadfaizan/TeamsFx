module.exports = {
  displayName: "client",
  rootDir: "./",
  testEnvironment: "jsdom",
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.json",
      diagnostics: {
        ignoreCodes: [151001],
      },
    },
  },
  moduleNameMapper: {
    // Force module uuid to resolve with the CJS entry point, because Jest does not support package.json.exports. See https://github.com/uuidjs/uuid/issues/451
    uuid: require.resolve("uuid"),
  },
  preset: "ts-jest",
  testMatch: ["<rootDir>/test/*.test.(ts|tsx|js)"],
  collectCoverage: true,
  collectCoverageFrom: ["/src/*.{js,jsx,ts,tsx}", "!<rootDir>/node_modules/"],
  coverageReporters: ["text", "html", "lcov"],
};
