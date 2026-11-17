const express = require('express');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ and 23.4+; no compiler needed
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Database ---------- */
// Money is stored in paise (1 rupee = 100 paise) as integers to avoid float bugs.
const db = new DatabaseSync(path.join(__dirname, 'velvet-skein.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT    DEFAULT '',
    price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
    category     TEXT    DEFAULT '',
    image_url    TEXT    DEFAULT '',
    stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    is_featured  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL,
    customer_name   TEXT NOT NULL,
    customer_email  TEXT NOT NULL,
    customer_phone  TEXT DEFAULT '',
    address         TEXT NOT NULL,
    total_paise     INTEGER NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id          TEXT    REFERENCES orders(id),
    product_id        INTEGER REFERENCES products(id),
    name              TEXT    NOT NULL,
    unit_price_paise  INTEGER NOT NULL,
    qty               INTEGER NOT NULL CHECK (qty > 0)
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    email      TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Runs fn inside BEGIN/COMMIT; rolls back if anything throws.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

// Seed the three featured products from the Figma design (only on an empty DB).
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const ins = db.prepare(`
    INSERT INTO products (name, description, price_paise, category, image_url, stock, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  ins.run('Sunny Desk Sunflower', 'A little desk-sized sunshine that never droops.', 15000, 'Forever Flowers', 'assets/product-sunflower.jpg', 12);
  ins.run('Pocket Penguin Keychain', 'Small enough for your pocket, cute enough to steal the spotlight on your bag.', 20000, 'Keychains & Charms', 'assets/product-penguin.jpg', 20);
  ins.run('White Lilies', 'Hand-crocheted white lilies for a bouquet that lasts.', 25000, 'Forever Flowers', 'assets/product-lily.jpg', 8);
}

/* ---------- App ---------- */
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key') || '';
  const a = Buffer.from(key);
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Admin key required' });
  }
  next();
}

/* ----- Products ----- */

app.get('/api/products', (req, res) => {
  const sql = req.query.featured
    ? 'SELECT * FROM products WHERE is_featured = 1 ORDER BY id'
    : 'SELECT * FROM products ORDER BY id';
  res.json(db.prepare(sql).all());
});

app.post('/api/products', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const price = Math.round(Number(b.price) * 100); // admin types rupees, we store paise
  const stock = Number.parseInt(b.stock, 10);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Enter a valid price' });
  if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'Stock must be 0 or more' });

  const info = db.prepare(`
    INSERT INTO products (name, description, price_paise, category, image_url, stock, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    String(b.description || '').slice(0, 500),
    price,
    String(b.category || '').slice(0, 60),
    String(b.image_url || '').slice(0, 300),
    stock,
    b.is_featured ? 1 : 0
  );

  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid)));
});

/* ----- Orders (buying steps) ----- */

app.post('/api/orders', (req, res) => {
  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Your bag is empty');
  }
  const c = customer || {};
  const name = String(c.name || '').trim();
  const email = String(c.email || '').trim().toLowerCase();
  const address = String(c.address || '').trim();
  if (!name || !email || !address) throw new HttpError(400, 'Name, email and address are required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const reserveStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

  const createOrder = transaction(() => {
    let total = 0;
    const lines = [];

    for (const it of items) {
      const productId = Number(it.productId);
      const qty = Number.parseInt(it.qty, 10);
      const p = getProduct.get(productId);
      if (!p) throw new HttpError(400, 'A product in your bag no longer exists');
      if (!(qty > 0 && qty <= 20)) throw new HttpError(400, 'Quantity must be between 1 and 20');
      if (reserveStock.run(qty, p.id, qty).changes === 0) {
        throw new HttpError(409, `Sorry, not enough ${p.name} left in stock`);
      }
      total += p.price_paise * qty;
      lines.push({ p, qty });
    }

    const id = 'VS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare(`
      INSERT INTO orders (id, status, customer_name, customer_email, customer_phone, address, total_paise)
      VALUES (?, 'pending_payment', ?, ?, ?, ?, ?)
    `).run(id, name, email, String(c.phone || '').slice(0, 20), address.slice(0, 500), total);

    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name, unit_price_paise, qty) VALUES (?, ?, ?, ?, ?)
    `);
    for (const { p, qty } of lines) insItem.run(id, p.id, p.name, p.price_paise, qty);

    return { id, totalPaise: total, status: 'pending_payment' };
  });

  res.status(201).json(createOrder());
});

// DEMO payment: marks the order paid. Replace with real verification before going live (see README).
app.post('/api/orders/:id/pay', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'pending_payment') throw new HttpError(409, 'Order already processed');

  db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
  res.json({ id: order.id, status: 'paid' });
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  const items = db.prepare(
    'SELECT product_id, name, unit_price_paise, qty FROM order_items WHERE order_id = ?'
  ).all(order.id);
  res.json({ ...order, items });
});

app.patch('/api/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  transaction(() => {
    if (status === 'shipped' && order.status === 'paid') {
      // nothing else to do
    } else if (status === 'cancelled' && order.status === 'pending_payment') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
      const restock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const it of items) restock.run(it.qty, it.product_id);
    } else {
      throw new HttpError(409, `Cannot change order from ${order.status} to ${status}`);
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
  })();

  res.json({ id: order.id, status });
});

/* ----- Newsletter ----- */
app.post('/api/newsletter', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email');
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.status(201).json({ ok: true });
});

/* ----- Errors ----- */
app.use((err, req, res, next) => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({
    error: err instanceof HttpError ? err.message : 'Something went wrong',
  });
});

app.listen(PORT, () => {
  console.log(`Velvet Skein running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin.html`);
});