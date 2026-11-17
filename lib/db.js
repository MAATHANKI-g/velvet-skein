const { Pool } = require('pg');

// DATABASE_URL is your Neon connection string (set in Vercel, never in code).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // each serverless instance uses one connection
});

let ready = null;

// Creates the tables on first use and loads the sample products if the table is empty.
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id           SERIAL PRIMARY KEY,
          name         TEXT NOT NULL,
          description  TEXT NOT NULL DEFAULT '',
          price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
          category     TEXT NOT NULL DEFAULT '',
          image_url    TEXT NOT NULL DEFAULT '',
          stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
          is_featured  BOOLEAN NOT NULL DEFAULT false,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS orders (
          id              TEXT PRIMARY KEY,
          status          TEXT NOT NULL,
          customer_name   TEXT NOT NULL,
          customer_email  TEXT NOT NULL,
          customer_phone  TEXT NOT NULL DEFAULT '',
          address         TEXT NOT NULL,
          total_paise     INTEGER NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS order_items (
          order_id          TEXT NOT NULL REFERENCES orders(id),
          product_id        INTEGER REFERENCES products(id),
          name              TEXT NOT NULL,
          unit_price_paise  INTEGER NOT NULL,
          qty               INTEGER NOT NULL CHECK (qty > 0)
        );
        CREATE TABLE IF NOT EXISTS subscribers (
          email      TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
      if (rows[0].n === 0) {
        await pool.query(`
          INSERT INTO products (name, description, price_paise, category, image_url, stock, is_featured) VALUES
          ('Sunny Desk Sunflower', 'A little desk-sized sunshine that never droops.', 15000, 'Forever Flowers', 'assets/product-sunflower.jpg', 12, true),
          ('Pocket Penguin Keychain', 'Small enough for your pocket, cute enough to steal the spotlight on your bag.', 20000, 'Keychains & Charms', 'assets/product-penguin.jpg', 20, true),
          ('White Lilies', 'Hand-crocheted white lilies for a bouquet that lasts.', 25000, 'Forever Flowers', 'assets/product-lily.jpg', 8, true)
        `);
      }
    })().catch((err) => {
      ready = null; // allow a retry on the next request
      throw err;
    });
  }
  return ready;
}

module.exports = { pool, ensureSchema };