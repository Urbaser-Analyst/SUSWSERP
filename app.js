/*************************************************************
 * SUS WS ERP — Frontend logic
 * Set API_URL to your deployed Apps Script Web App URL.
 *************************************************************/
const API_URL = 'https://script.google.com/macros/s/AKfycbyW0owUeKXhAXdwuY1XdWNICy4Pk4GIB93A3AlaHGT9NkWYaQ0v3NK89nok4XdHp5Su/exec';
const PAGE_SIZE = 10;

const state = {
  token: localStorage.getItem('sus_token') || null,
  user: null,
  currentTab: null,
  pages: {},   // view -> next start index
  totals: {},  // view -> total rows known
  requestLineCount: 0
};

/* ---------- API wrapper ----------
   POST with text/plain content-type avoids a CORS preflight,
   which Apps Script web apps can't answer. */
async function api(action, payload) {
  const body = Object.assign({ action, token: state.token }, payload || {});
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok && data.error === 'SESSION_EXPIRED') {
    toast('Your session expired. Please log in again.', true);
    doLogout(true);
  }
  return data;
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.classList.remove('show'), 3200);
}

/* ================= BOOT ================= */
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  if (!state.token) return showLogin();
  const res = await api('validateSession', {});
  if (res.ok) {
    state.user = res.user;
    showApp();
  } else {
    localStorage.removeItem('sus_token');
    state.token = null;
    showLogin();
  }
}

function showLogin() {
  document.getElementById('full-loading').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showApp() {
  document.getElementById('who-name').textContent = state.user.userName;
  document.getElementById('who-role').textContent = state.user.role;
  buildSidebar();
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('full-loading').style.display = 'none';
}

/* ================= LOGIN / LOGOUT ================= */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('login-userid').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const res = await api('login', { userId, password });
  if (!res.ok) { errEl.textContent = res.error || 'Login failed'; return; }
  state.token = res.token;
  state.user = res.user;
  localStorage.setItem('sus_token', state.token);
  showApp();
  openTab(defaultTabForRole(state.user.role));
});

document.getElementById('logout-btn').addEventListener('click', () => doLogout(false));

async function doLogout(silent) {
  if (state.token) await api('logout', {});
  localStorage.removeItem('sus_token');
  state.token = null;
  state.user = null;
  if (!silent) toast('Logged out');
  showLogin();
}

/* ================= SIDEBAR / TABS (only the logged-in role's own tabs) ================= */
const TABS_BY_ROLE = {
  User: [
    ['newrequest', 'New request'],
    ['myrequests', 'My requests'],
    ['verify', 'Verify & receive'],
    ['return', 'Return to supplier']
  ],
  Supplier: [
    ['supply-pending', 'Pending supply'],
    ['supply-mine', 'My supplies'],
    ['supply-returns', 'Confirm returns']
  ],
  Admin: [
    ['admin-all', 'All entries'],
    ['admin-products', 'Product master']
  ]
};

function defaultTabForRole(role) { return TABS_BY_ROLE[role][0][0]; }

function buildSidebar() {
  const sb = document.getElementById('sidebar');
  sb.innerHTML = '';
  TABS_BY_ROLE[state.user.role].forEach(([id, label]) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = label;
    b.dataset.tab = id;
    b.addEventListener('click', () => openTab(id));
    sb.appendChild(b);
  });
}

function openTab(id) {
  state.currentTab = id;
  document.querySelectorAll('.sidebar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.add('active');

  if (id === 'newrequest') initRequestForm();
  else if (id === 'myrequests') loadTable('myrequests', true);
  else if (id === 'verify') loadTable('verify', true);
  else if (id === 'return') loadTable('return', true);
  else if (id === 'supply-pending') loadTable('supply-pending', true);
  else if (id === 'supply-mine') loadTable('supply-mine', true);
  else if (id === 'supply-returns') loadTable('supply-returns', true);
  else if (id === 'admin-all') loadTable('admin-all', true);
  else if (id === 'admin-products') loadProducts(true);
}

document.querySelectorAll('[data-refresh]').forEach(b => b.addEventListener('click', () => loadTable(b.dataset.refresh, true)));
document.querySelectorAll('[data-loadmore]').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.loadmore;
  if (v === 'products') loadProducts(false); else loadTable(v, false);
}));

/* ================= VIEW CONFIG: table -> backend view + columns + actions ================= */
const VIEW_MAP = {
  'myrequests': 'mine',
  'verify': 'mineVerify',
  'return': 'mineReturn',
  'supply-pending': 'pendingSupply',
  'supply-mine': 'mySupplies',
  'supply-returns': 'pendingReturnReceive',
  'admin-all': 'all'
};

const COLS = {
  myrequests: ['Entry ID','Request ID','Requested Item Text','Requested Qty','Request Status','Product Name','Received Status','Return Status'],
  verify: ['Entry ID','Request ID','Requested Item Text','Product Name','Brand','UOM','Supplied Qty','Rate'],
  return: ['Entry ID','Request ID','Product Name','Received Qty','Rejected Qty','Final Qty','Return Status'],
  'supply-pending': ['Entry ID','Request ID','User Name','Requested Item Text','Requested Qty','Request Timestamp'],
  'supply-mine': ['Entry ID','Request ID','Product Name','Supplied Qty','Rate','Supply Amount','Supply Status'],
  'supply-returns': ['Entry ID','Request ID','Product Name','Return Qty','DC No','DC Date','Return Timestamp'],
  'admin-all': ['Entry ID','Request ID','User Name','Requested Item Text','Request Status','Supply Status','Received Status','Return Status','Admin Deactivate Status']
};

async function loadTable(view, reset) {
  if (reset) { state.pages[view] = 0; document.querySelector('#table-' + view + ' tbody').innerHTML = ''; }
  const start = state.pages[view] || 0;
  const res = await api('getEntries', { view: VIEW_MAP[view], pageStart: start, pageSize: PAGE_SIZE, includeArchive: false });
  if (!res.ok) { toast(res.error || 'Could not load data', true); return; }
  state.pages[view] = res.nextStart;
  renderTable(view, res.rows, reset);
  const moreBtn = document.querySelector('[data-loadmore="' + view + '"]');
  if (moreBtn) moreBtn.style.display = res.nextStart >= res.total ? 'none' : 'inline-block';
}

function renderTable(view, rows, reset) {
  const table = document.getElementById('table-' + view);
  const cols = COLS[view];
  if (reset) {
    table.querySelector('thead').innerHTML = '<tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '<th>Actions</th></tr>';
  }
  const tbody = table.querySelector('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => '<td>' + formatCell(c, r[c]) + '</td>').join('') + '<td>' + rowActions(view, r) + '</td>';
    tbody.appendChild(tr);
    tr.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.act, r)));
  });
}

function formatCell(col, val) {
  if (col.endsWith('Status') && val) return '<span class="status-pill status-' + String(val).replace(/\s/g,'-') + '">' + val + '</span>';
  if (val instanceof Date) return val;
  return val === undefined || val === null || val === '' ? '<span class="muted">—</span>' : val;
}

function rowActions(view, r) {
  const btns = [];
  if (view === 'myrequests') {
    btns.push('<button class="btn-ghost" data-act="pdf-request">Request PDF</button>');
    if (r['Supply Status']) btns.push('<button class="btn-ghost" data-act="pdf-supply">Supply PDF</button>');
    if (r['Received Status']==='Received') btns.push('<button class="btn-ghost" data-act="pdf-received">Received PDF</button>');
    if (r['Return Status']) btns.push('<button class="btn-ghost" data-act="pdf-return">Return PDF</button>');
    btns.push('<button class="btn-ghost" data-act="pdf-combined">Combined PDF</button>');
  }
  if (view === 'verify') btns.push('<button class="btn-primary" data-act="verify">Verify & receive</button>');
  if (view === 'return') btns.push('<button class="btn-primary" data-act="return">Return</button>');
  if (view === 'supply-pending') {
    btns.push('<button class="btn-primary" data-act="supply">Supply</button>');
    btns.push('<button class="btn-secondary" data-act="not-available">Not available</button>');
  }
  if (view === 'supply-returns') btns.push('<button class="btn-primary" data-act="confirm-return">Confirm received</button>');
  if (view === 'admin-all') {
    btns.push('<button class="btn-danger" data-act="deactivate"' + (r['Admin Deactivate Status']==='Deactivated' ? ' disabled' : '') + '>Disable</button>');
    btns.push('<button class="btn-ghost" data-act="pdf-combined">Combined PDF</button>');
  }
  return btns.join(' ');
}

function handleAction(act, r) {
  if (act === 'verify') return openVerifyModal(r);
  if (act === 'return') return openReturnModal(r);
  if (act === 'supply') return openSupplyModal(r);
  if (act === 'not-available') return openNotAvailableModal(r);
  if (act === 'confirm-return') return confirmReturnReceived(r);
  if (act === 'deactivate') return openDeactivateModal(r);
  if (act === 'pdf-request') return downloadSegmentPdf(r['Request ID'], 'Request');
  if (act === 'pdf-supply') return downloadSegmentPdf(r['Request ID'], 'Supply');
  if (act === 'pdf-received') return downloadSegmentPdf(r['Request ID'], 'Received');
  if (act === 'pdf-return') return downloadSegmentPdf(r['Request ID'], 'Return');
  if (act === 'pdf-combined') return downloadCombinedPdf(r['Request ID']);
}

/* ================= MODAL HELPERS ================= */
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('show');
}
function closeModal() { document.getElementById('modal-backdrop').classList.remove('show'); }
document.getElementById('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });

/* ---------- New Request ---------- */
function initRequestForm() {
  document.getElementById('request-lines').innerHTML = '';
  state.requestLineCount = 0;
  addRequestLine();
}
document.getElementById('add-line-btn').addEventListener('click', addRequestLine);
function addRequestLine() {
  const wrap = document.getElementById('request-lines');
  const idx = state.requestLineCount++;
  const div = document.createElement('div');
  div.className = 'request-line-row';
  div.dataset.idx = idx;
  div.innerHTML =
    '<div class="field" style="margin-bottom:0;"><label>Item needed</label><input class="line-text" placeholder="e.g. 2-inch nylon rope, heavy duty"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Qty</label><input class="line-qty" type="number" min="0" step="any"></div>' +
    '<button type="button" class="btn-ghost" title="Remove" onclick="this.parentElement.remove()">✕</button>';
  wrap.appendChild(div);
}
document.getElementById('submit-request-btn').addEventListener('click', async () => {
  const items = [...document.querySelectorAll('#request-lines .request-line-row')].map(row => ({
    itemText: row.querySelector('.line-text').value.trim(),
    qty: row.querySelector('.line-qty').value
  })).filter(it => it.itemText && it.qty);
  if (!items.length) return toast('Add at least one item with a quantity', true);
  const btn = document.getElementById('submit-request-btn');
  btn.disabled = true;
  const res = await api('createRequest', { items });
  btn.disabled = false;
  if (!res.ok) return toast(res.error || 'Could not submit request', true);
  toast('Request ' + res.requestId + ' submitted');
  initRequestForm();
  openTab('myrequests');
});

/* ---------- Verify & Receive ---------- */
function openVerifyModal(r) {
  openModal(
    '<h3>Verify & receive — ' + r['Entry ID'] + '</h3>' +
    '<p class="muted">' + r['Product Name'] + ' | Supplied: ' + r['Supplied Qty'] + ' ' + r['UOM'] + '</p>' +
    '<div class="field"><label>Received qty</label><input id="m-received" type="number" min="0" value="' + (r['Supplied Qty']||0) + '"></div>' +
    '<div class="field"><label>Rejected qty</label><input id="m-rejected" type="number" min="0" value="0"></div>' +
    '<div class="field"><label>Rejection reason (if any)</label><input id="m-reason"></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-primary" id="m-submit">Confirm receipt</button></div>'
  );
  document.getElementById('m-submit').addEventListener('click', async () => {
    const res = await api('verifyReceiveLine', {
      entryId: r['Entry ID'],
      receivedQty: document.getElementById('m-received').value,
      rejectedQty: document.getElementById('m-rejected').value,
      rejectionReason: document.getElementById('m-reason').value
    });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Received'); closeModal(); loadTable('verify', true);
  });
}

/* ---------- Return ---------- */
function openReturnModal(r) {
  openModal(
    '<h3>Return — ' + r['Entry ID'] + '</h3>' +
    '<p class="muted">Rejected qty on file: ' + r['Rejected Qty'] + '</p>' +
    '<div class="field"><label>Return qty</label><input id="m-returnqty" type="number" min="0" value="' + (r['Rejected Qty']||0) + '"></div>' +
    '<div class="field"><label>DC No</label><input id="m-dcno"></div>' +
    '<div class="field"><label>DC Date</label><input id="m-dcdate" type="date"></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-primary" id="m-submit">Submit return</button></div>'
  );
  document.getElementById('m-submit').addEventListener('click', async () => {
    const res = await api('returnLine', {
      entryId: r['Entry ID'],
      returnQty: document.getElementById('m-returnqty').value,
      dcNo: document.getElementById('m-dcno').value,
      dcDate: document.getElementById('m-dcdate').value
    });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Return recorded'); closeModal(); loadTable('return', true);
  });
}

/* ---------- Supply (map free-text request to a catalog product) ---------- */
function openSupplyModal(r) {
  openModal(
    '<h3>Supply — ' + r['Entry ID'] + '</h3>' +
    '<p class="muted">Requested: "' + r['Requested Item Text'] + '" — Qty ' + r['Requested Qty'] + '</p>' +
    '<div class="field"><label>Search product master</label><input id="m-prodsearch" placeholder="Type to search…"></div>' +
    '<div id="m-prodresults" class="muted" style="max-height:140px;overflow-y:auto;margin-bottom:10px;"></div>' +
    '<input type="hidden" id="m-prodid"><input type="hidden" id="m-prodname"><input type="hidden" id="m-prodbrand"><input type="hidden" id="m-produom">' +
    '<div class="field"><label>Supplied qty</label><input id="m-suppliedqty" type="number" min="0" value="' + r['Requested Qty'] + '"></div>' +
    '<div class="field"><label>Rate</label><input id="m-rate" type="number" min="0" step="any"></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-primary" id="m-submit">Confirm supply</button></div>'
  );
  document.getElementById('m-prodsearch').addEventListener('input', debounce(async (e) => {
    const res = await api('getProducts', { search: e.target.value, pageStart: 0, pageSize: 10 });
    const box = document.getElementById('m-prodresults');
    box.innerHTML = (res.rows || []).map(p =>
      '<div style="padding:6px;border-bottom:1px solid var(--border);cursor:pointer;" data-pick=\'' + JSON.stringify(p).replace(/'/g,'&#39;') + '\'>' +
      p['Product Name'] + ' — ' + p['Brand'] + ' (' + p['UOM'] + ')</div>'
    ).join('') || 'No matches';
    box.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
      const p = JSON.parse(el.dataset.pick);
      document.getElementById('m-prodid').value = p['Product ID'];
      document.getElementById('m-prodname').value = p['Product Name'];
      document.getElementById('m-prodbrand').value = p['Brand'];
      document.getElementById('m-produom').value = p['UOM'];
      box.innerHTML = '<strong>Selected:</strong> ' + p['Product Name'];
    }));
  }, 300));
  document.getElementById('m-submit').addEventListener('click', async () => {
    if (!document.getElementById('m-prodid').value) return toast('Pick a product from the catalog', true);
    const res = await api('supplyLine', {
      entryId: r['Entry ID'], mode: 'supply',
      productId: document.getElementById('m-prodid').value,
      productName: document.getElementById('m-prodname').value,
      brand: document.getElementById('m-prodbrand').value,
      uom: document.getElementById('m-produom').value,
      suppliedQty: document.getElementById('m-suppliedqty').value,
      rate: document.getElementById('m-rate').value
    });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Supplied'); closeModal(); loadTable('supply-pending', true);
  });
}

function openNotAvailableModal(r) {
  openModal(
    '<h3>Mark not available — ' + r['Entry ID'] + '</h3>' +
    '<div class="field"><label>Reason (optional)</label><input id="m-remarks"></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-danger" id="m-submit">Confirm</button></div>'
  );
  document.getElementById('m-submit').addEventListener('click', async () => {
    const res = await api('supplyLine', { entryId: r['Entry ID'], mode: 'notAvailable', remarks: document.getElementById('m-remarks').value });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Marked not available'); closeModal(); loadTable('supply-pending', true);
  });
}

async function confirmReturnReceived(r) {
  const res = await api('returnReceivedLine', { entryId: r['Entry ID'] });
  if (!res.ok) return toast(res.error || 'Failed', true);
  toast('Return receipt confirmed'); loadTable('supply-returns', true);
}

function openDeactivateModal(r) {
  openModal(
    '<h3>Disable entry — ' + r['Entry ID'] + '</h3>' +
    '<p class="muted">This hides nothing from the database — it flags the row as disabled with your reason, visible to admins.</p>' +
    '<div class="field"><label>Reason</label><input id="m-reason" required></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-danger" id="m-submit">Disable</button></div>'
  );
  document.getElementById('m-submit').addEventListener('click', async () => {
    const reason = document.getElementById('m-reason').value.trim();
    if (!reason) return toast('Reason is required', true);
    const res = await api('adminDeactivate', { entryId: r['Entry ID'], reason });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Entry disabled'); closeModal(); loadTable('admin-all', true);
  });
}

/* ================= PRODUCT MASTER ================= */
async function loadProducts(reset) {
  if (reset) { state.pages['products'] = 0; document.querySelector('#table-products tbody').innerHTML = ''; }
  const start = state.pages['products'] || 0;
  const search = document.getElementById('product-search').value;
  const res = await api('getProducts', { pageStart: start, pageSize: PAGE_SIZE, search });
  if (!res.ok) return toast(res.error || 'Could not load products', true);
  state.pages['products'] = res.nextStart;
  const cols = ['Product ID','Product Name','Brand','UOM','Status'];
  const table = document.getElementById('table-products');
  if (reset) table.querySelector('thead').innerHTML = '<tr>' + cols.map(c=>'<th>'+c+'</th>').join('') + '<th>Image</th><th>Actions</th></tr>';
  const tbody = table.querySelector('tbody');
  res.rows.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => '<td>' + (p[c] || '<span class="muted">—</span>') + '</td>').join('') +
      '<td>' + (p['Image1'] || p['Image2'] ? '<button class="btn-ghost" data-viewimg>View</button>' : '<span class="muted">None</span>') + '</td>' +
      '<td><button class="btn-secondary" data-edit>Edit</button></td>';
    tbody.appendChild(tr);
    const imgBtn = tr.querySelector('[data-viewimg]');
    if (imgBtn) imgBtn.addEventListener('click', () => viewProductImage(p));
    tr.querySelector('[data-edit]').addEventListener('click', () => openProductModal(p));
  });
  const moreBtn = document.querySelector('[data-loadmore="products"]');
  if (moreBtn) moreBtn.style.display = res.nextStart >= res.total ? 'none' : 'inline-block';
}
document.getElementById('product-search-btn').addEventListener('click', () => loadProducts(true));
document.getElementById('new-product-btn').addEventListener('click', () => openProductModal({}));

async function viewProductImage(p) {
  const fileId = p['Image1'] || p['Image2'];
  toast('Loading image…');
  const res = await api('getProductImage', { fileId });
  if (!res.ok) return toast(res.error || 'Could not load image', true);
  openModal('<h3>' + p['Product Name'] + '</h3><img src="' + res.dataUrl + '" style="max-width:100%;border-radius:6px;"><div class="actions"><button class="btn-secondary" onclick="closeModal()">Close</button></div>');
}

function openProductModal(p) {
  openModal(
    '<h3>' + (p['Product ID'] ? 'Edit product' : 'New product') + '</h3>' +
    '<div class="field"><label>Name</label><input id="p-name" value="' + (p['Product Name']||'') + '"></div>' +
    '<div class="field"><label>Brand</label><input id="p-brand" value="' + (p['Brand']||'') + '"></div>' +
    '<div class="field"><label>UOM</label><input id="p-uom" value="' + (p['UOM']||'') + '"></div>' +
    '<div class="field"><label>Image 1 — Drive file ID (optional)</label><input id="p-img1" value="' + (p['Image1']||'') + '"></div>' +
    '<div class="field"><label>Image 2 — Drive file ID (optional)</label><input id="p-img2" value="' + (p['Image2']||'') + '"></div>' +
    '<div class="field"><label>Status</label><select id="p-status"><option' + (p['Status']==='Active'?' selected':'') + '>Active</option><option' + (p['Status']==='Inactive'?' selected':'') + '>Inactive</option></select></div>' +
    '<div class="actions"><button class="btn-secondary" onclick="closeModal()">Cancel</button><button class="btn-primary" id="m-submit">Save</button></div>'
  );
  document.getElementById('m-submit').addEventListener('click', async () => {
    const product = {
      'Product ID': p['Product ID'] || '',
      'Product Name': document.getElementById('p-name').value.trim(),
      'Brand': document.getElementById('p-brand').value.trim(),
      'UOM': document.getElementById('p-uom').value.trim(),
      'Image1': document.getElementById('p-img1').value.trim(),
      'Image2': document.getElementById('p-img2').value.trim(),
      'Status': document.getElementById('p-status').value
    };
    if (!product['Product Name']) return toast('Name is required', true);
    const res = await api('saveProduct', { product });
    if (!res.ok) return toast(res.error || 'Failed', true);
    toast('Product saved'); closeModal(); loadProducts(true);
  });
}

/* ================= PDF DOWNLOADS ================= */
async function downloadSegmentPdf(requestId, segment) {
  toast('Generating ' + segment + ' PDF…');
  const res = await api('generateSegmentPdf', { requestId, segment });
  if (!res.ok) return toast(res.error || 'Could not generate PDF', true);
  triggerDownload(res.base64, res.fileName);
}
async function downloadCombinedPdf(requestId) {
  toast('Generating combined PDF…');
  const res = await api('generateCombinedPdf', { requestId });
  if (!res.ok) return toast(res.error || 'Could not generate PDF', true);
  triggerDownload(res.base64, res.fileName);
}
function triggerDownload(base64, fileName) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ================= UTIL ================= */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
