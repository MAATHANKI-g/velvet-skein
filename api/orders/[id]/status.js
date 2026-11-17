const { pool, ensureSchema } = require('../../../lib/db');
const { handle, method, requireAdmin, HttpError } = require('../../../lib/common');

module.exports = handle(async (req, res) => {
  method(req, ['PATCH']);
  requireAdmin(req);
  await ensureSchema();

  const { status } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.query.id]);
    if (!order) throw new HttpError(404, 'Order not found');

    if (status === 'shipped' && order.status === 'paid') {
      // nothing else to do
    } else if (status === 'cancelled' && order.status === 'pending_payment') {
      // return the reserved stock
      const { rows: items } = await client.query(
        'SELECT product_id, qty FROM order_items WHERE order_id = $1',
        [order.id]
      );
      for (const it of items) {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [it.qty, it.product_id]);
      }
    } else {
      throw new HttpError(409, `Cannot change order from ${order.status} to ${status}`);
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);
    await client.query('COMMIT');
    res.json({ id: order.id, status });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});