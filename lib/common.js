const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a handler so errors become clean JSON responses.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      res.status(err.status || 500).json({
        error: err instanceof HttpError ? err.message : 'Something went wrong',
      });
    }
  };
}

function method(req, allowed) {
  if (!allowed.includes(req.method)) throw new HttpError(405, 'Method not allowed');
}

// ADMIN_KEY must be set in Vercel. There is no fallback, so the admin pages can't be left open.
function requireAdmin(req) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) throw new HttpError(500, 'ADMIN_KEY is not set on the server');
  const a = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Admin key required');
  }
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

module.exports = { HttpError, handle, method, requireAdmin, isEmail };