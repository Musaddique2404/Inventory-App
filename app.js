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

// ══════════════════════════════════════════════════════════════════════════════
// AUTH LAYER
// ══════════════════════════════════════════════════════════════════════════════

// Switch between Sign In / Create Account tabs
function switchAuthTab(tab) {
  document.getElementById('auth-login-form').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('auth-register-form').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  // Clear errors on tab switch
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

  // Sidebar user info
  const name  = user.displayName || user.email;
  const email = user.email;
  const initials = name.charAt(0).toUpperCase();

  document.getElementById('sidebar-avatar').textContent     = initials;
  document.getElementById('sidebar-user-name').textContent  = name;
  document.getElementById('sidebar-user-email').textContent = email;

  // Setup nav buttons (once)
  document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(btn => {
    // Clone to remove old listeners
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
  toast.className = `toast toast-${type}`;
  toast.textContent = `${type === 'success' ? '✓' : '✕'} ${message}`;
  area.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
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
  const el = document.getElementById('sidebar-product-count');
  if (el) el.textContent = `${state.products.length} Product${state.products.length !== 1 ? 's' : ''}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function navigateTo(page) {
  state.currentPage = page;

  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page));
  document.querySelectorAll('.bottom-nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page));

  const indicator = document.getElementById('mobile-page-indicator');
  if (indicator) {
    indicator.textContent = { dashboard: 'Dashboard', inventory: 'Inventory', sales: 'Sales', purchases: 'Purchases' }[page] || '';
  }

  document.querySelectorAll('.page').forEach(p => (p.style.display = 'none'));
  document.getElementById(`${page}-page`).style.display = 'block';

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
    <div class="modal-title">${isEdit ? '✎ Edit Product' : '➕ Add New Product'}</div>
    <form id="product-form" onsubmit="return handleProductSubmit(event, ${isEdit ? `'${product.id}'` : 'null'})">
      <div class="form-grid">
        <div class="field">
          <label>Product Name <span class="req">*</span></label>
          <input type="text" name="name" value="${product?.name || ''}" placeholder="e.g. Apple AirPods" required>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Quantity <span class="req">*</span></label>
            <input type="number" name="quantity" value="${product?.quantity ?? ''}" min="0" placeholder="0" required>
          </div>
          <div class="field">
            <label>Buying Price (optional)</label>
            <input type="number" name="costPrice" value="${product?.costPrice ?? ''}" min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
        <div class="field">
          <label>Selling Price (optional)</label>
          <input type="number" name="price" value="${product?.price ?? ''}" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-amber">${isEdit ? '✓ Save Changes' : '+ Add Product'}</button>
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
    <div class="modal-title">⚡ Record New Sale</div>
    <div id="sale-form-content" style="max-height:75vh;overflow-y:auto;padding-right:4px;">
      <div style="margin-bottom:20px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span>👤</span> Customer Information
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field">
            <label>Full Name <span class="req">*</span></label>
            <input type="text" id="customer-name" placeholder="Ahmed Al-Rashid">
            <span class="err-msg" id="err-customer-name"></span>
          </div>
          <div class="field">
            <label>Date <span class="req">*</span></label>
            <input type="date" id="sale-date" value="${todayISO()}" max="${todayISO()}">
            <span class="err-msg" id="err-sale-date"></span>
          </div>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);margin:20px 0;"></div>
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);display:flex;align-items:center;gap:8px;">
            <span>📦</span> Products (<span id="item-count">1</span>)
          </div>
          <button type="button" onclick="addSaleItem()" style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:6px;border:1px dashed var(--amber-dim);background:var(--amber-glow);color:var(--amber);font-family:var(--mono);font-size:11px;font-weight:600;cursor:pointer;letter-spacing:1px;">
            + ADD ITEM
          </button>
        </div>
        <div style="display:grid;grid-template-columns:2fr 80px 100px 32px;gap:8px;margin-bottom:6px;padding:0 4px;">
          <span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);">Product</span>
          <span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);">Qty</span>
          <span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);">Price/Unit</span>
          <span></span>
        </div>
        <div id="sale-items-container"></div>
      </div>
      <div style="border-top:1px solid var(--border);margin:20px 0;"></div>
      <div style="margin-bottom:20px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span>💰</span> Payment &amp; Tax
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;cursor:pointer;">
            <input type="checkbox" id="vat-included" checked style="width:18px;height:18px;cursor:pointer;accent-color:var(--amber);">
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:2px;">VAT Included in Price</div>
              <div id="vat-description" style="font-family:var(--mono);font-size:11px;color:var(--text3);">Prices already include 15% VAT</div>
            </div>
          </label>
        </div>
        <div id="payment-types" style="display:flex;gap:10px;"></div>
      </div>
      <div id="order-summary"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-amber" onclick="submitSale()" style="padding:10px 24px;font-size:14px;">⚡ Record Sale</button>
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

  container.innerHTML = saleFormState.items.map(item => {
    const product   = state.products.find(p => p.id === item.productId);
    const lineTotal = item.qty && item.price && !isNaN(item.qty) && !isNaN(item.price)
      ? Number(item.qty) * Number(item.price) : null;

    const productOptions = state.products.map(p => {
      const disabled = p.quantity === 0 || (usedIds.includes(p.id) && p.id !== item.productId);
      return `<option value="${p.id}" ${item.productId === p.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${p.name}${p.quantity === 0 ? ' (out)' : ''}</option>`;
    }).join('');

    return `
      <div style="margin-bottom:8px;">
        <div style="display:grid;grid-template-columns:2fr 80px 100px 32px;gap:8px;align-items:start;">
          <select onchange="updateSaleItem('${item.id}','productId',this.value)" style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:9px 12px;color:var(--text);font-family:var(--sans);font-size:13px;cursor:pointer;">
            <option value="">— Select —</option>${productOptions}
          </select>
          <input type="number" min="1" max="${product?.quantity ?? ''}" value="${item.qty}"
            onchange="updateSaleItem('${item.id}','qty',this.value)" placeholder="0"
            ${!item.productId ? 'disabled' : ''}
            style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:9px 12px;color:var(--text);font-family:var(--sans);font-size:13px;">
          <div style="position:relative;">
            <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-family:var(--mono);font-size:10px;color:var(--text3);pointer-events:none;">SAR</span>
            <input type="number" min="0" step="0.01" value="${item.price}"
              onchange="updateSaleItem('${item.id}','price',this.value)" placeholder="0.00"
              ${!item.productId ? 'disabled' : ''}
              style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:9px 12px 9px 38px;color:var(--text);font-family:var(--sans);font-size:13px;width:100%;">
          </div>
          <button type="button" onclick="removeSaleItem('${item.id}')" ${saleFormState.items.length === 1 ? 'disabled' : ''}
            style="width:32px;height:38px;border-radius:7px;border:1px solid var(--border);
            background:${saleFormState.items.length === 1 ? 'transparent' : 'var(--red-dim)'};
            color:${saleFormState.items.length === 1 ? 'var(--text3)' : 'var(--red)'};
            cursor:${saleFormState.items.length === 1 ? 'not-allowed' : 'pointer'};
            font-size:14px;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        ${lineTotal !== null ? `
          <div style="display:flex;justify-content:flex-end;margin-top:4px;padding-right:40px;">
            <span style="font-family:var(--mono);font-size:11px;color:var(--text3);">
              ${item.qty} × ${fmt(Number(item.price))} = <strong style="color:var(--amber);">${fmt(lineTotal)}</strong>
            </span>
          </div>` : ''}
        ${product ? `<div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-top:2px;padding-left:2px;">${product.quantity} in stock</div>` : ''}
      </div>`;
  }).join('');

  const el = document.getElementById('item-count');
  if (el) el.textContent = saleFormState.items.length;
}

function renderPaymentTypes() {
  const container = document.getElementById('payment-types');
  if (!container) return;
  container.innerHTML = PAYMENT_TYPES.map(pt => `
    <button type="button" onclick="saleFormState.paymentType='${pt.id}'; renderPaymentTypes();" style="
      flex:1;padding:11px 8px;border-radius:10px;cursor:pointer;
      font-family:var(--sans);font-size:13px;font-weight:600;
      transition:all 0.15s;display:flex;flex-direction:column;align-items:center;gap:5px;border:2px solid;
      border-color:${saleFormState.paymentType===pt.id ? 'var(--amber)' : 'var(--border)'};
      background:${saleFormState.paymentType===pt.id ? 'var(--amber-glow)' : 'var(--bg3)'};
      color:${saleFormState.paymentType===pt.id ? 'var(--amber)' : 'var(--text2)'};
    "><span style="font-size:20px;">${pt.icon}</span>${pt.label}</button>`).join('');
}

function updateSaleFormSummary() {
  const container = document.getElementById('order-summary');
  if (!container) return;

  const subtotal   = saleFormState.items.reduce((s, i) => s + (isNaN(Number(i.qty)*Number(i.price)) ? 0 : Number(i.qty)*Number(i.price)), 0);
  const vatAmount  = saleFormState.vatIncluded ? 0 : subtotal * 0.15;
  const grandTotal = subtotal + vatAmount;

  container.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(217,119,6,0.10),rgba(217,119,6,0.04));border:1px solid var(--amber-dim);border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:12px;">Order Summary</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;color:var(--text2);">Subtotal (${saleFormState.items.length} item${saleFormState.items.length!==1?'s':''})</span>
        <span style="font-family:var(--mono);font-size:14px;font-weight:600;color:var(--text);">${fmt(subtotal)}</span>
      </div>
      ${!saleFormState.vatIncluded ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;color:var(--text2);">VAT (15%)</span>
        <span style="font-family:var(--mono);font-size:14px;font-weight:600;color:var(--text);">${fmt(vatAmount)}</span>
      </div>` : ''}
      <div style="border-top:1px solid var(--amber-dim);padding-top:12px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);">Grand Total</span>
        <span style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--amber);">${fmt(grandTotal)}</span>
      </div>
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
const PAY_COLOR = { cash: '#16a34a', card: '#3b82f6', credit: '#a855f7' };
const PAY_BG    = { cash: 'rgba(22,163,74,0.08)', card: 'rgba(59,130,246,0.08)', credit: 'rgba(168,85,247,0.08)' };
const PAY_ICON  = { cash: '💵', card: '💳', credit: '🏦' };

let purchaseFormState = { items: [], paymentType: 'cash', vatIncluded: true, updateCostPrice: true, errors: {}, submitting: false };

function openPurchaseForm(productId = '') {
  showModal(purchaseFormHTML());
  initPurchaseForm(productId);
}

function purchaseFormHTML() {
  const suppliers = [...new Set(state.purchases.map(p => p.supplierName).filter(Boolean))];
  return `
    <div class="modal-title">🛒 Record New Purchase</div>
    <div class="purchase-form" style="max-height:75vh;overflow-y:auto;padding-right:4px;">
      <div class="purchase-note">📥 Every item in this purchase is <strong>added to stock</strong> as soon as you save it.</div>

      <div class="form-section">
        <div class="section-label"><span>🏭</span> Supplier Information</div>
        <div class="supplier-grid">
          <div class="field supplier-name-field">
            <label>Supplier Name <span class="req">*</span></label>
            <input type="text" id="supplier-name" list="supplier-list" placeholder="e.g. Al-Jazeera Trading" autocomplete="off">
            <datalist id="supplier-list">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
            <span class="err-msg" id="err-supplier-name"></span>
          </div>
          <div class="field">
            <label>Phone (optional)</label>
            <input type="text" id="supplier-phone" placeholder="+966 5XX XXX XXXX">
            <span class="err-msg" id="err-supplier-phone"></span>
          </div>
          <div class="field">
            <label>Invoice / Ref No. (optional)</label>
            <input type="text" id="supplier-invoice" placeholder="INV-1001">
          </div>
        </div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div class="section-label" style="margin:0;"><span>📦</span> Items (<span id="purchase-item-count">1</span>)</div>
          <button type="button" class="add-item-btn" onclick="addPurchaseItem()">+ ADD ITEM</button>
        </div>
        <div class="purchase-row purchase-row-head">
          <span>Product</span><span>Qty</span><span>Cost/Unit</span><span></span>
        </div>
        <div id="purchase-items-container"></div>
      </div>

      <div class="form-divider"></div>

      <div class="form-section">
        <div class="section-label"><span>💰</span> Payment &amp; Options</div>
        <label class="option-check">
          <input type="checkbox" id="purchase-vat-included" checked>
          <div style="flex:1;">
            <div class="option-check-title">VAT Included in Cost</div>
            <div class="option-check-desc" id="purchase-vat-description">Costs already include 15% VAT</div>
          </div>
        </label>
        <label class="option-check">
          <input type="checkbox" id="purchase-update-cost" checked>
          <div style="flex:1;">
            <div class="option-check-title">Update Buying Price in Inventory</div>
            <div class="option-check-desc">Set each product's buying price to this purchase's unit cost</div>
          </div>
        </label>
        <div id="purchase-payment-types" style="display:flex;gap:10px;margin-top:4px;"></div>
      </div>

      <div id="purchase-summary"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-amber" id="btn-submit-purchase" onclick="submitPurchase()" style="padding:10px 24px;font-size:14px;">🛒 Record Purchase</button>
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
          <button type="button" class="row-remove-btn" onclick="removePurchaseItem('${item.id}')" ${single ? 'disabled' : ''}>✕</button>
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
          ${lineTotal !== null ? `<span>${qty} × ${fmt(cost)} = <strong style="color:var(--amber);">${fmt(lineTotal)}</strong></span>` : ''}
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
  container.innerHTML = PAYMENT_TYPES.map(pt => {
    const on = purchaseFormState.paymentType === pt.id;
    return `
      <button type="button" class="pay-type-btn${on ? ' active' : ''}"
        onclick="purchaseFormState.paymentType='${pt.id}'; renderPurchasePaymentTypes();">
        <span style="font-size:20px;">${pt.icon}</span>${pt.label}
      </button>`;
  }).join('');
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
      <div class="section-label" style="margin-bottom:12px;">Purchase Summary</div>
      <div class="summary-line"><span>Units added to stock</span><strong style="color:var(--green);">+${units}</strong></div>
      <div class="summary-line"><span>Subtotal (${n} item${n !== 1 ? 's' : ''})</span><strong>${fmt(subtotal)}</strong></div>
      ${!purchaseFormState.vatIncluded ? `<div class="summary-line"><span>VAT (15%)</span><strong>${fmt(vatAmount)}</strong></div>` : ''}
      <div class="summary-total">
        <span>Total Cost</span>
        <span class="summary-total-value">${fmt(total)}</span>
      </div>
    </div>`;
}

function setPurchaseSubmitting(on) {
  purchaseFormState.submitting = on;
  const btn = document.getElementById('btn-submit-purchase');
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? 'Saving…' : '🛒 Record Purchase';
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

function renderDashboard() {
  const container  = document.getElementById('dashboard-page');
  const lowStock   = state.products.filter(p => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD);
  const filteredSales = getFilteredSales();
  const stats      = calculateSaleStats(filteredSales);
  const filteredPurchases = getFilteredPurchases();
  const purchaseSpend = filteredPurchases.reduce((s, x) => s + purchaseTotal(x), 0);
  const purchaseUnitsIn = filteredPurchases.reduce((s, x) => s + purchaseUnits(x), 0);
  const allTimeRev = state.sales.reduce((s, x) => s + saleTotal(x), 0);
  const recent     = state.sales.slice(0, 5); // already sorted newest first by listener

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Dashboard</div>
      <div class="page-sub">SYSTEM_OVERVIEW // ${new Date().toLocaleDateString()}</div>
    </div>

    <div class="card" style="margin-bottom:24px;padding:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">📊 Sales Analytics</div>
          <div style="font-size:15px;font-weight:600;color:var(--text);">${getDateFilterLabel()}</div>
        </div>
        <div class="date-filter-buttons" style="display:flex;background:var(--bg3);border-radius:8px;padding:4px;gap:2px;">
          ${['today','month','year','custom'].map(f=>`
            <button onclick="setDateFilter('${f}')" style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-family:var(--sans);font-size:13px;font-weight:500;transition:all 0.15s;background:${state.dateFilter===f?'var(--amber)':'transparent'};color:${state.dateFilter===f?'#000':'var(--text2)'};">${f.charAt(0).toUpperCase()+f.slice(1)}</button>`).join('')}
        </div>
      </div>

      ${state.dateFilter==='custom' ? `
        <div class="custom-date-wrapper" style="margin-bottom:20px;padding:16px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div class="field" style="margin:0;"><label style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;">Start Date</label>
              <input type="date" id="custom-start-date" value="${state.customDateStart}" onchange="updateCustomDate()" style="padding:8px 10px;font-size:13px;"></div>
            <div class="field" style="margin:0;"><label style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;">End Date</label>
              <input type="date" id="custom-end-date" value="${state.customDateEnd}" onchange="updateCustomDate()" style="padding:8px 10px;font-size:13px;"></div>
          </div>
          <button onclick="updateCustomDate()" class="btn btn-amber" style="width:100%;padding:10px 16px;font-size:13px;justify-content:center;">Apply Filter</button>
        </div>` : ''}

      <div class="sales-analytics-grid">
        ${analyticsCard('💰 Total Revenue', fmt(stats.totalRevenue), `${stats.invoiceCount} transaction${stats.invoiceCount!==1?'s':''}`, 'var(--green)', 'rgba(22,163,74,0.08)', 'rgba(22,163,74,0.15)')}
        ${analyticsCard('🧾 Invoices Created', stats.invoiceCount, state.dateFilter==='today'?'Today':state.dateFilter==='month'?'This month':state.dateFilter==='year'?'This year':'Selected period', '#3b82f6', 'rgba(59,130,246,0.08)', 'rgba(59,130,246,0.15)')}
        ${analyticsCard('📈 Total Profit', fmt(stats.totalProfit), stats.totalRevenue>0?`${((stats.totalProfit/stats.totalRevenue)*100).toFixed(1)}% margin`:'No sales', 'var(--amber)', 'rgba(217,119,6,0.08)', 'rgba(217,119,6,0.15)')}
        ${analyticsCard('🛒 Total Purchases', fmt(purchaseSpend), filteredPurchases.length ? `${filteredPurchases.length} purchase${filteredPurchases.length!==1?'s':''} · +${purchaseUnitsIn} units to stock` : 'No purchases', '#7c3aed', 'rgba(124,58,237,0.08)', 'rgba(124,58,237,0.15)')}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card amber">
        <div class="stat-label">Total Products</div>
        <div class="stat-value">${state.products.length}</div>
        <div class="stat-desc">${state.products.filter(p=>p.quantity===0).length} out of stock</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Low Stock Alert</div>
        <div class="stat-value">${lowStock.length}</div>
        <div class="stat-desc">Items ≤ ${LOW_STOCK_THRESHOLD} units remaining</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">All-Time Sales</div>
        <div class="stat-value">${state.sales.length}</div>
        <div class="stat-desc">${allTimeRev>0?`${fmt(allTimeRev)} total`:'No revenue tracked'}</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-title">⚠ Low Stock Items</div>
        ${lowStock.length===0 ? `<div class="empty"><div class="empty-icon">✓</div><div class="empty-text">All products well stocked!</div></div>`
          : `<div class="low-list">${lowStock.map(p=>`<div class="low-item"><span class="low-item-name">${p.name}</span><span class="low-item-qty">${p.quantity} left</span></div>`).join('')}</div>`}
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div style="padding:18px 24px;background:linear-gradient(135deg,rgba(217,119,6,0.05) 0%,transparent 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--amber-glow);border:1px solid var(--amber-dim);display:flex;align-items:center;justify-content:center;font-size:16px;">↯</div>
            <div>
              <div style="font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);">Recent Activity</div>
              <div style="font-size:13px;color:var(--text2);margin-top:2px;">Latest ${recent.length} transaction${recent.length!==1?'s':''}</div>
            </div>
          </div>
          ${recent.length>0 ? `<div style="font-family:var(--mono);font-size:10px;color:var(--amber);background:var(--amber-glow);border:1px solid var(--amber-dim);border-radius:6px;padding:4px 10px;font-weight:600;letter-spacing:1px;">LIVE</div>` : ''}
        </div>
        ${recent.length===0
          ? `<div class="empty" style="padding:64px 24px;"><div style="font-size:48px;margin-bottom:12px;opacity:0.4;">📊</div><div style="font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px;">No sales yet</div><div style="font-size:13px;color:var(--text3);">Your recent transactions will appear here</div></div>`
          : `<div style="padding:8px 0;">${recent.map(s=>renderRecentSaleCard(s)).join('')}</div>`}
      </div>
    </div>`;
}

function analyticsCard(label, value, sub, color, bg, border) {
  return `
    <div style="padding:20px;background:linear-gradient(135deg,${bg} 0%,rgba(0,0,0,0.01) 100%);border:1px solid ${border};border-radius:10px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${color};"></div>
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px;">${label}</div>
      <div style="font-family:var(--mono);font-size:28px;font-weight:700;color:${color};line-height:1;margin-bottom:8px;">${value}</div>
      <div style="font-size:12px;color:var(--text3);">${sub}</div>
    </div>`;
}

function renderRecentSaleCard(s) {
  const items    = s.items ?? [];
  const tot      = saleTotal(s);
  const pt       = s.paymentType ?? 'cash';
  const payColor = {cash:'#16a34a',card:'#3b82f6',credit:'#a855f7'};
  const payBg    = {cash:'rgba(22,163,74,0.10)',card:'rgba(59,130,246,0.10)',credit:'rgba(168,85,247,0.10)'};
  const payIcon  = {cash:'💵',card:'💳',credit:'🏦'};


  return `
    <div style="margin:8px 16px;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;transition:all 0.2s ease;"
         onmouseenter="this.style.background='var(--bg3)';this.style.borderColor='var(--amber-dim)';this.style.transform='translateX(4px)';"
         onmouseleave="this.style.background='var(--bg2)';this.style.borderColor='var(--border)';this.style.transform='translateX(0)';">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;gap:12px;">
        <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;">
          <div style="width:40px;height:40px;border-radius:10px;background:${payBg[pt]};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${payIcon[pt]}</div>
          <div><div style="font-weight:700;font-size:15px;color:var(--text);margin-bottom:2px;">${s.customerName||'Unknown'}</div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--text3);">📅 ${fmtDate(recordDate(s))}</div></div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--green);margin-bottom:2px;">${fmt(tot)}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3);background:var(--bg3);border-radius:4px;padding:2px 6px;display:inline-block;">${(s.items ?? []).length} item${(s.items ?? []).length!==1?'s':''}</div>
        </div>
      </div>
      <div style="height:1px;background:var(--border);margin:12px 0;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0;">
          ${items.slice(0,2).map(it=>`
            <div style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text2);font-weight:500;">
              <span>📦</span><span>${it.productName}</span>
              <span style="background:var(--amber-glow);color:var(--amber);border-radius:3px;padding:1px 4px;font-size:10px;font-weight:700;">×${it.quantity}</span>
            </div>`).join('')}
          ${items.length>2?`<span style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 6px;background:var(--bg3);border-radius:6px;font-weight:600;">+${items.length-2}</span>`:''}
        </div>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;font-family:var(--mono);background:${payBg[pt]};color:${payColor[pt]};border:1px solid ${payColor[pt]}30;white-space:nowrap;letter-spacing:0.5px;">${pt.toUpperCase()}</div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY RENDERING (search-safe — only tbody re-renders on input)
// ══════════════════════════════════════════════════════════════════════════════

function renderInventory() {
  const sub = document.getElementById('inventory-sub');
  if (sub) sub.textContent = `PRODUCT_DATABASE // ${state.products.length} items`;

  const searchInput = document.getElementById('inventory-search');
  if (searchInput && !searchInput._listenerAttached) {
    searchInput.addEventListener('input', () => {
      state.inventorySearch = searchInput.value;
      renderInventoryTable();
    });
    searchInput._listenerAttached = true;
    searchInput.value = state.inventorySearch;
  }

  renderInventoryTable();
}

function renderInventoryTable() {
  const sub = document.getElementById('inventory-sub');
  if (sub) sub.textContent = `PRODUCT_DATABASE // ${state.products.length} items`;

  const term     = state.inventorySearch.toLowerCase();
  const filtered = state.products.filter(p => p.name.toLowerCase().includes(term));
  const tbody    = document.getElementById('inventory-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">${state.products.length===0?'No products yet. Add your first product!':'No products match your search.'}</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const status     = p.quantity===0 ? 'out' : p.quantity<=LOW_STOCK_THRESHOLD ? 'low' : 'ok';
    const statusText = p.quantity===0 ? 'Out of Stock' : p.quantity<=LOW_STOCK_THRESHOLD ? 'Low Stock' : 'In Stock';
    return `
      <tr>
        <td style="font-weight:500;">${p.name}</td>
        <td class="mono">${p.quantity}</td>
        <td class="mono">${p.costPrice!=null?fmt(p.costPrice):'—'}</td>
        <td class="mono">${p.price!=null?fmt(p.price):'—'}</td>
        <td><span class="badge badge-${status}">${statusText}</span></td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-stock btn-sm" onclick="openPurchaseForm('${p.id}'); return false;" title="Record a purchase for this product">＋ Stock</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteProduct('${p.id}','${p.name.replace(/'/g,"\\'")}'); return false;">✕ Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function confirmDeleteProduct(id, name) {
  showModal(`
    <div class="modal-title" style="color:var(--red);">🗑 Delete Product</div>
    <p style="font-size:14px;color:var(--text2);margin-bottom:6px;">Are you sure you want to delete:</p>
    <div style="background:var(--red-dim);border:1px solid rgba(220,38,38,0.2);border-radius:8px;padding:12px 16px;margin-bottom:20px;font-weight:600;color:var(--text);font-size:15px;">${name}</div>
    <p style="font-size:12px;color:var(--text3);margin-bottom:24px;font-family:var(--mono);">This action cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteProduct('${id}')">✕ Yes, Delete</button>
    </div>`);
}

// ══════════════════════════════════════════════════════════════════════════════
// SALES RENDERING
// ══════════════════════════════════════════════════════════════════════════════

function renderSales() {
  const container  = document.getElementById('sales-page');
  const totalRev   = state.sales.reduce((s, x) => s + saleTotal(x), 0);

  container.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
      <div>
        <div class="page-title">Transaction Log</div>
        <div class="page-sub">SALES_HISTORY // ${state.sales.length} transactions · ${fmt(totalRev)} total revenue</div>
      </div>
      <button class="btn btn-amber" style="padding:10px 20px;font-size:14px;" onclick="showModal(saleFormHTML()); initSaleForm(); return false;">⚡ New Sale</button>
    </div>
    <div style="position:relative;margin-bottom:24px;">
      <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:15px;pointer-events:none;">🔍</span>
      <input type="text" id="sales-search" placeholder="Search by customer, date or product…" oninput="renderSalesList()"
        style="padding:11px 14px 11px 42px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;font-size:14px;color:var(--text);width:100%;outline:none;">
    </div>
    <div id="sales-list-container"></div>`;

  renderSalesList();
}

function renderSalesList() {
  const container  = document.getElementById('sales-list-container');
  if (!container) return;

  const term = document.getElementById('sales-search')?.value.toLowerCase() || '';
  const filtered = state.sales.filter(s => {
    const items = s.items ?? [];
    return (s.customerName??'').toLowerCase().includes(term) ||
           (s.customerPhone??'').includes(term) ||
           fmtDate(recordDate(s)).toLowerCase().includes(term) ||
           items.some(it => (it.productName??'').toLowerCase().includes(term));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:64px 24px;color:var(--text3);">
        <div style="font-size:48px;margin-bottom:16px;">🧾</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px;">${state.sales.length===0?'No transactions yet':'No results found'}</div>
        <div style="font-size:13px;">${state.sales.length===0?'Record your first sale to get started':'Try adjusting your search'}</div>
      </div>`;
    return;
  }

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${filtered.map(s=>renderSaleCard(s)).join('')}</div>`;
}

function renderSaleCard(s) {
  const items    = s.items ?? [];
  const total    = saleTotal(s);
  const isOpen   = state.expandedSales[s.id];
  const pt       = s.paymentType ?? 'cash';
  const idx      = state.sales.findIndex(x => x.id === s.id);
  const txnNum   = String(state.sales.length - idx).padStart(4, '0');

  const payColor = {cash:'#16a34a',card:'#3b82f6',credit:'#a855f7'};
  const payBg    = {cash:'rgba(22,163,74,0.08)',card:'rgba(59,130,246,0.08)',credit:'rgba(168,85,247,0.08)'};
  const payIcon  = {cash:'💵',card:'💳',credit:'🏦'};

  const ts = toDate(s.timestamp);

  return `
    <div class="txn-card" style="box-shadow:${isOpen?'0 4px 20px rgba(0,0,0,0.06)':'none'};">
      <div class="txn-card-header" onclick="toggleSaleExpand('${s.id}')">
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;white-space:nowrap;">#${txnNum}</div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:14px;color:var(--text);">${s.customerName||'Unknown'}</span>
            <span style="font-family:var(--mono);font-size:11px;color:var(--text3);">📅 ${fmtDate(recordDate(s))}</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
            ${items.slice(0,3).map(it=>`<span style="font-family:var(--mono);font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:2px 7px;color:var(--text2);">${it.productName} ×${it.quantity}</span>`).join('')}
            ${items.length>3?`<span style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:2px 4px;">+${items.length-3} more</span>`:''}
          </div>
        </div>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:7px;font-size:12px;font-weight:600;font-family:var(--mono);background:${payBg[pt]};color:${payColor[pt]};white-space:nowrap;">
          ${payIcon[pt]} ${pt.charAt(0).toUpperCase()+pt.slice(1)}
        </span>
        <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--green);white-space:nowrap;">${fmt(total)}</div>
        <div style="font-size:12px;color:var(--text3);transition:transform 0.2s;transform:rotate(${isOpen?'180':'0'}deg);">▾</div>
      </div>
      ${isOpen ? `
        <div style="border-top:1px solid var(--border);">
          <div style="background:var(--bg3);padding:8px 20px;display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;">🕐</span>
            <span style="font-family:var(--mono);font-size:12px;color:var(--text3);">${s.saleDate ? `Sale date ${fmtDate(recordDate(s))} · recorded ` : ''}${ts.toLocaleString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
            <span style="margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text3);">TXN-${s.id.toUpperCase()}</span>
          </div>
          <div style="padding:16px 20px;">
            <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px;">Order Items</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${items.map(it=>`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:32px;height:32px;border-radius:8px;background:var(--amber-glow);border:1px solid var(--amber-dim);display:flex;align-items:center;justify-content:center;font-size:14px;">📦</div>
                    <div>
                      <div style="font-weight:600;font-size:13px;color:var(--text);">${it.productName}</div>
                      <div style="font-family:var(--mono);font-size:11px;color:var(--text3);">${it.quantity} unit${it.quantity>1?'s':''} × ${it.priceAtSale!=null?fmt(it.priceAtSale):'—'}</div>
                    </div>
                  </div>
                  <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--text);">${it.priceAtSale!=null?fmt(it.priceAtSale*it.quantity):'—'}</div>
                </div>`).join('')}
            </div>
            <div style="margin-top:12px;padding:12px 14px;background:linear-gradient(135deg,rgba(217,119,6,0.07),rgba(217,119,6,0.03));border:1px solid var(--amber-dim);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);">Grand Total</div>
                <div style="font-size:12px;color:var(--text3);margin-top:2px;">${items.length} item${items.length>1?'s':''} · paid by ${pt}</div>
              </div>
              <div style="font-family:var(--mono);font-size:22px;font-weight:800;color:var(--amber);">${fmt(total)}</div>
            </div>
          </div>
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
  const subText    = `PURCHASE_HISTORY // ${state.purchases.length} purchase${state.purchases.length !== 1 ? 's' : ''} · ${fmt(totalSpent)} total spent`;

  // Page shell already built → only refresh header + list (keeps search box focus while typing)
  const existingSub = document.getElementById('purchases-sub');
  if (existingSub) {
    existingSub.textContent = subText;
    renderPurchasesList();
    return;
  }

  container.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
      <div>
        <div class="page-title">Purchases</div>
        <div class="page-sub" id="purchases-sub">${subText}</div>
      </div>
      <button class="btn btn-amber" style="padding:10px 20px;font-size:14px;" onclick="openPurchaseForm(); return false;">🛒 New Purchase</button>
    </div>
    <div style="position:relative;margin-bottom:24px;">
      <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:15px;pointer-events:none;">🔍</span>
      <input type="text" id="purchases-search" placeholder="Search by supplier, invoice no. or product…" oninput="renderPurchasesList()"
        style="padding:11px 14px 11px 42px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;font-size:14px;color:var(--text);width:100%;outline:none;">
    </div>
    <div id="purchases-list-container"></div>`;

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
    container.innerHTML = `
      <div style="text-align:center;padding:64px 24px;color:var(--text3);">
        <div style="font-size:48px;margin-bottom:16px;">🛒</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px;">${state.purchases.length === 0 ? 'No purchases yet' : 'No results found'}</div>
        <div style="font-size:13px;">${state.purchases.length === 0 ? 'Record a purchase and its items are added to stock automatically' : 'Try adjusting your search'}</div>
      </div>`;
    return;
  }

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${filtered.map(renderPurchaseCard).join('')}</div>`;
}

function renderPurchaseCard(p) {
  const items  = p.items ?? [];
  const total  = purchaseTotal(p);
  const units  = purchaseUnits(p);
  const isOpen = state.expandedPurchases[p.id];
  const pt     = PAY_COLOR[p.paymentType] ? p.paymentType : 'cash';
  const idx    = state.purchases.findIndex(x => x.id === p.id);
  const num    = String(state.purchases.length - idx).padStart(4, '0');
  const ts     = toDate(p.timestamp);
  const subtotal  = typeof p.subtotal  === 'number' ? p.subtotal  : items.reduce((s, it) => s + (it.unitCost ?? 0) * it.quantity, 0);
  const vatAmount = typeof p.vatAmount === 'number' ? p.vatAmount : 0;

  return `
    <div class="txn-card" style="box-shadow:${isOpen ? '0 4px 20px rgba(0,0,0,0.06)' : 'none'};">
      <div class="txn-card-header" onclick="togglePurchaseExpand('${p.id}')">
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;white-space:nowrap;">PO-${num}</div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:14px;color:var(--text);">🏭 ${esc(p.supplierName || 'Unknown supplier')}</span>
            ${p.supplierPhone ? `<span style="font-family:var(--mono);font-size:11px;color:var(--text3);">${esc(p.supplierPhone)}</span>` : ''}
            ${p.invoiceNo ? `<span style="font-family:var(--mono);font-size:10px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:1px 6px;">${esc(p.invoiceNo)}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
            ${items.slice(0, 3).map(it => `<span style="font-family:var(--mono);font-size:11px;background:var(--green-dim);border:1px solid rgba(22,163,74,0.2);border-radius:4px;padding:2px 7px;color:var(--green);">${esc(it.productName)} +${it.quantity}</span>`).join('')}
            ${items.length > 3 ? `<span style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:2px 4px;">+${items.length - 3} more</span>` : ''}
          </div>
        </div>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:7px;font-size:12px;font-weight:600;font-family:var(--mono);background:${PAY_BG[pt]};color:${PAY_COLOR[pt]};white-space:nowrap;">
          ${PAY_ICON[pt]} ${pt.charAt(0).toUpperCase() + pt.slice(1)}
        </span>
        <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--purple);white-space:nowrap;">${fmt(total)}</div>
        <div style="font-size:12px;color:var(--text3);transition:transform 0.2s;transform:rotate(${isOpen ? '180' : '0'}deg);">▾</div>
      </div>
      ${isOpen ? `
        <div style="border-top:1px solid var(--border);">
          <div style="background:var(--bg3);padding:8px 20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:13px;">🕐</span>
            <span style="font-family:var(--mono);font-size:12px;color:var(--text3);">${ts.toLocaleString('en-US', { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
            <span style="margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text3);">by ${esc(p.recordedBy || 'unknown')}</span>
          </div>
          <div style="padding:16px 20px;">
            <div class="section-label" style="margin-bottom:10px;">Items Added to Stock</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${items.map(it => `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
                  <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                    <div style="width:32px;height:32px;flex-shrink:0;border-radius:8px;background:var(--green-dim);border:1px solid rgba(22,163,74,0.25);display:flex;align-items:center;justify-content:center;font-size:14px;">📥</div>
                    <div style="min-width:0;">
                      <div style="font-weight:600;font-size:13px;color:var(--text);">
                        ${esc(it.productName)}
                        ${it.isNewProduct ? `<span style="font-family:var(--mono);font-size:9px;letter-spacing:1px;background:var(--amber-glow);color:var(--amber);border:1px solid var(--amber-dim);border-radius:4px;padding:1px 5px;margin-left:4px;">NEW</span>` : ''}
                      </div>
                      <div style="font-family:var(--mono);font-size:11px;color:var(--text3);"><span style="color:var(--green);font-weight:600;">+${it.quantity}</span> unit${it.quantity !== 1 ? 's' : ''} × ${fmt(it.unitCost ?? 0)}</div>
                    </div>
                  </div>
                  <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;">${fmt((it.unitCost ?? 0) * it.quantity)}</div>
                </div>`).join('')}
            </div>
            <div style="margin-top:12px;padding:12px 14px;background:rgba(124,58,237,0.05);border:1px solid rgba(124,58,237,0.2);border-radius:8px;">
              ${vatAmount > 0 ? `
                <div class="summary-line"><span>Subtotal</span><strong>${fmt(subtotal)}</strong></div>
                <div class="summary-line"><span>VAT (15%)</span><strong>${fmt(vatAmount)}</strong></div>` : ''}
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div class="section-label" style="margin:0;">Total Cost</div>
                  <div style="font-size:12px;color:var(--text3);margin-top:2px;">${units} unit${units !== 1 ? 's' : ''} added · paid by ${pt}${p.vatIncluded === false ? '' : ' · VAT incl.'}</div>
                </div>
                <div style="font-family:var(--mono);font-size:22px;font-weight:800;color:var(--purple);">${fmt(total)}</div>
              </div>
            </div>
          </div>
        </div>` : ''}
    </div>`;
}

function togglePurchaseExpand(id) {
  state.expandedPurchases[id] = !state.expandedPurchases[id];
  renderPurchasesList();
}
