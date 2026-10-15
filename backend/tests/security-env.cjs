// Ephemeral test-only secret, never a fallback used by the application.
process.env.JWT_SECRET = require('node:crypto').randomBytes(48).toString('base64url');
process.env.JWT_EXPIRE = '2h';
