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
function userBranchesCol()  { return userCol('branches'); }
function userTransfersCol() { return userCol('transfers'); }

// Every account has a "Main branch" (fixed id) that holds stock by default
const MAIN_BRANCH = 'main';

// ─── Constants ────────────────────────────────────────────────────────────────
const PAYMENT_TYPES = [
  { id: 'cash',     label: 'Cash'     },
  { id: 'card',     label: 'Card'     },
  { id: 'transfer', label: 'Transfer' },
];

// ─── App State ────────────────────────────────────────────────────────────────
let state = {
  currentPage: 'dashboard',
  products: [],
  sales: [],
  purchases: [],
  expandedSales: {},
  expandedProducts: {},
  expandedTransfers: {},
  expandedReturns: {},
  hist: null,
  invBranch: 'all',
  receiptCache: {},
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
  _unsubBranches: null,
  _unsubTransfers: null,
  _unsubHidden: null,
  _unsubSettings: null,
  settings: null,             // filled from users/{uid}/settings/app — see appSettings()
  hidden: new Set(),         // "vendor:name" / "customer:name" removed from dropdown lists
  // Branches + transfers
  branches: [],
  transfers: [],
  // Sales page (Sell / Transfer)
  salesMode: 'sell',
  draft: null,
  sheet: null,
  sheetQuery: '',
  salesToast: '',
  histLimit: 15,
  saleSubmitting: false,
  // Purchases page (From vendor / Quick buy)
  purchaseMode: 'po',
  pdraft: null,
  qdraft: null,
  purchasesToast: '',
  purchaseHistLimit: 15,
  purchaseSubmitting: false,
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
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d) ? new Date() : d;         // anything unreadable counts as "now"
}

// Today's date as YYYY-MM-DD in the user's local timezone
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The date a sale/purchase belongs to: the chosen sale date, else when it was recorded
function recordDate(r) {
  const iso = r.saleDate || r.purchaseDate;
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
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
  user:      'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  store:     'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
  calendar:  'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  swapH:     'M4 9h13l-3-3M20 15H7l3 3',
  swapV:     'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  pin:       'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  minus:     'M5 12h14',
  arrowUR:   'M7 17L17 7M9 7h8v8',
  refund:    'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  arrowR:    'M5 12h14M13 6l6 6-6 6',
  close:     'M7 7l10 10M17 7L7 17',
  edit:      'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  truck:     'M3 7h11v10H3zM14 10h4l3 3v4h-7M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bag:       'M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2',
  camera:    'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  note:      'M6 3h9l4 4v14H6zM14 3v5h5M9 12h6M9 16h6',
  share:     'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  download:  'M12 3v12M7 10l5 5 5-5M4 20h16',
  clock:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  filter:    'M4 5h16l-6 8v5l-4 2v-7z',
  sliders:   'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

function ic(name, size = 16, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"></path></svg>`;
}

const PAY_IC   = { cash: 'cash', card: 'card', transfer: 'swapH', credit: 'bank' };
const PAY_TONE = { cash: 'green', card: 'blue', transfer: 'orange', credit: 'purple' };
const PAY_NAME = { cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'Credit' };
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
  if (state._unsubBranches) { state._unsubBranches();  state._unsubBranches  = null; }
  if (state._unsubTransfers){ state._unsubTransfers(); state._unsubTransfers = null; }
  if (state._unsubHidden)   { state._unsubHidden();    state._unsubHidden    = null; }
  if (state._unsubSettings) { state._unsubSettings();  state._unsubSettings  = null; }
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
  const set = document.getElementById('settings-btn');
  if (set) set.innerHTML = ic('sliders', 17);
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
      migrateLegacyStock();
      updateSidebarProductCount();
      scheduleRender(() => showDbLoading(false));   // hide the loader once the page is drawn
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
      scheduleRender();
    }, err => {
      console.error('Sales listener error:', err);
    });

  // Purchases listener — sorted newest first
  state._unsubPurchases = userPurchasesCol()
    .orderBy('timestamp', 'desc')
    .onSnapshot(snap => {
      state.purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      scheduleRender();
    }, err => {
      console.error('Purchases listener error:', err);
      showToast('Failed to load purchases', 'error');
    });

  // Branches listener — creates the Main branch the first time
  state._unsubBranches = userBranchesCol()
    .onSnapshot(snap => {
      state.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.id === MAIN_BRANCH) - (a.id === MAIN_BRANCH) || (a.name || '').localeCompare(b.name || ''));
      if (!state.branches.some(b => b.id === MAIN_BRANCH) && !(snap.metadata && snap.metadata.fromCache)) {
        userBranchesCol().doc(MAIN_BRANCH).set({
          name: 'Main branch', place: 'Main store', main: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch(e => console.error('Main branch create failed:', e));
      }
      scheduleRender();
    }, err => console.error('Branches listener error:', err));

  // App settings (VAT on/off and rate) — one document per account
  state._unsubSettings = userCol('settings').doc('app')
    .onSnapshot(doc => {
      state.settings = doc.exists ? doc.data() : null;
      applyBranding();
      scheduleRender();
    }, err => console.error('Settings listener error:', err));

  // Names the user removed from the Vendor / Customer dropdowns
  state._unsubHidden = userCol('hidden')
    .onSnapshot(snap => {
      state.hidden = new Set(snap.docs.map(d => d.data().key).filter(Boolean));
      scheduleRender();
    }, err => console.error('Hidden list listener error:', err));

  // Transfers listener — newest first
  state._unsubTransfers = userTransfersCol()
    .orderBy('timestamp', 'desc')
    .onSnapshot(snap => {
      state.transfers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      scheduleRender();
    }, err => console.error('Transfers listener error:', err));
}

// Products saved before branches existed keep all their stock in the Main branch
const _migrated = new Set();
function migrateLegacyStock() {
  const legacy = state.products.filter(p => (!p.stock || typeof p.stock !== 'object') && !_migrated.has(p.id));
  if (!legacy.length) return;
  const batch = db.batch();
  legacy.forEach(p => {
    _migrated.add(p.id);
    batch.update(userProductsCol().doc(p.id), { stock: { [MAIN_BRANCH]: Number(p.quantity) || 0 } });
  });
  batch.commit().catch(e => console.error('Stock migration failed:', e));
}

function stopFirestoreListeners() {
  if (state._unsubProducts)  { state._unsubProducts();  state._unsubProducts  = null; }
  if (state._unsubSales)     { state._unsubSales();     state._unsubSales     = null; }
  if (state._unsubPurchases) { state._unsubPurchases(); state._unsubPurchases = null; }
  if (state._unsubBranches)  { state._unsubBranches();  state._unsubBranches  = null; }
  if (state._unsubTransfers) { state._unsubTransfers(); state._unsubTransfers = null; }
  if (state._unsubHidden)    { state._unsubHidden();    state._unsubHidden    = null; }
  if (state._unsubSettings)  { state._unsubSettings();  state._unsubSettings  = null; }
  state.settings  = null;
  state.hidden    = new Set();
  state.products  = [];
  state.sales     = [];
  state.purchases = [];
  state.branches  = [];
  state.transfers = [];
  state.draft     = null;
  state.tdraft    = null;
  state.pdraft    = null;
  state.qdraft    = null;
  state.sheet     = null;
  _migrated.clear();
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
      stock: { [MAIN_BRANCH]: Number(data.quantity) || 0 },
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
  const now   = firebase.firestore.FieldValue.serverTimestamp();
  const branch = data.branchId || MAIN_BRANCH;

  batch.set(userSalesCol().doc(), {
    ...data,
    recordedBy: state.currentUser?.email || 'unknown',
    timestamp: now,
  });

  // Take the sold units out of the selling branch (and the overall total)
  data.items.forEach(item => {
    batch.update(userProductsCol().doc(item.productId), {
      quantity: firebase.firestore.FieldValue.increment(-item.quantity),
      [`stock.${branch}`]: firebase.firestore.FieldValue.increment(-item.quantity),
      updatedAt: now,
    });
  });

  await batch.commit();
}

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASE OPERATIONS (Firestore)
// Every purchase ADDS its quantities to stock in the same atomic batch.
// ══════════════════════════════════════════════════════════════════════════════

async function recordPurchase(data) {
  const batch  = db.batch();
  const now    = firebase.firestore.FieldValue.serverTimestamp();
  const branch = data.branchId || MAIN_BRANCH;

  // Items going into stock (vendor purchases, or quick buys marked "Add to inventory")
  const items = (data.items || []).map(item => {
    if (item.isNew) {
      const productRef = userProductsCol().doc();
      batch.set(productRef, {
        name:      item.productName,
        quantity:  item.quantity,
        stock:     { [branch]: item.quantity },
        costPrice: item.unitCost,
        price:     item.sellingPrice ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return { productId: productRef.id, productName: item.productName, quantity: item.quantity, unitCost: item.unitCost, isNewProduct: true };
    }
    batch.update(userProductsCol().doc(item.productId), {
      quantity:  firebase.firestore.FieldValue.increment(item.quantity),
      [`stock.${branch}`]: firebase.firestore.FieldValue.increment(item.quantity),
      costPrice: item.unitCost,                       // latest buying price
      updatedAt: now,
    });
    return { productId: item.productId, productName: item.productName, quantity: item.quantity, unitCost: item.unitCost };
  });

  const purchaseRef = userPurchasesCol().doc();
  const doc = { ...data, items, branchId: branch, recordedBy: state.currentUser?.email || 'unknown', timestamp: now };
  delete doc.receiptImage;
  batch.set(purchaseRef, doc);
  await batch.commit();

  // Receipt photos live in their own collection so lists stay light
  if (data.receiptImage) {
    try {
      await userCol('receipts').doc(purchaseRef.id).set({ image: data.receiptImage, createdAt: now });
      await purchaseRef.update({ hasReceipt: true });
    } catch (e) {
      console.error('Receipt upload failed:', e);
      showToast('Purchase saved, but the receipt photo could not be saved', 'error');
    }
  }
  return purchaseRef.id;
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
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" onclick="closeModal()" aria-label="Close">${ic('close', 14, 2.2)}</button>
        ${content}
      </div>
    </div>`;
  const first = document.querySelector('.modal input, .modal button:not(.modal-close)');
  if (first) first.focus();
}

// Escape closes whatever is open (picker sheet first, then pop-up)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (state.sheet) { closeSheet(); return; }
  const mc = document.getElementById('modal-container');
  if (mc && mc.innerHTML.trim()) closeModal();
});

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function updateSidebarProductCount() {
  // Product count is shown on the dashboard; nothing else to update.
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

const TAB_FOR_PAGE = { transfer: 'inventory' };
function navigateTo(page) {
  if (page === 'sales') state.salesMode = 'sell';
  if (page === 'transfer') state.salesMode = 'move';
  if (page !== state.currentPage) { state.salesToast = ''; state.purchasesToast = ''; }
  state.currentPage = page;
  const tab = TAB_FOR_PAGE[page] || page;
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === tab));
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
    case 'settings':  renderSettings();   break;
    case 'transfer':  renderSales();      break;
    case 'history':   renderHistory();    break;
  }
  // Keep an open picker list in sync when data changes in real time
  if (state.sheet && document.getElementById('sheet-list')) renderSheetList();
}

// Real-time data arrives in bursts (six listeners at sign-in, two snapshots per save).
// Draw at most once per frame, and don't replay entrance animations on those redraws,
// so the screen doesn't flicker or jump while data streams in.
let _renderQueued = false;
const _afterRender = [];
function scheduleRender(after) {
  if (after) _afterRender.push(after);
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => {
    _renderQueued = false;
    renderCurrentPage();
    document.querySelectorAll('.page .inline-toast, .page .hist-detail, .page .txn-detail')
      .forEach(el => { el.style.animation = 'none'; });
    _afterRender.splice(0).forEach(fn => fn());
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FORM BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

// A product's stock per branch, also for products saved before branches existed
function stockMap(p) {
  if (p && p.stock && typeof p.stock === 'object') return { ...p.stock };
  return { [MAIN_BRANCH]: Number(p?.quantity) || 0 };
}

// Stock fields for the edit form: one "Quantity" box with a single branch,
// one box per branch when stock is split across branches
function stockFieldsHTML(product) {
  const branches = state.branches.length ? state.branches : [branchById(MAIN_BRANCH)];
  const stock = stockMap(product);
  const input = (b, label) => `
    <div class="field">
      <label>${label}</label>
      <input type="number" name="stock_${b.id}" data-branch="${b.id}" value="${Number(stock[b.id]) || 0}" min="0" step="1" placeholder="0" inputmode="numeric" required>
    </div>`;
  if (branches.length === 1) return input(branches[0], 'Quantity <span class="req">*</span>');
  return `
    <div class="field">
      <label>Stock by branch <span class="hint">· total updates automatically</span></label>
      <div class="form-row stock-grid">${branches.map(b => input(b, esc(b.name))).join('')}</div>
    </div>`;
}

function openEditProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) { showToast('Product not found', 'error'); return; }
  showModal(productFormHTML(p));
}

function productFormHTML(product = null) {
  const isEdit = product !== null;
  const prices = `
        <div class="form-row">
          <div class="field">
            <label>Buying price</label>
            <input type="number" name="costPrice" value="${product?.costPrice ?? ''}" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
          </div>
          <div class="field">
            <label>Selling price</label>
            <input type="number" name="price" value="${product?.price ?? ''}" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
          </div>
        </div>`;
  return `
    <div class="modal-title"><span class="ic ic-orange">${ic(isEdit ? 'edit' : 'box')}</span>${isEdit ? 'Edit product' : 'Add product'}</div>
    <form id="product-form" onsubmit="return handleProductSubmit(event, ${isEdit ? `'${product.id}'` : 'null'})">
      <div class="form-grid">
        <div class="field">
          <label>Product name <span class="req">*</span></label>
          <input type="text" name="name" value="${esc(product?.name || '')}" placeholder="e.g. Apple AirPods" required>
        </div>
        ${isEdit ? prices + stockFieldsHTML(product) : `
        <div class="field">
          <label>Quantity <span class="req">*</span></label>
          <input type="number" name="quantity" value="" min="0" placeholder="0" inputmode="numeric" required>
        </div>` + prices}
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
  const get  = n => form.elements[n].value;
  const data = {
    name:      get('name').trim(),
    costPrice: get('costPrice') ? parseFloat(get('costPrice')) : null,
    price:     get('price')     ? parseFloat(get('price'))     : null,
  };
  if (!data.name) { showToast('Product name is required', 'error'); return false; }

  if (productId) {
    const p = state.products.find(x => x.id === productId);
    if (!p) { closeModal(); showToast('Product not found', 'error'); return false; }
    // Keep the per-branch stock and the overall total in step
    const stock = stockMap(p);
    form.querySelectorAll('[data-branch]').forEach(inp => {
      stock[inp.dataset.branch] = Math.max(0, parseInt(inp.value, 10) || 0);
    });
    data.stock    = stock;
    data.quantity = Object.values(stock).reduce((s, v) => s + (Number(v) || 0), 0);
    editProduct(productId, data);
  } else {
    data.quantity = parseInt(get('quantity'), 10) || 0;
    addProduct(data);
  }
  return false;
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

const TAG_LABEL = {
  paid: 'Paid', refunded: 'Refunded', returned: 'Returned', partial_return: 'Part returned',
  in_transit: 'In transit', received: 'Received',
};

function saleTotal(s) {
  if (typeof s.total === 'number') return s.total;
  return (s.items ?? []).reduce((sum, it) => sum + (it.priceAtSale??0)*it.quantity, 0);
}

// ── Sale returns ─────────────────────────────────────────────────────────────
// Each return is kept on the sale: returns: [{ id, date, items: [{ idx, productId, productName, quantity, priceAtSale }], subtotal, vat, total, note }]
function saleReturns(s) { return Array.isArray(s.returns) ? s.returns : []; }
// Units already returned for each line of the sale (by line index)
function returnedByLine(s) {
  const map = {};
  saleReturns(s).forEach(r => (r.items || []).forEach(it => { map[it.idx] = (map[it.idx] || 0) + (Number(it.quantity) || 0); }));
  return map;
}
function returnedAmount(s) {
  if (s.refunded && !saleReturns(s).length) return saleTotal(s);          // older fully-refunded sales
  return saleReturns(s).reduce((a, r) => a + (Number(r.total) || 0), 0);
}
function saleNetTotal(s) { return Math.max(0, saleTotal(s) - returnedAmount(s)); }
function saleStatus(s) {
  if (s.refunded && !saleReturns(s).length) return 'refunded';
  if (!saleReturns(s).length) return 'paid';
  const back = returnedByLine(s);
  return (s.items || []).every((it, i) => (back[i] || 0) >= it.quantity) ? 'returned' : 'partial_return';
}

function saleProfit(s) {
  if (saleStatus(s) === 'refunded') return 0;
  const back = returnedByLine(s);
  return (s.items ?? []).reduce((sum, it, i) => {
    const product   = state.products.find(p => p.id === it.productId);
    const cost      = product?.costPrice ?? 0;
    return sum + (it.priceAtSale - cost) * (it.quantity - (back[i] || 0));
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
    totalRevenue: sales.reduce((s, x) => s + saleNetTotal(x), 0),     // after returns
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

  const lowStock   = state.products.filter(p => p.quantity > 0 && p.quantity <= lowStockLevel());
  const outCount   = state.products.filter(p => p.quantity === 0).length;
  const stats      = calculateSaleStats(getFilteredSales());
  const allTimeRev = state.sales.reduce((s, x) => s + saleNetTotal(x), 0);
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
      <div class="lc-row"><span class="ic ic-red">${ic('alert')}</span><div class="lc-text"><span class="lc-title">Low stock alert</span><span class="lc-sub">Items ≤ ${lowStockLevel()} units remaining</span></div><span class="lc-val">${lowStock.length}</span></div>
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
        <div class="box-head-text"><span class="box-title">Recent activity</span><span class="box-sub">Sales, returns, purchases and transfers</span></div>
        <button class="box-link" onclick="openHistory()">History</button>
      </div>
      ${recentActivityHTML()}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY RENDERING (search-safe — only the list re-renders while typing)
// ══════════════════════════════════════════════════════════════════════════════

// ── Shop (branch) view: 'all' or a branch id ──
function invShop() {
  const id = state.invBranch || 'all';
  return id !== 'all' && !state.branches.some(b => b.id === id) ? 'all' : id;
}
function qtyIn(p, shop = invShop()) { return shop === 'all' ? (Number(p.quantity) || 0) : stockAt(p, shop); }
function stockStatus(q) { return q <= 0 ? 'out' : q <= lowStockLevel() ? 'low' : 'ok'; }
function setInvShop(id) { state.invBranch = id; renderInventory(); }

function renderInventory() {
  const container = document.getElementById('inventory-page');
  if (!container) return;
  const shop = invShop();
  const low = state.products.filter(p => stockStatus(qtyIn(p, shop)) === 'low').length;
  const out = state.products.filter(p => stockStatus(qtyIn(p, shop)) === 'out').length;
  const where = shop === 'all' ? '' : ` at ${branchById(shop).name}`;
  const sub = `${plural(state.products.length, 'product')} · ${low} low · ${out} out of stock${where}`;

  if (!document.getElementById('inventory-list')) {
    container.innerHTML = `
      <div class="page-head"><div class="page-head-text"><span class="page-title">Inventory</span><span class="page-date" id="inventory-sub"></span></div></div>
      <div class="head-actions two">
        <button class="btn btn-primary" onclick="showModal(productFormHTML()); return false;">${ic('plus', 16, 2.4)}Add product</button>
        <button class="btn btn-soft" onclick="navigateTo('transfer'); return false;">${ic('swapH')}Transfer stock</button>
      </div>
      <div class="shop-bar" id="inventory-shops" role="tablist" aria-label="Shop"></div>
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

  // Shop switcher (only when there's more than one shop)
  const shop = invShop();
  const shopBar = document.getElementById('inventory-shops');
  // Always shown: "All shops", then every shop you've added (by its full name), then "+ Add shop"
  if (shopBar) {
    const shops = state.branches.length ? state.branches : [branchById(MAIN_BRANCH)];
    shopBar.hidden = false;
    shopBar.innerHTML = [{ id: 'all', name: 'All shops' }, ...shops].map(b => {
      const units = b.id === 'all' ? state.products.reduce((a, p) => a + (Number(p.quantity) || 0), 0) : branchUnits(b.id);
      const items = b.id === 'all' ? state.products.length : state.products.filter(p => stockAt(p, b.id) > 0).length;
      return `<button class="shop-chip${shop === b.id ? ' active' : ''}" role="tab" aria-selected="${shop === b.id}" onclick="setInvShop('${b.id}')" title="${esc(b.name)}">
        <span class="shop-name">${b.id === 'all' ? ic('store', 13) : ''}<bdi>${esc(b.name)}</bdi></span><span class="shop-units num">${plural(items, 'product')} · ${plural(units, 'unit')}</span></button>`;
    }).join('') + `<button class="shop-chip add" onclick="openSheet('addBranch', 'inventory')">${ic('plus', 14, 2.4)}<span class="shop-name">Add shop</span></button>`;
  }

  const term = state.inventorySearch.toLowerCase();
  const filtered = state.products.filter(p => {
    if (!(p.name ?? '').toLowerCase().includes(term)) return false;
    const st = stockStatus(qtyIn(p, shop));
    if (filter === 'low') return st === 'low';
    if (filter === 'out') return st === 'out';
    return true;
  });
  const count = document.getElementById('inventory-count');
  if (count) {
    if (shop === 'all') count.textContent = filtered.length === state.products.length ? 'Sorted A–Z' : `${filtered.length} of ${state.products.length} shown`;
    else {
      const here = state.products.filter(p => qtyIn(p, shop) > 0);
      const units = here.reduce((a, p) => a + qtyIn(p, shop), 0);
      const value = here.reduce((a, p) => a + qtyIn(p, shop) * (Number(p.costPrice) || 0), 0);
      count.textContent = `${branchById(shop).name} · ${plural(here.length, 'product')} in stock · ${plural(units, 'unit')} · ${fmt(value)}`;
    }
  }
  const title = document.querySelector('#inventory-page .box-title');
  if (title) title.textContent = shop === 'all' ? 'Products in all shops' : `Products at ${branchById(shop).name}`;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('box', 20)}</span>
      <span class="empty-title">${state.products.length === 0 ? 'No products yet' : 'Nothing found'}</span>
      <span class="empty-text">${state.products.length === 0 ? 'Add your first product or record a purchase' : 'Try a different search or filter'}</span></div>`;
    return;
  }

  const multi = state.branches.length > 1;
  list.innerHTML = filtered.map(p => {
    const q          = qtyIn(p, shop);
    const status     = stockStatus(q);
    const statusText = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' }[status];
    const open = !!state.expandedProducts[p.id];
    // Per-shop split under the name: "Main 8 · Malaz 4" (all shops) or "of 12 in all shops" (one shop)
    const split = !multi ? '' : shop === 'all'
      ? state.branches.map(b => `<span class="split-item"><bdi>${esc(b.name)}</bdi> <b>${stockAt(p, b.id)}</b></span>`).join('<span class="split-dot"> · </span>')
      : `${p.quantity} in all shops`;
    return `
      <div class="prod${open ? ' open' : ''}" data-product="${p.id}">
        <button class="prod-top" type="button" onclick="toggleProductExpand('${p.id}')" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} details">
          <span class="ic ${status === 'ok' ? 'ic-orange' : status === 'low' ? 'ic-orange' : 'ic-red'}">${ic('box')}</span>
          <div class="sr-text"><span class="sr-title">${esc(p.name)}</span><span class="sr-sub">Buy ${p.costPrice != null ? fmt(p.costPrice) : '—'} · Sell ${p.price != null ? fmt(p.price) : '—'}</span>${split ? `<span class="prod-split">${ic('store', 11)}${split}</span>` : ''}</div>
          <div class="prod-qty"><b>${q}</b><span class="tag ${status}">${statusText}</span></div>
          <span class="dd-chev">${ic('chevron', 16, 2.2)}</span>
        </button>
        ${open ? productDetailHTML(p) : ''}
        <div class="prod-actions">
          <button class="btn btn-soft btn-sm" onclick="openEditProduct('${p.id}'); return false;" title="Edit name, prices and quantity">${ic('edit', 14)}Edit</button>
          <button class="btn btn-stock btn-sm" onclick="openPurchaseForm('${p.id}'); return false;" title="Record a purchase for this product">${ic('plus', 14, 2.4)}Stock</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteProduct('${p.id}'); return false;">${ic('trash', 14)}Delete</button>
        </div>
      </div>`;
  }).join('');
}

function toggleProductExpand(id) {
  state.expandedProducts[id] = !state.expandedProducts[id];
  renderInventoryTable();
}

// Everything we know about one product: stock per branch, prices, value, sales and last purchase
function productDetailHTML(p) {
  const cost = p.costPrice != null ? Number(p.costPrice) : null;
  const price = p.price != null ? Number(p.price) : null;
  const margin = cost != null && price != null ? price - cost : null;
  const marginPct = margin != null && price > 0 ? (margin / price) * 100 : null;
  const qty = Number(p.quantity) || 0;

  // Stock by branch (every branch, plus any old branch that still holds units)
  const stock = stockMap(p);
  const branches = (state.branches.length ? state.branches : [branchById(MAIN_BRANCH)]).map(b => ({ name: b.name, qty: Number(stock[b.id]) || 0 }));
  const known = new Set(state.branches.length ? state.branches.map(b => b.id) : [MAIN_BRANCH]);
  Object.keys(stock).forEach(id => {
    if (!known.has(id) && Number(stock[id])) branches.push({ name: 'Other branch', qty: Number(stock[id]) });
  });

  // Sales of this product (after returns)
  let sold = 0, revenue = 0, lastSold = null;
  state.sales.forEach(s => {
    if (saleStatus(s) === 'refunded') return;
    const back = returnedByLine(s);
    (s.items || []).forEach((it, i) => {
      if (it.productId !== p.id) return;
      const net = it.quantity - (back[i] || 0);
      sold += net; revenue += net * (Number(it.priceAtSale) || 0);
      const d = recordDate(s);
      if (!lastSold || d > lastSold) lastSold = d;
    });
  });

  // Most recent purchase that included it
  let lastBuy = null;
  state.purchases.forEach(pu => {
    const it = (pu.items || []).find(x => x.productId === p.id);
    if (!it) return;
    const d = recordDate(pu);
    if (!lastBuy || d > lastBuy.date) lastBuy = { date: d, from: pu.supplierName || pu.shop || 'Purchase', cost: it.unitCost, qty: it.quantity };
  });

  const kv = (label, value, sub = '') => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-val">${value}</span>${sub ? `<span class="kv-sub">${sub}</span>` : ''}</div>`;
  const money = n => n != null ? fmt(n) : '—';
  return `
        <div class="dd-panel">
          <div class="dd-block">
            <span class="dd-title">Stock by branch</span>
            ${branches.map(b => `<div class="dd-line"><span>${esc(b.name)}</span><b class="num">${plural(b.qty, 'unit')}</b></div>`).join('')}
            <div class="dd-line total"><span>Total</span><b class="num">${plural(qty, 'unit')}</b></div>
          </div>
          <div class="kv-grid">
            ${kv('Buying price', money(cost))}
            ${kv('Selling price', money(price))}
            ${kv('Profit per unit', margin != null ? fmt(margin) : '—', marginPct != null ? `${marginPct.toFixed(1)}% margin` : 'Set both prices')}
            ${kv('Stock value', cost != null ? fmt(cost * qty) : '—', price != null ? `${fmt(price * qty)} at selling price` : 'at buying price')}
            ${kv('Units sold', String(sold), sold ? `${fmt(revenue)} in sales` : 'No sales yet')}
            ${kv('Last sold', lastSold ? fmtDate(lastSold) : '—')}
            ${kv('Last purchase', lastBuy ? fmtDate(lastBuy.date) : '—', lastBuy ? `${esc(lastBuy.from)} · ${lastBuy.qty} × ${fmt(Number(lastBuy.cost) || 0)}` : '')}
            ${kv('Added', p.createdAt ? fmtDate(toDate(p.createdAt)) : '—', p.updatedAt ? `Updated ${fmtDate(toDate(p.updatedAt))}` : '')}
          </div>
        </div>`;
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
// SALES PAGE — Sell to a customer, or Transfer stock between branches
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS PAGE — business profile (name, tagline, logo), VAT, stock alerts,
// appearance and account. Saved per account in users/{uid}/settings/app.
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  appName: 'Ateer', tagline: "Musaddique's", logo: '',
  vatRate: 15, vatSales: true, vatPurchases: true,
  lowStock: 5,
};
const BRAND_CACHE_KEY = 'ateer-brand';

function appSettings() { return { ...DEFAULT_SETTINGS, ...(state.settings || {}) }; }

// VAT % to apply right now for 'sales' or 'purchases' (0 when switched off)
function vatPct(kind) {
  const s = appSettings();
  const on = kind === 'sales' ? s.vatSales : s.vatPurchases;
  const rate = Number(s.vatRate);
  return on && rate > 0 ? rate : 0;
}
function withVat(sub, pct) {
  const vat = Math.round(sub * pct) / 100;           // pct is a percentage, rounded to halalas
  return { vat, total: sub + vat, vatPct: pct };
}
function pctLabel(n) { return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`; }

// Products with this many units or fewer count as "Low stock"
function lowStockLevel() {
  const n = Number(appSettings().lowStock);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.lowStock;
}

// ── Branding: top bar, sign-in screen, browser tab title and icon ────────────
function readBrandCache() {
  try { return JSON.parse(localStorage.getItem(BRAND_CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function brand() {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || readBrandCache() || {}) };
  return {
    name:    String(s.appName || '').trim() || DEFAULT_SETTINGS.appName,
    tagline: String(s.tagline ?? '').trim(),
    logo:    typeof s.logo === 'string' && s.logo.startsWith('data:image/') ? s.logo : '',
  };
}
function brandMarkHTML(b) {
  return b.logo ? `<img src="${esc(b.logo)}" alt="">` : esc(b.name.charAt(0).toUpperCase());
}
function applyBranding() {
  const b = brand();
  document.querySelectorAll('.brand-mark').forEach(el => {
    el.innerHTML = brandMarkHTML(b);
    el.classList.toggle('has-logo', !!b.logo);
  });
  document.querySelectorAll('.brand-name').forEach(el => { el.textContent = b.name; });
  document.querySelectorAll('.brand-owner').forEach(el => { el.textContent = b.tagline; el.hidden = !b.tagline; });
  document.title = `${b.name} - Inventory Management System`;
  let icon = document.querySelector('link[rel="icon"]');
  if (b.logo) {
    if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
    icon.href = b.logo;
  } else if (icon) icon.remove();
  // Remember the look on this device so the sign-in screen shows it too
  if (state.settings) {
    try { localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({ appName: b.name, tagline: b.tagline, logo: b.logo })); } catch (e) {}
  }
}

// ── Saving ──────────────────────────────────────────────────────────────────
async function saveSettingsPatch(patch, okMsg) {
  const before = state.settings;
  state.settings = { ...(state.settings || {}), ...patch };     // show the change right away
  applyBranding();
  renderCurrentPage();
  try {
    await userCol('settings').doc('app').set({ ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (okMsg) showToast(okMsg);
    return true;
  } catch (e) {
    console.error(e);
    state.settings = before;
    applyBranding();
    renderCurrentPage();
    showToast('Could not save settings', 'error');
    return false;
  }
}
function toggleSetting(key) { saveSettingsPatch({ [key]: !appSettings()[key] }); }

// ── Page ────────────────────────────────────────────────────────────────────
function openSettings() {
  if (state.currentPage !== 'settings') state.prevPage = state.currentPage;
  closeSheet();
  navigateTo('settings');
}
function closeSettings() { navigateTo(state.prevPage || 'dashboard'); }

const SET_CHEV = () => `<span class="set-chev">${ic('chevron', 16, 2.2)}</span>`;
function setRow(o) {
  const tag = o.onclick ? 'button' : 'div';
  return `
      <${tag} class="set-row${o.cls ? ' ' + o.cls : ''}"${o.onclick ? ` type="button" onclick="${o.onclick}"` : ''}${o.attrs || ''}>
        <span class="ic ${o.tone || 'ic-orange'}">${ic(o.icon, 17)}</span>
        <span class="set-text"><span class="set-title">${o.title}</span>${o.sub ? `<span class="set-sub">${o.sub}</span>` : ''}</span>
        ${o.end || ''}
      </${tag}>`;
}
function setValue(v) { return `<span class="set-val">${v}</span>${SET_CHEV()}`; }
function setSwitchRow(key, o) {
  const on = !!appSettings()[key];
  return setRow({ ...o, onclick: `toggleSetting('${key}')`, attrs: ` role="switch" aria-checked="${on}"`,
    end: `<span class="switch${on ? ' on' : ''}"><span></span></span>` });
}

function renderSettings() {
  const c = document.getElementById('settings-page');
  if (!c) return;
  const s = appSettings(), b = brand(), u = state.currentUser || {};
  const dark = isDark();
  const low = lowStockLevel();
  c.innerHTML = `
    <div class="page-head set-head">
      <button class="round-btn back-btn" onclick="closeSettings()" aria-label="Back" title="Back">${ic('chevron', 18, 2.2)}</button>
      <div class="page-head-text"><span class="page-title">Settings</span><span class="page-date">Business profile, tax and preferences</span></div>
    </div>

    <button class="set-hero" type="button" onclick="openProfileEditor()" aria-label="Edit business profile">
      <span class="set-logo${b.logo ? ' has-logo' : ''}">${brandMarkHTML(b)}</span>
      <span class="set-hero-text">
        <span class="set-hero-name">${esc(b.name)}</span>
        <span class="set-hero-sub">${b.tagline ? esc(b.tagline) : 'Add a tagline'}</span>
        <span class="set-hero-link">${ic('edit', 13)}Edit name, tagline &amp; logo</span>
      </span>
      ${SET_CHEV()}
    </button>

    <div class="set-section">
      <span class="set-group-title">Tax</span>
      <div class="set-group">
        ${setSwitchRow('vatSales', { icon: 'trend', tone: 'ic-green', title: 'VAT on sales', sub: s.vatSales ? `${pctLabel(s.vatRate)} added to every sale` : 'Sales are saved without VAT' })}
        ${setSwitchRow('vatPurchases', { icon: 'truck', tone: 'ic-blue', title: 'VAT on vendor purchases', sub: s.vatPurchases ? `${pctLabel(s.vatRate)} added to every purchase` : 'Purchases are saved without VAT' })}
        ${setRow({ icon: 'dollar', title: 'VAT rate', sub: 'Used whenever VAT is on', end: setValue(pctLabel(s.vatRate)), onclick: "openNumberSetting('vatRate')" })}
      </div>
    </div>

    <div class="set-section">
      <span class="set-group-title">Inventory</span>
      <div class="set-group">
        ${setRow({ icon: 'alert', tone: 'ic-red', title: 'Low stock alert', sub: low > 0 ? `Warn when ${plural(low, 'unit')} or fewer are left` : 'Low stock warnings are off', end: setValue(low > 0 ? plural(low, 'unit') : 'Off'), onclick: "openNumberSetting('lowStock')" })}
      </div>
    </div>

    <div class="set-section">
      <span class="set-group-title">Appearance</span>
      <div class="set-group">
        ${setRow({ icon: dark ? 'moon' : 'sun', tone: 'ic-purple', title: 'Theme', sub: 'Saved on this device',
          end: `<span class="set-seg" role="group" aria-label="Theme">
            <button type="button" class="${dark ? '' : 'on'}" aria-pressed="${!dark}" onclick="setTheme('light')">Light</button>
            <button type="button" class="${dark ? 'on' : ''}" aria-pressed="${dark}" onclick="setTheme('dark')">Dark</button>
          </span>` })}
      </div>
    </div>

    <div class="set-section">
      <span class="set-group-title">Account</span>
      <div class="set-group">
        ${setRow({ icon: 'user', tone: 'ic-blue', title: esc(u.displayName || 'Signed in as'), sub: esc(u.email || '') })}
        ${setRow({ icon: 'bolt', title: 'Change password', sub: 'We’ll email you a reset link', end: SET_CHEV(), onclick: 'askPasswordReset()' })}
        ${setRow({ icon: 'power', tone: 'ic-red', title: 'Sign out', cls: 'danger', onclick: 'askSignOut()' })}
      </div>
    </div>

    <p class="set-foot">${esc(b.name)} · Inventory management<br>Your data syncs to the cloud and only you can see it.</p>`;
}

function setTheme(mode) {
  if ((mode === 'dark') !== isDark()) toggleTheme();
  if (state.currentPage === 'settings') renderSettings();
}

// ── Business profile editor (name, tagline, logo) ───────────────────────────
function openProfileEditor() {
  const b = brand();
  state.logoDraft = b.logo;
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic('store')}</span>Business profile</div>
    <form id="profile-form" onsubmit="return saveProfile(event)">
      <div class="form-grid">
        <div class="logo-edit">
          <span class="set-logo big${b.logo ? ' has-logo' : ''}" id="logo-preview">${brandMarkHTML(b)}</span>
          <div class="logo-actions">
            <span class="set-title">Logo</span>
            <div class="logo-btns">
              <label class="btn btn-soft btn-sm">${ic('camera', 14)}<span id="logo-pick-label">${b.logo ? 'Change' : 'Upload logo'}</span><input type="file" accept="image/*" onchange="pickLogo(this)" hidden></label>
              <button type="button" class="btn btn-ghost btn-sm" id="logo-remove" onclick="removeLogoDraft()"${b.logo ? '' : ' hidden'}>Remove</button>
            </div>
            <span class="hint">PNG or JPG · a square image looks best</span>
          </div>
        </div>
        <div class="field">
          <label for="set-name">App name <span class="req">*</span></label>
          <input type="text" id="set-name" name="appName" maxlength="40" value="${esc(b.name)}" placeholder="e.g. Ateer" required oninput="updateLogoPreview()">
        </div>
        <div class="field">
          <label for="set-tagline">Tagline <span class="hint">(optional · shown above the name)</span></label>
          <input type="text" id="set-tagline" name="tagline" maxlength="40" value="${esc(b.tagline)}" placeholder="e.g. Musaddique's">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btn-save-profile">Save</button>
        </div>
      </div>
    </form>`);
}

function updateLogoPreview() {
  const el = document.getElementById('logo-preview');
  if (!el) return;
  const name = (document.getElementById('set-name')?.value || '').trim() || DEFAULT_SETTINGS.appName;
  el.innerHTML = brandMarkHTML({ name, logo: state.logoDraft });
  el.classList.toggle('has-logo', !!state.logoDraft);
  const rm = document.getElementById('logo-remove');
  if (rm) rm.hidden = !state.logoDraft;
  const lbl = document.getElementById('logo-pick-label');
  if (lbl) lbl.textContent = state.logoDraft ? 'Change' : 'Upload logo';
}
function removeLogoDraft() { state.logoDraft = ''; updateLogoPreview(); }

// Shrinks the picked image to 256px so it stays small enough to save with the settings
function pickLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('Choose an image file', 'error'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const w0 = img.naturalWidth || max, h0 = img.naturalHeight || max;
      const scale = Math.min(1, max / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const ctx = canvas.getContext('2d');
      let data = '';
      if (!/jpe?g/i.test(file.type)) {                 // keep transparency for PNG / WebP / SVG logos
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL('image/png');
      }
      if (!data || data.length > 200000) {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL('image/jpeg', 0.85);
      }
      state.logoDraft = data;
      updateLogoPreview();
    };
    img.onerror = () => showToast('That file is not an image', 'error');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const appName = form.elements.appName.value.trim();
  const tagline = form.elements.tagline.value.trim();
  if (!appName) { showToast('Enter the app name', 'error'); form.elements.appName.focus(); return false; }
  const btn = document.getElementById('btn-save-profile');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const ok = await saveSettingsPatch({ appName, tagline, logo: state.logoDraft || '' }, 'Business profile saved');
  if (ok) closeModal();
  else if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  return false;
}

// ── Number settings (VAT rate, low stock level) ─────────────────────────────
const NUMBER_SETTINGS = {
  vatRate:  { title: 'VAT rate', icon: 'dollar', label: 'VAT rate', unit: '%', min: 0, max: 100, step: '0.01', decimal: true,
              note: 'Added on top of the subtotal when VAT is on. Saved sales and purchases keep the rate they used.' },
  lowStock: { title: 'Low stock alert', icon: 'alert', label: 'Warn when stock is at or below', unit: 'Units', min: 0, max: 100000, step: '1', decimal: false,
              note: 'Products at or below this number show as “Low stock” on the Dashboard and Inventory. Set 0 to turn it off.' },
};
function openNumberSetting(key) {
  const cfg = NUMBER_SETTINGS[key];
  if (!cfg) return;
  const value = key === 'lowStock' ? lowStockLevel() : appSettings()[key];
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic(cfg.icon)}</span>${cfg.title}</div>
    <form onsubmit="return saveNumberSetting(event, '${key}')">
      <div class="form-grid">
        <div class="field">
          <label for="num-setting">${cfg.label}</label>
          <div class="sar-field"><span>${cfg.unit}</span><input type="number" id="num-setting" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" inputmode="${cfg.decimal ? 'decimal' : 'numeric'}" value="${esc(value)}" required></div>
        </div>
        <p class="modal-note" style="margin:0">${cfg.note}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </div>
    </form>`);
  const input = document.getElementById('num-setting');
  if (input) input.select();
}
async function saveNumberSetting(event, key) {
  event.preventDefault();
  const cfg = NUMBER_SETTINGS[key];
  const raw = document.getElementById('num-setting').value;
  const n = cfg.decimal ? parseFloat(raw) : parseInt(raw, 10);
  if (raw === '' || isNaN(n) || n < cfg.min || n > cfg.max) {
    showToast(`Enter a number from ${cfg.min} to ${cfg.max.toLocaleString('en-US')}`, 'error'); return false;
  }
  closeModal();
  saveSettingsPatch({ [key]: n }, `${cfg.title} saved`);
  return false;
}

// ── Account ─────────────────────────────────────────────────────────────────
function askPasswordReset() {
  const email = state.currentUser?.email || '';
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic('bolt')}</span>Change password</div>
    <p class="modal-note">We'll send a link to <b>${esc(email)}</b>. Open it to choose a new password.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-send-reset" onclick="sendPasswordReset()">Send link</button>
    </div>`);
}
async function sendPasswordReset() {
  const btn = document.getElementById('btn-send-reset');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await auth.sendPasswordResetEmail(state.currentUser.email);
    closeModal();
    showToast('Reset link sent — check your email');
  } catch (e) {
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = 'Send link'; }
    showToast('Could not send the reset email', 'error');
  }
}
function askSignOut() {
  showModal(`
    <div class="modal-title"><span class="ic ic-red">${ic('power')}</span>Sign out</div>
    <p class="modal-note">You can sign back in any time — your data stays saved in the cloud.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="closeModal(); handleLogout()">Sign out</button>
    </div>`);
}

applyBranding();   // show the saved name / logo straight away (also on the sign-in screen)

function branchById(id) {
  return state.branches.find(b => b.id === id)
    || (id === MAIN_BRANCH ? { id: MAIN_BRANCH, name: 'Main branch', place: 'Main store', main: true } : null);
}
function shortBranch(name) { return String(name || '').replace(/\s+branch$/i, ''); }
function stockAt(p, branchId) {
  if (p.stock && typeof p.stock === 'object') return Number(p.stock[branchId] || 0);
  return branchId === MAIN_BRANCH ? Number(p.quantity || 0) : 0;
}
function branchUnits(branchId) { return state.products.reduce((s, p) => s + stockAt(p, branchId), 0); }
function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function whenLabel(date, ts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return toDate(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function dayLabel(iso) {
  if (iso === todayISO()) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function newSaleDraft() {
  return { customer: '', fromId: MAIN_BRANCH, toId: null, pay: 'cash', date: todayISO(), note: '', deliveryNote: '', cart: [] };
}
function sellDraft() { if (!state.draft)  state.draft  = newSaleDraft(); return state.draft; }
function moveDraft() { if (!state.tdraft) state.tdraft = newSaleDraft(); return state.tdraft; }
// The draft for the page you're on: Sell (new sale) or Transfer stock
function saleDraft() { return state.salesMode === 'move' ? moveDraft() : sellDraft(); }

function draftTotals() {
  const d = saleDraft();
  const units = d.cart.reduce((s, l) => s + l.qty, 0);
  const sub = d.cart.reduce((s, l) => {
    const p = state.products.find(x => x.id === l.productId);
    const price = state.salesMode === 'sell' ? Number(l.price) || 0 : Number(p?.price ?? p?.costPrice ?? 0);
    return s + price * l.qty;
  }, 0);
  return { units, sub, ...withVat(sub, state.salesMode === 'sell' ? vatPct('sales') : 0) };
}

function saleInvoiceNo(s) {
  if (s.invoiceNo) return s.invoiceNo;
  const idx = [...state.sales].sort((a, b) => toDate(a.timestamp) - toDate(b.timestamp)).findIndex(x => x.id === s.id);
  return 'INV-' + String(idx + 1).padStart(4, '0');
}

// Keep the draft valid when products / branches change underneath it
function syncDraft() {
  const d = saleDraft();
  d.cart = d.cart.filter(l => state.products.some(p => p.id === l.productId));
  if (!branchById(d.fromId)) d.fromId = MAIN_BRANCH;
  if (d.toId && (!branchById(d.toId) || d.toId === d.fromId)) d.toId = null;
  if (!d.toId) d.toId = (state.branches.find(b => b.id !== d.fromId) || {}).id || null;
}

function salesContainer() { return document.getElementById(state.salesMode === 'move' ? 'transfer-page' : 'sales-page'); }

function renderSales() {
  const container = salesContainer();
  if (!container) return;
  // Only one of Sell / Transfer is drawn at a time, so element ids never clash
  const other = document.getElementById(state.salesMode === 'move' ? 'sales-page' : 'transfer-page');
  if (other) other.innerHTML = '';
  syncDraft();
  const d    = saleDraft();
  const sell = state.salesMode === 'sell';
  const from = branchById(d.fromId);
  const to   = d.toId ? branchById(d.toId) : null;
  const t    = draftTotals();

  const brIc = (b) => `<span class="ic40 ${b && b.main ? 'ic-orange' : 'ic-ring'}">${ic('store')}</span>`;

  const lines = d.cart.map((l, i) => {
    const p = state.products.find(x => x.id === l.productId);
    const av = stockAt(p, d.fromId);
    const over = l.qty > av;
    const priceSet = l.price !== '' && l.price != null && !isNaN(l.price);
    const sub = sell
      ? `<button class="price-link${priceSet ? '' : ' missing'}" onclick="openSheet('price', ${i})">${priceSet ? 'SAR ' + fmtNum(l.price) : 'Set price'}</button> · ${av} in stock`
      : `${av} available at ${esc(shortBranch(from.name))}`;
    return `
      <div class="cart-line" data-line="${i}">
        <span class="ini">${esc(initials(p.name))}</span>
        <div class="cl-text"><span class="cl-name">${esc(p.name)}</span><span class="cl-sub${over ? ' over' : ''}">${sub}</span></div>
        ${qtyBoxHTML(`qty-s-${i}`, l.qty, p.name, `typeSaleQty(${i}, this)`, `fixSaleQty(${i}, this)`, `removeSaleLine(${i})`)}
      </div>`;
  }).join('');

  withFocusKept(() => { container.innerHTML = `
    ${sell ? `
    <div class="page-head" style="padding:4px 4px 2px"><div class="page-head-text"><span class="page-title">Sell</span><span class="page-date">New sale to a customer</span></div></div>` : `
    <div class="page-head set-head">
      <button class="round-btn back-btn" onclick="navigateTo('inventory')" aria-label="Back to Inventory" title="Back">${ic('chevron', 18, 2.2)}</button>
      <div class="page-head-text"><span class="page-title">Transfer stock</span><span class="page-date">Move products from one shop to another</span></div>
    </div>`}

    ${sell ? `
    <div class="box move-card">
      ${ddButton({ onclick: "openSheet('customer')", icon: 'user', tone: 'ic-blue', label: 'Customer · full name', value: esc(d.customer || 'Walk-in customer'), sub: d.customer ? 'Tap to change' : 'Tap to write a name', id: 'dd-customer' })}
      ${ddButton({ onclick: "openSheet('branch', 'from')", icon: 'store', tone: 'ic-orange', label: 'Selling from', value: esc(from.name), sub: `${ic('pin', 11)}${esc(from.place || '—')}`, id: 'dd-from' })}
      <label class="br-btn dd date-dd" for="sale-date">
        <span class="ic40 ic-green">${ic('calendar')}</span>
        <div class="pr-text"><span class="pr-label">Date</span><span class="pr-value">${dayLabel(d.date)}</span><span class="pr-place">${fmtDate(isoToDate(d.date))}</span></div>
        <span class="br-chev">${ic('chevron', 16, 2.2)}</span>
        <input type="date" id="sale-date" value="${d.date}" max="${todayISO()}" onchange="setSaleDate(this.value)" aria-label="Sale date">
      </label>
      <div class="note-field" style="padding:4px 2px 0">
        <label class="pr-label" for="delivery-note">Delivery note <span class="hint">(optional)</span></label>
        <input id="delivery-note" class="note-input" value="${esc(d.deliveryNote || '')}" placeholder="e.g. Deliver to the back door, call on arrival" autocomplete="off" oninput="saleDraft().deliveryNote = this.value">
      </div>
    </div>` : `
    <div class="box move-card">
      <button class="br-btn" onclick="openSheet('branch', 'from')">${brIc(from)}<div class="pr-text"><span class="pr-label">From</span><span class="pr-value">${esc(from.name)}</span><span class="pr-place">${ic('pin', 11)}${esc(from.place || '—')}</span></div><span class="br-chev">${ic('chevron', 16, 2.2)}</span></button>
      <button class="swap-btn" onclick="swapBranches()" title="Swap" aria-label="Swap branches">${ic('swapV', 16, 2.2)}</button>
      <button class="br-btn" onclick="openSheet('branch', 'to')">${to ? brIc(to) : `<span class="ic40 ic-ring">${ic('plus')}</span>`}<div class="pr-text"><span class="pr-label">To</span><span class="pr-value">${to ? esc(to.name) : 'Choose a branch'}</span><span class="pr-place">${ic('pin', 11)}${to ? esc(to.place || '—') : 'Add a branch to transfer stock'}</span></div><span class="br-chev">${ic('chevron', 16, 2.2)}</span></button>
    </div>`}

    <div class="box">
      <div class="box-head"><span class="box-title">${sell ? 'Items' : 'Products to send'}</span><span class="box-sub" data-t="units">${plural(t.units, 'unit')}</span></div>
      ${d.cart.length ? `<div class="cart-lines">${lines}</div>` : ''}
      <button class="add-line-btn" onclick="openSheet('product')">${ic('plus', 14, 2.4)}Add product</button>
    </div>

    ${sell ? `
    <div class="box">
      <span class="box-title">Payment</span>
      <div class="pay3">${PAYMENT_TYPES.map(pt =>
        `<button class="pay3-btn${d.pay === pt.id ? ' active' : ''}" onclick="setSalePay('${pt.id}')">${ic(PAY_IC[pt.id], 18, 1.9)}${pt.label}</button>`).join('')}</div>
      ${totalsHTML(t)}
      <button class="btn btn-primary btn-block cta" id="btn-complete-sale" onclick="completeSale()" ${state.saleSubmitting ? 'disabled' : ''}>${ic('check', 16, 2.6)}${state.saleSubmitting ? 'Saving…' : 'Complete sale'}</button>
    </div>` : `
    <div class="box">
      <div class="note-field"><span class="pr-label">Note</span><input id="transfer-note" class="note-input" value="${esc(d.note)}" placeholder="e.g. Weekend restock" oninput="saleDraft().note = this.value"></div>
      <div class="move-sum"><span data-t="movesum">${plural(d.cart.length, 'product')} · ${plural(t.units, 'unit')}</span><span class="num" data-t="value">Value SAR ${fmtNum(t.sub)}</span></div>
      <button class="btn btn-primary btn-block cta" id="btn-send-transfer" onclick="sendTransfer()" ${state.saleSubmitting ? 'disabled' : ''}>${ic('arrowR', 16, 2.4)}${state.saleSubmitting ? 'Sending…' : 'Send transfer'}</button>
    </div>`}

    ${state.salesToast ? `<div class="inline-toast"><span class="it-ic">${ic('check', 13, 3)}</span><span>${esc(state.salesToast)}</span></div>` : ''}

    <div class="box">
      <div class="box-head"><span class="box-title">${sell ? 'Recent sales' : 'Recent transfers'}</span>
        <button class="box-link" onclick="openHistory({ type: '${sell ? 'sale' : 'transfer'}' })">See all</button></div>
      <div class="hist" id="sales-list-container">${sell ? salesHistory() : transfersHistory()}</div>
    </div>`; });
}

function salesHistory() {
  if (!state.sales.length) return `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('bolt', 20)}</span><span class="empty-title">No sales yet</span><span class="empty-text">Completed sales will appear here</span></div>`;
  return state.sales.slice(0, 3).map(renderSaleCard).join('');
}

function transfersHistory() {
  if (!state.transfers.length) return `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('swapH', 20)}</span><span class="empty-title">No transfers yet</span><span class="empty-text">Stock you move between branches will appear here</span></div>`;
  return state.transfers.slice(0, 3).map(transferCardHTML).join('');
}

function transferCardHTML(tr) {
  const status = tr.status === 'received' ? 'received' : 'in_transit';
  const open = !!state.expandedTransfers[tr.id];
  return `
    <div class="hist-item${open ? ' open' : ''}">
      <button class="hist-row" onclick="toggleTransferExpand('${tr.id}')" aria-expanded="${open}">
        <span class="ic ic-orange">${ic('swapH', 15)}</span>
        <div class="pr-text"><span class="cl-name">${esc(shortBranch(tr.fromName))} → ${esc(shortBranch(tr.toName))}</span><span class="pr-label">${esc(tr.transferNo || 'TR')} · ${plural(tr.units || 0, 'unit')} · ${whenLabel(toDate(tr.timestamp), tr.timestamp)}</span></div>
        <div class="sr-end"><span class="h-amt num">${fmt(tr.value || 0)}</span><span class="htag ${status}">${TAG_LABEL[status]}</span></div>
        <span class="dd-chev">${ic('chevron', 16, 2.2)}</span>
      </button>
      ${open ? transferDetailHTML(tr) : ''}
    </div>`;
}

function toggleTransferExpand(id) { state.expandedTransfers[id] = !state.expandedTransfers[id]; renderCurrentPage(); }

function transferDetailHTML(tr) {
  const received = tr.status === 'received';
  return `
        <div class="hist-detail">
          <div class="dd-facts">
            ${fact('Transfer', esc(tr.transferNo || 'Transfer'))}
            ${fact('Sent', fmtDate(toDate(tr.timestamp)))}
            ${fact('From', esc(tr.fromName || '—'))}
            ${fact('To', esc(tr.toName || '—'))}
            ${fact('Status', received ? `Received${tr.receivedAt ? ' ' + fmtDate(toDate(tr.receivedAt)) : ''}` : 'In transit')}
            ${fact('Sent by', esc(tr.recordedBy || 'unknown'))}
          </div>
          ${(tr.items || []).map(it => `
            <div class="line-item">
              <div class="li-text"><b>${esc(it.productName)}</b><small>${plural(it.quantity, 'unit')} × ${fmt(Number(it.unitValue) || 0)}</small></div>
              <span class="amt">${fmt((Number(it.unitValue) || 0) * it.quantity)}</span>
            </div>`).join('')}
          ${tr.note ? `<div class="sheet-note" style="margin-bottom:8px">${ic('note', 13)} ${esc(tr.note)}</div>` : ''}
          <div class="totals">
            <div class="tl"><span>Units</span><span class="num">${plural(tr.units || 0, 'unit')}</span></div>
            <div class="tl total"><span>Value</span><span class="num">${fmt(tr.value || 0)}</span></div>
          </div>
          ${received ? '' : `<button class="btn btn-primary btn-block cta" onclick="receiveTransfer('${tr.id}')">${ic('check', 16, 2.6)}Mark as received at ${esc(shortBranch(tr.toName))}</button>`}
          <div class="dd-actions">
            <button class="btn btn-ghost btn-sm" onclick="docAction('transfer', '${tr.id}', 'share', this)">${ic('share', 14)}Share</button>
            <button class="btn btn-ghost btn-sm" onclick="docAction('transfer', '${tr.id}', 'download', this)">${ic('download', 14)}PDF</button>
          </div>
          <button class="btn btn-danger btn-sm del-btn" onclick="askDeleteTransfer('${tr.id}')">${ic('trash', 14)}Delete transfer</button>
        </div>`;
}


function renderSaleCard(s) {
  const items  = s.items ?? [];
  const isOpen = state.expandedSales[s.id];
  const pt     = payOf(s);
  const status = saleStatus(s);
  const back   = returnedByLine(s);
  const returns = saleReturns(s);
  const subtotal = typeof s.subtotal === 'number' ? s.subtotal : items.reduce((a, it) => a + (it.priceAtSale ?? 0) * it.quantity, 0);
  const vat      = typeof s.vatAmount === 'number' ? s.vatAmount : 0;
  const tone = status === 'paid' ? 'ic-green' : status === 'partial_return' ? 'ic-orange' : 'ic-red';
  const canReturn = status === 'paid' || status === 'partial_return';
  return `
    <div class="hist-item${isOpen ? ' open' : ''}">
      <button class="hist-row" onclick="toggleSaleExpand('${s.id}')" aria-expanded="${isOpen ? 'true' : 'false'}">
        <span class="ic ${tone}">${ic(status === 'paid' ? 'arrowUR' : 'refund', 15)}</span>
        <div class="pr-text"><span class="cl-name">${esc(s.customerName || 'Walk-in customer')}</span><span class="pr-label">${esc(saleInvoiceNo(s))} · ${whenLabel(recordDate(s), s.timestamp)} · ${PAY_NAME[pt]}</span></div>
        <div class="sr-end"><span class="h-amt num">${fmt(saleNetTotal(s))}</span><span class="htag ${status}">${TAG_LABEL[status]}</span></div>
        <span class="dd-chev">${ic('chevron', 16, 2.2)}</span>
      </button>
      ${isOpen ? `
        <div class="hist-detail">
          <div class="dd-facts">
            ${fact('Invoice', esc(saleInvoiceNo(s)))}
            ${fact('Date', fmtDate(recordDate(s)))}
            ${fact('Customer', esc(s.customerName || 'Walk-in customer'))}
            ${fact('Branch', esc(s.branchName || 'Main branch'))}
            ${fact('Payment', PAY_NAME[pt])}
            ${fact('Recorded by', esc(s.recordedBy || 'unknown'))}
          </div>
          ${s.deliveryNote ? `<div class="sheet-note" style="margin-bottom:8px">${ic('note', 13)} ${esc(s.deliveryNote)}</div>` : ''}
          ${items.map((it, i) => `
            <div class="line-item">
              <div class="li-text"><b>${esc(it.productName)}</b><small>${it.quantity} × ${it.priceAtSale != null ? fmt(it.priceAtSale) : '—'}${back[i] ? ` · <span class="ret-note">${back[i]} returned</span>` : ''}</small></div>
              <span class="amt">${it.priceAtSale != null ? fmt(it.priceAtSale * it.quantity) : '—'}</span>
            </div>`).join('')}
          <div class="totals">
            ${vat > 0 ? `<div class="tl"><span>Subtotal</span><span class="num">${fmt(subtotal)}</span></div><div class="tl"><span>VAT ${pctLabel(s.vatRate ?? 15)}</span><span class="num">${fmt(vat)}</span></div>` : ''}
            <div class="tl total"><span>Total</span><span class="num">${fmt(saleTotal(s))}</span></div>
          </div>
          ${returns.length ? `
          <div class="dd-block ret-block">
            <span class="dd-title">Returns</span>
            ${returns.map(r => `
              <div class="dd-line"><span>${fmtDate(isoToDate(r.date))} · ${(r.items || []).map(it => `${it.quantity} × ${esc(it.productName)}`).join(', ')}${r.note ? ` <small>· ${esc(r.note)}</small>` : ''}</span><b class="num neg">−${fmt(Number(r.total) || 0)}</b></div>`).join('')}
            <div class="dd-line total"><span>Net total</span><b class="num">${fmt(saleNetTotal(s))}</b></div>
          </div>` : ''}
          <div class="dd-actions">
            ${canReturn ? `<button class="btn btn-soft btn-sm" onclick="openReturn('${s.id}')">${ic('refund', 14)}Return</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="docAction('sale', '${s.id}', 'share', this)">${ic('share', 14)}Share</button>
            <button class="btn btn-ghost btn-sm" onclick="docAction('sale', '${s.id}', 'download', this)">${ic('download', 14)}PDF</button>
          </div>
          <button class="btn btn-danger btn-sm del-btn" onclick="askDeleteSale('${s.id}')">${ic('trash', 14)}Delete sale</button>
        </div>` : ''}
    </div>`;
}

function fact(label, value) { return `<div class="fact"><span>${label}</span><b>${value}</b></div>`; }

// ── Returns: full (everything left) or partial (choose how many of each item) ──
function returnableLeft(s) {
  const back = returnedByLine(s);
  return (s.items || []).map((it, i) => Math.max(0, (Number(it.quantity) || 0) - (back[i] || 0)));
}
// Refund for the chosen quantities, with the sale's VAT included proportionally
function returnTotals(s, qtys) {
  const items = s.items || [];
  const gross = items.reduce((a, it) => a + (Number(it.priceAtSale) || 0) * it.quantity, 0);
  const factor = gross > 0 ? saleTotal(s) / gross : 1;
  const sub = items.reduce((a, it, i) => a + (Number(it.priceAtSale) || 0) * (qtys[i] || 0), 0);
  const left = returnableLeft(s);
  const everything = left.every((n, i) => (qtys[i] || 0) >= n);
  let total = Math.round(sub * factor * 100) / 100;
  if (everything) total = Math.round((saleTotal(s) - returnedAmount(s)) * 100) / 100;   // no rounding leftovers
  const units = qtys.reduce((a, q) => a + (q || 0), 0);
  return { sub, vat: Math.max(0, Math.round((total - sub) * 100) / 100), total, units, everything };
}

function openReturn(id) {
  const s = state.sales.find(x => x.id === id); if (!s) return;
  const left = returnableLeft(s);
  if (!left.some(n => n > 0)) { showToast('Everything in this sale is already returned', 'error'); return; }
  state.ret = { id, mode: 'full', qty: left.map(() => 0), note: '' };
  const branch = s.branchName || 'Main branch';
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic('refund')}</span>Return items</div>
    <p class="modal-note" style="margin-bottom:12px">${esc(saleInvoiceNo(s))} · ${esc(s.customerName || 'Walk-in customer')} · ${fmtDate(recordDate(s))}</p>
    <div id="ret-body"></div>
    <div class="field" style="margin-top:14px">
      <label for="ret-note">Reason <span class="hint">(optional)</span></label>
      <input type="text" id="ret-note" maxlength="120" placeholder="e.g. Damaged, wrong size" autocomplete="off" oninput="if (state.ret) state.ret.note = this.value">
    </div>
    <p class="modal-note" style="margin:12px 0">Returned items go back into stock at <b>${esc(branch)}</b>.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-confirm-return" onclick="confirmReturn()">${ic('check', 16, 2.6)}Confirm return</button>
    </div>`);
  renderReturnBody();
  if (document.activeElement && document.activeElement.id === 'ret-note') document.activeElement.blur();   // don't pop the keyboard
}

function setReturnMode(mode) { if (!state.ret) return; state.ret.mode = mode; renderReturnBody(); }

function currentReturnQtys(s) {
  const left = returnableLeft(s);
  return state.ret.mode === 'full' ? left : state.ret.qty.map((q, i) => Math.min(q || 0, left[i]));
}

function renderReturnBody() {
  const r = state.ret; const box = document.getElementById('ret-body');
  const s = r && state.sales.find(x => x.id === r.id);
  if (!s || !box) return;
  const full = r.mode === 'full';
  const left = returnableLeft(s);
  box.innerHTML = `
    <div class="mode-seg ret-seg">
      <button class="mode-btn${full ? ' active' : ''}" onclick="setReturnMode('full')">Full return</button>
      <button class="mode-btn${full ? '' : ' active'}" onclick="setReturnMode('partial')">Partial return</button>
    </div>
    <div class="ret-lines">
      ${(s.items || []).map((it, i) => left[i] ? `
        <div class="cart-line ret-line">
          <span class="ini">${esc(initials(it.productName))}</span>
          <div class="cl-text"><span class="cl-name">${esc(it.productName)}</span><span class="cl-sub">${fmt(Number(it.priceAtSale) || 0)} each · ${left[i] === it.quantity ? `${it.quantity} sold` : `${left[i]} of ${it.quantity} left`}</span></div>
          ${full ? `<span class="ret-qty num">× ${left[i]}</span>`
                 : qtyBoxHTML(`ret-q-${i}`, r.qty[i], it.productName, `typeReturnQty(${i}, this)`, `fixReturnQty(${i}, this)`, null)}
        </div>` : '').join('')}
    </div>
    ${full ? '' : `<p class="hint" style="margin-top:8px">Type how many of each item came back — leave the rest empty.</p>`}
    <div class="totals" id="ret-totals" style="margin-top:12px">${returnTotalsHTML(s)}</div>`;
}

function returnTotalsHTML(s) {
  const t = returnTotals(s, currentReturnQtys(s));
  return `
      <div class="tl"><span>Items</span><span class="num">${plural(t.units, 'unit')}</span></div>
      ${t.vat > 0 ? `<div class="tl"><span>Subtotal</span><span class="num">${fmt(t.sub)}</span></div><div class="tl"><span>VAT</span><span class="num">${fmt(t.vat)}</span></div>` : ''}
      <div class="lc-div"></div>
      <div class="tl total"><span>Refund</span><span class="num">${fmt(t.total)}</span></div>`;
}

function typeReturnQty(i, el) {
  const r = state.ret; const s = r && state.sales.find(x => x.id === r.id); if (!s) return;
  const max = returnableLeft(s)[i] || 0;
  let q = readQty(el);
  if (q > max) { q = max; el.value = String(max); }
  r.qty[i] = q;
  const box = document.getElementById('ret-totals');
  if (box) box.innerHTML = returnTotalsHTML(s);
}
function fixReturnQty(i, el) { const q = state.ret ? state.ret.qty[i] : 0; el.value = q ? String(q) : ''; }

async function confirmReturn() {
  const r = state.ret; const s = r && state.sales.find(x => x.id === r.id);
  if (!s) { closeModal(); return; }
  const qtys = currentReturnQtys(s);
  const items = [];
  (s.items || []).forEach((it, i) => {
    if (qtys[i] > 0) items.push({ idx: i, productId: it.productId || null, productName: it.productName || 'Item', quantity: qtys[i], priceAtSale: Number(it.priceAtSale) || 0 });
  });
  if (!items.length) { showToast('Type how many items came back', 'error'); document.querySelector('#ret-body .qty-input')?.focus(); return; }
  const t = returnTotals(s, qtys);
  const ret = {
    id: uid(), date: todayISO(), at: Date.now(), type: t.everything ? 'full' : 'partial',
    items, subtotal: Math.round(t.sub * 100) / 100, vat: t.vat, total: t.total,
    note: (r.note || '').trim(), by: state.currentUser?.email || 'unknown',
  };
  const FV = firebase.firestore.FieldValue, now = FV.serverTimestamp();
  const branch = s.branchId || MAIN_BRANCH;
  const batch = db.batch();
  batch.update(userSalesCol().doc(s.id), { returns: FV.arrayUnion(ret), returnedTotal: FV.increment(ret.total), updatedAt: now });
  items.forEach(it => {
    if (!it.productId || !state.products.some(p => p.id === it.productId)) return;   // product deleted since
    batch.update(userProductsCol().doc(it.productId), {
      quantity: FV.increment(it.quantity), [`stock.${branch}`]: FV.increment(it.quantity), updatedAt: now,
    });
  });
  const btn = document.getElementById('btn-confirm-return');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await batch.commit();
    state.ret = null;
    closeModal();
    notify(`Returned ${plural(t.units, 'unit')} · refund ${fmt(t.total)}`);
  } catch (e) {
    console.error(e);
    if (btn) { btn.disabled = false; btn.innerHTML = `${ic('check', 16, 2.6)}Confirm return`; }
    showToast('Failed to save the return', 'error');
  }
}

function toggleSaleExpand(id) {
  state.expandedSales[id] = !state.expandedSales[id];
  renderCurrentPage();
}

// Old dashboard links call these
function renderSalesList() { renderSales(); }

// ── Actions ──────────────────────────────────────────────────────────────────
function setSalesMode(mode) { state.salesMode = mode; state.salesToast = ''; renderSales(); }
function setSalePay(id)     { saleDraft().pay = id; renderSales(); }
function setSaleDate(v)     { if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todayISO()) saleDraft().date = v; renderSales(); }

function swapBranches() {
  const d = saleDraft();
  if (!d.toId) { openSheet('branch', 'to'); return; }
  [d.fromId, d.toId] = [d.toId, d.fromId];
  renderSales();
}

// ── Typed quantity boxes (sales, transfers, purchases) ──────────────────────
// Typing updates the numbers in place (no full redraw), so the keyboard stays up.
function qtyBoxHTML(id, qty, name, onType, onDone, onRemove) {
  return `
        <div class="qty-edit">
          <input class="qty-input num" id="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"
            value="${qty || ''}" placeholder="0" aria-label="Quantity of ${esc(name)}"
            oninput="${onType}" onblur="${onDone}" onfocus="this.select()" onkeydown="if (event.key === 'Enter') this.blur()">
          ${onRemove ? `<button class="qty-rm" onclick="${onRemove}" aria-label="Remove ${esc(name)}" title="Remove">${ic('trash', 14, 2.2)}</button>` : ''}
        </div>`;
}
function readQty(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 6);
  if (digits !== el.value) el.value = digits;
  return digits === '' ? 0 : parseInt(digits, 10);
}
function setT(root, key, text) { root.querySelectorAll(`[data-t="${key}"]`).forEach(el => { el.textContent = text; }); }
function totalsHTML(t) {
  return `
      <div class="totals">
        <div class="tl"><span>Subtotal</span><span class="num" data-t="sub">SAR ${fmtNum(t.sub)}</span></div>
        ${t.vatPct ? `<div class="tl"><span>VAT ${pctLabel(t.vatPct)}</span><span class="num" data-t="vat">SAR ${fmtNum(t.vat)}</span></div>` : ''}
        <div class="lc-div"></div>
        <div class="tl total"><span>Total</span><span class="num" data-t="total">SAR ${fmtNum(t.total)}</span></div>
      </div>`;
}
function refreshTotals(root, t) {
  setT(root, 'units', plural(t.units, 'unit'));
  setT(root, 'sub', 'SAR ' + fmtNum(t.sub));
  setT(root, 'vat', 'SAR ' + fmtNum(t.vat));
  setT(root, 'total', 'SAR ' + fmtNum(t.total));
}

function refreshSaleNumbers() {
  const page = salesContainer(); if (!page) return;
  const d = saleDraft(), t = draftTotals();
  refreshTotals(page, t);
  setT(page, 'movesum', `${plural(d.cart.length, 'product')} · ${plural(t.units, 'unit')}`);
  setT(page, 'value', `Value SAR ${fmtNum(t.sub)}`);
  d.cart.forEach((l, i) => {
    const p = state.products.find(x => x.id === l.productId);
    const sub = page.querySelector(`[data-line="${i}"] .cl-sub`);
    if (p && sub) sub.classList.toggle('over', l.qty > stockAt(p, d.fromId));
  });
}
function typeSaleQty(i, el) {
  const l = saleDraft().cart[i]; if (!l) return;
  l.qty = readQty(el);
  refreshSaleNumbers();
}
function fixSaleQty(i, el) {
  const l = saleDraft().cart[i]; if (!l) return;
  if (!(l.qty >= 1)) l.qty = 1;              // empty or 0 goes back to 1 — use the bin to remove
  el.value = String(l.qty);
  refreshSaleNumbers();
}
function removeSaleLine(i) {
  saleDraft().cart.splice(i, 1);
  renderSales();
}

function addLine(productId) {
  const d = saleDraft();
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const existing = d.cart.find(l => l.productId === productId);
  if (existing) existing.qty += 1;
  else d.cart.push({ productId, qty: 1, price: p.price != null ? String(p.price) : '' });
  closeSheet();
  renderSales();
}

// Confirmation that shows on whichever page you're on
function notify(msg) {
  if (state.currentPage === 'sales' || state.currentPage === 'transfer') return flashSalesToast(msg);
  if (state.currentPage === 'purchases') return flashPurchasesToast(msg);
  showToast(msg);
  renderCurrentPage();
}

function flashSalesToast(msg) {
  state.salesToast = msg;
  renderSales();
  clearTimeout(flashSalesToast._t);
  flashSalesToast._t = setTimeout(() => { state.salesToast = ''; if (state.currentPage === 'sales' || state.currentPage === 'transfer') renderSales(); }, 3000);
}

async function completeSale() {
  if (state.saleSubmitting) return;
  const d = saleDraft();
  const branch = branchById(d.fromId);
  if (!d.cart.length) { showToast('Add at least one product', 'error'); return; }
  for (const l of d.cart) {
    const p = state.products.find(x => x.id === l.productId);
    if (!(l.qty >= 1)) { showToast(`Enter a quantity for ${p.name}`, 'error'); document.getElementById(`qty-s-${d.cart.indexOf(l)}`)?.focus(); return; }
    if (l.price === '' || l.price == null || isNaN(l.price) || Number(l.price) < 0) { showToast(`Set a price for ${p.name}`, 'error'); return; }
    if (l.qty > stockAt(p, d.fromId)) { showToast(`Only ${stockAt(p, d.fromId)} ${p.name} in stock at ${branch.name}`, 'error'); return; }
  }
  const t = draftTotals();
  const items = d.cart.map(l => {
    const p = state.products.find(x => x.id === l.productId);
    return { productId: p.id, productName: p.name, quantity: l.qty, priceAtSale: Number(l.price) };
  });
  const payName = PAY_NAME[d.pay] || 'Cash';
  state.saleSubmitting = true; renderSales();
  try {
    await recordSale({
      customerName: d.customer || 'Walk-in customer',
      saleDate: d.date,
      deliveryNote: (d.deliveryNote || '').trim(),
      branchId: branch.id, branchName: branch.name,
      paymentType: d.pay, vatIncluded: false,
      subtotal: t.sub, vatAmount: t.vat, vatRate: t.vatPct, total: t.total,
      invoiceNo: 'INV-' + String(state.sales.length + 1).padStart(4, '0'),
      items,
    });
    d.cart = [];
    d.date = todayISO();          // next sale starts on today again
    d.deliveryNote = '';
    state.saleSubmitting = false;
    flashSalesToast(`Sale completed · SAR ${fmtNum(t.total)} · ${payName}`);
  } catch (e) {
    console.error(e);
    state.saleSubmitting = false; renderSales();
    showToast('Failed to record sale', 'error');
  }
}

async function sendTransfer() {
  if (state.saleSubmitting) return;
  const d = saleDraft();
  const from = branchById(d.fromId), to = d.toId ? branchById(d.toId) : null;
  if (!to) { showToast('Choose a branch to send to', 'error'); openSheet('branch', 'to'); return; }
  if (!d.cart.length) { showToast('Add at least one product', 'error'); return; }
  for (const l of d.cart) {
    const p = state.products.find(x => x.id === l.productId);
    if (!(l.qty >= 1)) { showToast(`Enter a quantity for ${p.name}`, 'error'); document.getElementById(`qty-s-${d.cart.indexOf(l)}`)?.focus(); return; }
    if (l.qty > stockAt(p, from.id)) { showToast(`Only ${stockAt(p, from.id)} ${p.name} available at ${from.name}`, 'error'); return; }
  }
  const t = draftTotals();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const items = d.cart.map(l => {
    const p = state.products.find(x => x.id === l.productId);
    return { productId: p.id, productName: p.name, quantity: l.qty, unitValue: Number(p.price ?? p.costPrice ?? 0) };
  });
  batch.set(userTransfersCol().doc(), {
    transferNo: 'TR-' + String(state.transfers.length + 1).padStart(3, '0'),
    fromId: from.id, fromName: from.name, toId: to.id, toName: to.name,
    items, units: t.units, value: t.sub, note: d.note.trim(),
    status: 'in_transit', recordedBy: state.currentUser?.email || 'unknown', timestamp: now,
  });
  // Stock leaves the sending branch now; it arrives when the transfer is received
  items.forEach(it => batch.update(userProductsCol().doc(it.productId), {
    quantity: firebase.firestore.FieldValue.increment(-it.quantity),
    [`stock.${from.id}`]: firebase.firestore.FieldValue.increment(-it.quantity),
    updatedAt: now,
  }));
  state.saleSubmitting = true; renderSales();
  try {
    await batch.commit();
    d.cart = []; d.note = '';
    state.saleSubmitting = false;
    flashSalesToast(`Transfer sent to ${to.name} · ${plural(t.units, 'unit')}`);
  } catch (e) {
    console.error(e);
    state.saleSubmitting = false; renderSales();
    showToast('Failed to send transfer', 'error');
  }
}

async function receiveTransfer(id) {
  const tr = state.transfers.find(x => x.id === id);
  if (!tr || tr.status === 'received') return;
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.update(userTransfersCol().doc(id), { status: 'received', receivedAt: now });
  (tr.items || []).forEach(it => {
    if (!state.products.some(p => p.id === it.productId)) return;   // product deleted meanwhile
    batch.update(userProductsCol().doc(it.productId), {
      quantity: firebase.firestore.FieldValue.increment(it.quantity),
      [`stock.${tr.toId}`]: firebase.firestore.FieldValue.increment(it.quantity),
      updatedAt: now,
    });
  });
  try {
    await batch.commit();
    closeSheet();
    notify(`Received at ${tr.toName} · ${plural(tr.units || 0, 'unit')}`);
  } catch (e) {
    console.error(e);
    showToast('Failed to mark as received', 'error');
  }
}

async function saveBranch() {
  const name  = document.getElementById('branch-name').value.trim();
  const place = document.getElementById('branch-place').value.trim();
  const err   = document.getElementById('err-branch-name');
  if (!name) { err.textContent = 'Branch name is required'; return; }
  if (state.branches.some(b => (b.name || '').toLowerCase() === name.toLowerCase())) { err.textContent = 'A branch with this name already exists'; return; }
  const target = state.sheet && state.sheet.arg;
  try {
    const ref = await userBranchesCol().add({ name, place, main: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    const d = saleDraft();
    if (target === 'to') d.toId = ref.id;
    if (target === 'receive') purchaseDraft().branchId = ref.id;
    if (target === 'inventory') state.invBranch = ref.id;
    closeSheet();
    showToast(`${name} added`);
    renderCurrentPage();
  } catch (e) {
    console.error(e);
    showToast('Failed to add branch', 'error');
  }
}

function savePrice(i) {
  const v = document.getElementById('price-input').value;
  const err = document.getElementById('err-price');
  if (v === '' || isNaN(v) || Number(v) < 0) { err.textContent = 'Enter a valid price'; return; }
  const line = saleDraft().cart[i];
  if (line) line.price = String(Number(v));
  closeSheet();
  renderSales();
}

function pickCustomer(name) {
  if (name !== 'Walk-in customer') unhideName('customer', name);
  saleDraft().customer = name === 'Walk-in customer' ? '' : name;
  closeSheet();
  renderSales();
}

function pickBranch(target, id) {
  const d = saleDraft();
  if (target === 'to') d.toId = id;
  else {
    d.fromId = id;
    if (d.toId === id) d.toId = null;
  }
  closeSheet();
  renderSales();
}

// ── Bottom sheets ────────────────────────────────────────────────────────────
function openSheet(kind, arg) {
  state.sheet = { kind, arg };
  state.sheetQuery = kind === 'customer' ? (saleDraft().customer || '') : '';
  renderSheet();
}

function closeSheet() {
  state.sheet = null;
  closeModal();
}

function renderSheet() {
  const sh = state.sheet;
  if (!sh) return;
  const d = saleDraft();
  const sell = state.salesMode === 'sell';
  let title = '', sub = '', search = '', body = '', footer = '';

  if (sh.kind.startsWith('p-')) {
    const spec = purchaseSheetSpec(sh);
    if (!spec) { closeSheet(); return; }
    ({ title, sub } = spec); search = spec.search || ''; body = spec.body || ''; footer = spec.footer || '';
  } else if (sh.kind === 'branch') {
    title = sh.arg === 'to' ? 'Send to' : sell ? 'Sell from' : 'Send from';
    sub = 'Choose a branch by name or place';
    search = 'Search branch or city';
  } else if (sh.kind === 'product') {
    title = 'Add product';
    sub = sell ? 'Choose a product to sell' : 'Choose a product to send';
    search = 'Search products';
  } else if (sh.kind === 'customer') {
    title = 'Customer';
    sub = 'Write a new customer’s full name, or pick a recent one';
    search = 'Full name';
  } else if (sh.kind === 'price') {
    const line = d.cart[sh.arg];
    const p = line && state.products.find(x => x.id === line.productId);
    title = 'Price';
    sub = p ? `Selling price for ${esc(p.name)}` : '';
    body = `
      <div class="sheet-form">
        <div class="sar-input big"><span>SAR</span><input type="number" id="price-input" min="0" step="0.01" inputmode="decimal" value="${esc(line ? line.price : '')}" placeholder="0.00"></div>
        <span class="err-msg" id="err-price"></span>
        <button class="btn btn-primary btn-block cta" onclick="savePrice(${sh.arg})">${ic('check', 16, 2.6)}Save price</button>
      </div>`;
  } else if (sh.kind === 'addBranch') {
    title = 'Add branch';
    sub = 'Create a new location for your stock';
    body = `
      <div class="sheet-form">
        <div class="field"><label>Branch name <span class="req">*</span></label><input type="text" id="branch-name" placeholder="e.g. Olaya branch" autocomplete="off"><span class="err-msg" id="err-branch-name"></span></div>
        <div class="field"><label>Place <span class="hint">(area, city)</span></label><input type="text" id="branch-place" placeholder="e.g. Olaya St, Riyadh" autocomplete="off"></div>
        <button class="btn btn-primary btn-block cta" onclick="saveBranch()">${ic('check', 16, 2.6)}Save branch</button>
      </div>`;
  } else if (sh.kind === 'editBranch') {
    const b = branchById(sh.arg);
    if (!b) { closeSheet(); return; }
    title = 'Edit branch';
    sub = b.main ? 'Rename your main branch' : 'Change the name or place';
    body = `
      <div class="sheet-form">
        <div class="field"><label for="branch-name">Branch name <span class="req">*</span></label><input type="text" id="branch-name" value="${esc(b.name)}" autocomplete="off" onkeydown="if (event.key === 'Enter') saveBranchEdit('${b.id}')"><span class="err-msg" id="err-branch-name"></span></div>
        <div class="field"><label for="branch-place">Place <span class="hint">(area, city)</span></label><input type="text" id="branch-place" value="${esc(b.place || '')}" autocomplete="off" onkeydown="if (event.key === 'Enter') saveBranchEdit('${b.id}')"></div>
        <button class="btn btn-primary btn-block cta" onclick="saveBranchEdit('${b.id}')">${ic('check', 16, 2.6)}Save changes</button>
        ${b.main ? '' : `<button class="btn btn-danger btn-sm del-btn" onclick="askDeleteBranch('${b.id}')">${ic('trash', 14)}Delete branch</button>`}
      </div>`;
  }

  document.getElementById('modal-container').innerHTML = `
    <div class="sheet-wrap">
      <div class="sheet-scrim" onclick="closeSheet()"></div>
      <div class="sheet" role="dialog" aria-label="${esc(title)}">
        <span class="sheet-handle"></span>
        <div class="sheet-head"><div class="sheet-head-text"><span class="sheet-title">${esc(title)}</span><span class="sheet-sub">${sub}</span></div><button class="sheet-close" onclick="closeSheet()" aria-label="Close">${ic('close', 14, 2.2)}</button></div>
        ${search ? `<div class="sheet-search">${ic('search', 16, 2.2)}<input id="sheet-q" placeholder="${search}" value="${esc(state.sheetQuery)}" autocomplete="off" oninput="state.sheetQuery = this.value; renderSheetList()" onkeydown="if (event.key === 'Enter') { const r = document.querySelector('#sheet-list .sheet-row:not(.dis)'); if (r) r.click(); }" aria-label="${search}"></div>
        <div class="sheet-list" id="sheet-list"></div>` : body}
        ${footer}
      </div>
    </div>`;
  if (search) renderSheetList();
  const first = document.querySelector('#sheet-q, #price-input, #branch-name, #cost-input, #vendor-name');
  if (first && sh.kind === 'editBranch') { first.focus(); first.select(); return; }
  if (first && !['branch', 'p-branch', 'p-detail', 'transfer'].includes(sh.kind)) first.focus();
}

function renderSheetList() {
  const sh = state.sheet;
  const list = document.getElementById('sheet-list');
  if (!sh || !list) return;
  const d = saleDraft();
  const q = state.sheetQuery.trim().toLowerCase();

  if (sh.kind.startsWith('p-')) { renderPurchaseSheetList(sh, list, q); return; }
  if (sh.kind === 'branch') {
    const cur = sh.arg === 'to' ? d.toId : d.fromId;
    const other = state.salesMode === 'sell' ? null : sh.arg === 'to' ? d.fromId : d.toId;
    const rows = state.branches
      .filter(b => !q || `${b.name} ${b.place || ''}`.toLowerCase().includes(q))
      .map(b => {
        const on = b.id === cur, dis = b.id === other;
        return `<div class="sheet-row-wrap">
          <button class="sheet-row${on ? ' on' : ''}${dis ? ' dis' : ''}" ${dis ? 'disabled' : `onclick="pickBranch('${sh.arg}', '${b.id}')"`}>
            <span class="ic40 ${on ? 'ic-white' : b.main ? 'ic-orange' : 'ic-soft'}">${ic('store')}</span>
            <div class="pr-text"><span class="sr-name">${esc(b.name)}${b.main ? '<span class="main-badge">MAIN</span>' : ''}</span><span class="pr-place">${ic('pin', 11)}${esc(b.place || '—')} · ${branchUnits(b.id).toLocaleString()} units</span></div>
            <span class="sr-end-txt${on ? ' on' : ''}">${on ? 'Selected' : dis ? (sh.arg === 'to' ? 'Sending from' : 'Sending to') : ''}</span>
          </button>${branchRowActions(b)}</div>`;
      }).join('');
    list.innerHTML = (rows || `<div class="sheet-empty">No branch matches “${esc(state.sheetQuery)}”</div>`) + `
      <button class="sheet-row" onclick="openSheet('addBranch', '${sh.arg}')">
        <span class="ic40 ic-soft">${ic('plus')}</span>
        <div class="pr-text"><span class="sr-name">Add branch</span><span class="pr-place">Create a new location</span></div>
      </button>`;
  } else if (sh.kind === 'product') {
    const sell = state.salesMode === 'sell';
    const rows = state.products
      .filter(p => !q || (p.name || '').toLowerCase().includes(q))
      .map(p => {
        const av = stockAt(p, d.fromId);
        const inCart = d.cart.some(l => l.productId === p.id);
        const dis = av <= 0;
        return `
          <button class="sheet-row${dis ? ' dis' : ''}" ${dis ? 'disabled' : `onclick="addLine('${p.id}')"`}>
            <span class="ini">${esc(initials(p.name))}</span>
            <div class="pr-text"><span class="sr-name">${esc(p.name)}</span><span class="pr-place">${sell ? (p.price != null ? 'SAR ' + fmtNum(p.price) + ' · ' : '') : ''}${av} in stock at ${esc(shortBranch(branchById(d.fromId).name))}</span></div>
            <span class="sr-end-txt${inCart ? ' on' : ''}">${dis ? 'Out of stock' : inCart ? 'Added' : ''}</span>
          </button>`;
      }).join('');
    list.innerHTML = rows || `<div class="sheet-empty">${state.products.length ? `No product matches “${esc(state.sheetQuery)}”` : 'No products yet — add one in Inventory'}</div>`;
  } else if (sh.kind === 'customer') {
    const typed = state.sheetQuery.trim();
    const recent = [...new Set(state.sales.map(s => s.customerName).filter(n => n && n !== 'Walk-in customer' && !isHidden('customer', n)))].slice(0, 8);
    const names = ['Walk-in customer', ...recent].filter(n => !q || n.toLowerCase().includes(q));
    const current = d.customer || 'Walk-in customer';
    let html = '';
    if (typed && !names.some(n => n.toLowerCase() === typed.toLowerCase())) {
      html += `<button class="sheet-row" onclick="pickCustomer(this.dataset.name)" data-name="${esc(typed)}"><span class="ic40 ic-orange">${ic('plus')}</span><div class="pr-text"><span class="sr-name">Add “${esc(typed)}”</span><span class="pr-place">New customer</span></div></button>`;
    }
    html += names.map(n => `<div class="sheet-row-wrap">
      <button class="sheet-row${n === current ? ' on' : ''}" onclick="pickCustomer(this.dataset.name)" data-name="${esc(n)}">
        <span class="ic40 ${n === current ? 'ic-white' : 'ic-blue'}">${ic('user')}</span>
        <div class="pr-text"><span class="sr-name">${esc(n)}</span><span class="pr-place">${n === 'Walk-in customer' ? 'No name needed' : 'Recent customer'}</span></div>
        <span class="sr-end-txt${n === current ? ' on' : ''}">${n === current ? 'Selected' : ''}</span>
      </button>${n === 'Walk-in customer' ? '' : `<div class="row-actions"><button class="row-del" onclick="askHideName('customer', this.dataset.name)" data-name="${esc(n)}" aria-label="Delete ${esc(n)}" title="Delete customer">${ic('trash', 14)}</button></div>`}</div>`).join('');
    list.innerHTML = html;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASES PAGE — buy stock from a vendor, or record a quick one-off buy
// ══════════════════════════════════════════════════════════════════════════════

const PO_TERMS = [
  { id: 'paid',    t: 'Paid',    sub: 'In full'  },
  { id: 'credit',  t: 'Credit',  sub: '30 days'  },
  { id: 'partial', t: 'Partial', sub: 'Pay part' },
];

function purchaseDraft() {
  if (!state.pdraft) state.pdraft = { vendor: '', branchId: MAIN_BRANCH, cart: [], date: todayISO(), term: 'paid', amountPaid: '' };
  return state.pdraft;
}
function quickDraft() {
  if (!state.qdraft) state.qdraft = { shop: '', item: '', productId: null, qty: 1, price: '', addStock: false, pay: 'cash', receipt: null };
  return state.qdraft;
}

function purchaseType(p) { return p.type === 'quick' ? 'quick' : 'po'; }
function purchaseDue(p) {
  const total = purchaseTotal(p);
  if (p.paymentStatus === 'credit')  return total;
  if (p.paymentStatus === 'partial') return Math.max(0, total - (Number(p.amountPaid) || 0));
  return 0;
}
function purchaseDueDate(p) { const d = recordDate(p); d.setDate(d.getDate() + 30); return d; }
function purchaseTag(p) {
  const due = purchaseDue(p);
  if (due <= 0.004) return { cls: 'paid', t: 'Paid' };
  const dueDate = purchaseDueDate(p);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dueDate < today) return { cls: 'refunded', t: 'Due ' + dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  return { cls: 'in_transit', t: p.paymentStatus === 'partial' ? 'Partial' : 'Credit' };
}

function vendorsList() {
  const map = new Map();
  state.purchases.filter(p => purchaseType(p) === 'po' && p.supplierName).forEach(p => {
    const name = p.supplierName.trim(), key = name.toLowerCase();
    const v = map.get(key) || { name, count: 0, due: 0, last: null };
    v.count += 1; v.due += purchaseDue(p);
    const d = recordDate(p); if (!v.last || d > v.last) v.last = d;
    map.set(key, v);
  });
  return [...map.values()].filter(v => !isHidden('vendor', v.name)).sort((a, b) => (b.last || 0) - (a.last || 0));
}
function recentShops() {
  return [...new Set(state.purchases.filter(p => purchaseType(p) === 'quick' && p.shop).map(p => p.shop.trim()))].slice(0, 4);
}

function poTotals() {
  const d = purchaseDraft();
  const units = d.cart.reduce((s, l) => s + l.qty, 0);
  const sub = d.cart.reduce((s, l) => s + (Number(l.cost) || 0) * l.qty, 0);
  return { units, sub, ...withVat(sub, vatPct('purchases')) };
}

function syncPurchaseDraft() {
  const d = purchaseDraft();
  d.cart = d.cart.filter(l => l.isNew || state.products.some(p => p.id === l.productId));
  if (!branchById(d.branchId)) d.branchId = MAIN_BRANCH;
}

// Keep focus + cursor in whatever field the user is typing in across re-renders
function withFocusKept(render) {
  const el = document.activeElement;
  const id = el && el.id;
  const pos = el && typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null;
  render();
  if (id) {
    const again = document.getElementById(id);
    if (again && again !== document.activeElement) {
      again.focus();
      if (pos && again.setSelectionRange) { try { again.setSelectionRange(pos[0], pos[1]); } catch (e) {} }
    }
  }
}

function renderPurchases() {
  const container = document.getElementById('purchases-page');
  if (!container) return;
  withFocusKept(() => { container.innerHTML = purchasesPageHTML(); });
}

function purchasesPageHTML() {
  syncPurchaseDraft();
  const po = state.purchaseMode !== 'quick';
  return `
    <div class="page-head" style="padding:4px 4px 2px"><div class="page-head-text"><span class="page-title">Buy</span><span class="page-date">${po ? 'Buy stock from a vendor' : 'Record a one-off buy from a shop'}</span></div></div>

    <div class="mode-seg" role="tablist" aria-label="Purchase type">
      ${[['po', 'From vendor', 'truck'], ['quick', 'Quick buy', 'bag']].map(([k, label, icon]) =>
        `<button class="mode-btn${(po ? 'po' : 'quick') === k ? ' active' : ''}" role="tab" aria-selected="${(po ? 'po' : 'quick') === k}" onclick="setPurchaseMode('${k}')">${ic(icon, 15)}${label}</button>`).join('')}
    </div>

    ${po ? poFormHTML() : quickFormHTML()}

    ${state.purchasesToast ? `<div class="inline-toast" role="status"><span class="it-ic">${ic('check', 13, 3)}</span><span>${esc(state.purchasesToast)}</span></div>` : ''}

    <div class="box">
      <div class="box-head"><span class="box-title">Recent purchases</span>
        <button class="box-link" onclick="openHistory({ type: 'purchase' })">See all</button></div>
      <div class="hist" id="purchases-list-container">${purchasesHistory()}</div>
    </div>`;
}

function ddButton({ onclick, icon, tone, label, value, sub, id }) {
  return `
    <button class="br-btn dd" ${id ? `id="${id}"` : ''} onclick="${onclick}" aria-haspopup="dialog">
      <span class="ic40 ${tone}">${ic(icon)}</span>
      <div class="pr-text"><span class="pr-label">${label}</span><span class="pr-value">${value}</span>${sub ? `<span class="pr-place">${sub}</span>` : ''}</div>
      <span class="br-chev">${ic('chevron', 16, 2.2)}</span>
    </button>`;
}

function poFormHTML() {
  const d = purchaseDraft();
  const br = branchById(d.branchId);
  const t = poTotals();
  const ven = d.vendor ? vendorsList().find(v => v.name.toLowerCase() === d.vendor.toLowerCase()) : null;
  const venSub = !d.vendor ? 'Tap to choose or add a supplier'
    : ven ? `${plural(ven.count, 'purchase')}${ven.due > 0 ? ` · ${fmt(ven.due)} due` : ''}` : 'New vendor';

  const lines = d.cart.map((l, i) => {
    const p = l.isNew ? null : state.products.find(x => x.id === l.productId);
    const name = l.isNew ? l.name : p.name;
    const costSet = l.cost !== '' && l.cost != null && !isNaN(l.cost);
    return `
      <div class="cart-line" data-line="${i}">
        <span class="ini">${esc(initials(name))}</span>
        <div class="cl-text"><span class="cl-name">${esc(name)}${l.isNew ? ' <span class="tag new">NEW</span>' : ''}</span>
          <span class="cl-sub"><button class="price-link${costSet ? '' : ' missing'}" onclick="openSheet('p-cost', ${i})" aria-label="Change cost for ${esc(name)}">${costSet ? 'Cost SAR ' + fmtNum(l.cost) : 'Set cost'}</button>${costSet ? `<span data-t="linetotal"> · SAR ${fmtNum(Number(l.cost) * l.qty)}</span>` : ''}</span></div>
        ${qtyBoxHTML(`qty-p-${i}`, l.qty, name, `typePurchaseQty(${i}, this)`, `fixPurchaseQty(${i}, this)`, `removePurchaseLine(${i})`)}
      </div>`;
  }).join('');

  return `
    <div class="box move-card">
      ${ddButton({ onclick: "openSheet('p-vendor')", icon: 'truck', tone: 'ic-blue', label: 'Vendor', value: d.vendor ? esc(d.vendor) : 'Choose vendor', sub: esc(venSub), id: 'dd-vendor' })}
      ${ddButton({ onclick: "openSheet('p-branch')", icon: 'store', tone: 'ic-orange', label: 'Receive at', value: esc(br.name), sub: `${ic('pin', 11)}${esc(br.place || '—')}`, id: 'dd-receive' })}
    </div>

    <div class="box">
      <div class="box-head"><span class="box-title">Items</span><span class="box-sub" data-t="units">${plural(t.units, 'unit')}</span></div>
      ${d.cart.length ? `<div class="cart-lines">${lines}</div>` : ''}
      <button class="add-line-btn" onclick="openSheet('p-product')">${ic('plus', 14, 2.4)}Add product</button>
    </div>

    <div class="box">
      <span class="box-title">Bill</span>
      <div class="note-field">
        <span class="pr-label">Bill date</span>
        <label class="date-field">${ic('calendar', 14)}<span>${fmtDate(isoToDate(d.date))}</span><input type="date" id="purchase-date" value="${d.date}" max="${todayISO()}" onchange="setPurchaseDate(this.value)" aria-label="Bill date"></label>
      </div>
      <div class="note-field">
        <span class="pr-label">Payment</span>
        <div class="pay3">${PO_TERMS.map(term => `
          <button class="pay3-btn term${d.term === term.id ? ' active' : ''}" onclick="setPurchaseTerm('${term.id}')" aria-pressed="${d.term === term.id}">${term.t}<span class="term-sub">${term.sub}</span></button>`).join('')}</div>
      </div>
      ${d.term === 'partial' ? `
      <div class="note-field">
        <span class="pr-label">Amount paid now</span>
        <div class="sar-field"><span>SAR</span><input type="number" id="amount-paid" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(d.amountPaid)}" oninput="purchaseDraft().amountPaid = this.value"></div>
      </div>` : ''}
      ${totalsHTML(t)}
      <button class="btn btn-primary btn-block cta" id="btn-save-po" onclick="savePurchase()" ${state.purchaseSubmitting ? 'disabled' : ''}>${ic('check', 16, 2.6)}${state.purchaseSubmitting ? 'Saving…' : 'Save purchase'}</button>
    </div>`;
}

function quickFormHTML() {
  const q = quickDraft();
  const total = (Number(q.price) || 0) * q.qty;
  const shops = recentShops();
  return `
    <div class="box">
      <div class="note-field">
        <label class="pr-label" for="quick-shop">Bought from</label>
        <div class="icon-field">${ic('bag', 16)}<input id="quick-shop" placeholder="Shop or market name" value="${esc(q.shop)}" autocomplete="off" oninput="quickDraft().shop = this.value"></div>
        ${shops.length ? `<div class="chip-row">${shops.map(s => `<button class="chip-btn" onclick="setQuickShop(this.dataset.v)" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="note-field">
        <label class="pr-label" for="quick-item">Item</label>
        <input id="quick-item" class="note-input" placeholder="What did you buy?" value="${esc(q.item)}" autocomplete="off" oninput="setQuickItem(this.value)">
        <div class="chip-row" id="quick-item-matches">${quickMatchesHTML()}</div>
      </div>
      <div class="qty-price">
        <div class="note-field">
          <span class="pr-label">Qty</span>
          <div class="qty-big">${qtyBoxHTML('quick-qty', q.qty, 'item', 'typeQuickQty(this)', 'fixQuickQty(this)', null)}</div>
        </div>
        <div class="note-field">
          <label class="pr-label" for="quick-price">Price per piece</label>
          <div class="sar-field"><span>SAR</span><input type="number" id="quick-price" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(q.price)}" oninput="setQuickPrice(this.value)"></div>
        </div>
      </div>
      <button class="toggle-row" role="switch" aria-checked="${q.addStock}" onclick="toggleQuickStock()">
        <span class="tr-text"><span class="tr-title">Add to inventory</span><span class="tr-sub">${q.addStock ? `Will be added to ${esc(branchById(MAIN_BRANCH).name)} stock` : 'Expense only, not for resale'}</span></span>
        <span class="switch${q.addStock ? ' on' : ''}"><span></span></span>
      </button>
    </div>

    <div class="box">
      <div class="note-field">
        <span class="pr-label">Paid by</span>
        <div class="pay3">${PAYMENT_TYPES.map(pt =>
          `<button class="pay3-btn${q.pay === pt.id ? ' active' : ''}" style="height:60px" onclick="quickDraft().pay='${pt.id}'; renderPurchases()" aria-pressed="${q.pay === pt.id}">${ic(PAY_IC[pt.id], 18, 1.9)}${pt.label}</button>`).join('')}</div>
      </div>
      ${q.receipt ? `
        <div class="receipt-row">
          <img src="${q.receipt}" alt="Receipt photo">
          <div class="tr-text"><span class="tr-title">Receipt added</span><span class="tr-sub">Saved with this purchase</span></div>
          <button class="chg-btn" onclick="quickDraft().receipt = null; renderPurchases()">Remove</button>
        </div>` : `
        <label class="receipt-btn">${ic('camera', 17)}Add receipt photo<input type="file" accept="image/*" capture="environment" onchange="addReceiptPhoto(this)"></label>`}
      <div class="tl total"><span>Total</span><span class="num" id="quick-total">SAR ${fmtNum(total)}</span></div>
      <button class="btn btn-primary btn-block cta" id="btn-save-quick" onclick="saveQuickPurchase()" ${state.purchaseSubmitting ? 'disabled' : ''}>${ic('check', 16, 2.6)}${state.purchaseSubmitting ? 'Saving…' : 'Save purchase'}</button>
    </div>`;
}

function quickMatchesHTML() {
  const q = quickDraft();
  const term = q.item.trim().toLowerCase();
  if (q.productId) {
    const p = state.products.find(x => x.id === q.productId);
    return p ? `<span class="chip-btn on">${ic('check', 12, 2.6)}${esc(p.name)} · in inventory</span>` : '';
  }
  if (!term) return '';
  return state.products.filter(p => (p.name || '').toLowerCase().includes(term)).slice(0, 4)
    .map(p => `<button class="chip-btn" onclick="pickQuickProduct('${p.id}')">${esc(p.name)}</button>`).join('');
}

function purchasesHistory() {
  if (!state.purchases.length) return `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('cart', 20)}</span><span class="empty-title">No purchases yet</span><span class="empty-text">Saved purchases will appear here</span></div>`;
  return state.purchases.slice(0, 3).map(purchaseCardHTML).join('');
}

function purchaseCardHTML(p) {
  const quick = purchaseType(p) === 'quick';
  const tag = purchaseTag(p);
  const units = purchaseUnits(p);
  const when = whenLabel(recordDate(p), p.timestamp);
  const meta = quick
    ? `${esc(p.itemName || 'Item')} × ${p.quantity || units || 1} · ${when}`
    : `${esc(p.poNo || 'PO')} · ${plural(units, 'unit')} · ${when}`;
  const open = !!state.expandedPurchases[p.id];
  return `
    <div class="hist-item${open ? ' open' : ''}">
      <button class="hist-row" onclick="togglePurchaseExpand('${p.id}')" aria-expanded="${open}">
        <span class="ic ${quick ? 'ic-orange' : 'ic-blue'}">${ic(quick ? 'bag' : 'truck', 15)}</span>
        <div class="pr-text"><span class="cl-name">${esc(quick ? (p.shop || 'Quick buy') : (p.supplierName || 'Unknown vendor'))}</span><span class="pr-label">${meta}</span></div>
        <div class="sr-end"><span class="h-amt num">${fmt(purchaseTotal(p))}</span><span class="htag ${tag.cls}">${esc(tag.t)}</span></div>
        <span class="dd-chev">${ic('chevron', 16, 2.2)}</span>
      </button>
      ${open ? purchaseDetailHTML(p) : ''}
    </div>`;
}

function togglePurchaseExpand(id) { state.expandedPurchases[id] = !state.expandedPurchases[id]; renderCurrentPage(); }

function purchaseDetailHTML(p) {
  const quick = purchaseType(p) === 'quick';
  const due = purchaseDue(p);
  const tag = purchaseTag(p);
  const items = p.items || [];
  const paid = purchaseTotal(p) - due;
  const termName = quick ? PAY_NAME[payOf(p)] : ({ paid: 'Paid in full', partial: 'Part paid', credit: 'On credit' }[p.paymentStatus] || 'Paid in full');
  const receipt = state.receiptCache[p.id];
  return `
        <div class="hist-detail">
          <div class="dd-facts">
            ${fact(quick ? 'Type' : 'PO number', quick ? 'Quick buy' : esc(p.poNo || 'PO'))}
            ${fact('Date', fmtDate(recordDate(p)))}
            ${fact(quick ? 'Bought from' : 'Vendor', esc(quick ? (p.shop || '—') : (p.supplierName || '—')))}
            ${fact(quick ? 'Stock' : 'Received at', quick ? (p.addToInventory ? `Added to ${esc(p.branchName || 'Main branch')}` : 'Expense only') : esc(p.branchName || 'Main branch'))}
            ${fact('Payment', esc(termName))}
            ${fact('Recorded by', esc(p.recordedBy || 'unknown'))}
          </div>
          ${quick ? `
            <div class="line-item">
              <div class="li-text"><b>${esc(p.itemName || 'Item')}</b><small>${p.quantity || 1} × ${fmt(Number(p.unitCost) || 0)}</small></div>
              <span class="amt">${fmt(purchaseTotal(p))}</span>
            </div>`
          : items.map(it => `
            <div class="line-item">
              <div class="li-text"><b>${esc(it.productName)}${it.isNewProduct ? ' <span class="tag new">NEW</span>' : ''}</b><small>+${it.quantity} × ${fmt(Number(it.unitCost) || 0)}</small></div>
              <span class="amt">${fmt((Number(it.unitCost) || 0) * it.quantity)}</span>
            </div>`).join('')}
          <div class="totals">
            ${(p.vatAmount || 0) > 0 ? `<div class="tl"><span>Subtotal</span><span class="num">${fmt(p.subtotal || 0)}</span></div><div class="tl"><span>VAT ${pctLabel(p.vatRate ?? 15)}</span><span class="num">${fmt(p.vatAmount)}</span></div>` : ''}
            <div class="tl total"><span>Total</span><span class="num">${fmt(purchaseTotal(p))}</span></div>
            <div class="tl"><span>Status</span><span class="htag ${tag.cls}">${esc(tag.t)}</span></div>
            ${due > 0 ? `<div class="tl"><span>Paid</span><span class="num">${fmt(paid)}</span></div><div class="tl"><span>Still to pay</span><span class="num" style="color:var(--red);font-weight:600">${fmt(due)}</span></div>` : ''}
          </div>
          ${p.hasReceipt ? `<div id="receipt-view-${p.id}" class="receipt-view">${receipt
            ? `<img class="receipt-full" src="${esc(receipt)}" alt="Receipt photo">`
            : `<button class="more-btn" style="width:100%" onclick="showReceipt('${p.id}')">${ic('camera', 14)} View receipt photo</button>`}</div>` : ''}
          ${due > 0 ? `<button class="btn btn-primary btn-block cta" onclick="markPurchasePaid('${p.id}')">${ic('check', 16, 2.6)}Mark as paid</button>` : ''}
          <div class="dd-actions">
            <button class="btn btn-ghost btn-sm" onclick="docAction('purchase', '${p.id}', 'share', this)">${ic('share', 14)}Share</button>
            <button class="btn btn-ghost btn-sm" onclick="docAction('purchase', '${p.id}', 'download', this)">${ic('download', 14)}PDF</button>
          </div>
          <button class="btn btn-danger btn-sm del-btn" onclick="askDeletePurchase('${p.id}')">${ic('trash', 14)}Delete purchase</button>
        </div>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────
function isoToDate(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
function setPurchaseMode(m) { state.purchaseMode = m; state.purchasesToast = ''; renderPurchases(); }
function setPurchaseDate(v) { if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todayISO()) purchaseDraft().date = v; renderPurchases(); }
function setPurchaseTerm(t) { purchaseDraft().term = t; renderPurchases(); }
function refreshPurchaseNumbers() {
  const page = document.getElementById('purchases-page'); if (!page) return;
  const d = purchaseDraft();
  refreshTotals(page, poTotals());
  d.cart.forEach((l, i) => {
    const el = page.querySelector(`[data-line="${i}"] [data-t="linetotal"]`);
    if (el) el.textContent = ' · SAR ' + fmtNum((Number(l.cost) || 0) * l.qty);
  });
}
function typePurchaseQty(i, el) {
  const l = purchaseDraft().cart[i]; if (!l) return;
  l.qty = readQty(el);
  refreshPurchaseNumbers();
}
function fixPurchaseQty(i, el) {
  const l = purchaseDraft().cart[i]; if (!l) return;
  if (!(l.qty >= 1)) l.qty = 1;
  el.value = String(l.qty);
  refreshPurchaseNumbers();
}
function removePurchaseLine(i) {
  purchaseDraft().cart.splice(i, 1);
  renderPurchases();
}
function addPurchaseLine(productId) {
  const d = purchaseDraft();
  const p = state.products.find(x => x.id === productId); if (!p) return;
  const ex = d.cart.find(l => l.productId === productId);
  if (ex) ex.qty += 1;
  else d.cart.push({ productId, qty: 1, cost: p.costPrice != null ? String(p.costPrice) : '' });
  closeSheet(); renderPurchases();
}
function addNewPurchaseProduct(name) {
  name = String(name || '').trim(); if (!name) return;
  const existing = state.products.find(p => (p.name || '').trim().toLowerCase() === name.toLowerCase());
  if (existing) { addPurchaseLine(existing.id); return; }
  const d = purchaseDraft();
  if (!d.cart.some(l => l.isNew && l.name.toLowerCase() === name.toLowerCase())) d.cart.push({ isNew: true, name, qty: 1, cost: '', sellingPrice: '' });
  closeSheet(); renderPurchases();
  openSheet('p-cost', d.cart.findIndex(l => l.isNew && l.name.toLowerCase() === name.toLowerCase()));
}
function saveNewVendor() {
  const v = document.getElementById('vendor-name').value.trim();
  if (!v) { document.getElementById('err-vendor-name').textContent = 'Vendor name is required'; return; }
  pickVendor(v);
}
function pickVendor(name) {
  const v = String(name || '').trim();
  unhideName('vendor', v);
  purchaseDraft().vendor = v; closeSheet(); renderPurchases();
}
function pickReceiveBranch(id) { purchaseDraft().branchId = id; closeSheet(); renderPurchases(); }
function saveCost(i) {
  const d = purchaseDraft(); const l = d.cart[i];
  const v = document.getElementById('cost-input').value;
  const err = document.getElementById('err-cost');
  if (v === '' || isNaN(v) || Number(v) < 0) { err.textContent = 'Enter a valid cost'; return; }
  if (l) {
    l.cost = String(Number(v));
    const sp = document.getElementById('sell-input');
    if (sp && l.isNew) l.sellingPrice = sp.value;
  }
  closeSheet(); renderPurchases();
}

function setQuickShop(v) { quickDraft().shop = v; renderPurchases(); }
function setQuickItem(v) {
  const q = quickDraft(); q.item = v;
  const p = q.productId && state.products.find(x => x.id === q.productId);
  if (p && p.name !== v) q.productId = null;
  const box = document.getElementById('quick-item-matches');
  if (box) box.innerHTML = quickMatchesHTML();
}
function pickQuickProduct(id) {
  const q = quickDraft(); const p = state.products.find(x => x.id === id); if (!p) return;
  q.productId = id; q.item = p.name; q.addStock = true;
  if (!q.price && p.costPrice != null) q.price = String(p.costPrice);
  renderPurchases();
}
function refreshQuickTotal() {
  const q = quickDraft();
  const el = document.getElementById('quick-total');
  if (el) el.textContent = 'SAR ' + fmtNum((Number(q.price) || 0) * q.qty);
}
function typeQuickQty(el) { quickDraft().qty = readQty(el); refreshQuickTotal(); }
function fixQuickQty(el) {
  const q = quickDraft();
  if (!(q.qty >= 1)) q.qty = 1;
  el.value = String(q.qty);
  refreshQuickTotal();
}
function setQuickPrice(v) {
  const q = quickDraft(); q.price = v;
  const el = document.getElementById('quick-total');
  if (el) el.textContent = 'SAR ' + fmtNum((Number(v) || 0) * q.qty);
}
function toggleQuickStock() { const q = quickDraft(); q.addStock = !q.addStock; renderPurchases(); }

function addReceiptPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1000, scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72, data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > 850000 && quality > 0.3) { quality -= 0.12; data = canvas.toDataURL('image/jpeg', quality); }
      quickDraft().receipt = data;
      renderPurchases();
    };
    img.onerror = () => showToast('That file is not a photo', 'error');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function flashPurchasesToast(msg) {
  state.purchasesToast = msg;
  renderPurchases();
  clearTimeout(flashPurchasesToast._t);
  flashPurchasesToast._t = setTimeout(() => { state.purchasesToast = ''; if (state.currentPage === 'purchases') renderPurchases(); }, 3000);
}

async function savePurchase() {
  if (state.purchaseSubmitting) return;
  const d = purchaseDraft();
  const br = branchById(d.branchId);
  if (!d.vendor) { showToast('Choose a vendor', 'error'); openSheet('p-vendor'); return; }
  if (!d.cart.length) { showToast('Add at least one product', 'error'); return; }
  const noQty = d.cart.findIndex(l => !(l.qty >= 1));
  if (noQty >= 0) { const l = d.cart[noQty]; showToast(`Enter a quantity for ${l.isNew ? l.name : state.products.find(p => p.id === l.productId).name}`, 'error'); document.getElementById(`qty-p-${noQty}`)?.focus(); return; }
  const missing = d.cart.find(l => l.cost === '' || l.cost == null || isNaN(l.cost));
  if (missing) { showToast(`Set the cost for ${missing.isNew ? missing.name : state.products.find(p => p.id === missing.productId).name}`, 'error'); openSheet('p-cost', d.cart.indexOf(missing)); return; }
  const t = poTotals();
  let amountPaid = t.total;
  if (d.term === 'credit') amountPaid = 0;
  if (d.term === 'partial') {
    amountPaid = Number(d.amountPaid);
    if (d.amountPaid === '' || isNaN(amountPaid) || amountPaid < 0 || amountPaid >= t.total) { showToast('Enter how much you paid now (less than the total)', 'error'); document.getElementById('amount-paid')?.focus(); return; }
  }
  const items = d.cart.map(l => l.isNew
    ? { isNew: true, productName: l.name, quantity: l.qty, unitCost: Number(l.cost), sellingPrice: l.sellingPrice !== '' && !isNaN(l.sellingPrice) ? Number(l.sellingPrice) : null }
    : { productId: l.productId, productName: state.products.find(p => p.id === l.productId).name, quantity: l.qty, unitCost: Number(l.cost) });
  const poCount = state.purchases.filter(p => purchaseType(p) === 'po').length;
  state.purchaseSubmitting = true; renderPurchases();
  try {
    await recordPurchase({
      type: 'po', supplierName: d.vendor, branchId: br.id, branchName: br.name,
      purchaseDate: d.date, paymentStatus: d.term, amountPaid,
      subtotal: t.sub, vatAmount: t.vat, vatRate: t.vatPct, total: t.total,
      poNo: 'PO-' + String(poCount + 1).padStart(3, '0'),
      items,
    });
    state.pdraft = { vendor: d.vendor, branchId: d.branchId, cart: [], date: todayISO(), term: 'paid', amountPaid: '' };
    state.purchaseSubmitting = false;
    flashPurchasesToast(`Purchase saved · ${d.vendor} · SAR ${fmtNum(t.total)}`);
  } catch (e) {
    console.error(e);
    state.purchaseSubmitting = false; renderPurchases();
    showToast('Failed to save purchase', 'error');
  }
}

async function saveQuickPurchase() {
  if (state.purchaseSubmitting) return;
  const q = quickDraft();
  const item = q.item.trim(), price = Number(q.price);
  if (!item) { showToast('Enter what you bought', 'error'); document.getElementById('quick-item')?.focus(); return; }
  if (!(q.qty >= 1)) { showToast('Enter the quantity', 'error'); document.getElementById('quick-qty')?.focus(); return; }
  if (q.price === '' || isNaN(price) || price <= 0) { showToast('Enter the price per piece', 'error'); document.getElementById('quick-price')?.focus(); return; }
  const total = price * q.qty;
  let items = [];
  if (q.addStock) {
    const p = q.productId ? state.products.find(x => x.id === q.productId)
      : state.products.find(x => (x.name || '').trim().toLowerCase() === item.toLowerCase());
    items = [p ? { productId: p.id, productName: p.name, quantity: q.qty, unitCost: price }
               : { isNew: true, productName: item, quantity: q.qty, unitCost: price, sellingPrice: null }];
  }
  state.purchaseSubmitting = true; renderPurchases();
  try {
    await recordPurchase({
      type: 'quick', shop: q.shop.trim(), itemName: item, quantity: q.qty, unitCost: price,
      addToInventory: q.addStock, branchId: MAIN_BRANCH, branchName: branchById(MAIN_BRANCH).name,
      purchaseDate: todayISO(), paymentStatus: 'paid', amountPaid: total, paymentType: q.pay,
      subtotal: total, vatAmount: 0, total,
      receiptImage: q.receipt || null,
      items,
    });
    state.qdraft = null;
    state.purchaseSubmitting = false;
    flashPurchasesToast(`Saved · ${item} · SAR ${fmtNum(total)}`);
  } catch (e) {
    console.error(e);
    state.purchaseSubmitting = false; renderPurchases();
    showToast('Failed to save purchase', 'error');
  }
}

async function markPurchasePaid(id) {
  const p = state.purchases.find(x => x.id === id); if (!p) return;
  try {
    await userPurchasesCol().doc(id).update({ paymentStatus: 'paid', amountPaid: purchaseTotal(p), paidAt: firebase.firestore.FieldValue.serverTimestamp() });
    closeSheet();
    notify(`Marked as paid · ${p.supplierName || p.shop || 'Purchase'}`);
  } catch (e) { console.error(e); showToast('Failed to update payment', 'error'); }
}

async function showReceipt(id) {
  const box = document.getElementById(`receipt-view-${id}`);
  if (!box) return;
  box.innerHTML = `<div class="sheet-empty">Loading receipt…</div>`;
  try {
    const snap = await userCol('receipts').doc(id).get();
    const data = snap && (typeof snap.data === 'function' ? snap.data() : null);
    if (data && data.image) state.receiptCache[id] = data.image;
    const el = document.getElementById(`receipt-view-${id}`) || box;
    el.innerHTML = data && data.image ? `<img class="receipt-full" src="${esc(data.image)}" alt="Receipt photo">` : `<div class="sheet-empty">No receipt found</div>`;
  } catch (e) { console.error(e); box.innerHTML = `<div class="sheet-empty">Could not load the receipt</div>`; }
}

// Restock buttons (Inventory, Dashboard) open a vendor purchase with that product
function openPurchaseForm(productId = '') {
  state.purchaseMode = 'po';
  const p = productId && state.products.find(x => x.id === productId);
  if (p) {
    const d = purchaseDraft();
    if (!d.cart.some(l => l.productId === p.id)) d.cart.push({ productId: p.id, qty: 1, cost: p.costPrice != null ? String(p.costPrice) : '' });
  }
  navigateTo('purchases');
}

// ── Purchase sheets (plugged into the shared bottom sheet) ───────────────────
function purchaseSheetSpec(sh) {
  const d = purchaseDraft();
  if (sh.kind === 'p-vendor') return { title: 'Choose vendor', sub: 'Suppliers you buy from', search: 'Search or type a new vendor name',
    footer: `<button class="add-line-btn" onclick="openSheet('p-newvendor')">${ic('plus', 14, 2.4)}New vendor</button>` };
  if (sh.kind === 'p-newvendor') return { title: 'New vendor', sub: 'Add a supplier you buy from', body: `
      <div class="sheet-form">
        <div class="field"><label for="vendor-name">Vendor name <span class="req">*</span></label><input type="text" id="vendor-name" placeholder="e.g. Gulf Traders" autocomplete="off" onkeydown="if (event.key === 'Enter') saveNewVendor()"><span class="err-msg" id="err-vendor-name"></span></div>
        <button class="btn btn-primary btn-block cta" onclick="saveNewVendor()">${ic('check', 16, 2.6)}Use this vendor</button>
      </div>` };
  if (sh.kind === 'p-branch') return { title: 'Receive at', sub: 'Which of your stores gets this stock', search: 'Search branch or city' };
  if (sh.kind === 'p-product') return { title: 'Add product', sub: 'All products · search or add a new one', search: 'Search products or type a new name' };
  if (sh.kind === 'p-cost') {
    const l = d.cart[sh.arg];
    const name = l ? (l.isNew ? l.name : (state.products.find(p => p.id === l.productId) || {}).name) : '';
    return { title: 'Cost', sub: `Buying price per unit for ${esc(name || '')}`, body: `
      <div class="sheet-form">
        <div class="sar-input big"><span>SAR</span><input type="number" id="cost-input" min="0" step="0.01" inputmode="decimal" value="${esc(l ? l.cost : '')}" placeholder="0.00" onkeydown="if (event.key === 'Enter') saveCost(${sh.arg})" aria-label="Cost per unit"></div>
        <span class="err-msg" id="err-cost"></span>
        ${l && l.isNew ? `<div class="field"><label for="sell-input">Selling price <span class="hint">(optional)</span></label><div class="sar-input"><span>SAR</span><input type="number" id="sell-input" min="0" step="0.01" inputmode="decimal" value="${esc(l.sellingPrice || '')}" placeholder="0.00"></div></div>` : ''}
        <button class="btn btn-primary btn-block cta" onclick="saveCost(${sh.arg})">${ic('check', 16, 2.6)}Save cost</button>
      </div>` };
  }
  return null;
}

function renderPurchaseSheetList(sh, list, q) {
  const d = purchaseDraft();
  const typed = state.sheetQuery.trim();
  if (sh.kind === 'p-vendor') {
    const vendors = vendorsList().filter(v => !q || v.name.toLowerCase().includes(q));
    let html = '';
    if (typed && !vendorsList().some(v => v.name.toLowerCase() === typed.toLowerCase())) {
      html += `<button class="sheet-row" onclick="pickVendor(this.dataset.v)" data-v="${esc(typed)}"><span class="ic40 ic-orange">${ic('plus')}</span><div class="pr-text"><span class="sr-name">Add “${esc(typed)}”</span><span class="pr-place">New vendor</span></div></button>`;
    }
    html += vendors.map(v => {
      const on = d.vendor && v.name.toLowerCase() === d.vendor.toLowerCase();
      return `<div class="sheet-row-wrap">
        <button class="sheet-row${on ? ' on' : ''}" onclick="pickVendor(this.dataset.v)" data-v="${esc(v.name)}">
          <span class="ic40 ${on ? 'ic-white' : 'ic-blue'}" style="font-size:12px;font-weight:600">${esc(initials(v.name))}</span>
          <div class="pr-text"><span class="sr-name">${esc(v.name)}</span><span class="pr-place">${plural(v.count, 'purchase')} · last ${fmtDate(v.last)}</span></div>
          <span class="sr-end-txt${on ? ' on' : v.due > 0 ? ' due' : ''}">${on ? 'Selected' : v.due > 0 ? fmt(v.due) + ' due' : 'No balance'}</span>
        </button><div class="row-actions"><button class="row-del" onclick="askHideName('vendor', this.dataset.v)" data-v="${esc(v.name)}" aria-label="Delete ${esc(v.name)}" title="Delete vendor">${ic('trash', 14)}</button></div></div>`;
    }).join('');
    list.innerHTML = html || `<div class="sheet-empty">No vendors yet — type a name above and tap “Add”.</div>`;
  } else if (sh.kind === 'p-branch') {
    list.innerHTML = state.branches.filter(b => !q || `${b.name} ${b.place || ''}`.toLowerCase().includes(q)).map(b => {
      const on = b.id === d.branchId;
      return `<div class="sheet-row-wrap">
        <button class="sheet-row${on ? ' on' : ''}" onclick="pickReceiveBranch('${b.id}')">
          <span class="ic40 ${on ? 'ic-white' : b.main ? 'ic-orange' : 'ic-soft'}">${ic('store')}</span>
          <div class="pr-text"><span class="sr-name">${esc(b.name)}${b.main ? '<span class="main-badge">MAIN</span>' : ''}</span><span class="pr-place">${ic('pin', 11)}${esc(b.place || '—')} · ${branchUnits(b.id).toLocaleString()} units</span></div>
          <span class="sr-end-txt${on ? ' on' : ''}">${on ? 'Selected' : ''}</span>
        </button>${branchRowActions(b)}</div>`;
    }).join('') + `
      <button class="sheet-row" onclick="openSheet('addBranch', 'receive')"><span class="ic40 ic-soft">${ic('plus')}</span><div class="pr-text"><span class="sr-name">Add branch</span><span class="pr-place">Create a new location</span></div></button>`;
  } else if (sh.kind === 'p-product') {
    const br = branchById(d.branchId);
    let html = '';
    if (typed && !state.products.some(p => (p.name || '').trim().toLowerCase() === typed.toLowerCase())) {
      html += `<button class="sheet-row" onclick="addNewPurchaseProduct(this.dataset.v)" data-v="${esc(typed)}"><span class="ic40 ic-orange">${ic('plus')}</span><div class="pr-text"><span class="sr-name">Add “${esc(typed)}”</span><span class="pr-place">New product — created when you save</span></div></button>`;
    }
    html += state.products.filter(p => !q || (p.name || '').toLowerCase().includes(q)).map(p => {
      const inCart = d.cart.some(l => l.productId === p.id);
      return `
        <button class="sheet-row" onclick="addPurchaseLine('${p.id}')">
          <span class="ini">${esc(initials(p.name))}</span>
          <div class="pr-text"><span class="sr-name">${esc(p.name)}</span><span class="pr-place">${p.costPrice != null ? 'Cost SAR ' + fmtNum(p.costPrice) + ' · ' : ''}${stockAt(p, d.branchId)} in stock at ${esc(shortBranch(br.name))}</span></div>
          <span class="sr-end-txt${inCart ? ' on' : ''}">${inCart ? 'Added' : ''}</span>
        </button>`;
    }).join('');
    list.innerHTML = html || `<div class="sheet-empty">${state.products.length ? 'No product matches — type the full name to add it' : 'No products yet — type a name above to add your first one'}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE — sales, purchases, transfers, branches (stock is put back correctly)
// ══════════════════════════════════════════════════════════════════════════════

function confirmDelete({ title, name, note, action }) {
  showModal(`
    <div class="modal-title"><span class="ic ic-red">${ic('trash')}</span>${esc(title)}</div>
    <div class="danger-box">${esc(name)}</div>
    <p class="modal-note">${note}</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="btn-confirm-delete" onclick="${action}">${ic('trash', 15)}Yes, delete</button>
    </div>`);
}

function askDeleteSale(id) {
  const s = state.sales.find(x => x.id === id); if (!s) return;
  confirmDelete({ title: 'Delete sale', name: `${saleInvoiceNo(s)} · ${s.customerName || 'Walk-in customer'} · ${fmt(saleTotal(s))}`,
    note: (() => { const back = returnedByLine(s); const units = (s.items || []).reduce((a, it, i) => a + Math.max(0, it.quantity - (back[i] || 0)), 0);
      return units ? `The ${plural(units, 'unit')} still out from this sale go back into stock at ${esc(s.branchName || 'Main branch')}. This can't be undone.` : `Everything in this sale was already returned, so stock doesn't change. This can't be undone.`; })(),
    action: `deleteSale('${id}')` });
}

async function deleteSale(id) {
  const s = state.sales.find(x => x.id === id); if (!s) return closeModal();
  const branch = s.branchId || MAIN_BRANCH, inc = firebase.firestore.FieldValue.increment;
  const batch = db.batch();
  batch.delete(userSalesCol().doc(id));
  const back = returnedByLine(s);
  (s.items || []).forEach((it, i) => {
    const q = it.quantity - (back[i] || 0);               // returned units are already back in stock
    if (q <= 0 || !state.products.some(p => p.id === it.productId)) return;
    batch.update(userProductsCol().doc(it.productId), { quantity: inc(q), [`stock.${branch}`]: inc(q) });
  });
  try { await batch.commit(); delete state.expandedSales[id]; closeModal(); showToast('Sale deleted · stock returned'); }
  catch (e) { console.error(e); showToast('Failed to delete sale', 'error'); }
}

function askDeletePurchase(id) {
  const p = state.purchases.find(x => x.id === id); if (!p) return;
  const units = (p.items || []).reduce((a, it) => a + it.quantity, 0);
  closeSheet();
  confirmDelete({ title: 'Delete purchase', name: `${purchaseType(p) === 'quick' ? (p.shop || 'Quick buy') : (p.poNo || 'PO') + ' · ' + (p.supplierName || '')} · ${fmt(purchaseTotal(p))}`,
    note: units ? `The ${plural(units, 'unit')} it added are taken back out of stock at ${esc(p.branchName || 'Main branch')}. This can't be undone.` : `This only removes the record — it didn't add stock. This can't be undone.`,
    action: `deletePurchase('${id}')` });
}

async function deletePurchase(id) {
  const p = state.purchases.find(x => x.id === id); if (!p) return closeModal();
  const branch = p.branchId || MAIN_BRANCH, inc = firebase.firestore.FieldValue.increment;
  const batch = db.batch();
  batch.delete(userPurchasesCol().doc(id));
  if (p.hasReceipt) batch.delete(userCol('receipts').doc(id));
  (p.items || []).forEach(it => {
    if (!state.products.some(x => x.id === it.productId)) return;
    batch.update(userProductsCol().doc(it.productId), { quantity: inc(-it.quantity), [`stock.${branch}`]: inc(-it.quantity) });
  });
  try { await batch.commit(); closeModal(); showToast('Purchase deleted'); }
  catch (e) { console.error(e); showToast('Failed to delete purchase', 'error'); }
}

function askDeleteTransfer(id) {
  const tr = state.transfers.find(x => x.id === id); if (!tr) return;
  const received = tr.status === 'received';
  closeSheet();
  confirmDelete({ title: 'Delete transfer', name: `${tr.transferNo || 'Transfer'} · ${shortBranch(tr.fromName)} → ${shortBranch(tr.toName)}`,
    note: received ? `The ${plural(tr.units || 0, 'unit')} move back from ${esc(tr.toName)} to ${esc(tr.fromName)}. This can't be undone.`
                   : `The ${plural(tr.units || 0, 'unit')} in transit go back to ${esc(tr.fromName)}. This can't be undone.`,
    action: `deleteTransfer('${id}')` });
}

async function deleteTransfer(id) {
  const tr = state.transfers.find(x => x.id === id); if (!tr) return closeModal();
  const inc = firebase.firestore.FieldValue.increment;
  const batch = db.batch();
  batch.delete(userTransfersCol().doc(id));
  (tr.items || []).forEach(it => {
    if (!state.products.some(p => p.id === it.productId)) return;
    const upd = { [`stock.${tr.fromId}`]: inc(it.quantity) };
    if (tr.status === 'received') upd[`stock.${tr.toId}`] = inc(-it.quantity);
    else upd.quantity = inc(it.quantity);            // in transit: units weren't counted anywhere
    batch.update(userProductsCol().doc(it.productId), upd);
  });
  try { await batch.commit(); closeModal(); showToast('Transfer deleted · stock moved back'); }
  catch (e) { console.error(e); showToast('Failed to delete transfer', 'error'); }
}

function askDeleteBranch(id) {
  const b = branchById(id); if (!b) return;
  if (b.main) {
    closeSheet();
    showModal(`
      <div class="modal-title"><span class="ic ic-orange">${ic('store')}</span>Main branch</div>
      <div class="danger-box" style="background:var(--orange-tint)">${esc(b.name)}</div>
      <p class="modal-note">Your main branch is where new stock goes by default, so it can't be deleted. You can rename it instead.</p>
      <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="closeModal(); openSheet('editBranch', '${b.id}')">${ic('edit', 15)}Rename</button></div>`);
    return;
  }
  const units = branchUnits(id);
  const moving = state.transfers.some(t => t.status !== 'received' && (t.fromId === id || t.toId === id));
  closeSheet();
  if (units > 0 || moving) {
    showModal(`
      <div class="modal-title"><span class="ic ic-orange">${ic('store')}</span>Can't delete yet</div>
      <div class="danger-box" style="background:var(--orange-tint)">${esc(b.name)}</div>
      <p class="modal-note">${units > 0 ? `It still holds ${plural(units, 'unit')}. Transfer them to another branch first.` : 'A transfer to or from this branch is still in transit. Mark it received first.'}</p>
      <div class="form-actions"><span></span><button class="btn btn-primary" onclick="closeModal()">OK</button></div>`);
    return;
  }
  confirmDelete({ title: 'Delete branch', name: b.name, note: 'Past sales and transfers keep showing its name. This can\'t be undone.', action: `deleteBranch('${id}')` });
}

async function deleteBranch(id) {
  try {
    await userBranchesCol().doc(id).delete();
    [sellDraft(), moveDraft()].forEach(d => { if (d.fromId === id) d.fromId = MAIN_BRANCH; if (d.toId === id) d.toId = null; });
    const pd = purchaseDraft(); if (pd.branchId === id) pd.branchId = MAIN_BRANCH;
    closeModal(); showToast('Branch deleted'); renderCurrentPage();
  } catch (e) { console.error(e); showToast('Failed to delete branch', 'error'); }
}

// ── Branch row buttons (edit + delete) used in every branch dropdown ──
function branchRowActions(b) {
  return `<div class="row-actions">
    <button class="row-edit" onclick="openSheet('editBranch', '${b.id}')" aria-label="Edit ${esc(b.name)}" title="Edit branch">${ic('edit', 14)}</button>
    <button class="row-del" onclick="askDeleteBranch('${b.id}')" aria-label="Delete ${esc(b.name)}" title="Delete branch">${ic('trash', 14)}</button>
  </div>`;
}

async function saveBranchEdit(id) {
  const name  = document.getElementById('branch-name').value.trim();
  const place = document.getElementById('branch-place').value.trim();
  const err   = document.getElementById('err-branch-name');
  if (!name) { err.textContent = 'Branch name is required'; return; }
  if (state.branches.some(b => b.id !== id && (b.name || '').toLowerCase() === name.toLowerCase())) { err.textContent = 'Another branch already has this name'; return; }
  try {
    await userBranchesCol().doc(id).update({ name, place });
    closeSheet(); showToast('Branch updated'); renderCurrentPage();
  } catch (e) { console.error(e); showToast('Failed to update branch', 'error'); }
}

// ── Removing vendors / customers from the dropdown lists (their records stay) ──
function nameKey(type, name) { return `${type}:${String(name || '').trim().toLowerCase()}`; }
function isHidden(type, name) { return state.hidden.has(nameKey(type, name)); }
function hiddenDocId(key) { return encodeURIComponent(key).slice(0, 700); }

function askHideName(type, name) {
  closeSheet();
  const label = type === 'vendor' ? 'vendor' : 'customer';
  confirmDelete({ title: `Delete ${label}`, name,
    note: `${name} is removed from the ${label} list. Past ${type === 'vendor' ? 'purchases' : 'sales'} keep their records. If you type this name again later, it comes back.`,
    action: `hideName('${type}', this.dataset.n)` });
  const btn = document.getElementById('btn-confirm-delete');
  if (btn) btn.dataset.n = name;
}

async function hideName(type, name) {
  const key = nameKey(type, name);
  try {
    await userCol('hidden').doc(hiddenDocId(key)).set({ key, type, name, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    if (type === 'vendor' && purchaseDraft().vendor.toLowerCase() === String(name).toLowerCase()) purchaseDraft().vendor = '';
    if (type === 'customer' && sellDraft().customer.toLowerCase() === String(name).toLowerCase()) sellDraft().customer = '';
    closeModal(); showToast(`${name} deleted`); renderCurrentPage();
  } catch (e) { console.error(e); showToast('Failed to delete', 'error'); }
}

function unhideName(type, name) {
  const key = nameKey(type, name);
  if (!state.hidden.has(key)) return;
  state.hidden.delete(key);
  userCol('hidden').doc(hiddenDocId(key)).delete().catch(e => console.error(e));
}


// ══════════════════════════════════════════════════════════════════════════════
// PDF — minimal invoice / purchase / transfer documents, shared or downloaded.
// Pages are drawn with the browser's own text engine (so Arabic names render
// correctly) and packed into a small PDF here — no extra library needed.
// ══════════════════════════════════════════════════════════════════════════════

const PDF_W = 595.28, PDF_H = 841.89, PDF_SCALE = 2, PDF_M = 44;   // A4 in points
const PDF_FONT = '"Manrope", "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Arabic", "Geeza Pro", Tahoma, sans-serif';

function saleDocSpec(s) {
  const b = brand(), items = s.items || [], back = returnedByLine(s), returns = saleReturns(s);
  const status = saleStatus(s);
  const sub = typeof s.subtotal === 'number' ? s.subtotal : items.reduce((a, it) => a + (Number(it.priceAtSale) || 0) * it.quantity, 0);
  const vat = typeof s.vatAmount === 'number' ? s.vatAmount : 0;
  const no = saleInvoiceNo(s);
  return {
    kind: 'Invoice', number: no, date: fmtDate(recordDate(s)),
    parties: [
      { label: 'Billed to', value: s.customerName || 'Walk-in customer' },
      { label: 'Branch', value: s.branchName || 'Main branch' },
      { label: 'Payment', value: PAY_NAME[payOf(s)] + (status !== 'paid' ? ` · ${TAG_LABEL[status]}` : '') },
    ],
    columns: ['Item', 'Qty', 'Unit price', 'Amount'],
    rows: items.map((it, i) => ({
      cells: [it.productName || 'Item', String(it.quantity), fmtNum(it.priceAtSale), fmtNum((Number(it.priceAtSale) || 0) * it.quantity)],
      sub: back[i] ? `${back[i]} returned` : '',
    })),
    totals: [
      ...(vat > 0 ? [['Subtotal', fmtNum(sub)], [`VAT ${pctLabel(s.vatRate ?? 15)}`, fmtNum(vat)]] : []),
      ['Total', fmt(saleTotal(s)), true],
    ],
    extra: returns.length ? {
      title: 'Returns',
      lines: returns.map(r => [`${fmtDate(isoToDate(r.date))} · ${(r.items || []).map(it => `${it.quantity} × ${it.productName}`).join(', ')}${r.note ? ` · ${r.note}` : ''}`, `− ${fmtNum(Number(r.total) || 0)}`]),
      total: ['Net total', fmt(saleNetTotal(s))],
    } : (status === 'refunded' ? { title: 'Refund', lines: [['This sale was refunded in full', `− ${fmtNum(saleTotal(s))}`]], total: ['Net total', fmt(0)] } : null),
    note: s.deliveryNote ? ['Delivery note', s.deliveryNote] : null,
    footer: 'Thank you for your business.',
    fileName: `Invoice-${no}.pdf`,
    shareText: `Invoice ${no} from ${b.name} · ${fmt(saleNetTotal(s))}`,
  };
}

function purchaseDocSpec(p) {
  const b = brand(), quick = purchaseType(p) === 'quick', due = purchaseDue(p), total = purchaseTotal(p);
  const no = quick ? 'Quick buy' : (p.poNo || 'PO');
  const vat = Number(p.vatAmount) || 0;
  const rows = quick
    ? [{ cells: [p.itemName || 'Item', String(p.quantity || 1), fmtNum(p.unitCost), fmtNum(total)], sub: p.addToInventory ? 'Added to stock' : '' }]
    : (p.items || []).map(it => ({ cells: [it.productName || 'Item', String(it.quantity), fmtNum(it.unitCost), fmtNum((Number(it.unitCost) || 0) * it.quantity)], sub: it.isNewProduct ? 'New product' : '' }));
  return {
    kind: quick ? 'Receipt' : 'Purchase order', number: no, date: fmtDate(recordDate(p)),
    parties: quick
      ? [{ label: 'Bought from', value: p.shop || '—' }, { label: 'Paid by', value: PAY_NAME[payOf(p)] }, { label: 'Stock', value: p.addToInventory ? (p.branchName || 'Main branch') : 'Expense only' }]
      : [{ label: 'Vendor', value: p.supplierName || '—' }, { label: 'Received at', value: p.branchName || 'Main branch' }, { label: 'Payment', value: purchaseTag(p).t }],
    columns: ['Item', 'Qty', 'Unit cost', 'Amount'],
    rows,
    totals: [
      ...(vat > 0 ? [['Subtotal', fmtNum(p.subtotal || 0)], [`VAT ${pctLabel(p.vatRate ?? 15)}`, fmtNum(vat)]] : []),
      ['Total', fmt(total), true],
      ...(due > 0 ? [['Paid', fmtNum(total - due)], ['Balance due', fmtNum(due)]] : []),
    ],
    extra: null, note: null,
    footer: b.name,
    fileName: `${quick ? 'Receipt' : 'Purchase'}-${no}.pdf`,
    shareText: `${quick ? 'Receipt' : 'Purchase order ' + no} · ${quick ? (p.shop || '') : (p.supplierName || '')} · ${fmt(total)}`,
  };
}

function transferDocSpec(tr) {
  const b = brand(), no = tr.transferNo || 'Transfer';
  return {
    kind: 'Transfer note', number: no, date: fmtDate(toDate(tr.timestamp)),
    parties: [
      { label: 'From', value: tr.fromName || '—' },
      { label: 'To', value: tr.toName || '—' },
      { label: 'Status', value: tr.status === 'received' ? 'Received' : 'In transit', sub: tr.receivedAt ? fmtDate(toDate(tr.receivedAt)) : '' },
    ],
    columns: ['Item', 'Qty', 'Unit value', 'Value'],
    rows: (tr.items || []).map(it => ({ cells: [it.productName || 'Item', String(it.quantity), fmtNum(it.unitValue), fmtNum((Number(it.unitValue) || 0) * it.quantity)], sub: '' })),
    totals: [['Units', String(tr.units || 0)], ['Value', fmt(tr.value || 0), true]],
    extra: null,
    note: tr.note ? ['Note', tr.note] : null,
    footer: b.name,
    fileName: `Transfer-${no}.pdf`,
    shareText: `Transfer ${no} · ${tr.fromName || ''} → ${tr.toName || ''}`,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}

// Draws the document onto A4 canvases (one per page)
async function renderDocPages(d) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  const b = brand();
  let logo = null;
  if (b.logo) { try { logo = await loadImage(b.logo); } catch (e) {} }

  const M = PDF_M, W = PDF_W - 2 * M, BOTTOM = PDF_H - M - 30;
  const INK = '#16181d', MUTED = '#7b8190', LINE = '#e6e3de', ACCENT = '#e0701a';
  const pages = [];
  let ctx, y;
  const font = (size, weight = 400) => `${weight} ${size}px ${PDF_FONT}`;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(PDF_W * PDF_SCALE); c.height = Math.round(PDF_H * PDF_SCALE);
    ctx = c.getContext('2d');
    ctx.scale(PDF_SCALE, PDF_SCALE);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PDF_W, PDF_H);
    ctx.textBaseline = 'alphabetic';
    pages.push(c); y = M;
  };
  const put = (str, x, yy, size, { weight = 400, color = INK, align = 'left', maxW = 0 } = {}) => {
    ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = align;
    let s = String(str ?? '');
    if (maxW > 0 && ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s += '…';
    }
    ctx.fillText(s, x, yy);
  };
  const wrap = (str, size, weight, maxW, maxLines) => {
    ctx.font = font(size, weight);
    const lines = []; let line = '';
    String(str ?? '').split(/\s+/).filter(Boolean).forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (!line || ctx.measureText(t).width <= maxW) line = t; else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    return lines.length ? lines : [''];
  };
  const rule = (yy, color = LINE, x = M, w = W, h = 0.8) => { ctx.fillStyle = color; ctx.fillRect(x, yy, w, h); };
  const ensure = h => { if (y + h > BOTTOM) { newPage(); return true; } return false; };

  newPage();

  // ── Header: logo + business (left) · document type, number, date (right)
  let tx = M;
  if (logo) {
    const s = 40;
    ctx.save(); ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(M, y, s, s, 10); else ctx.rect(M, y, s, s);
    ctx.clip();
    const r = Math.max(s / logo.width, s / logo.height);
    ctx.drawImage(logo, M + (s - logo.width * r) / 2, y + (s - logo.height * r) / 2, logo.width * r, logo.height * r);
    ctx.restore();
    tx = M + s + 12;
  }
  const nameW = W * 0.56 - (tx - M);
  put(b.name, tx, y + (b.tagline ? 17 : 25), 15, { weight: 700, maxW: nameW });
  if (b.tagline) put(b.tagline, tx, y + 33, 9.5, { color: MUTED, maxW: nameW });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
  put(d.kind.toUpperCase(), M + W, y + 13, 13, { weight: 700, align: 'right', color: ACCENT });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  put(d.number, M + W, y + 30, 10.5, { weight: 600, align: 'right' });
  put(d.date, M + W, y + 44, 9.5, { color: MUTED, align: 'right' });
  y += 62;
  rule(y); y += 24;

  // ── Parties (billed to / branch / payment …)
  const cw = W / d.parties.length;
  let partyH = 0;
  d.parties.forEach((p, i) => {
    const x = M + i * cw;
    put(p.label.toUpperCase(), x, y, 7.5, { weight: 600, color: MUTED });
    const lines = wrap(p.value, 10.5, 600, cw - 14, 2);
    lines.forEach((ln, k) => put(ln, x, y + 17 + k * 14, 10.5, { weight: 600 }));
    let h = 17 + (lines.length - 1) * 14;
    if (p.sub) { h += 14; put(p.sub, x, y + h, 9, { color: MUTED, maxW: cw - 14 }); }
    partyH = Math.max(partyH, h);
  });
  y += partyH + 38;

  // ── Items table
  const C = [{ x: M, align: 'left' }, { x: M + W * 0.64, align: 'right' }, { x: M + W * 0.82, align: 'right' }, { x: M + W, align: 'right' }];
  const itemW = W * 0.52;
  const tableHead = () => {
    d.columns.forEach((c, i) => put(c.toUpperCase(), C[i].x, y, 7.5, { weight: 600, color: MUTED, align: C[i].align }));
    y += 9; rule(y, INK, M, W, 0.9); y += 20;
  };
  tableHead();
  d.rows.forEach(r => {
    const lines = wrap(r.cells[0], 10, 500, itemW, 3);
    const extraH = (lines.length - 1) * 13 + (r.sub ? 13 : 0);
    if (ensure(extraH + 26)) tableHead();
    lines.forEach((ln, k) => put(ln, M, y + k * 13, 10, { weight: 500 }));
    for (let i = 1; i < r.cells.length; i++) put(r.cells[i], C[i].x, y, 10, { align: 'right', weight: i === 3 ? 600 : 400 });
    if (r.sub) put(r.sub, M, y + lines.length * 13, 8.5, { weight: 600, color: ACCENT });
    y += extraH + 11; rule(y); y += 19;
  });

  // ── Totals (right column)
  const TW = 230, TX = M + W - TW;
  ensure(d.totals.length * 20 + 20);
  y += 2;
  d.totals.forEach(([label, val, strong]) => {
    if (strong) { rule(y - 11, INK, TX, TW, 0.9); y += 7; }
    put(label, TX, y, strong ? 11 : 9.5, { color: strong ? INK : MUTED, weight: strong ? 700 : 400 });
    put(val, M + W, y, strong ? 13 : 10, { align: 'right', weight: strong ? 700 : 500 });
    y += strong ? 24 : 18;
  });

  // ── Extra section (returns)
  if (d.extra) {
    ensure(54 + d.extra.lines.length * 18);
    y += 12;
    put(d.extra.title.toUpperCase(), M, y, 7.5, { weight: 600, color: MUTED });
    y += 9; rule(y); y += 18;
    d.extra.lines.forEach(([left, right]) => {
      const ls = wrap(left, 9.5, 400, W - 120, 3);
      ensure(ls.length * 12 + 10);
      ls.forEach((ln, k) => put(ln, M, y + k * 12, 9.5, { color: '#3a3f4a' }));
      put(right, M + W, y, 9.5, { align: 'right', weight: 600, color: ACCENT });
      y += (ls.length - 1) * 12 + 18;
    });
    if (d.extra.total) {
      rule(y - 9, INK, TX, TW, 0.9); y += 9;
      put(d.extra.total[0], TX, y, 11, { weight: 700 });
      put(d.extra.total[1], M + W, y, 13, { weight: 700, align: 'right' });
      y += 24;
    }
  }

  // ── Note
  if (d.note) {
    ensure(48);
    y += 12;
    put(d.note[0].toUpperCase(), M, y, 7.5, { weight: 600, color: MUTED });
    y += 16;
    wrap(d.note[1], 9.5, 400, W, 8).forEach(ln => { ensure(14); put(ln, M, y, 9.5, { color: '#3a3f4a' }); y += 13; });
  }

  // ── Footer on every page
  pages.forEach((c, i) => {
    ctx = c.getContext('2d');
    rule(PDF_H - M - 12);
    put(d.footer || b.name, M, PDF_H - M + 4, 8.5, { color: MUTED, maxW: W * 0.6 });
    put(pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : `${b.name} · ${fmtDate(new Date())}`, M + W, PDF_H - M + 4, 8.5, { color: MUTED, align: 'right', maxW: W * 0.38 });
  });
  return pages;
}

function canvasToJPEG(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(bl => bl ? resolve(bl) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9));
}
function pdfString(s) {          // plain ASCII for the PDF's Title field
  return String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, m => '\\' + m);
}

// Packs page images into a PDF file (one full-page JPEG per page)
async function pagesToPDF(pages, title) {
  return jpegsToPDF(await canvasesToJpegs(pages, []), title);
}
function jpegsToPDF(jpegs, title) {
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let size = 0;
  const push = p => { const bytes = typeof p === 'string' ? enc.encode(p) : p; parts.push(bytes); size += bytes.length; };
  const obj = (num, write) => { offsets[num] = size; push(`${num} 0 obj\n`); write(); push('\nendobj\n'); };

  push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const n = jpegs.length;
  const pageNum = i => 3 + i * 3, imgNum = i => 4 + i * 3, contentNum = i => 5 + i * 3, infoNum = 3 + n * 3;
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${jpegs.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${n} >>`));
  for (let i = 0; i < n; i++) {
    const { bytes, w, h } = jpegs[i];
    obj(pageNum(i), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /XObject << /Im0 ${imgNum(i)} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentNum(i)} 0 R >>`));
    obj(imgNum(i), () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes); push('\nendstream');
    });
    const draw = `q\n${PDF_W} 0 0 ${PDF_H} 0 0 cm\n/Im0 Do\nQ`;
    obj(contentNum(i), () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  }
  const d = new Date(), pad = v => String(v).padStart(2, '0');
  obj(infoNum, () => push(`<< /Title (${pdfString(title)}) /Producer (${pdfString(brand().name)}) /CreationDate (D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}) >>`));
  const xref = size;
  push(`xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`);
  for (let k = 1; k <= infoNum; k++) push(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Share or Download buttons on sales, purchases and transfers
async function docAction(kind, id, how, btn) {
  if (state.pdfBusy) return;
  let spec = null;
  if (kind === 'return') { const f = findReturn(id); if (f) spec = returnDocSpec(f.s, f.r, f.i); }
  else {
    const rec = kind === 'sale' ? state.sales.find(x => x.id === id)
              : kind === 'purchase' ? state.purchases.find(x => x.id === id)
              : state.transfers.find(x => x.id === id);
    if (rec) spec = kind === 'sale' ? saleDocSpec(rec) : kind === 'purchase' ? purchaseDocSpec(rec) : transferDocSpec(rec);
  }
  if (!spec) return;
  spec.fileName = spec.fileName.replace(/[^\w.\-]+/g, '-');
  state.pdfBusy = true;
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const blob = await pagesToPDF(await renderDocPages(spec), `${spec.kind} ${spec.number}`);
    const file = new File([blob], spec.fileName, { type: 'application/pdf' });
    if (how === 'share') await sharePDF(file, spec);
    else { downloadBlob(file, spec.fileName); showToast('PDF downloaded'); }
  } catch (e) {
    console.error(e);
    showToast('Could not create the PDF', 'error');
  } finally {
    state.pdfBusy = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}

async function sharePDF(file, spec) {
  const data = { files: [file], title: `${spec.kind} ${spec.number}`, text: spec.shareText };
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share(data); return; }
    catch (e) {
      if (e && e.name === 'AbortError') return;                                   // share sheet closed
      if (e && e.name === 'NotAllowedError') { offerShareAgain(file, spec); return; }   // needs a fresh tap
      throw e;
    }
  }
  downloadBlob(file, file.name);
  showToast('Sharing isn’t available in this browser, so the PDF was downloaded');
}

function offerShareAgain(file, spec) {
  state.pendingShare = { file, spec };
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic('share')}</span>PDF ready</div>
    <p class="modal-note">${esc(file.name)} is ready to send.</p>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="downloadPending()">${ic('download', 15)}Download</button>
      <button class="btn btn-primary" onclick="sharePending()">${ic('share', 15)}Share</button>
    </div>`);
}
function sharePending() {
  const p = state.pendingShare; if (!p) { closeModal(); return; }
  navigator.share({ files: [p.file], title: `${p.spec.kind} ${p.spec.number}`, text: p.spec.shareText })
    .then(() => { state.pendingShare = null; closeModal(); })
    .catch(e => { if (!e || e.name !== 'AbortError') { downloadBlob(p.file, p.file.name); state.pendingShare = null; closeModal(); } });
}
function downloadPending() {
  const p = state.pendingShare;
  if (p) downloadBlob(p.file, p.file.name);
  state.pendingShare = null; closeModal();
}


// ══════════════════════════════════════════════════════════════════════════════
// HISTORY — every sale, return, purchase and transfer in one place,
// with search, filters, a summary and one-PDF statements.
// ══════════════════════════════════════════════════════════════════════════════

const HIST_TYPES = [['all', 'All'], ['sale', 'Sales'], ['return', 'Returns'], ['purchase', 'Purchases'], ['transfer', 'Transfers']];
const HIST_RANGES = [['all', 'All time'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['custom', 'Custom']];
const HIST_STATUS = [['all', 'Any status'], ['paid', 'Paid'], ['due', 'Money due'], ['returned', 'Returned'], ['in_transit', 'In transit'], ['received', 'Received']];
const HIST_PAY = [['all', 'Any payment'], ['cash', 'Cash'], ['card', 'Card'], ['transfer', 'Bank transfer'], ['credit', 'Credit / on account']];

function defaultHist() {
  return { q: '', type: 'all', range: 'all', from: todayISO(), to: todayISO(), branch: 'all', pay: 'all', status: 'all', party: null, limit: 40 };
}
function hist() { if (!state.hist) state.hist = defaultHist(); return state.hist; }

// One flat, newest-first list of everything that happened
function historyRecords() {
  const out = [];
  state.sales.forEach(s => {
    const party = s.customerName || 'Walk-in customer';
    const number = saleInvoiceNo(s);
    const names = (s.items || []).map(it => it.productName).join(' ');
    const st = saleStatus(s);
    out.push({ type: 'sale', id: s.id, key: 'sale:' + s.id, rec: s, date: recordDate(s), ts: toDate(s.timestamp),
      party, partyKind: 'customer', number, amount: saleTotal(s), net: saleNetTotal(s),
      branches: [s.branchId || MAIN_BRANCH], pay: payOf(s), status: st === 'paid' ? ['paid'] : ['returned', 'paid'],
      units: (s.items || []).reduce((a, it) => a + (Number(it.quantity) || 0), 0),
      text: `${party} ${number} ${s.branchName || ''} ${names} ${s.deliveryNote || ''}`.toLowerCase() });
    saleReturns(s).forEach((r, i) => {
      out.push({ type: 'return', id: `${s.id}:${r.id || i}`, key: `return:${s.id}:${r.id || i}`, rec: s, ret: r, date: isoToDate(r.date), ts: new Date(r.at || isoToDate(r.date)),
        party, partyKind: 'customer', number: `${number}-R${i + 1}`, amount: -(Number(r.total) || 0),
        branches: [s.branchId || MAIN_BRANCH], pay: payOf(s), status: ['returned'],
        units: (r.items || []).reduce((a, it) => a + (Number(it.quantity) || 0), 0),
        text: `${party} ${number} return ${(r.items || []).map(it => it.productName).join(' ')} ${r.note || ''}`.toLowerCase() });
    });
  });
  state.purchases.forEach(p => {
    const quick = purchaseType(p) === 'quick';
    const party = quick ? (p.shop || 'Quick buy') : (p.supplierName || 'Unknown vendor');
    const number = quick ? 'Quick buy' : (p.poNo || 'PO');
    const due = purchaseDue(p);
    out.push({ type: 'purchase', id: p.id, key: 'purchase:' + p.id, rec: p, date: recordDate(p), ts: toDate(p.timestamp),
      party, partyKind: quick ? 'shop' : 'vendor', number, amount: purchaseTotal(p), due,
      branches: [p.branchId || MAIN_BRANCH], pay: quick ? payOf(p) : (due > 0.004 ? 'credit' : 'paid'), status: [due > 0.004 ? 'due' : 'paid'],
      units: quick ? (Number(p.quantity) || 1) : purchaseUnits(p),
      text: `${party} ${number} ${p.branchName || ''} ${quick ? (p.itemName || '') : (p.items || []).map(it => it.productName).join(' ')}`.toLowerCase() });
  });
  state.transfers.forEach(tr => {
    const party = `${shortBranch(tr.fromName)} → ${shortBranch(tr.toName)}`;
    out.push({ type: 'transfer', id: tr.id, key: 'transfer:' + tr.id, rec: tr, date: toDate(tr.timestamp), ts: toDate(tr.timestamp),
      party, partyKind: 'branch', number: tr.transferNo || 'Transfer', amount: Number(tr.value) || 0,
      branches: [tr.fromId, tr.toId], pay: '', status: [tr.status === 'received' ? 'received' : 'in_transit'],
      units: Number(tr.units) || 0,
      text: `${tr.fromName || ''} ${tr.toName || ''} ${tr.transferNo || ''} ${(tr.items || []).map(it => it.productName).join(' ')} ${tr.note || ''}`.toLowerCase() });
  });
  return out.sort((a, b) => b.date - a.date || b.ts - a.ts);
}

function histRange(h) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (h.range === 'today') return [start, null];
  if (h.range === 'week') { const s = new Date(start); s.setDate(s.getDate() - 6); return [s, null]; }
  if (h.range === 'month') return [new Date(start.getFullYear(), start.getMonth(), 1), null];
  if (h.range === 'custom') {
    const a = isoToDate(h.from || todayISO()), b = isoToDate(h.to || todayISO());
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const end = new Date(hi); end.setHours(23, 59, 59, 999);
    return [lo, end];
  }
  return [null, null];
}

function filteredHistory() {
  const h = hist();
  const q = h.q.trim().toLowerCase();
  const [from, to] = histRange(h);
  return historyRecords().filter(r => {
    if (h.type !== 'all' && r.type !== h.type) return false;
    if (h.party && !(r.partyKind === h.party.kind && r.party.trim().toLowerCase() === h.party.name.trim().toLowerCase())) return false;
    if (q && !r.text.includes(q)) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (h.branch !== 'all' && !r.branches.includes(h.branch)) return false;
    if (h.pay !== 'all' && r.pay !== h.pay) return false;
    if (h.status !== 'all' && !r.status.includes(h.status)) return false;
    return true;
  });
}

// Totals for whatever is shown
function historySummary(list) {
  const sum = (type, f) => list.filter(r => r.type === type).reduce((a, r) => a + f(r), 0);
  const count = type => list.filter(r => r.type === type).length;
  const sales = sum('sale', r => r.amount), returns = -sum('return', r => r.amount);
  return {
    sales: { n: count('sale'), total: sales },
    returns: { n: count('return'), total: returns },
    net: sales - returns,
    purchases: { n: count('purchase'), total: sum('purchase', r => r.amount), due: sum('purchase', r => r.due || 0) },
    transfers: { n: count('transfer'), units: sum('transfer', r => r.units), value: sum('transfer', r => r.amount) },
  };
}
function summaryStats(sm) {
  const stats = [];
  if (sm.sales.n) stats.push({ label: 'Sales', value: fmt(sm.sales.total), sub: plural(sm.sales.n, 'invoice') });
  if (sm.returns.n) stats.push({ label: 'Returns', value: '−' + fmt(sm.returns.total), sub: plural(sm.returns.n, 'return'), tone: 'red' });
  if (sm.sales.n || sm.returns.n) stats.push({ label: 'Net sales', value: fmt(sm.net), sub: 'after returns', tone: 'green' });
  if (sm.purchases.n) stats.push({ label: 'Purchases', value: fmt(sm.purchases.total), sub: plural(sm.purchases.n, 'purchase') });
  if (sm.purchases.due > 0.004) stats.push({ label: 'Still to pay', value: fmt(sm.purchases.due), sub: 'balance due', tone: 'red' });
  if (sm.transfers.n) stats.push({ label: 'Transfers', value: plural(sm.transfers.units, 'unit'), sub: `${plural(sm.transfers.n, 'transfer')} · ${fmt(sm.transfers.value)}` });
  return stats;
}

// Customers / vendors whose name matches what's typed
function historyPartySuggestions(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const map = new Map();
  historyRecords().forEach(r => {
    if (r.partyKind !== 'customer' && r.partyKind !== 'vendor' && r.partyKind !== 'shop') return;
    if (r.type === 'return') return;
    if (!r.party.toLowerCase().includes(q)) return;
    const key = r.partyKind + ':' + r.party.trim().toLowerCase();
    const v = map.get(key) || { kind: r.partyKind, name: r.party.trim(), n: 0 };
    v.n += 1; map.set(key, v);
  });
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 6);
}

function historyTitle(h) {
  if (h.party) return h.party.kind === 'customer' ? 'Customer statement' : h.party.kind === 'vendor' ? 'Vendor statement' : 'Shop purchases';
  return { all: 'Activity report', sale: 'Sales report', return: 'Returns report', purchase: 'Purchase report', transfer: 'Transfer report' }[h.type];
}
function historyPeriodLabel(h, list) {
  if (h.range === 'today') return fmtDate(new Date());
  if (h.range === 'week' || h.range === 'month') { const [a] = histRange(h); return `${fmtDate(a)} – ${fmtDate(new Date())}`; }
  if (h.range === 'custom') { const [a, b] = histRange(h); return `${fmtDate(a)} – ${fmtDate(b)}`; }
  if (!list.length) return 'All time';
  const first = fmtDate(list[list.length - 1].date), last = fmtDate(list[0].date);
  return first === last ? first : `${first} – ${last}`;
}
function historyFilterNotes(h) {
  const notes = [];
  if (h.q.trim()) notes.push(`Search: “${h.q.trim()}”`);
  if (h.branch !== 'all') notes.push(`Shop: ${(branchById(h.branch) || {}).name || '—'}`);
  if (h.pay !== 'all') notes.push(`Payment: ${HIST_PAY.find(x => x[0] === h.pay)[1]}`);
  if (h.status !== 'all') notes.push(`Status: ${HIST_STATUS.find(x => x[0] === h.status)[1]}`);
  return notes;
}

// ── Page ────────────────────────────────────────────────────────────────────
function openHistory(opts = {}) {
  state.hist = Object.assign(defaultHist(), opts);
  navigateTo('history');
  const input = document.getElementById('hist-search');
  if (input) input.value = hist().q;
  window.scrollTo(0, 0);
}

// Opens one record from Home: History with that record expanded
function openRecord(key) {
  const [type, ...rest] = key.split(':');
  const id = rest.join(':');
  if (type === 'sale') state.expandedSales[id] = true;
  if (type === 'purchase') state.expandedPurchases[id] = true;
  if (type === 'transfer') state.expandedTransfers[id] = true;
  if (type === 'return') state.expandedReturns[id] = true;
  openHistory();
  const all = filteredHistory();
  const idx = all.findIndex(r => r.key === key);
  if (idx >= hist().limit) { hist().limit = idx + 10; renderHistoryBody(); }
  const el = document.querySelector(`[data-rec="${CSS.escape(key)}"]`);
  if (el) { el.scrollIntoView({ block: 'center' }); }
}

function renderHistory() {
  const c = document.getElementById('history-page');
  if (!c) return;
  if (!document.getElementById('hist-search')) {
    c.innerHTML = `
      <div class="page-head"><div class="page-head-text"><span class="page-title">History</span><span class="page-date">Sales, returns, purchases and transfers</span></div></div>
      <div class="hist-search-row">
        <div class="search">${ic('search', 17)}<input type="search" id="hist-search" placeholder="Search name, invoice or product" autocomplete="off"></div>
        <button class="round-btn filter-btn" id="hist-filter-btn" onclick="openHistoryFilters()" aria-label="More filters" title="More filters">${ic('filter', 17)}<span class="filter-badge" id="hist-filter-badge" hidden></span></button>
      </div>
      <div id="hist-body" class="hist-body"></div>`;
    const input = document.getElementById('hist-search');
    input.value = hist().q;
    input.addEventListener('input', () => { hist().q = input.value; hist().limit = 40; renderHistoryBody(); });
  }
  renderHistoryBody();
}

function renderHistoryBody() {
  const body = document.getElementById('hist-body');
  if (!body) return;
  const h = hist();
  const list = filteredHistory();
  const sm = historySummary(list);
  const stats = summaryStats(sm);
  const sugg = h.party ? [] : historyPartySuggestions(h.q);
  const anyHistory = state.sales.length + state.purchases.length + state.transfers.length > 0;
  const nExtra = ['branch', 'pay', 'status'].filter(k => h[k] !== 'all').length;
  const badge = document.getElementById('hist-filter-badge');
  if (badge) { badge.hidden = !nExtra; badge.textContent = nExtra; }

  const kindIcon = k => k === 'customer' ? 'user' : k === 'vendor' ? 'truck' : 'bag';
  const kindName = k => k === 'customer' ? 'Customer' : k === 'vendor' ? 'Vendor' : 'Shop';
  const activeChips = [
    h.party ? `<button class="active-chip" onclick="clearHistParty()">${ic(kindIcon(h.party.kind), 12)}${kindName(h.party.kind)}: <bdi>${esc(h.party.name)}</bdi>${ic('x', 12, 2.4)}</button>` : '',
    h.branch !== 'all' ? `<button class="active-chip" onclick="setHist('branch', 'all')">${ic('store', 12)}${esc((branchById(h.branch) || {}).name || 'Shop')}${ic('x', 12, 2.4)}</button>` : '',
    h.pay !== 'all' ? `<button class="active-chip" onclick="setHist('pay', 'all')">${esc(HIST_PAY.find(x => x[0] === h.pay)[1])}${ic('x', 12, 2.4)}</button>` : '',
    h.status !== 'all' ? `<button class="active-chip" onclick="setHist('status', 'all')">${esc(HIST_STATUS.find(x => x[0] === h.status)[1])}${ic('x', 12, 2.4)}</button>` : '',
  ].join('');

  // Group the visible records by day
  const shown = list.slice(0, h.limit);
  let lastDay = '', rows = '';
  shown.forEach(r => {
    const day = fmtDate(r.date);
    if (day !== lastDay) { rows += `<div class="day-head">${histDayLabel(r.date)}</div>`; lastDay = day; }
    rows += `<div class="hist-entry" data-rec="${esc(r.key)}">${historyCardHTML(r)}</div>`;
  });

  body.innerHTML = `
    ${sugg.length ? `<div class="sugg-row">${sugg.map(s => `
      <button class="sugg-chip" onclick="pickHistParty(this.dataset.k, this.dataset.n)" data-k="${s.kind}" data-n="${esc(s.name)}">
        ${ic(kindIcon(s.kind), 13)}<span>${esc(s.name)}</span><small>${kindName(s.kind)} · ${s.n}</small></button>`).join('')}</div>` : ''}
    ${activeChips ? `<div class="active-row">${activeChips}</div>` : ''}
    <div class="chip-scroll" role="tablist" aria-label="Type">${HIST_TYPES.map(([k, t]) =>
      `<button class="hchip${h.type === k ? ' active' : ''}" role="tab" aria-selected="${h.type === k}" onclick="setHist('type', '${k}')">${t}</button>`).join('')}</div>
    <div class="chip-scroll" role="tablist" aria-label="Date">${HIST_RANGES.map(([k, t]) =>
      `<button class="hchip small${h.range === k ? ' active' : ''}" role="tab" aria-selected="${h.range === k}" onclick="setHist('range', '${k}')">${t}</button>`).join('')}</div>
    ${h.range === 'custom' ? `
    <div class="range-custom">
      <div class="field"><label for="hist-from">From</label><input type="date" id="hist-from" value="${h.from}" max="${todayISO()}" onchange="setHist('from', this.value)"></div>
      <div class="field"><label for="hist-to">To</label><input type="date" id="hist-to" value="${h.to}" max="${todayISO()}" onchange="setHist('to', this.value)"></div>
    </div>` : ''}

    <div class="box hist-summary">
      <div class="box-head">
        <div class="box-head-text"><span class="box-title">${esc(h.party ? h.party.name : historyTitle(h))}</span>
          <span class="box-sub">${plural(list.length, 'record')} · ${esc(historyPeriodLabel(h, list))}</span></div>
      </div>
      ${stats.length ? `<div class="stat-grid">${stats.map(s => `
        <div class="stat"><span class="stat-label">${s.label}</span><span class="stat-val${s.tone ? ' ' + s.tone : ''}">${s.value}</span><span class="stat-sub">${s.sub}</span></div>`).join('')}</div>` : ''}
      <div class="dd-actions" style="margin-top:2px">
        <button class="btn btn-soft btn-sm" onclick="askStatement('download', this)" ${list.length ? '' : 'disabled'}>${ic('download', 14)}Download PDF</button>
        <button class="btn btn-ghost btn-sm" onclick="askStatement('share', this)" ${list.length ? '' : 'disabled'}>${ic('share', 14)}Share</button>
      </div>
    </div>

    <div class="box">
      ${list.length ? `<div class="hist hist-all">${rows}</div>
        ${list.length > h.limit ? `<button class="more-btn" onclick="hist().limit += 40; renderHistoryBody()">Show more (${list.length - h.limit})</button>` : ''}`
      : `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('clock', 20)}</span><span class="empty-title">${anyHistory ? 'Nothing matches' : 'No history yet'}</span>
          <span class="empty-text">${anyHistory ? 'Try a different search, date or filter' : 'Sales, purchases and transfers will appear here'}</span>
          ${anyHistory ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="resetHistory()">Clear filters</button>` : ''}</div>`}
    </div>`;
}

function histDayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((today - x) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return x.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: x.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function historyCardHTML(r) {
  if (r.type === 'sale') return renderSaleCard(r.rec);
  if (r.type === 'purchase') return purchaseCardHTML(r.rec);
  if (r.type === 'transfer') return transferCardHTML(r.rec);
  return returnCardHTML(r);
}

function setHist(key, value) {
  const h = hist();
  h[key] = value;
  h.limit = 40;
  renderHistoryBody();
}
function pickHistParty(kind, name) {
  const h = hist();
  h.party = { kind, name };
  h.q = '';
  const input = document.getElementById('hist-search'); if (input) input.value = '';
  if (h.type === 'transfer') h.type = 'all';
  h.limit = 40;
  renderHistoryBody();
}
function clearHistParty() { hist().party = null; renderHistoryBody(); }
function resetHistory() {
  state.hist = defaultHist();
  const input = document.getElementById('hist-search'); if (input) input.value = '';
  renderHistoryBody();
}

function openHistoryFilters() {
  const h = hist();
  const sel = (id, label, opts, value) => `
    <div class="field"><label for="${id}">${label}</label>
      <select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  const shops = [['all', 'All shops'], ...state.branches.map(b => [b.id, b.name])];
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic('filter')}</span>Filters</div>
    <div class="form-grid">
      ${sel('hf-branch', 'Shop', shops, h.branch)}
      ${sel('hf-pay', 'Payment', HIST_PAY, h.pay)}
      ${sel('hf-status', 'Status', HIST_STATUS, h.status)}
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="applyHistoryFilters(true)">Reset</button>
        <button class="btn btn-primary" onclick="applyHistoryFilters(false)">Show results</button>
      </div>
    </div>`);
}
function applyHistoryFilters(reset) {
  const h = hist();
  h.branch = reset ? 'all' : document.getElementById('hf-branch').value;
  h.pay = reset ? 'all' : document.getElementById('hf-pay').value;
  h.status = reset ? 'all' : document.getElementById('hf-status').value;
  h.limit = 40;
  closeModal();
  renderHistoryBody();
}

// ── Return entries (each return is its own record in History) ──
function returnCardHTML(r) {
  const s = r.rec, ret = r.ret, open = !!state.expandedReturns[r.id];
  return `
    <div class="hist-item${open ? ' open' : ''}">
      <button class="hist-row" onclick="toggleReturnExpand('${r.id}')" aria-expanded="${open}">
        <span class="ic ic-red">${ic('refund', 15)}</span>
        <div class="pr-text"><span class="cl-name">${esc(r.party)}</span><span class="pr-label">Return · ${esc(saleInvoiceNo(s))} · ${plural(r.units, 'unit')}</span></div>
        <div class="sr-end"><span class="h-amt num neg">−${fmt(Number(ret.total) || 0)}</span><span class="htag returned">${ret.type === 'full' ? 'Full return' : 'Partial'}</span></div>
        <span class="dd-chev">${ic('chevron', 16, 2.2)}</span>
      </button>
      ${open ? `
        <div class="hist-detail">
          <div class="dd-facts">
            ${fact('Return', esc(r.number))}
            ${fact('Date', fmtDate(r.date))}
            ${fact('Customer', esc(r.party))}
            ${fact('From invoice', esc(saleInvoiceNo(s)))}
            ${fact('Back in stock at', esc(s.branchName || 'Main branch'))}
            ${fact('Recorded by', esc(ret.by || 'unknown'))}
          </div>
          ${ret.note ? `<div class="sheet-note" style="margin-bottom:8px">${ic('note', 13)} ${esc(ret.note)}</div>` : ''}
          ${(ret.items || []).map(it => `
            <div class="line-item">
              <div class="li-text"><b>${esc(it.productName)}</b><small>${it.quantity} × ${fmt(Number(it.priceAtSale) || 0)}</small></div>
              <span class="amt">${fmt((Number(it.priceAtSale) || 0) * it.quantity)}</span>
            </div>`).join('')}
          <div class="totals">
            ${(Number(ret.vat) || 0) > 0 ? `<div class="tl"><span>Subtotal</span><span class="num">${fmt(Number(ret.subtotal) || 0)}</span></div><div class="tl"><span>VAT</span><span class="num">${fmt(Number(ret.vat))}</span></div>` : ''}
            <div class="tl total"><span>Refund</span><span class="num">${fmt(Number(ret.total) || 0)}</span></div>
          </div>
          <div class="dd-actions">
            <button class="btn btn-soft btn-sm" onclick="openHistory({ q: '${esc(saleInvoiceNo(s))}' })">${ic('doc', 14)}Open invoice</button>
            <button class="btn btn-ghost btn-sm" onclick="docAction('return', '${r.id}', 'share', this)">${ic('share', 14)}Share</button>
            <button class="btn btn-ghost btn-sm" onclick="docAction('return', '${r.id}', 'download', this)">${ic('download', 14)}PDF</button>
          </div>
        </div>` : ''}
    </div>`;
}
function toggleReturnExpand(id) { state.expandedReturns[id] = !state.expandedReturns[id]; renderCurrentPage(); }
function findReturn(id) {
  const [saleId, retId] = String(id).split(':');
  const s = state.sales.find(x => x.id === saleId);
  if (!s) return null;
  const list = saleReturns(s);
  const i = list.findIndex((r, k) => String(r.id || k) === retId);
  return i < 0 ? null : { s, r: list[i], i };
}

// ── Home: latest activity across everything ──
function recentActivityHTML() {
  const recent = historyRecords().slice(0, 5);
  if (!recent.length) return `<div class="empty-box"><span class="ic ic-white ic-lg">${ic('bolt', 20)}</span><span class="empty-title">No activity yet</span><span class="empty-text">Sales, purchases and transfers will appear here</span></div>`;
  const look = {
    sale: r => ({ icon: PAY_IC[r.pay] || 'cash', tone: PAY_TONE[r.pay] || 'green', amt: fmt(r.net), cls: 'green', tag: saleStatus(r.rec) === 'paid' ? PAY_NAME[r.pay] : TAG_LABEL[saleStatus(r.rec)], tagCls: saleStatus(r.rec) === 'paid' ? r.pay : 'out' }),
    return: r => ({ icon: 'refund', tone: 'red', amt: '−' + fmt(-r.amount), cls: 'red', tag: 'Return', tagCls: 'out' }),
    purchase: r => ({ icon: r.partyKind === 'shop' ? 'bag' : 'truck', tone: 'blue', amt: fmt(r.amount), cls: '', tag: r.due > 0.004 ? 'Due' : 'Purchase', tagCls: r.due > 0.004 ? 'low' : '' }),
    transfer: r => ({ icon: 'swapH', tone: 'orange', amt: plural(r.units, 'unit'), cls: '', tag: TAG_LABEL[r.status[0]], tagCls: r.status[0] === 'received' ? 'ok' : 'low' }),
  };
  return `<div class="box-list">${recent.map(r => {
    const l = look[r.type](r);
    const what = r.type === 'sale' ? itemsSummary(r.rec.items) : r.type === 'purchase' ? r.number : r.type === 'return' ? 'Return · ' + saleInvoiceNo(r.rec) : r.number;
    return `
    <div class="soft-row" role="button" tabindex="0" style="cursor:pointer" onclick="openRecord('${esc(r.key)}')">
      <span class="ic ic-${l.tone}">${ic(l.icon)}</span>
      <div class="sr-text"><span class="sr-title">${esc(r.party)}</span><span class="sr-sub">${esc(what)} · ${fmtDate(r.date)}</span></div>
      <div class="sr-end"><span class="sr-val ${l.cls}">${l.amt}</span>${l.tag ? `<span class="tag ${l.tagCls}">${esc(l.tag)}</span>` : ''}</div>
    </div>`; }).join('')}</div>`;
}


// ── Credit note for one return ──────────────────────────────────────────────
function returnDocSpec(s, r, i) {
  const b = brand(), inv = saleInvoiceNo(s), no = `${inv}-R${i + 1}`;
  return {
    kind: 'Credit note', number: no, date: fmtDate(isoToDate(r.date)),
    parties: [
      { label: 'Customer', value: s.customerName || 'Walk-in customer' },
      { label: 'Original invoice', value: inv, sub: fmtDate(recordDate(s)) },
      { label: 'Refund', value: r.type === 'full' ? 'Full return' : 'Partial return', sub: s.branchName || 'Main branch' },
    ],
    columns: ['Item', 'Qty', 'Unit price', 'Amount'],
    rows: (r.items || []).map(it => ({ cells: [it.productName || 'Item', String(it.quantity), fmtNum(it.priceAtSale), fmtNum((Number(it.priceAtSale) || 0) * it.quantity)], sub: '' })),
    totals: [
      ...((Number(r.vat) || 0) > 0 ? [['Subtotal', fmtNum(r.subtotal)], ['VAT', fmtNum(r.vat)]] : []),
      ['Refund', fmt(Number(r.total) || 0), true],
    ],
    extra: null,
    note: r.note ? ['Reason', r.note] : null,
    footer: b.name,
    fileName: `Credit-note-${no}.pdf`,
    shareText: `Credit note ${no} from ${b.name} · ${fmt(Number(r.total) || 0)}`,
  };
}

function recordDocSpec(r) {
  if (r.type === 'sale') return saleDocSpec(r.rec);
  if (r.type === 'purchase') return purchaseDocSpec(r.rec);
  if (r.type === 'transfer') return transferDocSpec(r.rec);
  const f = findReturn(r.id);
  return f ? returnDocSpec(f.s, f.r, f.i) : null;
}

// ── Statement: everything shown in History as one PDF ──────────────────────
function askStatement(how) {
  const list = filteredHistory();
  if (!list.length) return;
  const h = hist();
  showModal(`
    <div class="modal-title"><span class="ic ic-orange">${ic(how === 'share' ? 'share' : 'download')}</span>${esc(historyTitle(h))}</div>
    <p class="modal-note">${h.party ? `<bdi>${esc(h.party.name)}</bdi> · ` : ''}${plural(list.length, 'record')} · ${esc(historyPeriodLabel(h, list))}</p>
    <div class="pick-list">
      <button class="pick-row" onclick="buildStatement('summary', '${how}')">
        <span class="ic ic-orange">${ic('doc', 17)}</span>
        <span class="set-text"><span class="set-title">Summary only</span><span class="set-sub">Totals and one table of every record · short, good for WhatsApp</span></span>
      </button>
      <button class="pick-row" onclick="buildStatement('full', '${how}')">
        <span class="ic ic-blue">${ic('note', 17)}</span>
        <span class="set-text"><span class="set-title">Summary + every invoice</span><span class="set-sub">Then each record in full, one per page · ${plural(list.length, 'extra page')}</span></span>
      </button>
    </div>
    <div class="stmt-progress" id="stmt-progress" hidden></div>`);
}

function statementSpec(list) {
  const h = hist(), b = brand(), sm = historySummary(list);
  const typeName = { sale: 'Sale', return: 'Return', purchase: 'Purchase', transfer: 'Transfer' };
  const showParty = !h.party;
  const rows = [...list].reverse().map(r => {
    let details = '';
    if (r.type === 'sale') details = itemsSummary(r.rec.items) + (saleStatus(r.rec) !== 'paid' ? ` · ${TAG_LABEL[saleStatus(r.rec)].toLowerCase()}` : '');
    if (r.type === 'return') details = (r.ret.items || []).map(it => `${it.quantity} × ${it.productName}`).join(', ') + (r.ret.note ? ` · ${r.ret.note}` : '');
    if (r.type === 'purchase') details = (purchaseType(r.rec) === 'quick' ? `${r.rec.itemName || 'Item'} × ${r.rec.quantity || 1}` : `${plural(r.units, 'unit')}`) + (r.due > 0.004 ? ` · ${fmt(r.due)} due` : '');
    if (r.type === 'transfer') details = `${plural(r.units, 'unit')} · ${TAG_LABEL[r.status[0]].toLowerCase()}`;
    if (showParty && r.type !== 'transfer') details = `${r.party} · ${details}`;
    if (r.type === 'transfer') details = `${r.party} · ${details}`;
    const amount = r.type === 'return' ? `− ${fmtNum(-r.amount)}` : fmtNum(r.amount);
    return { date: fmtDate(r.date), number: r.number, type: typeName[r.type], details, amount, neg: r.type === 'return', muted: r.type === 'transfer' };
  });
  const stats = summaryStats(sm).map(s => [s.label, s.value, s.sub]);
  if (h.party && h.party.kind === 'vendor') {
    const paid = sm.purchases.total - sm.purchases.due;
    stats.splice(1, 0, ['Paid', fmt(paid), 'so far']);
  }
  const title = historyTitle(h);
  // Browsers drop non-Latin download names, so the file name uses plain characters only
  const slug = h.party ? h.party.name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') : '';
  return {
    kind: title, number: h.party ? h.party.name : '', period: historyPeriodLabel(h, list),
    subject: h.party ? { label: h.party.kind === 'customer' ? 'Customer' : h.party.kind === 'vendor' ? 'Vendor' : 'Shop', value: h.party.name } : null,
    notes: historyFilterNotes(h),
    stats, rows,
    footer: `${b.name} · ${plural(list.length, 'record')}`,
    fileName: `${title.replace(/\s+/g, '-')}${slug ? '-' + slug : ''}-${todayISO()}.pdf`,
    shareText: `${title}${h.party ? ' — ' + h.party.name : ''} · ${historyPeriodLabel(h, list)}`,
  };
}

// Draws the statement (summary box + table) onto A4 canvases
async function renderStatementPages(st) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  const b = brand();
  let logo = null;
  if (b.logo) { try { logo = await loadImage(b.logo); } catch (e) {} }
  const M = PDF_M, W = PDF_W - 2 * M, BOTTOM = PDF_H - M - 30;
  const INK = '#16181d', MUTED = '#7b8190', LINE = '#e6e3de', ACCENT = '#e0701a', SOFT = '#f6f4f1', RED = '#c2410c', GREEN = '#15803d';
  const pages = [];
  let ctx, y;
  const font = (size, weight = 400) => `${weight} ${size}px ${PDF_FONT}`;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(PDF_W * PDF_SCALE); c.height = Math.round(PDF_H * PDF_SCALE);
    ctx = c.getContext('2d'); ctx.scale(PDF_SCALE, PDF_SCALE);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PDF_W, PDF_H);
    pages.push(c); y = M;
  };
  const put = (str, x, yy, size, { weight = 400, color = INK, align = 'left', maxW = 0 } = {}) => {
    ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = align;
    let s = String(str ?? '');
    if (maxW > 0 && ctx.measureText(s).width > maxW) { while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); s += '…'; }
    ctx.fillText(s, x, yy);
  };
  const wrap = (str, size, weight, maxW, maxLines) => {
    ctx.font = font(size, weight);
    const lines = []; let line = '';
    String(str ?? '').split(/\s+/).filter(Boolean).forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (!line || ctx.measureText(t).width <= maxW) line = t; else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    return lines.length ? lines : [''];
  };
  const rule = (yy, color = LINE, x = M, w = W, h = 0.8) => { ctx.fillStyle = color; ctx.fillRect(x, yy, w, h); };

  newPage();
  // Header
  let tx = M;
  if (logo) {
    const s = 40;
    ctx.save(); ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(M, y, s, s, 10); else ctx.rect(M, y, s, s);
    ctx.clip();
    const r = Math.max(s / logo.width, s / logo.height);
    ctx.drawImage(logo, M + (s - logo.width * r) / 2, y + (s - logo.height * r) / 2, logo.width * r, logo.height * r);
    ctx.restore(); tx = M + s + 12;
  }
  const nameW = W * 0.5 - (tx - M);
  put(b.name, tx, y + (b.tagline ? 17 : 25), 15, { weight: 700, maxW: nameW });
  if (b.tagline) put(b.tagline, tx, y + 33, 9.5, { color: MUTED, maxW: nameW });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
  put(st.kind.toUpperCase(), M + W, y + 13, 13, { weight: 700, align: 'right', color: ACCENT, maxW: W * 0.48 });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  put(st.period, M + W, y + 30, 10, { weight: 600, align: 'right', maxW: W * 0.48 });
  put(`Made ${fmtDate(new Date())}`, M + W, y + 44, 9, { color: MUTED, align: 'right' });
  y += 62; rule(y); y += 24;

  // Who / filters
  if (st.subject) {
    put(st.subject.label.toUpperCase(), M, y, 7.5, { weight: 600, color: MUTED });
    put(st.subject.value, M, y + 18, 14, { weight: 700, maxW: W });
    y += 30;
  }
  if (st.notes.length) { put(st.notes.join('   ·   '), M, y + 4, 9, { color: MUTED, maxW: W }); y += 18; }
  y += 6;

  // Summary box
  if (st.stats.length) {
    const cols = Math.min(3, st.stats.length), rowsN = Math.ceil(st.stats.length / cols);
    const cellW = (W - 24) / cols, cellH = 46, boxH = rowsN * cellH + 16;
    ctx.fillStyle = SOFT;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(M, y, W, boxH, 12); else ctx.rect(M, y, W, boxH); ctx.fill();
    st.stats.forEach(([label, value, sub], i) => {
      const x = M + 12 + (i % cols) * cellW, yy = y + 8 + Math.floor(i / cols) * cellH;
      put(label.toUpperCase(), x, yy + 13, 7.5, { weight: 600, color: MUTED });
      const tone = /^−/.test(value) || label === 'Still to pay' ? RED : label === 'Net sales' ? GREEN : INK;
      put(value, x, yy + 29, 12.5, { weight: 700, color: tone, maxW: cellW - 10 });
      if (sub) put(sub, x, yy + 41, 8.5, { color: MUTED, maxW: cellW - 10 });
    });
    y += boxH + 26;
  }

  // Table
  const X = { date: M, num: M + W * 0.15, type: M + W * 0.32, det: M + W * 0.44, amt: M + W };
  const detW = W * 0.38;
  const head = () => {
    [['Date', X.date], ['Number', X.num], ['Type', X.type], ['Details', X.det]].forEach(([t, x]) => put(t.toUpperCase(), x, y, 7.5, { weight: 600, color: MUTED }));
    put('AMOUNT (SAR)', X.amt, y, 7.5, { weight: 600, color: MUTED, align: 'right' });
    y += 9; rule(y, INK, M, W, 0.9); y += 18;
  };
  head();
  st.rows.forEach(r => {
    const lines = wrap(r.details, 9, 400, detW, 3);
    const h = (lines.length - 1) * 12;
    if (y + h + 14 > BOTTOM) { newPage(); head(); }
    put(r.date, X.date, y, 9, { color: '#3a3f4a' });
    put(r.number, X.num, y, 9, { weight: 600, maxW: W * 0.16 });
    put(r.type, X.type, y, 9, { color: r.neg ? RED : MUTED, weight: r.neg ? 600 : 400 });
    lines.forEach((ln, k) => put(ln, X.det, y + k * 12, 9, { color: '#3a3f4a' }));
    put(r.amount, X.amt, y, 9.5, { align: 'right', weight: 600, color: r.neg ? RED : r.muted ? MUTED : INK });
    y += h + 9; rule(y); y += 16;
  });

  pages.forEach((c, i) => {
    ctx = c.getContext('2d');
    rule(PDF_H - M - 12);
    put(st.footer, M, PDF_H - M + 4, 8.5, { color: MUTED, maxW: W * 0.6 });
    put(`Page ${i + 1} of ${pages.length}`, M + W, PDF_H - M + 4, 8.5, { color: MUTED, align: 'right' });
  });
  return pages;
}

// Canvases → JPEG page images, freeing each canvas straight away (keeps memory low for long statements)
async function canvasesToJpegs(pages, out) {
  for (const c of pages) {
    const bytes = new Uint8Array(await (await canvasToJPEG(c)).arrayBuffer());
    out.push({ bytes, w: c.width, h: c.height });
    c.width = 0; c.height = 0;
  }
  return out;
}

async function buildStatement(mode, how) {
  if (state.pdfBusy) return;
  const list = filteredHistory();
  if (!list.length) return;
  const progress = document.getElementById('stmt-progress');
  const say = t => { if (progress) { progress.hidden = false; progress.textContent = t; } };
  document.querySelectorAll('.pick-row').forEach(b => { b.disabled = true; });
  state.pdfBusy = true;
  try {
    const st = statementSpec(list);
    say('Preparing summary…');
    const jpegs = await canvasesToJpegs(await renderStatementPages(st), []);
    if (mode === 'full') {
      const ordered = [...list].reverse();
      for (let i = 0; i < ordered.length; i++) {
        say(`Adding invoice ${i + 1} of ${ordered.length}…`);
        const spec = recordDocSpec(ordered[i]);
        if (spec) await canvasesToJpegs(await renderDocPages(spec), jpegs);
      }
    }
    say('Saving PDF…');
    const blob = await jpegsToPDF(jpegs, `${st.kind} ${st.number}`.trim());
    const name = st.fileName.replace(/[^\w.\-]+/g, '-');
    const file = new File([blob], name, { type: 'application/pdf' });
    state.pdfBusy = false;
    closeModal();
    if (how === 'share') await sharePDF(file, { kind: st.kind, number: st.number, shareText: st.shareText });
    else { downloadBlob(file, name); showToast('PDF downloaded'); }
  } catch (e) {
    console.error(e);
    showToast('Could not create the PDF', 'error');
    closeModal();
  } finally {
    state.pdfBusy = false;
  }
}
