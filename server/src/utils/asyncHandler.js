// Wraps async route handlers so thrown errors are forwarded to Express's
// error middleware instead of crashing the process or needing try/catch everywhere.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
