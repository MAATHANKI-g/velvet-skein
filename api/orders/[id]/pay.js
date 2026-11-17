const { pool, ensureSchema } = require('../../../lib/db');
const { handle, method, HttpError } = require('../../../lib/common');

// DEMO: marks the order paid without charging anyone.
// Before going live, replace this with Razorpay signature verification (see README).
module.exports = handle(async (req, res) => {
  method(req, ['POST']);
  await ensureSchema();

  const { rows: [order] } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.query.id]);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'pending_payment') throw new HttpError(409, 'Order already processed');

  await pool.query("UPDATE orders SET status = 'paid' WHERE id = $1", [order.id]);
  res.json({ id: order.id, status: 'paid' });
});