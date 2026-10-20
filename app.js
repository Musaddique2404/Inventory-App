// ═══════════════════════════════════════════════════════════════════════════
// ATEER — Firebase Auth + Firestore (Per-User Data Isolation)
// ═══════════════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyCc4VUMaGSGOwtqeXpqne9_PhwMpv0xjxs",
  authDomain: "stockcontrol-inventory.firebaseapp.com",
  projectId: "stockcontrol-inventory",
  storageBucket: "stockcontrol-inventory.firebasestorage.app",
  messagingSenderId: "739892225209",
  appId: "1:739892225209:web:2a3b1ec03923df952fa768",
  measurementId: "G-H30TQN7F89"
};

// ── Init Firebase ─────────────────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ─── Per-user collection helpers ─────────────────────────────────────────────
// All data is stored under: users/{userId}/products, /sales and /purchases
// This ensures each account has completely private, isolated data.
function userCol(name) {
  return db.collection('users').doc(state.currentUser.uid).collection(name);
}
function userProductsCol()  { return userCol('products'); }
function userSalesCol()     { return userCol('sales'); }
function userPurchasesCol() { return userCol('purchases'); }

// ─── Constants ────────────────────────────────────────────────────────────────
const LOW_STOCK_THRESHOLD = 5;
const PAYMENT_TYPES = [
  { id: 'cash',   icon: '💵', label: 'Cash'   },
  { id: 'card',   icon: '💳', label: 'Card'   },
  { id: 'credit', icon: '🏦', label: 'Credit' },
];

// ─── App State ────────────────────────────────────────────────────────────────
let state = {
  currentPage: 'dashboard',
  products: [],
  sales: [],
  purchases: [],
  expandedSales: {},
  expandedPurchases: {},
  inventorySearch: '',
  inventoryFilter: 'all',
  dateFilter: 'today',
  customDateStart: new Date().toISOString().slice(0, 10),
  customDateEnd:   new Date().toISOString().slice(0, 10),
  currentUser: null,
  // Firestore real-time listener unsubscribers
  _unsubProducts: null,
  _unsubSales: null,
  _unsubPurchases: null,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmt(num) {
  return `SAR ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Escape user-typed text before putting it into HTML / attribute values
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9);
}

function toDate(ts) {
  if (!ts) return new Date();               // pending server timestamp
  return ts.toDate ? ts.toDate() : new Date(ts);
}

// Today's date as YYYY-MM-DD in the user's local timezone
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The date a sale/purchase belongs to: the chosen sale date, else when it was recorded
function recordDate(r) {
  if (r.saleDate) {
    const [y, m, d] = r.saleDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return toDate(r.timestamp);
}

function fmtDate(date) {
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Number without currency, e.g. 1,250.00
function fmtNum(num) {
  return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Size class for long amounts so big numbers still fit on a phone
function sizeClass(text, longAt, xlongAt) {
  const n = String(text).length;
  return n >= xlongAt ? ' xlong' : n >= longAt ? ' long' : '';
}

// ─── Icons (24×24 stroke icons) ──────────────────────────────────────────────
const ICONS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  box:       'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  trend:     'M3 17l6-6 4 4 8-8M15 7h6v6',
  cart:      'M6 6h15l-2 9H8zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  moon:      'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun:       'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  power:     'M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0',
  doc:       'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  dollar:    'M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6',
  alert:     'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  bars:      'M4 20V10M10 20V4M16 20v-7M22 20H2',
  check:     'M5 12l5 5 9-10',
  bolt:      'M13 2L4 14h7l-1 8 9-12h-7z',
  search:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2',
  plus:      'M12 5v14M5 12h14',
  x:         'M6 6l12 12M18 6L6 18',
  chevron:   'M6 9l6 6 6-6',
  trash:     'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  cash:      'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  card:      'M3 6h18v12H3zM3 10h18M7 15h4',
  bank:      'M3 10h18M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18M12 3l9 5H3z',
  factory:   'M3 21V10l6 3V10l6 3V6l6-3v18zM3 21h18',
  inbox:     'M12 3v11M7 9l5 5 5-5M4 15v5h16v-5',
  refresh:   'M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4',
};

function ic(name, size = 16, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"></path></svg>`;
}

const PAY_IC   = { cash: 'cash', card: 'card', credit: 'bank' };
const PAY_TONE = { cash: 'green', card: 'blue', credit: 'purple' };
const PAY_NAME = { cash: 'Cash', card: 'Card', credit: 'Credit' };
function payOf(r) { return PAY_IC[r.paymentType] ? r.paymentType : 'cash'; }

// ─── Theme (light / dark) ────────────────────────────────────────────────────
function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

function toggleTheme() {
  const dark = !isDark();
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else      document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('ateer-theme', dark ? 'dark' : 'light'); } catch (e) {}
  updateThemeChrome();
}

function updateThemeChrome() {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.innerHTML = ic(isDark() ? 'sun' : 'moon', 17);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark() ? '#141517' : '#f4f2ef');
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH LAYER
// ══════════════════════════════════════════════════════════════════════════════

// Switch between Sign In / Create Account tabs
function switchAuthTab(tab) {
  const login = tab === 'login';
  document.getElementById('auth-login-form').style.display    = login ? '' : 'none';
  document.getElementById('auth-register-form').style.display = login ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active',    login);
  document.getElementById('tab-register').classList.toggle('active', !login);
  const title = document.getElementById('auth-title');
  const sub   = document.getElementById('auth-sub');
  if (title) title.textContent = login ? 'Welcome back' : 'Create your account';
  if (sub)   sub.textContent   = login ? 'Sign in to manage your stock, sales and purchases.'
                                       : 'Your shop data stays private to your account.';
  ['err-login-email','err-login-password','err-login-general',
   'err-reg-name','err-reg-email','err-reg-password','err-reg-general'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

function setAuthLoading(form, loading) {
  const btn  = document.getElementById(`btn-${form}`);
  const txt  = document.getElementById(`btn-${form}-text`);
  const spin = document.getElementById(`btn-${form}-spin`);
  btn.disabled    = loading;
  txt.style.display  = loading ? 'none' : '';
  spin.style.display = loading ? ''     : 'none';
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  let valid = true;

  document.getElementById('err-login-email').textContent    = '';
  document.getElementById('err-login-password').textContent = '';
  document.getElementById('err-login-general').textContent  = '';

  if (!email)    { document.getElementById('err-login-email').textContent    = 'Email is required';    valid = false; }
  if (!password) { document.getElementById('err-login-password').textContent = 'Password is required'; valid = false; }
  if (!valid) return;

  setAuthLoading('login', true);
  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged handles the rest
  } catch (e) {
    document.getElementById('err-login-general').textContent = friendlyAuthError(e.code);
    setAuthLoading('login', false);
  }
}

async function handleRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  let valid = true;

  ['err-reg-name','err-reg-email','err-reg-password','err-reg-general'].forEach(id =>
    document.getElementById(id).textContent = '');

  if (!name)              { document.getElementById('err-reg-name').textContent     = 'Name is required';         valid = false; }
  if (!email)             { document.getElementById('err-reg-email').textContent    = 'Email is required';        valid = false; }
  if (password.length < 6){ document.getElementById('err-reg-password').textContent = 'Min 6 characters';         valid = false; }
  if (!valid) return;

  setAuthLoading('register', true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // onAuthStateChanged handles the rest
  } catch (e) {
    document.getElementById('err-reg-general').textContent = friendlyAuthError(e.code);
    setAuthLoading('register', false);
  }
}

async function handleLogout() {
  // Detach Firestore listeners before signing out
  if (state._unsubProducts) { state._unsubProducts(); state._unsubProducts = null; }
  if (state._unsubSales)    { state._unsubSales();    state._unsubSales    = null; }
  if (state._unsubPurchases){ state._unsubPurchases(); state._unsubPurchases = null; }
  await auth.signOut();
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with this email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-email':        'Invalid email address.',
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/weak-password':        'Password is too weak.',
    'auth/too-many-requests':    'Too many attempts. Try again later.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/user-disabled':          'This account has been disabled.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ── Auth state observer ───────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (user) {
    state.currentUser = user;
    showAppScreen(user);
    startFirestoreListeners();
  } else {
    state.currentUser = null;
    stopFirestoreListeners();
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app-screen').style.display  = 'none';
  // Reset login button state in case it was stuck loading
  setAuthLoading('login',    false);
  setAuthLoading('register', false);
}

function showAppScreen(user) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = '';

  // Header + tab bar icons
  updateThemeChrome();
  const out = document.getElementById('logout-btn');
  if (out) out.innerHTML = ic('power', 17);
  document.querySelectorAll('.tab-ic[data-icon]').forEach(el => { el.innerHTML = ic(el.dataset.icon, 19); });

  // Tab buttons (re-bind once per sign-in)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => navigateTo(fresh.dataset.page));
  });

  showDbLoading(true);
}

// ══════════════════════════════════════════════════════════════════════════════
// FIRESTORE — REAL-TIME LISTENERS
// ══════════════════════════════════════════════════════════════════════════════

function startFirestoreListeners() {
  // Products listener
  state._unsubProducts = userProductsCol()
    .orderBy('name')
    .onSnapshot(snap => {
      state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateSidebarProductCount();
      renderCurrentPage();
      showDbLoading(false);
    }, err => {
      console.error('Products listener error:', err);
      showToast('Failed to load products', 'error');
      showDbLoading(false);
    });

  // Sales listener — sorted newest first
  state._unsubSales = userSalesCol()
    .orderBy('timestamp', 'desc')
    .onSnapshot(snap => {
      state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => recordDate(b) - recordDate(a) || toDate(b.timestamp) - toDate(a.timestamp));
      renderCurrentPage();
    }, err => {
      console.error('Sales listener error:', err);
    });

  // Purchases listener — sorted newest first
  state._unsubPurchases = userPurchasesCol()
    .orderBy('timestamp', 'desc')
    .onSnapshot(snap => {
      state.purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCurrentPage();
    }, err => {
      console.error('Purchases listener error:', err);
      showToast('Failed to load purchases', 'error');
    });
}

function stopFirestoreListeners() {
  if (state._unsubProducts)  { state._unsubProducts();  state._unsubProducts  = null; }
  if (state._unsubSales)     { state._unsubSales();     state._unsubSales     = null; }
  if (state._unsubPurchases) { state._unsubPurchases(); state._unsubPurchases = null; }
  state.products  = [];
  state.sales     = [];
  state.purchases = [];
}

function showDbLoading(visible) {
  const el = document.getElementById('db-loading');
  if (el) el.style.display = visible ? '' : 'none';
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT OPERATIONS (Firestore)
// ══════════════════════════════════════════════════════════════════════════════

async function addProduct(data) {
  try {
    await userProductsCol().add({
      ...data,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeModal();
    showToast('Product added successfully');
    // Real-time listener refreshes state automatically
  } catch (e) {
    console.error(e);
    showToast('Failed to add product', 'error');
  }
}

async function editProduct(id, data) {
  try {
    await userProductsCol().doc(id).update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeModal();
    showToast('Product updated');
  } catch (e) {
    console.error(e);
    showToast('Failed to update product', 'error');
  }
}

async function deleteProduct(id) {
  try {
    await userProductsCol().doc(id).delete();
    closeModal();
    showToast('Product deleted');
  } catch (e) {
    console.error(e);
    showToast('Failed to delete product', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SALE OPERATIONS (Firestore)
// ══════════════════════════════════════════════════════════════════════════════

async function recordSale(data) {
  const batch = db.batch();

  // Write the sale document
  const saleRef = userSalesCol().doc();
  batch.set(saleRef, {
    ...data,
    recordedBy: state.currentUser?.email || 'unknown',
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // Decrement stock for each item
  data.items.forEach(item => {
    const productRef = userProductsCol().doc(item.productId);
    batch.update(productRef, {
      quantity: firebase.firestore.FieldValue.increment(-item.quantity),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });

  try {
    await batch.commit();
    closeModal();
    const names = data.items.map(it => it.productName).join(', ');
    showToast(`Sale recorded — ${data.items.length} item${data.items.length > 1 ? 's' : ''}: ${names}`);
  } catch (e) {
    console.error(e);
    showToast('Failed to record sale', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASE OPERATIONS (Firestore)
// Every purchase ADDS its quantities to stock in the same atomic batch.
// ══════════════════════════════════════════════════════════════════════════════

async function recordPurchase(data, { updateCostPrice = true } = {}) {
  const batch = db.batch();
  const now   = firebase.firestore.FieldValue.serverTimestamp();

  const items = data.items.map(item => {
    // Brand-new product bought for the first time → create it with the purchased qty
    if (item.isNew) {
      const productRef = userProductsCol().doc();
      batch.set(productRef, {
        name:      item.productName,
        quantity:  item.quantity,
        costPrice: item.unitCost,
        price:     item.sellingPrice ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return { productId: productRef.id, productName: item.productName, quantity: item.quantity, unitCost: item.unitCost, isNewProduct: true };
    }

    // Existing product → increment stock (and optionally refresh its buying price)
    const productRef = userProductsCol().doc(item.productId);
    const update = {
      quantity:  firebase.firestore.FieldValue.increment(item.quantity),
      updatedAt: now,
    };
    if (updateCostPrice) update.costPrice = item.unitCost;
    batch.update(productRef, update);
    return { productId: item.productId, productName: item.productName, quantity: item.quantity, unitCost: item.unitCost };
  });

  const purchaseRef = userPurchasesCol().doc();
  batch.set(purchaseRef, {
    supplierName:  data.supplierName,
    supplierPhone: data.supplierPhone,
    invoiceNo:     data.invoiceNo,
    paymentType:   data.paymentType,
    vatIncluded:   data.vatIncluded,
    subtotal:      data.subtotal,
    vatAmount:     data.vatAmount,
    total:         data.total,
    items,
    recordedBy: state.currentUser?.email || 'unknown',
    timestamp:  now,
  });

  try {
    await batch.commit();
    closeModal();
    const units = items.reduce((s, it) => s + it.quantity, 0);
    showToast(`Purchase recorded — ${units} unit${units !== 1 ? 's' : ''} added to stock`);
  } catch (e) {
    console.error(e);
    showToast('Failed to record purchase', 'error');
    setPurchaseSubmitting(false);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function showToast(message, type = 'success') {
  const area  = document.getElementById('toast-area');
  const toast = document.createElement('div');
  const ok    = type === 'success';
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="ic ${ok ? 'ic-green' : 'ic-red'}">${ic(ok ? 'check' : 'x', 14, 2.4)}</span><span>${esc(message)}</span>`;
  area.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function showModal(content) {
  document.getElementById('modal-container').innerHTML = `
    <div class="overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">${content}</div>
    </div>`;
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function updateSidebarProductCount() {
  // Product count is shown on the dashboard; nothing else to update.
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function navigateTo(page) {
  state.currentPage = page;
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => (p.style.display = 'none'));
  document.getElementById(`${page}-page`).style.display = 'grid';
  window.scrollTo(0, 0);
  renderCurrentPage();
}

function renderCurrentPage() {
  switch (state.currentPage) {
    case 'dashboard': renderDashboard();  break;
    case 'inventory': renderInventory();  break;
    case 'sales':     renderSales();      break;
    case 'purchases': renderPurchases();  break;
  }
  // Keep an open purchase form in sync when products change in real time
  // (skipped while the user is typing in it, so no keystrokes are lost)
  const pc = document.getElementById('purchase-items-container');
  if (pc && !pc.contains(document.activeElement)) renderPurchaseItems();
}

// ══════════════════════════════════════════════════════════════════════════════
// FORM BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

function productFormHTML(product = null) {
  const isEdit = product !== null;
  return `
    <div class="modal-title"><span class="ic ic-orange">${ic('box')}</span>${isEdit ? 'Edit product' : 'Add product'}</div>
    <form id="product-form" onsubmit="return handleProductSubmit(event, ${isEdit ? `'${product.id}'` : 'null'})">
      <div class="form-grid">
        <div class="field">
          <label>Product name <span class="req">*</span></label>
          <input type="text" name="name" value="${esc(product?.name || '')}" placeholder="e.g. Apple AirPods" required>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Quantity <span class="req">*</span></label>
            <input type="number" name="quantity" value="${product?.quantity ?? ''}" min="0" placeholder="0" inputmode="numeric" required>
          </div>
          <div class="field">
            <label>Buying price</label>
            <input type="number" name="costPrice" value="${product?.costPrice ?? ''}" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
          </div>
        </div>
        <div class="field">
          <label>Selling price</label>
          <input type="number" name="price" value="${product?.price ?? ''}" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add product'}</button>
        </div>
      </div>
    </form>`;
}

function handleProductSubmit(event, productId) {
  event.preventDefault();
  const form = event.target;
  const data = {
    name:      form.name.value.trim(),
    quantity:  parseInt(form.quantity.value),
    costPrice: form.costPrice.value ? parseFloat(form.costPrice.value) : null,
    price:     form.price.value     ? parseFloat(form.price.value)     : null,
  };
  productId ? editProduct(productId, data) : addProduct(data);
  return false;
}

function saleFormHTML() {
  return `
    <div class="modal-title"><span class="ic ic-orange">${ic('bolt')}</span>New sale</div>
    <div id="sale-form-content">
      <div class="form-section">
        <div class="form-label"><span class="lbl">Customer</span></div>
        <div class="form-row">
          <div class="field">
            <label>Full name <span class="req">*</span></label>
            <input type="text" id="customer-name" placeholder="Ahmed Al-Rashid" autocomplete="off">
            <span class="err-msg" id="err-customer-name"></span>
          </div>
          <div class="field">
            <label>Date <span class="req">*</span></label>
            <input type="date" id="sale-date" value="${todayISO()}" max="${todayISO()}">
            <span class="err-msg" id="err-sale-date"></span>
          </div>
        </div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div class="form-label">
          <span class="lbl">Products (<span id="item-count">1</span>)</span>
          <button type="button" class="add-item-btn" onclick="addSaleItem()">+ Add item</button>
        </div>
        <div class="purchase-row purchase-row-head"><span>Product</span><span>Qty</span><span>Price / unit</span><span></span></div>
        <div id="sale-items-container"></div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div class="form-label"><span class="lbl">Payment &amp; tax</span></div>
        <label class="option-check">
          <input type="checkbox" id="vat-included" checked>
          <div style="flex:1;">
            <div class="option-check-title">VAT included in price</div>
            <div class="option-check-desc" id="vat-description">Prices already include 15% VAT</div>
          </div>
        </label>
        <div id="payment-types" class="pay-types"></div>
      </div>

      <div id="order-summary"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="submitSale()">Record sale</button>
      </div>
    </div>`;
}

// ── Sale form state ───────────────────────────────────────────────────────────
let saleFormState = { items: [], paymentType: 'cash', vatIncluded: true };

function initSaleForm() {
  saleFormState = {
    items: [{ id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2,9), productId: '', qty: '', price: '' }],
    paymentType: 'cash',
    vatIncluded: true,
  };
  renderSaleItems();
  renderPaymentTypes();
  updateSaleFormSummary();

  document.getElementById('vat-included')?.addEventListener('change', e => {
    saleFormState.vatIncluded = e.target.checked;
    const desc = document.getElementById('vat-description');
    if (desc) desc.textContent = saleFormState.vatIncluded
      ? 'Prices already include 15% VAT'
      : '15% VAT will be added to total';
    updateSaleFormSummary();
  });
}

function addSaleItem() {
  saleFormState.items.push({ id: Math.random().toString(36).substr(2,9), productId: '', qty: '', price: '' });
  renderSaleItems();
  updateSaleFormSummary();
}

function removeSaleItem(itemId) {
  if (saleFormState.items.length > 1) {
    saleFormState.items = saleFormState.items.filter(it => it.id !== itemId);
    renderSaleItems();
    updateSaleFormSummary();
  }
}

function updateSaleItem(itemId, field, value) {
  const item = saleFormState.items.find(it => it.id === itemId);
  if (!item) return;
  item[field] = value;
  if (field === 'productId') {
    const product = state.products.find(p => p.id === value);
    item.price = product?.price != null ? String(product.price) : '';
    item.qty   = '';
  }
  renderSaleItems();
  updateSaleFormSummary();
}

function renderSaleItems() {
  const container = document.getElementById('sale-items-container');
  if (!container) return;

  const usedIds = saleFormState.items.map(it => it.productId).filter(Boolean);
  const single  = saleFormState.items.length === 1;

  container.innerHTML = saleFormState.items.map(item => {
    const product   = state.products.find(p => p.id === item.productId);
    const lineTotal = item.qty && item.price && !isNaN(item.qty) && !isNaN(item.price)
      ? Number(item.qty) * Number(item.price) : null;

    const productOptions = state.products.map(p => {
      const disabled = p.quantity === 0 || (usedIds.includes(p.id) && p.id !== item.productId);
      return `<option value="${p.id}" ${item.productId === p.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(p.name)} (${p.quantity === 0 ? 'out of stock' : p.quantity + ' in stock'})</option>`;
    }).join('');

    return `
      <div class="purchase-item">
        <div class="purchase-row">
          <div class="purchase-product">
            <select onchange="updateSaleItem('${item.id}','productId',this.value)">
              <option value="">— Select product —</option>${productOptions}
            </select>
          </div>
          <input type="number" min="1" max="${product?.quantity ?? ''}" value="${esc(item.qty)}" placeholder="Qty" inputmode="numeric"
            onchange="updateSaleItem('${item.id}','qty',this.value)" ${!item.productId ? 'disabled' : ''}>
          <div class="sar-input">
            <span>SAR</span>
            <input type="number" min="0" step="0.01" value="${esc(item.price)}" placeholder="0.00" inputmode="decimal"
              onchange="updateSaleItem('${item.id}','price',this.value)" ${!item.productId ? 'disabled' : ''}>
          </div>
          <button type="button" class="row-remove-btn" onclick="removeSaleItem('${item.id}')" ${single ? 'disabled' : ''} aria-label="Remove item">${ic('x', 15)}</button>
        </div>
        <div class="purchase-item-meta">
          <span>${product ? `${product.quantity} in stock` : 'Choose a product'}</span>
          ${lineTotal !== null ? `<span>${item.qty} × ${fmt(Number(item.price))} = <strong style="color:var(--orange);">${fmt(lineTotal)}</strong></span>` : ''}
        </div>
      </div>`;
  }).join('');

  const el = document.getElementById('item-count');
  if (el) el.textContent = saleFormState.items.length;
}

function renderPaymentTypes() {
  const container = document.getElementById('payment-types');
  if (!container) return;
  container.innerHTML = PAYMENT_TYPES.map(pt => `
    <button type="button" class="pay-type-btn${saleFormState.paymentType === pt.id ? ' active' : ''}"
      onclick="saleFormState.paymentType='${pt.id}'; renderPaymentTypes();">${ic(PAY_IC[pt.id], 20)}${pt.label}</button>`).join('');
}

function updateSaleFormSummary() {
  const container = document.getElementById('order-summary');
  if (!container) return;

  const subtotal   = saleFormState.items.reduce((s, i) => s + (isNaN(Number(i.qty)*Number(i.price)) ? 0 : Number(i.qty)*Number(i.price)), 0);
  const vatAmount  = saleFormState.vatIncluded ? 0 : subtotal * 0.15;
  const grandTotal = subtotal + vatAmount;
  const n = saleFormState.items.length;

  container.innerHTML = `
    <div class="order-summary-box">
      <div class="osb-label">Order summary</div>
      <div class="summary-line"><span>Subtotal (${n} item${n !== 1 ? 's' : ''})</span><strong>${fmt(subtotal)}</strong></div>
      ${!saleFormState.vatIncluded ? `<div class="summary-line"><span>VAT (15%)</span><strong>${fmt(vatAmount)}</strong></div>` : ''}
      <div class="summary-total"><span>Grand total</span><span class="summary-total-value">${fmt(grandTotal)}</span></div>
    </div>`;
}

function submitSale() {
  const customerName = document.getElementById('customer-name').value.trim();
  const saleDate     = document.getElementById('sale-date').value;
  let errors = {};

  if (!customerName) errors.customerName = 'Customer name is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) errors.saleDate = 'Select a date';
  else if (saleDate > todayISO())             errors.saleDate = 'Date cannot be in the future';

  saleFormState.items.forEach((item, i) => {
    const product = state.products.find(p => p.id === item.productId);
    if (!item.productId)                                      errors[`p_${i}`] = 'Select a product';
    if (!item.qty || isNaN(item.qty) || Number(item.qty)<=0) errors[`q_${i}`] = 'Enter qty > 0';
    else if (product && Number(item.qty) > product.quantity)  errors[`q_${i}`] = `Max ${product.quantity}`;
    if (!item.price || isNaN(item.price) || Number(item.price)<0) errors[`s_${i}`] = 'Enter price';
  });

  document.getElementById('err-customer-name').textContent = errors.customerName || '';
  document.getElementById('err-sale-date').textContent     = errors.saleDate     || '';

  if (Object.keys(errors).length > 0) { showToast('Please fix validation errors', 'error'); return; }

  const lineItems = saleFormState.items.map(item => {
    const product = state.products.find(p => p.id === item.productId);
    return { productId: item.productId, productName: product.name, quantity: Number(item.qty), priceAtSale: Number(item.price) };
  });

  recordSale({ customerName, saleDate, paymentType: saleFormState.paymentType, vatIncluded: saleFormState.vatIncluded, items: lineItems });
}

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASE FORM
// ══════════════════════════════════════════════════════════════════════════════

const NEW_PRODUCT = '__new__';
const VAT_RATE    = 0.15;

let purchaseFormState = { items: [], paymentType: 'cash', vatIncluded: true, updateCostPrice: true, errors: {}, submitting: false };

function openPurchaseForm(productId = '') {
  showModal(purchaseFormHTML());
  initPurchaseForm(productId);
}

function purchaseFormHTML() {
  const suppliers = [...new Set(state.purchases.map(p => p.supplierName).filter(Boolean))];
  return `
    <div class="modal-title"><span class="ic ic-purple">${ic('cart')}</span>New purchase</div>
    <div class="purchase-form">
      <div class="purchase-note">Every item in this purchase is <strong>added to stock</strong> as soon as you save it.</div>

      <div class="form-section">
        <div class="form-label"><span class="lbl">Supplier</span></div>
        <div class="supplier-grid">
          <div class="field supplier-name-field">
            <label>Supplier name <span class="req">*</span></label>
            <input type="text" id="supplier-name" list="supplier-list" placeholder="e.g. Al-Jazeera Trading" autocomplete="off">
            <datalist id="supplier-list">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
            <span class="err-msg" id="err-supplier-name"></span>
          </div>
          <div class="field">
            <label>Phone <span class="hint">(optional)</span></label>
            <input type="tel" id="supplier-phone" placeholder="+966 5XX XXX XXXX">
            <span class="err-msg" id="err-supplier-phone"></span>
          </div>
          <div class="field">
            <label>Invoice no. <span class="hint">(optional)</span></label>
            <input type="text" id="supplier-invoice" placeholder="INV-1001">
          </div>
        </div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div class="form-label">
          <span class="lbl">Items (<span id="purchase-item-count">1</span>)</span>
          <button type="button" class="add-item-btn" onclick="addPurchaseItem()">+ Add item</button>
        </div>
        <div class="purchase-row purchase-row-head"><span>Product</span><span>Qty</span><span>Cost / unit</span><span></span></div>
        <div id="purchase-items-container"></div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div class="form-label"><span class="lbl">Payment &amp; options</span></div>
        <label class="option-check">
          <input type="checkbox" id="purchase-vat-included" checked>
          <div style="flex:1;">
            <div class="option-check-title">VAT included in cost</div>
            <div class="option-check-desc" id="purchase-vat-description">Costs already include 15% VAT</div>
          </div>
        </label>
        <label class="option-check">
          <input type="checkbox" id="purchase-update-cost" checked>
          <div style="flex:1;">
            <div class="option-check-title">Update buying price</div>
            <div class="option-check-desc">Set each product's buying price to this unit cost</div>
          </div>
        </label>
        <div id="purchase-payment-types" class="pay-types"></div>
      </div>

      <div id="purchase-summary"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="btn-submit-purchase" onclick="submitPurchase()">Record purchase</button>
      </div>
    </div>`;
}

function newPurchaseItem(productId = '') {
  const product = state.products.find(p => p.id === productId);
  return {
    id: uid(),
    productId: product ? product.id : '',
    isNew: false,
    newName: '',
    sellingPrice: '',
    qty: '',
    cost: product?.costPrice != null ? String(product.costPrice) : '',
  };
}

function initPurchaseForm(productId = '') {
  purchaseFormState = {
    items: [newPurchaseItem(productId)],
    paymentType: 'cash',
    vatIncluded: true,
    updateCostPrice: true,
    errors: {},
    submitting: false,
  };
  renderPurchaseItems();
  renderPurchasePaymentTypes();
  updatePurchaseSummary();

  document.getElementById('purchase-vat-included')?.addEventListener('change', e => {
    purchaseFormState.vatIncluded = e.target.checked;
    const desc = document.getElementById('purchase-vat-description');
    if (desc) desc.textContent = purchaseFormState.vatIncluded
      ? 'Costs already include 15% VAT'
      : '15% VAT will be added to total';
    updatePurchaseSummary();
  });
  document.getElementById('purchase-update-cost')?.addEventListener('change', e => {
    purchaseFormState.updateCostPrice = e.target.checked;
  });
}

function addPurchaseItem() {
  purchaseFormState.items.push(newPurchaseItem());
  renderPurchaseItems();
  updatePurchaseSummary();
}

function removePurchaseItem(itemId) {
  if (purchaseFormState.items.length > 1) {
    purchaseFormState.items = purchaseFormState.items.filter(it => it.id !== itemId);
    delete purchaseFormState.errors[itemId];
    renderPurchaseItems();
    updatePurchaseSummary();
  }
}

function updatePurchaseItem(itemId, field, value) {
  const item = purchaseFormState.items.find(it => it.id === itemId);
  if (!item) return;

  if (field === 'productId') {
    if (value === NEW_PRODUCT) {
      item.isNew = true;
      item.productId = '';
      item.cost = '';
    } else {
      const product = state.products.find(p => p.id === value);
      item.isNew = false;
      item.newName = '';
      item.sellingPrice = '';
      item.productId = value;
      item.cost = product?.costPrice != null ? String(product.costPrice) : '';
    }
  } else {
    item[field] = value;
  }
  delete purchaseFormState.errors[itemId];
  renderPurchaseItems();
  updatePurchaseSummary();
}

function renderPurchaseItems() {
  const container = document.getElementById('purchase-items-container');
  if (!container) return;

  const usedIds = purchaseFormState.items.map(it => it.productId).filter(Boolean);
  const single  = purchaseFormState.items.length === 1;

  container.innerHTML = purchaseFormState.items.map(item => {
    const product  = state.products.find(p => p.id === item.productId);
    const qty      = Number(item.qty);
    const cost     = Number(item.cost);
    const validQty = item.qty !== '' && Number.isInteger(qty) && qty > 0;
    const lineTotal = validQty && item.cost !== '' && !isNaN(cost) && cost >= 0 ? qty * cost : null;
    const active   = item.isNew || !!item.productId;
    const err      = purchaseFormState.errors[item.id];

    const productCell = item.isNew ? `
      <div class="new-product-input">
        <input type="text" value="${esc(item.newName)}" placeholder="New product name"
          onchange="updatePurchaseItem('${item.id}','newName',this.value)">
        <button type="button" title="Pick an existing product instead"
          onclick="updatePurchaseItem('${item.id}','productId','')">↺</button>
      </div>` : `
      <select onchange="updatePurchaseItem('${item.id}','productId',this.value)">
        <option value="">— Select product —</option>
        ${state.products.map(p => {
          const taken = usedIds.includes(p.id) && p.id !== item.productId;
          return `<option value="${p.id}" ${item.productId === p.id ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(p.name)} (${p.quantity} in stock)</option>`;
        }).join('')}
        <option value="${NEW_PRODUCT}">➕ New product…</option>
      </select>`;

    let stockHint = '';
    if (product) {
      stockHint = validQty
        ? `${product.quantity} in stock → <strong style="color:var(--green);">${product.quantity + qty}</strong> after purchase`
        : `${product.quantity} in stock`;
    } else if (item.isNew) {
      stockHint = `New product — will be added to inventory${validQty ? ` with <strong style="color:var(--green);">${qty}</strong> in stock` : ''}`;
    }

    return `
      <div class="purchase-item${err ? ' has-error' : ''}">
        <div class="purchase-row">
          <div class="purchase-product">${productCell}</div>
          <input type="number" min="1" step="1" value="${esc(item.qty)}" placeholder="Qty"
            onchange="updatePurchaseItem('${item.id}','qty',this.value)" ${active ? '' : 'disabled'}>
          <div class="sar-input">
            <span>SAR</span>
            <input type="number" min="0" step="0.01" value="${esc(item.cost)}" placeholder="0.00"
              onchange="updatePurchaseItem('${item.id}','cost',this.value)" ${active ? '' : 'disabled'}>
          </div>
          <button type="button" class="row-remove-btn" onclick="removePurchaseItem('${item.id}')" ${single ? 'disabled' : ''} aria-label="Remove item">${ic('x', 15)}</button>
        </div>
        ${item.isNew ? `
          <div class="new-product-extra">
            <label>Selling price (optional)</label>
            <div class="sar-input">
              <span>SAR</span>
              <input type="number" min="0" step="0.01" value="${esc(item.sellingPrice)}" placeholder="0.00"
                onchange="updatePurchaseItem('${item.id}','sellingPrice',this.value)">
            </div>
          </div>` : ''}
        <div class="purchase-item-meta">
          <span>${stockHint}</span>
          ${lineTotal !== null ? `<span>${qty} × ${fmt(cost)} = <strong style="color:var(--orange);">${fmt(lineTotal)}</strong></span>` : ''}
        </div>
        ${err ? `<div class="err-msg" style="margin-top:4px;">${esc(err)}</div>` : ''}
      </div>`;
  }).join('');

  const el = document.getElementById('purchase-item-count');
  if (el) el.textContent = purchaseFormState.items.length;
}

function renderPurchasePaymentTypes() {
  const container = document.getElementById('purchase-payment-types');
  if (!container) return;
  container.innerHTML = PAYMENT_TYPES.map(pt => `
    <button type="button" class="pay-type-btn${purchaseFormState.paymentType === pt.id ? ' active' : ''}"
      onclick="purchaseFormState.paymentType='${pt.id}'; renderPurchasePaymentTypes();">${ic(PAY_IC[pt.id], 20)}${pt.label}</button>`).join('');
}

function purchaseFormTotals() {
  const subtotal = purchaseFormState.items.reduce((s, i) => {
    const line = Number(i.qty) * Number(i.cost);
    return s + (isNaN(line) ? 0 : line);
  }, 0);
  const vatAmount = purchaseFormState.vatIncluded ? 0 : subtotal * VAT_RATE;
  const units = purchaseFormState.items.reduce((s, i) => s + (Number(i.qty) > 0 ? Number(i.qty) : 0), 0);
  return { subtotal, vatAmount, total: subtotal + vatAmount, units };
}

function updatePurchaseSummary() {
  const container = document.getElementById('purchase-summary');
  if (!container) return;
  const { subtotal, vatAmount, total, units } = purchaseFormTotals();
  const n = purchaseFormState.items.length;

  container.innerHTML = `
    <div class="order-summary-box">
      <div class="osb-label">Purchase summary</div>
      <div class="summary-line"><span>Units added to stock</span><strong>+${units}</strong></div>
      <div class="summary-line"><span>Subtotal (${n} item${n !== 1 ? 's' : ''})</span><strong>${fmt(subtotal)}</strong></div>
      ${!purchaseFormState.vatIncluded ? `<div class="summary-line"><span>VAT (15%)</span><strong>${fmt(vatAmount)}</strong></div>` : ''}
      <div class="summary-total"><span>Total cost</span><span class="summary-total-value">${fmt(total)}</span></div>
    </div>`;
}

function setPurchaseSubmitting(on) {
  purchaseFormState.submitting = on;
  const btn = document.getElementById('btn-submit-purchase');
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? 'Saving…' : 'Record purchase';
  }
}

function submitPurchase() {
  if (purchaseFormState.submitting) return;   // prevent double stock-in on double click

  const supplierName  = document.getElementById('supplier-name').value.trim();
  const supplierPhone = document.getElementById('supplier-phone').value.trim();
  const invoiceNo     = document.getElementById('supplier-invoice').value.trim();
  const errors = {};
  const rowErrors = {};

  if (!supplierName) errors.supplierName = 'Supplier name is required';
  if (supplierPhone && !/^\+?[\d\s\-().]{7,15}$/.test(supplierPhone)) errors.supplierPhone = 'Enter a valid phone number';

  const newNames = new Set();
  purchaseFormState.items.forEach(item => {
    const errs = [];
    if (item.isNew) {
      const name = item.newName.trim();
      if (!name) errs.push('Enter the new product name');
      else if (state.products.some(p => (p.name ?? '').trim().toLowerCase() === name.toLowerCase()))
        errs.push(`"${name}" already exists — pick it from the list`);
      else if (newNames.has(name.toLowerCase())) errs.push('Same new product added twice');
      newNames.add(name.toLowerCase());
      if (item.sellingPrice !== '' && (isNaN(item.sellingPrice) || Number(item.sellingPrice) < 0)) errs.push('Invalid selling price');
    } else if (!item.productId) {
      errs.push('Select a product');
    } else if (!state.products.some(p => p.id === item.productId)) {
      errs.push('This product was deleted — choose another');
    }
    const qty = Number(item.qty);
    if (item.qty === '' || !Number.isInteger(qty) || qty <= 0) errs.push('Qty must be a whole number above 0');
    if (item.cost === '' || isNaN(item.cost) || Number(item.cost) < 0) errs.push('Enter unit cost');
    if (errs.length) rowErrors[item.id] = errs.join(' · ');
  });

  document.getElementById('err-supplier-name').textContent  = errors.supplierName  || '';
  document.getElementById('err-supplier-phone').textContent = errors.supplierPhone || '';
  purchaseFormState.errors = rowErrors;
  renderPurchaseItems();

  if (Object.keys(errors).length || Object.keys(rowErrors).length) {
    showToast('Please fix validation errors', 'error');
    return;
  }

  const items = purchaseFormState.items.map(item => {
    if (item.isNew) {
      return {
        isNew: true,
        productName: item.newName.trim(),
        quantity: Number(item.qty),
        unitCost: Number(item.cost),
        sellingPrice: item.sellingPrice !== '' ? Number(item.sellingPrice) : null,
      };
    }
    const product = state.products.find(p => p.id === item.productId);
    return { productId: item.productId, productName: product.name, quantity: Number(item.qty), unitCost: Number(item.cost) };
  });

  const { subtotal, vatAmount, total } = purchaseFormTotals();
  setPurchaseSubmitting(true);
  recordPurchase(
    { supplierName, supplierPhone, invoiceNo, paymentType: purchaseFormState.paymentType,
      vatIncluded: purchaseFormState.vatIncluded, subtotal, vatAmount, total, items },
    { updateCostPrice: purchaseFormState.updateCostPrice },
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DATE FILTER HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function getFilteredSales()     { return filterByDate(state.sales); }
function getFilteredPurchases() { return filterByDate(state.purchases); }

function filterByDate(list) {
  const today = new Date(); today.setHours(0,0,0,0);
  return list.filter(s => {
    const sd = recordDate(s);
    sd.setHours(0,0,0,0);
    switch (state.dateFilter) {
      case 'today':  return sd.getTime() === today.getTime();
      case 'month':  return sd.getMonth()===today.getMonth() && sd.getFullYear()===today.getFullYear();
      case 'year':   return sd.getFullYear()===today.getFullYear();
      case 'custom': {
        const start=new Date(state.customDateStart); start.setHours(0,0,0,0);
        const end=new Date(state.customDateEnd);     end.setHours(23,59,59,999);
        return sd>=start && sd<=end;
      }
      default: return true;
    }
  });
}

function saleTotal(s) {
  return (s.items ?? []).reduce((sum, it) => sum + (it.priceAtSale??0)*it.quantity, 0);
}

function saleProfit(s) {
  return (s.items ?? []).reduce((sum, it) => {
    const product   = state.products.find(p => p.id === it.productId);
    const cost      = product?.costPrice ?? 0;
    return sum + (it.priceAtSale - cost) * it.quantity;
  }, 0);
}

function purchaseTotal(p) {
  if (typeof p.total === 'number') return p.total;
  return (p.items ?? []).reduce((sum, it) => sum + (it.unitCost ?? 0) * it.quantity, 0);
}

function purchaseUnits(p) {
  return (p.items ?? []).reduce((sum, it) => sum + (it.quantity ?? 0), 0);
}

function calculateSaleStats(sales) {
  return {
    totalRevenue: sales.reduce((s, x) => s + saleTotal(x), 0),
    totalProfit:  sales.reduce((s, x) => s + saleProfit(x), 0),
    invoiceCount: sales.length,
  };
}

function getDateFilterLabel() {
  const today = new Date();
  switch (state.dateFilter) {
    case 'today':  return today.toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric'});
    case 'month':  return today.toLocaleDateString('en-US', {month:'long',year:'numeric'});
    case 'year':   return today.getFullYear().toString();
    case 'custom': {
      const s=new Date(state.customDateStart), e=new Date(state.customDateEnd);
      return `${s.toLocaleDateString('en-US',{month:'short',day:'numeric'})} - ${e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    }
  }
}

function setDateFilter(filter) { state.dateFilter = filter; renderDashboard(); }
function updateCustomDate() {
  state.customDateStart = document.getElementById('custom-start-date')?.value || state.customDateStart;
  state.customDateEnd   = document.getElementById('custom-end-date')?.value   || state.customDateEnd;
  renderDashboard();
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD RENDERING
// ══════════════════════════════════════════════════════════════════════════════

const RANGES = [
  { id: 'today',  t: 'Today',  label: 'Today' },
  { id: 'month',  t: 'Month',  label: 'This month' },
  { id: 'year',   t: 'Year',   label: 'This year' },
  { id: 'custom', t: 'Custom', label: 'Custom' },
];

function rangeLabel() {
  return (RANGES.find(r => r.id === state.dateFilter) || RANGES[0]).label;
}

function plural(n, word) { return `${n} ${word}${n !== 1 ? 's' : ''}`; }

function itemsSummary(items) {
  const list = items ?? [];
  if (!list.length) return 'No items';
  const first = `${list[0].productName} ×${list[0].quantity}`;
  return list.length > 1 ? `${first} +${list.length - 1} more` : first;
}

function renderDashboard() {
  const container = document.getElementById('dashboard-page');
  if (!container) return;

  const lowStock   = state.products.filter(p => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD);
  const outCount   = state.products.filter(p => p.quantity === 0).length;
  const stats      = calculateSaleStats(getFilteredSales());
  const allTimeRev = state.sales.reduce((s, x) => s + saleTotal(x), 0);
  const recent     = state.sales.slice(0, 5);
  const label      = rangeLabel();
  const revText    = fmtNum(stats.totalRevenue);
  const profitText = fmtNum(stats.totalProfit);
  const dateLong   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head-text"><span class="page-title">Dashboard</span><span class="page-date">${dateLong}</span></div>
    </div>

    <div class="seg" role="tablist">
      ${RANGES.map(r => `<button class="seg-btn${state.dateFilter === r.id ? ' active' : ''}" onclick="setDateFilter('${r.id}')">${r.t}</button>`).join('')}
    </div>

    ${state.dateFilter === 'custom' ? `
    <div class="range-custom">
      <div class="field"><label>From</label><input type="date" id="custom-start-date" value="${state.customDateStart}" onchange="updateCustomDate()"></div>
      <div class="field"><label>To</label><input type="date" id="custom-end-date" value="${state.customDateEnd}" onchange="updateCustomDate()"></div>
    </div>` : ''}

    <div class="rev-card">
      <span class="rev-deco"></span>
      <div class="rev-top"><span class="rev-ic">${ic('trend')}</span><span class="rev-label">Total revenue</span><span class="rev-pill">${label}</span></div>
      <div class="rev-amount"><span class="rev-cur">SAR</span><span class="rev-val${sizeClass(revText, 10, 13)}">${revText}</span></div>
      <span class="rev-sub">${plural(stats.invoiceCount, 'transaction')}</span>
    </div>

    <div class="tiles2">
      <div class="tile">
        <span class="ic ic-blue">${ic('doc')}</span>
        <div class="tile-body"><span class="tile-val">${stats.invoiceCount}</span><span class="tile-label">Invoices created</span><span class="tile-sub">${label}</span></div>
      </div>
      <div class="tile">
        <span class="ic ic-green">${ic('dollar')}</span>
        <div class="tile-body"><span class="tile-val${sizeClass(profitText, 8, 11)}"><span class="cur">SAR</span>${profitText}</span><span class="tile-label">Total profit</span><span class="tile-sub">${label}</span></div>
      </div>
    </div>

    <div class="list-card">
      <div class="lc-row"><span class="ic ic-orange">${ic('box')}</span><div class="lc-text"><span class="lc-title">Total products</span><span class="lc-sub">${outCount} out of stock</span></div><span class="lc-val">${state.products.length}</span></div>
      <div class="lc-div"></div>
      <div class="lc-row"><span class="ic ic-red">${ic('alert')}</span><div class="lc-text"><span class="lc-title">Low stock alert</span><span class="lc-sub">Items ≤ ${LOW_STOCK_THRESHOLD} units remaining</span></div><span class="lc-val">${lowStock.length}</span></div>
      <div class="lc-div"></div>
      <div class="lc-row"><span class="ic ic-green">${ic('bars')}</span><div class="lc-text"><span class="lc-title">All-time sales</span><span class="lc-sub">${allTimeRev > 0 ? `${fmt(allTimeRev)} total` : 'No revenue tracked'}</span></div><span class="lc-val">${state.sales.length}</span></div>
    </div>

    <div class="box">
      <div class="box-head"><span class="box-title">Low stock items</span><button class="box-link" onclick="navigateTo('inventory')">Inventory</button></div>
      ${lowStock.length === 0
        ? `<div class="soft-row"><span class="ic ic-green">${ic('check', 16, 2.4)}</span><span class="soft-row-text">All products well stocked!</span></div>`
        : `<div class="box-list">${lowStock.map(p => `
          <div class="soft-row" role="button" style="cursor:pointer" onclick="openPurchaseForm('${p.id}')" title="Restock ${esc(p.name)}">
            <span class="ic ic-red">${ic('alert')}</span>
            <div class="sr-text"><span class="sr-title">${esc(p.name)}</span><span class="sr-sub">Tap to restock</span></div>
            <span class="sr-val red">${p.quantity} left</span>
          </div>`).join('')}</div>`}
    </div>

    <div class="box">
      <div class="box-head">
        <div class="box-head-text"><span class="box-title">Recent activity</span><span class="box-sub">Latest ${plural(recent.length, 'transaction')}</span></div>
        <button class="box-link" onclick="navigateTo('sales')">Sales</button>
      </div>
      ${recent.length === 0
        ? `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('bolt', 20)}</span><span class="empty-title">No sales yet</span><span class="empty-text">Your recent transactions will appear here</span></div>`
        : `<div class="box-list">${recent.map(recentSaleRow).join('')}</div>`}
    </div>`;
}

function recentSaleRow(s) {
  const pt = payOf(s);
  return `
    <div class="soft-row" role="button" style="cursor:pointer" onclick="openSale('${s.id}')">
      <span class="ic ic-${PAY_TONE[pt]}">${ic(PAY_IC[pt])}</span>
      <div class="sr-text"><span class="sr-title">${esc(s.customerName || 'Walk-in customer')}</span><span class="sr-sub">${esc(itemsSummary(s.items))} · ${fmtDate(recordDate(s))}</span></div>
      <div class="sr-end"><span class="sr-val green">${fmt(saleTotal(s))}</span><span class="tag ${pt}">${PAY_NAME[pt]}</span></div>
    </div>`;
}

function openSale(id) {
  state.expandedSales[id] = true;
  navigateTo('sales');
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY RENDERING (search-safe — only the list re-renders while typing)
// ══════════════════════════════════════════════════════════════════════════════

function renderInventory() {
  const container = document.getElementById('inventory-page');
  if (!container) return;
  const low = state.products.filter(p => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD).length;
  const out = state.products.filter(p => p.quantity === 0).length;
  const sub = `${plural(state.products.length, 'product')} · ${low} low · ${out} out of stock`;

  if (!document.getElementById('inventory-list')) {
    container.innerHTML = `
      <div class="page-head"><div class="page-head-text"><span class="page-title">Inventory</span><span class="page-date" id="inventory-sub"></span></div></div>
      <div class="head-actions two">
        <button class="btn btn-primary" onclick="showModal(productFormHTML()); return false;">${ic('plus', 16, 2.4)}Add product</button>
        <button class="btn btn-soft" onclick="openPurchaseForm(); return false;">${ic('cart')}Purchase stock</button>
      </div>
      <div class="search">${ic('search', 17)}<input type="search" id="inventory-search" placeholder="Search products…" autocomplete="off"></div>
      <div class="seg" id="inventory-filter"></div>
      <div class="box">
        <div class="box-head"><div class="box-head-text"><span class="box-title">Products</span><span class="box-sub" id="inventory-count"></span></div></div>
        <div id="inventory-list" class="box-list"></div>
      </div>`;
    const input = document.getElementById('inventory-search');
    input.value = state.inventorySearch;
    input.addEventListener('input', () => { state.inventorySearch = input.value; renderInventoryTable(); });
  }
  document.getElementById('inventory-sub').textContent = sub;
  renderInventoryTable();
}

function setInventoryFilter(f) { state.inventoryFilter = f; renderInventoryTable(); }

function renderInventoryTable() {
  const list = document.getElementById('inventory-list');
  if (!list) return;
  const filter = state.inventoryFilter || 'all';
  const filterBar = document.getElementById('inventory-filter');
  if (filterBar) filterBar.innerHTML = [['all', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']]
    .map(([id, t]) => `<button class="seg-btn${filter === id ? ' active' : ''}" onclick="setInventoryFilter('${id}')">${t}</button>`).join('');

  const term = state.inventorySearch.toLowerCase();
  const filtered = state.products.filter(p => {
    if (!(p.name ?? '').toLowerCase().includes(term)) return false;
    if (filter === 'low') return p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD;
    if (filter === 'out') return p.quantity === 0;
    return true;
  });
  const count = document.getElementById('inventory-count');
  if (count) count.textContent = filtered.length === state.products.length ? 'Sorted A–Z' : `${filtered.length} of ${state.products.length} shown`;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('box', 20)}</span>
      <span class="empty-title">${state.products.length === 0 ? 'No products yet' : 'Nothing found'}</span>
      <span class="empty-text">${state.products.length === 0 ? 'Add your first product or record a purchase' : 'Try a different search or filter'}</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    const status     = p.quantity === 0 ? 'out' : p.quantity <= LOW_STOCK_THRESHOLD ? 'low' : 'ok';
    const statusText = p.quantity === 0 ? 'Out of stock' : p.quantity <= LOW_STOCK_THRESHOLD ? 'Low stock' : 'In stock';
    return `
      <div class="prod" data-product="${p.id}">
        <div class="prod-top">
          <span class="ic ${status === 'ok' ? 'ic-orange' : status === 'low' ? 'ic-orange' : 'ic-red'}">${ic('box')}</span>
          <div class="sr-text"><span class="sr-title">${esc(p.name)}</span><span class="sr-sub">Buy ${p.costPrice != null ? fmt(p.costPrice) : '—'} · Sell ${p.price != null ? fmt(p.price) : '—'}</span></div>
          <div class="prod-qty"><b>${p.quantity}</b><span class="tag ${status}">${statusText}</span></div>
        </div>
        <div class="prod-actions">
          <button class="btn btn-stock btn-sm" onclick="openPurchaseForm('${p.id}'); return false;" title="Record a purchase for this product">${ic('plus', 14, 2.4)}Stock</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteProduct('${p.id}'); return false;">${ic('trash', 14)}Delete</button>
        </div>
      </div>`;
  }).join('');
}

function confirmDeleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  showModal(`
    <div class="modal-title"><span class="ic ic-red">${ic('trash')}</span>Delete product</div>
    <p class="modal-note">Are you sure you want to delete this product?</p>
    <div class="danger-box">${esc(p.name)}</div>
    <p class="modal-note">This action cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteProduct('${p.id}')">Yes, delete</button>
    </div>`);
}

// ══════════════════════════════════════════════════════════════════════════════
// SALES RENDERING
// ══════════════════════════════════════════════════════════════════════════════

function renderSales() {
  const container = document.getElementById('sales-page');
  if (!container) return;
  const totalRev = state.sales.reduce((s, x) => s + saleTotal(x), 0);
  const sub = `${plural(state.sales.length, 'transaction')} · ${fmt(totalRev)} revenue`;

  if (!document.getElementById('sales-list-container')) {
    container.innerHTML = `
      <div class="page-head"><div class="page-head-text"><span class="page-title">Sales</span><span class="page-date" id="sales-sub"></span></div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="showModal(saleFormHTML()); initSaleForm(); return false;">${ic('bolt')}New sale</button></div>
      <div class="search">${ic('search', 17)}<input type="search" id="sales-search" placeholder="Search by customer, date or product…" autocomplete="off" oninput="renderSalesList()"></div>
      <div class="box">
        <div class="box-head"><div class="box-head-text"><span class="box-title">Transaction log</span><span class="box-sub">Newest first · tap a sale for details</span></div></div>
        <div id="sales-list-container" class="box-list"></div>
      </div>`;
  }
  document.getElementById('sales-sub').textContent = sub;
  renderSalesList();
}

function renderSalesList() {
  const container = document.getElementById('sales-list-container');
  if (!container) return;

  const term = (document.getElementById('sales-search')?.value || '').toLowerCase();
  const filtered = state.sales.filter(s => {
    const items = s.items ?? [];
    return (s.customerName ?? '').toLowerCase().includes(term) ||
           (s.customerPhone ?? '').includes(term) ||
           fmtDate(recordDate(s)).toLowerCase().includes(term) ||
           items.some(it => (it.productName ?? '').toLowerCase().includes(term));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('bolt', 20)}</span>
      <span class="empty-title">${state.sales.length === 0 ? 'No sales yet' : 'No results found'}</span>
      <span class="empty-text">${state.sales.length === 0 ? 'Record your first sale to get started' : 'Try adjusting your search'}</span></div>`;
    return;
  }
  container.innerHTML = filtered.map(renderSaleCard).join('');
}

function renderSaleCard(s) {
  const items  = s.items ?? [];
  const total  = saleTotal(s);
  const isOpen = state.expandedSales[s.id];
  const pt     = payOf(s);
  const idx    = state.sales.findIndex(x => x.id === s.id);
  const txnNum = String(state.sales.length - idx).padStart(4, '0');
  const ts     = toDate(s.timestamp);

  return `
    <div class="txn${isOpen ? ' open' : ''}">
      <button class="txn-main" onclick="toggleSaleExpand('${s.id}')" aria-expanded="${isOpen ? 'true' : 'false'}">
        <span class="ic ic-${PAY_TONE[pt]}">${ic(PAY_IC[pt])}</span>
        <div class="sr-text"><span class="sr-title">${esc(s.customerName || 'Walk-in customer')}</span><span class="sr-sub">${fmtDate(recordDate(s))} · ${esc(itemsSummary(items))}</span></div>
        <div class="sr-end"><span class="sr-val green">${fmt(total)}</span><span class="tag ${pt}">${PAY_NAME[pt]}</span></div>
        <span class="txn-chev">${ic('chevron')}</span>
      </button>
      ${isOpen ? `
        <div class="txn-detail">
          <div class="txn-meta"><span>#${txnNum}</span><span>Sale date ${fmtDate(recordDate(s))}</span><span>Recorded ${ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          ${items.map(it => `
            <div class="line-item">
              <div class="li-text"><b>${esc(it.productName)}</b><small>${it.quantity} unit${it.quantity !== 1 ? 's' : ''} × ${it.priceAtSale != null ? fmt(it.priceAtSale) : '—'}</small></div>
              <span class="amt">${it.priceAtSale != null ? fmt(it.priceAtSale * it.quantity) : '—'}</span>
            </div>`).join('')}
          <div class="txn-total"><span class="lbl">Grand total<small>${plural(items.length, 'item')} · paid by ${PAY_NAME[pt].toLowerCase()}</small></span><span class="val">${fmt(total)}</span></div>
        </div>` : ''}
    </div>`;
}

function toggleSaleExpand(id) {
  state.expandedSales[id] = !state.expandedSales[id];
  renderSalesList();
}

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASES RENDERING
// ══════════════════════════════════════════════════════════════════════════════

function renderPurchases() {
  const container = document.getElementById('purchases-page');
  if (!container) return;
  const totalSpent = state.purchases.reduce((s, x) => s + purchaseTotal(x), 0);
  const sub = `${plural(state.purchases.length, 'purchase')} · ${fmt(totalSpent)} total spent`;

  if (!document.getElementById('purchases-list-container')) {
    container.innerHTML = `
      <div class="page-head"><div class="page-head-text"><span class="page-title">Purchases</span><span class="page-date" id="purchases-sub"></span></div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="openPurchaseForm(); return false;">${ic('cart')}New purchase</button></div>
      <div class="search">${ic('search', 17)}<input type="search" id="purchases-search" placeholder="Search by supplier, invoice or product…" autocomplete="off" oninput="renderPurchasesList()"></div>
      <div class="box">
        <div class="box-head"><div class="box-head-text"><span class="box-title">Purchase log</span><span class="box-sub">Every purchase adds its items to stock</span></div></div>
        <div id="purchases-list-container" class="box-list"></div>
      </div>`;
  }
  document.getElementById('purchases-sub').textContent = sub;
  renderPurchasesList();
}

function renderPurchasesList() {
  const container = document.getElementById('purchases-list-container');
  if (!container) return;

  const term = (document.getElementById('purchases-search')?.value || '').toLowerCase();
  const filtered = state.purchases.filter(p =>
    (p.supplierName ?? '').toLowerCase().includes(term) ||
    (p.supplierPhone ?? '').includes(term) ||
    (p.invoiceNo ?? '').toLowerCase().includes(term) ||
    (p.items ?? []).some(it => (it.productName ?? '').toLowerCase().includes(term)));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('cart', 20)}</span>
      <span class="empty-title">${state.purchases.length === 0 ? 'No purchases yet' : 'No results found'}</span>
      <span class="empty-text">${state.purchases.length === 0 ? 'Record a purchase and its items are added to stock automatically' : 'Try adjusting your search'}</span></div>`;
    return;
  }
  container.innerHTML = filtered.map(renderPurchaseCard).join('');
}

function renderPurchaseCard(p) {
  const items  = p.items ?? [];
  const total  = purchaseTotal(p);
  const units  = purchaseUnits(p);
  const isOpen = state.expandedPurchases[p.id];
  const pt     = payOf(p);
  const idx    = state.purchases.findIndex(x => x.id === p.id);
  const num    = String(state.purchases.length - idx).padStart(4, '0');
  const ts     = toDate(p.timestamp);
  const subtotal  = typeof p.subtotal  === 'number' ? p.subtotal  : items.reduce((s, it) => s + (it.unitCost ?? 0) * it.quantity, 0);
  const vatAmount = typeof p.vatAmount === 'number' ? p.vatAmount : 0;

  return `
    <div class="txn${isOpen ? ' open' : ''}">
      <button class="txn-main" onclick="togglePurchaseExpand('${p.id}')" aria-expanded="${isOpen ? 'true' : 'false'}">
        <span class="ic ic-purple">${ic('factory')}</span>
        <div class="sr-text"><span class="sr-title">${esc(p.supplierName || 'Unknown supplier')}</span><span class="sr-sub">${fmtDate(ts)} · +${units} units${p.invoiceNo ? ` · ${esc(p.invoiceNo)}` : ''}</span></div>
        <div class="sr-end"><span class="sr-val purple">${fmt(total)}</span><span class="tag ${pt}">${PAY_NAME[pt]}</span></div>
        <span class="txn-chev">${ic('chevron')}</span>
      </button>
      ${isOpen ? `
        <div class="txn-detail">
          <div class="txn-meta"><span>PO-${num}</span><span>${ts.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>${p.supplierPhone ? `<span>${esc(p.supplierPhone)}</span>` : ''}<span>by ${esc(p.recordedBy || 'unknown')}</span></div>
          ${items.map(it => `
            <div class="line-item">
              <span class="ic ic-green" style="width:30px;height:30px;">${ic('inbox', 14)}</span>
              <div class="li-text"><b>${esc(it.productName)} ${it.isNewProduct ? '<span class="tag new">NEW</span>' : ''}</b><small><span style="color:var(--green);font-weight:600;">+${it.quantity}</span> unit${it.quantity !== 1 ? 's' : ''} × ${fmt(it.unitCost ?? 0)}</small></div>
              <span class="amt">${fmt((it.unitCost ?? 0) * it.quantity)}</span>
            </div>`).join('')}
          ${vatAmount > 0 ? `<div class="txn-lines"><div class="summary-line"><span>Subtotal</span><strong>${fmt(subtotal)}</strong></div><div class="summary-line"><span>VAT (15%)</span><strong>${fmt(vatAmount)}</strong></div></div>` : ''}
          <div class="txn-total purple"><span class="lbl">Total cost<small>${units} unit${units !== 1 ? 's' : ''} added · paid by ${PAY_NAME[pt].toLowerCase()}</small></span><span class="val">${fmt(total)}</span></div>
        </div>` : ''}
    </div>`;
}

function togglePurchaseExpand(id) {
  state.expandedPurchases[id] = !state.expandedPurchases[id];
  renderPurchasesList();
}
