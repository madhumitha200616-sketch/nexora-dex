// Base URL for the dexBack Express server. Set REACT_APP_API_URL in the
// hosting platform's env vars (Vercel, etc.) to point at the deployed
// backend (e.g. Render) - falls back to localhost for local dev where
// that env var is never set.
export const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";
