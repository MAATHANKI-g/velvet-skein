const { pool, ensureSchema } = require('../../../lib/db');
const { handle, method, HttpError } = require('../../../lib/common');

module.exports = handle(async (req, res) => {
  method(req, ['GET']);
  await ensureSchema();

  const { rows: [order] } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.query.id]);
  if (!order) throw new HttpError(404, 'Order not found');

  const { rows: items } = await pool.query(
    'SELECT product_id, name, unit_price_paise, qty FROM order_items WHERE order_id = $1',
    [order.id]
  );
  res.json({ ...order, items });
});