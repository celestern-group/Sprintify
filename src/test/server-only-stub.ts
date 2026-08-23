// `server-only` resolves to a module that throws unless the `react-server`
// export condition is active, which it isn't under vitest's node environment.
// vitest.config.ts aliases the package to this no-op so server modules that
// (correctly) guard themselves stay unit-testable.
export {};
