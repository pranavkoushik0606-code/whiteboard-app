// Ports deliberately differ from the dev defaults (5173/5000) so a running
// `npm run dev` in either folder does not collide with a test run.
export const CLIENT_PORT = 5174;
export const API_PORT = 5001;

export const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

// Not a credential — the test server is an ephemeral child process backed by an
// in-memory Mongo that is destroyed when the run ends.
export const JWT_SECRET = 'e2e_only_not_a_real_secret';
