const { pool, ensureSchema } = require('../lib/db');
const { handle, method, HttpError, isEmail } = require('../lib/common');

module.exports = handle(async (req, res) => {
  method(req, ['POST']);
  await ensureSchema();

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email');

  await pool.query(
    'INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
    [email]
  );
  res.status(201).json({ ok: true });
});