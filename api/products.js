const { pool, ensureSchema } = require('../lib/db');
const { handle, method, requireAdmin, HttpError } = require('../lib/common');

module.exports = handle(async (req, res) => {
  method(req, ['GET', 'POST']);
  await ensureSchema();

  if (req.method === 'GET') {
    const sql = req.query.featured
      ? 'SELECT * FROM products WHERE is_featured = true ORDER BY id'
      : 'SELECT * FROM products ORDER BY id';
    const { rows } = await pool.query(sql);
    return res.json(rows);
  }

  // POST: add a product (admin only)
  requireAdmin(req);
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const price = Math.round(Number(b.price) * 100); // admin types rupees, we store paise
  const stock = Number.parseInt(b.stock, 10);

  if (!name) throw new HttpError(400, 'Name is required');
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Enter a valid price');
  if (!Number.isInteger(stock) || stock < 0) throw new HttpError(400, 'Stock must be 0 or more');

  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price_paise, category, image_url, stock, is_featured)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      name,
      String(b.description || '').slice(0, 500),
      price,
      String(b.category || '').slice(0, 60),
      String(b.image_url || '').slice(0, 300),
      stock,
      Boolean(b.is_featured),
    ]
  );
  res.status(201).json(rows[0]);
});