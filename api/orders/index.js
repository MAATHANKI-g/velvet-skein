const crypto = require('crypto');
const { pool, ensureSchema } = require('../../lib/db');
const { handle, method, HttpError, isEmail } = require('../../lib/common');

module.exports = handle(async (req, res) => {
  method(req, ['POST']);
  await ensureSchema();

  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your bag is empty');

  const c = customer || {};
  const name = String(c.name || '').trim();
  const email = String(c.email || '').trim().toLowerCase();
  const address = String(c.address || '').trim();
  if (!name || !email || !address) throw new HttpError(400, 'Name, email and address are required');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const lines = [];
    for (const it of items) {
      const productId = Number(it.productId);
      const qty = Number.parseInt(it.qty, 10);
      if (!(qty > 0 && qty <= 20)) throw new HttpError(400, 'Quantity must be between 1 and 20');

      // Lock the product row so two buyers can't take the last item at once
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const p = rows[0];
      if (!p) throw new HttpError(400, 'A product in your bag no longer exists');

      const upd = await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
        [qty, p.id]
      );
      if (upd.rowCount === 0) throw new HttpError(409, `Sorry, not enough ${p.name} left in stock`);

      total += p.price_paise * qty;
      lines.push({ p, qty });
    }

    const id = 'VS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await client.query(
      `INSERT INTO orders (id, status, customer_name, customer_email, customer_phone, address, total_paise)
       VALUES ($1, 'pending_payment', $2, $3, $4, $5, $6)`,
      [id, name, email, String(c.phone || '').slice(0, 20), address.slice(0, 500), total]
    );

    for (const { p, qty } of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, unit_price_paise, qty)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, p.id, p.name, p.price_paise, qty]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id, totalPaise: total, status: 'pending_payment' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});