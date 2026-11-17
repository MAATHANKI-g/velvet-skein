const $ = (sel) => document.querySelector(sel);
const fmt = (paise) => '₹' + (paise / 100).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BAG_KEY = 'velvet-skein-bag';
let products = [];
let bag = JSON.parse(localStorage.getItem(BAG_KEY) || '{}'); // { productId: qty }

function saveBag() {
  localStorage.setItem(BAG_KEY, JSON.stringify(bag));
  renderBag();
}

function showToast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

/* ---------- Products ---------- */
async function loadProducts() {
  try {
    products = await api('/api/products?featured=1');
    renderProducts();
    renderBag();
  } catch (err) {
    $('#featured-grid').innerHTML = `<p class="muted">Couldn't load products. Is the server running?</p>`;
  }
}

function renderProducts() {
  $('#featured-grid').innerHTML = products.map((p) => {
    const soldOut = p.stock <= 0;
    const stockText = soldOut ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock';
    return `
      <article class="product-card">
        <div class="product-img">
          <img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">
          <span class="tag">Handmade</span>
          <button class="fav" aria-label="Save ${esc(p.name)}">&#9825;</button>
        </div>
        <div class="product-title">
          <h3>${esc(p.name)}</h3>
          <span class="price">${fmt(p.price_paise)}</span>
        </div>
        <p class="product-desc">${esc(p.description)}</p>
        <p class="stock">${stockText}</p>
        <button class="btn btn-add" data-add="${p.id}" ${soldOut ? 'disabled' : ''}>
          ${soldOut ? 'Sold out' : 'Add to Bag'}
        </button>
      </article>`;
  }).join('');
}

function addToBag(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const current = bag[id] || 0;
  if (current >= p.stock) return showToast(`Only ${p.stock} left of ${p.name}`);
  bag[id] = current + 1;
  saveBag();
  showToast(`${p.name} added to your bag`);
}

function changeQty(id, delta) {
  const p = products.find((x) => x.id === id);
  const next = (bag[id] || 0) + delta;
  if (next <= 0) delete bag[id];
  else if (p && next > p.stock) return showToast(`Only ${p.stock} left`);
  else bag[id] = next;
  saveBag();
}

/* ---------- Bag ---------- */
function bagLines() {
  return Object.entries(bag)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === Number(id)), qty }))
    .filter((l) => l.p);
}

function renderBag() {
  const lines = bagLines();
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.p.price_paise * l.qty, 0);

  $('#bag-count').textContent = count;
  $('#bag-total').textContent = fmt(total);
  $('#checkout-btn').disabled = lines.length === 0;
  $('#bag-lines').innerHTML = lines.length
    ? lines.map((l) => `
        <li class="bag-line">
          <div>
            <strong>${esc(l.p.name)}</strong>
            <div class="muted small">${fmt(l.p.price_paise)} each</div>
          </div>
          <div class="qty">
            <button data-dec="${l.p.id}" aria-label="Decrease quantity">&minus;</button>
            <span>${l.qty}</span>
            <button data-inc="${l.p.id}" aria-label="Increase quantity">+</button>
          </div>
        </li>`).join('')
    : '<li class="muted">Your bag is empty. Go pick something soft.</li>';
}

/* ---------- Checkout ---------- */
async function placeOrder(e) {
  e.preventDefault();
  const form = e.target;
  const msg = $('#checkout-msg');
  const btn = form.querySelector('button[type=submit]');
  const customer = Object.fromEntries(new FormData(form));
  const items = Object.entries(bag).map(([id, qty]) => ({ productId: Number(id), qty }));

  btn.disabled = true;
  msg.textContent = 'Placing your order…';

  try {
    // 1) Create the order. Server re-prices everything and reserves stock.
    const order = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ items, customer }),
    });

    // 2) Payment. Demo mode marks it paid directly.
    //    In production: open Razorpay Checkout with order.razorpayOrderId here,
    //    then send the payment response to the server for signature verification.
    await api(`/api/orders/${order.id}/pay`, { method: 'POST' });

    // 3) Done.
    bag = {};
    saveBag();
    form.reset();
    msg.textContent = '';
    $('#checkout').close();
    showToast(`Order ${order.id} confirmed. Thank you!`);
  } catch (err) {
    msg.textContent = err.message;
    await loadProducts(); // refresh stock if something sold out
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Newsletter ---------- */
async function subscribe(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/newsletter', { method: 'POST', body: JSON.stringify({ email: form.email.value }) });
    form.reset();
    showToast("You're on the list!");
  } catch (err) {
    showToast(err.message);
  }
}

/* ---------- Wiring ---------- */
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  const inc = e.target.closest('[data-inc]');
  const dec = e.target.closest('[data-dec]');
  const close = e.target.closest('[data-close]');

  if (add) addToBag(Number(add.dataset.add));
  if (inc) changeQty(Number(inc.dataset.inc), +1);
  if (dec) changeQty(Number(dec.dataset.dec), -1);
  if (close) $('#' + close.dataset.close).close();
});

$('#bag-open').addEventListener('click', () => $('#bag').showModal());
$('#checkout-btn').addEventListener('click', () => {
  $('#bag').close();
  $('#checkout').showModal();
});
$('#checkout-form').addEventListener('submit', placeOrder);
$('#newsletter-form').addEventListener('submit', subscribe);

loadProducts();
renderBag();
