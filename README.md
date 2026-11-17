# The Velvet Skein: frontend + backend

## 1. What to keep as the backend

You only need four things stored on the server:

| Table | Why it exists | Key fields |
|---|---|---|
| `products` | The items you sell (add product page writes here) | name, description, price (paise), stock, image, is_featured |
| `orders` | One row per purchase | id, status, customer details, total |
| `order_items` | The lines in each order | product, name and price **at time of purchase**, qty |
| `subscribers` | Newsletter emails | email |

Two rules keep the backend honest:

- **Never trust prices sent from the browser.** The server looks up each price from `products`.
- **Stock is reduced on the server** when an order is created, and returned if the order is cancelled.

Money is stored as integers in paise (₹150 = 15000) to avoid decimal bugs.

## 2. The buying flow (step by step)

```
Browser                              Server                           Payment provider
-------                              ------                           ----------------
1. Click "Add to Bag"        -->     (nothing yet, bag lives in localStorage)
2. Open bag, change qty
3. Click Checkout, fill form
4. POST /api/orders          -->     Check each product exists
    items: [{productId, qty}]        Check qty 1..20
    customer: {name, email...}       Reserve stock (fails if not enough)
                                     Insert order (status: pending_payment)
                                <--  {id: "VS-1A2B3C4D", totalPaise}
5. Open payment popup        ------------------------------------------>  Customer pays
                                                                     <--  payment_id + signature
6. POST /api/orders/:id/pay  -->     Verify signature (PRODUCTION)
                                     Set status = paid
                                <--  {status: "paid"}
7. Bag cleared, "Thank you" shown
8. Admin marks PATCH .../status  -->  paid -> shipped
   (or cancels an unpaid order: stock is returned)
```

Order statuses: `pending_payment` -> `paid` -> `shipped`, or `pending_payment` -> `cancelled`.

## 3. Run it

Requires Node.js 18 or newer.

```bash
cd velvet-skein/server
npm install
ADMIN_KEY=pick-a-long-secret npm start
```

Then open:

- Store: http://localhost:3000
- Add product: http://localhost:3000/admin.html (enter the same admin key)

On Windows PowerShell, set the key with `$env:ADMIN_KEY="pick-a-long-secret"; npm start`.

The database file `server/velvet-skein.db` is created automatically and seeded with the three products from the design.

## 4. API reference

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/products` | public | All products. Add `?featured=1` for the bestsellers row |
| POST | `/api/products` | admin | Add a product. Body: `name, description, price` (rupees), `stock, category, image_url, is_featured` |
| POST | `/api/orders` | public | Create order. Body: `items: [{productId, qty}]`, `customer: {name, email, phone, address}` |
| POST | `/api/orders/:id/pay` | public (see production note) | Mark order paid |
| GET | `/api/orders/:id` | public | Order details for confirmation |
| PATCH | `/api/orders/:id/status` | admin | Body: `{status: "shipped"}` or `{status: "cancelled"}` |
| POST | `/api/newsletter` | public | Body: `{email}` |

Admin routes need the header `x-admin-key: <your key>`.

Example, adding a product from the terminal:

```bash
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "x-admin-key: pick-a-long-secret" \
  -d '{"name":"Mini Cactus Pot","description":"Zero watering needed.","price":180,"stock":10,"category":"Forever Flowers","image_url":"assets/cactus.jpg","is_featured":true}'
```

## 5. Adding real payments (Razorpay, recommended for India)

The `/pay` route is a demo that marks orders paid. Before going live, replace it:

1. `npm install razorpay`
2. In `POST /api/orders`, after inserting the order, call
   `razorpay.orders.create({ amount: totalPaise, currency: 'INR', receipt: id })`
   and save the returned `razorpay_order_id` on your order. Return it to the browser.
3. In the browser (`app.js`, step 2), open Razorpay Checkout with that order id.
4. In `POST /api/orders/:id/pay`, receive `razorpay_payment_id` and `razorpay_signature`,
   then verify with HMAC-SHA256 using your key secret:
   ```js
   const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
     .update(`${razorpayOrderId}|${paymentId}`).digest('hex');
   if (expected !== signature) throw new HttpError(400, 'Payment not verified');
   ```
5. Only then set `status = 'paid'`. Also add a Razorpay webhook so payments that
   succeed after the browser closes still mark the order paid.

## 6. Before you launch (production checklist)

- Change `ADMIN_KEY` to a long random value. Better still, add a real login for admin.
- Serve over HTTPS.
- Replace the demo `/pay` route with real payment verification (section 5).
- Send confirmation emails (Resend, SendGrid, or Nodemailer) after step 6.
- Add an admin view for orders, so you can see and mark them shipped without curl.
- Customer order lookup currently uses the order id only. Add email verification
  before showing order details in production.
- Back up `velvet-skein.db` regularly, or move to PostgreSQL when traffic grows.

## 7. Images from Figma

The page references these image files, which go in `public/assets/`:

| File | Figma node |
|---|---|
| `hero.jpg` | 1:38 (hero lifestyle image) |
| `dolls.jpg` | 1:64 |
| `florals.jpg` | 1:81 |
| `keychains.jpg` | 1:98 |
| `custom.jpg` | 1:115 |
| `product-sunflower.jpg` | 1:142 |
| `product-penguin.jpg` | 1:164 |
| `product-lily.jpg` | 1:186 |

Easiest route: in Figma, select each image frame and use Export (JPG, 2x), or ask
Claude to download them with the Figma connector. The temporary asset links Figma gives
expire after 7 days, so download them promptly and do not hotlink them in production.

## 8. Project layout

```
velvet-skein/
├── public/
│   ├── index.html     Full page from Figma (hero, categories, bestsellers, newsletter, footer)
│   ├── admin.html     Add product form
│   ├── styles.css     Design tokens and responsive layout
│   ├── app.js         Products, bag, checkout, newsletter logic
│   └── assets/        Images (see section 7)
├── server/
│   ├── server.js      Express API + SQLite database
│   └── package.json
└── README.md
```
