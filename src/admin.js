// Admin page: live print queue, pair / single printing, leftover-half tracking,
// edit / reprint, allergen summary, guest QR code and label calibration.
import './styles.css';
import QRCode from 'qrcode';
import { supabase, isConfigured, showConfigError } from './supabase.js';
import { ALLERGENS, DIET_TAGS, labelFor } from './constants.js';
import { buildSheetPdf, buildAlignmentPdf, DEFAULT_LAYOUT } from './label-pdf.js';

if (!isConfigured) {
  showConfigError();
  throw new Error('Supabase is not configured');
}

const $ = (id) => document.getElementById(id);
const LAYOUT_KEY = 'potluck-layout-v1';

const state = {
  dishes: [],
  openSheet: null,     // a sheet with one unused half, or null
  busy: false,         // true while a print is being saved (prevents double taps)
  lastPdf: null,       // { blob, name } so you can reopen it
  knownWaiting: null,  // ids seen last time, to detect new arrivals
};

// ---------------------------------------------------------------------
// Small DOM helper: h('div', {className: 'x'}, 'text', childNode)
// Uses textContent everywhere, so guest-typed text can never become HTML.
// ---------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// ---------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------
async function showView() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    $('login-view').hidden = false;
    $('app-view').hidden = true;
    return;
  }
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || !isAdmin) {
    await supabase.auth.signOut();
    $('login-view').hidden = false;
    $('app-view').hidden = true;
    showLoginError('This account is not set up as an admin. See SETUP.md step "Make yourself admin".');
    return;
  }
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  startApp();
}

function showLoginError(text) {
  $('login-error').textContent = text;
  $('login-error').hidden = !text;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const f = new FormData(e.target);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(f.get('email')).trim(),
    password: String(f.get('password')),
  });
  if (error) return showLoginError(error.message);
  showLoginError('');
  showView();
});

$('signout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// ---------------------------------------------------------------------
// Loading data + live updates
// ---------------------------------------------------------------------
let started = false;
let reloadTimer = null;

async function reload() {
  const [dishesRes, sheetRes] = await Promise.all([
    supabase.from('dishes').select('*').order('created_at', { ascending: true }),
    supabase.from('sheets').select('*').eq('closed', false).order('id', { ascending: false }).limit(1),
  ]);
  if (dishesRes.error || sheetRes.error) {
    console.error(dishesRes.error || sheetRes.error);
    setLive(false);
    return;
  }
  state.dishes = dishesRes.data;
  state.openSheet = sheetRes.data[0] ?? null;
  detectNewArrivals();
  render();
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, 250);
}

function setLive(ok) {
  $('live-pill').textContent = ok ? 'live' : 'offline';
  $('live-pill').classList.toggle('live', ok);
}

function startApp() {
  if (started) return;
  started = true;
  reload();
  supabase
    .channel('admin-queue')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sheets' }, scheduleReload)
    .subscribe((status) => setLive(status === 'SUBSCRIBED'));
  // Safety nets: phones pause live connections when the screen locks,
  // so also refresh every 20s and whenever the page comes back into view.
  setInterval(reload, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
  renderQr();
  fillLayoutForm();
}

// ---------------------------------------------------------------------
// New-dish sound
// ---------------------------------------------------------------------
let audioCtx = null;
function unlockAudio() {
  // Browsers only allow sound after a tap, so we create the audio engine on the first tap.
  try { audioCtx ??= new AudioContext(); audioCtx.resume(); } catch { /* no audio */ }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function chime() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [660, 880].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.3);
  });
}

function detectNewArrivals() {
  const ids = new Set(waitingQueue().map((d) => d.id));
  if (state.knownWaiting) {
    const fresh = [...ids].some((id) => !state.knownWaiting.has(id));
    if (fresh) chime();
  }
  state.knownWaiting = ids;
}

// ---------------------------------------------------------------------
// Queue logic
// ---------------------------------------------------------------------
function waitingQueue() {
  return state.dishes
    .filter((d) => d.status === 'waiting')
    .sort((a, b) => (b.priority - a.priority) || (new Date(a.created_at) - new Date(b.created_at)));
}

const freeSlot = (sheet) => (sheet.top_used ? 'bottom' : 'top');

// ---------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------
function loadLayout() {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

// Hand the PDF to the phone's print system. MUST run straight from a tap
// (before any "await"), otherwise iPhone Safari blocks the share sheet / new tab.
function deliverPdf(doc, name) {
  const blob = doc.output('blob');
  state.lastPdf = { blob, name };
  $('reopen-btn').hidden = false;
  openPdf(blob, name);
}

function openPdf(blob, name) {
  const file = new File([blob], name, { type: 'application/pdf' });
  const isPhone = matchMedia('(pointer: coarse)').matches;
  if (isPhone && navigator.canShare?.({ files: [file] })) {
    // iPhone: opens the share sheet -> choose "Print" -> pick the DeskJet.
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function showPrintMsg(text, kind = 'ok') {
  const box = $('print-msg');
  box.textContent = text;
  box.className = `msg ${kind}`;
  box.hidden = !text;
}

async function markPrinted(dishes) {
  const now = new Date().toISOString();
  for (const d of dishes) {
    const { error } = await supabase
      .from('dishes')
      .update({ status: 'printed', printed_at: now, priority: false, print_count: (d.print_count ?? 0) + 1 })
      .eq('id', d.id);
    if (error) throw error;
  }
}

/**
 * kind: 'pair'     -> next 2 dishes, top + bottom of a fresh sheet
 *       'fresh'    -> next 1 dish, top of a fresh sheet (bottom becomes the leftover)
 *       'leftover' -> next 1 dish, in the free half of the leftover sheet
 */
function printNext(kind) {
  if (state.busy) return;
  const queue = waitingQueue();
  const need = kind === 'pair' ? 2 : 1;
  if (queue.length < need) return;
  const dishes = queue.slice(0, need);

  let slots;
  if (kind === 'pair') slots = { top: dishes[0], bottom: dishes[1] };
  else if (kind === 'fresh') slots = { top: dishes[0] };
  else slots = { [freeSlot(state.openSheet)]: dishes[0] };

  // 1) Open the PDF immediately (synchronously, still inside the tap).
  const names = dishes.map((d) => d.dish_name).join(' + ');
  deliverPdf(buildSheetPdf(slots, loadLayout()), `labels-${dishes.map((d) => d.id).join('-')}.pdf`);

  // 2) Then record what was printed.
  saveSheet(kind, slots, dishes, names);
}

async function saveSheet(kind, slots, dishes, names) {
  state.busy = true;
  render();
  try {
    if (kind === 'pair') {
      const { error } = await supabase.from('sheets').insert({
        top_dish_id: slots.top.id, bottom_dish_id: slots.bottom.id,
        top_used: true, bottom_used: true, closed: true,
      });
      if (error) throw error;
    } else if (kind === 'fresh') {
      // Only one leftover half is tracked: starting a fresh single-label sheet retires the old one.
      const { error: closeErr } = await supabase.from('sheets').update({ closed: true }).eq('closed', false);
      if (closeErr) throw closeErr;
      const { error } = await supabase.from('sheets').insert({
        top_dish_id: slots.top.id, top_used: true, closed: false,
      });
      if (error) throw error;
    } else {
      const slot = freeSlot(state.openSheet);
      const { error } = await supabase
        .from('sheets')
        .update({ [`${slot}_dish_id`]: dishes[0].id, [`${slot}_used`]: true, closed: true })
        .eq('id', state.openSheet.id);
      if (error) throw error;
    }
    await markPrinted(dishes);
    const where = kind === 'leftover'
      ? ' Put the half-used sheet back in the printer (same way as before).'
      : '';
    showPrintMsg(`Sent: ${names}. In the share sheet choose Print, then your DeskJet.${where}`);
  } catch (err) {
    console.error(err);
    showPrintMsg(`The PDF opened, but saving the print status failed (${err.message}). Refresh and check the queue.`, 'error');
  } finally {
    state.busy = false;
    await reload();
  }
}

$('print-pair-btn').addEventListener('click', () => printNext('pair'));
$('print-fresh-btn').addEventListener('click', () => printNext('fresh'));
$('print-leftover-btn').addEventListener('click', () => printNext('leftover'));
$('reopen-btn').addEventListener('click', () => {
  if (state.lastPdf) openPdf(state.lastPdf.blob, state.lastPdf.name);
});
$('discard-btn').addEventListener('click', async () => {
  if (!state.openSheet || !confirm('Throw away the leftover half? The next single label will use a fresh sheet.')) return;
  await supabase.from('sheets').update({ closed: true }).eq('id', state.openSheet.id);
  reload();
});

// ---------------------------------------------------------------------
// Per-dish actions
// ---------------------------------------------------------------------
async function updateDish(id, fields) {
  const { error } = await supabase.from('dishes').update(fields).eq('id', id);
  if (error) alert(`Could not save: ${error.message}`);
  reload();
}

function dishRow(d) {
  const allergens = d.allergens.length
    ? `Contains: ${d.allergens.map((k) => labelFor(ALLERGENS, k)).join(', ')}`
    : 'No allergens declared';
  const actions = d.status === 'waiting'
    ? [
        h('button', { type: 'button', onclick: () => updateDish(d.id, { priority: !d.priority }) },
          d.priority ? 'Un-prioritize' : 'Move to front'),
        h('button', { type: 'button', onclick: () => openEditor(d) }, 'Edit'),
      ]
    : [
        h('button', { type: 'button', onclick: () => updateDish(d.id, { status: 'waiting', priority: true }) }, 'Reprint'),
        h('button', { type: 'button', onclick: () => openEditor(d) }, 'Edit'),
      ];
  return h('div', { className: 'dish' },
    h('div', { className: 'title' }, d.dish_name, ' ', d.priority ? h('span', { className: 'pill front' }, 'next') : null),
    h('div', { className: 'meta' },
      `by ${d.cook_name} · ${d.status === 'printed' ? `printed ${timeAgo(d.printed_at)}` : timeAgo(d.created_at)}`),
    h('div', { className: 'meta' }, allergens),
    h('div', { className: 'actions' }, actions),
  );
}

// ---------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------
let editing = null;

function chipSet(containerId, list, name) {
  const box = $(containerId);
  box.replaceChildren(...list.map((item) =>
    h('label', {}, h('input', { type: 'checkbox', name, value: item.key }), item.label)));
}
chipSet('edit-allergens', ALLERGENS, 'allergens');
chipSet('edit-diet', DIET_TAGS, 'diet_tags');

function openEditor(d) {
  editing = d;
  const f = $('edit-form');
  f.elements.dish_name.value = d.dish_name;
  f.elements.cook_name.value = d.cook_name;
  f.elements.ingredients.value = d.ingredients;
  for (const input of f.querySelectorAll('input[type=checkbox]')) {
    input.checked = (d[input.name] ?? []).includes(input.value);
  }
  $('edit-error').hidden = true;
  $('edit-dialog').showModal();
}

$('edit-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save' || !editing) return; // Cancel just closes
  e.preventDefault();
  const f = new FormData(e.target);
  const fields = {
    dish_name: String(f.get('dish_name')).trim(),
    cook_name: String(f.get('cook_name')).trim(),
    ingredients: String(f.get('ingredients')).trim(),
    allergens: f.getAll('allergens').map(String),
    diet_tags: f.getAll('diet_tags').map(String),
  };
  const { error } = await supabase.from('dishes').update(fields).eq('id', editing.id);
  if (error) {
    $('edit-error').textContent = error.message;
    $('edit-error').hidden = false;
    return;
  }
  $('edit-dialog').close();
  reload();
});

$('delete-btn').addEventListener('click', async () => {
  if (!editing || !confirm(`Delete "${editing.dish_name}"? This cannot be undone.`)) return;
  const { error } = await supabase.from('dishes').delete().eq('id', editing.id);
  if (error) return alert(error.message);
  $('edit-dialog').close();
  reload();
});

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function render() {
  const queue = waitingQueue();
  const printed = state.dishes
    .filter((d) => d.status === 'printed')
    .sort((a, b) => new Date(b.printed_at) - new Date(a.printed_at));
  const n = queue.length;
  const sheet = state.openSheet;

  $('waiting-count').textContent = n;
  document.title = n ? `(${n}) Potluck Print Queue` : 'Potluck Print Queue';
  $('leftover-status').textContent = sheet
    ? `Leftover sheet: ${freeSlot(sheet)} half is free`
    : 'No leftover half';

  const pairBtn = $('print-pair-btn');
  pairBtn.hidden = n < 2;
  pairBtn.textContent = n >= 2 ? `Print next 2: ${queue[0].dish_name} + ${queue[1].dish_name}` : '';

  const leftoverBtn = $('print-leftover-btn');
  leftoverBtn.hidden = !(sheet && n >= 1);
  if (sheet && n >= 1) leftoverBtn.textContent = `Print ${queue[0].dish_name} on leftover ${freeSlot(sheet)} half`;

  const freshBtn = $('print-fresh-btn');
  freshBtn.hidden = n < 1;
  if (n >= 1) {
    freshBtn.textContent = `Print ${queue[0].dish_name} alone on a fresh sheet`;
    freshBtn.classList.toggle('primary', n === 1 && !sheet);
  }

  $('discard-btn').hidden = !sheet;
  for (const b of [pairBtn, leftoverBtn, freshBtn]) b.disabled = state.busy;

  $('waiting-list').replaceChildren(...(n ? queue.map(dishRow) : [h('p', { className: 'muted' }, 'All caught up ✅')]));
  $('printed-count').textContent = printed.length;
  $('printed-list').replaceChildren(...printed.map(dishRow));

  $('summary-body').replaceChildren(...state.dishes.map((d) => h('tr', {},
    h('td', {}, d.dish_name),
    h('td', {}, d.cook_name),
    h('td', {}, d.allergens.map((k) => labelFor(ALLERGENS, k)).join(', ') || '—'),
    h('td', {}, d.diet_tags.map((k) => labelFor(DIET_TAGS, k)).join(', ') || '—'),
  )));
}

$('print-summary-btn').addEventListener('click', () => {
  $('summary-details').open = true;
  document.body.classList.add('printing-summary');
  window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('printing-summary'));

// ---------------------------------------------------------------------
// Guest QR code
// ---------------------------------------------------------------------
async function renderQr() {
  const guestUrl = `${location.origin}/`;
  const dataUrl = await QRCode.toDataURL(guestUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' });
  $('qr-img').src = dataUrl;
  $('qr-download').href = dataUrl;
  $('guest-link').href = guestUrl;
  $('guest-link').textContent = guestUrl;
}

// ---------------------------------------------------------------------
// Calibration settings
// ---------------------------------------------------------------------
const LAYOUT_FIELDS = ['leftMargin', 'topMargin', 'gap', 'labelHeight', 'nudgeX', 'nudgeY'];

function fillLayoutForm() {
  const layout = loadLayout();
  const f = $('layout-form');
  for (const k of LAYOUT_FIELDS) f.elements[k].value = layout[k];
}

$('layout-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const layout = {};
  for (const k of LAYOUT_FIELDS) {
    const v = Number.parseFloat(f.elements[k].value);
    layout[k] = Number.isFinite(v) ? v : DEFAULT_LAYOUT[k];
  }
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  fillLayoutForm();
  alert('Saved on this device.');
});

$('layout-reset-btn').addEventListener('click', () => {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
  fillLayoutForm();
});

$('test-align-btn').addEventListener('click', () => deliverPdf(buildAlignmentPdf(loadLayout()), 'alignment-test.pdf'));
$('test-sample-btn').addEventListener('click', () => deliverPdf(buildSheetPdf({
  top: { dish_name: 'Sample: Mango Salsa', cook_name: 'Test', ingredients: 'mango, red onion, cilantro, lime, jalapeño, salt', allergens: [], diet_tags: ['vegan', 'spicy'] },
  bottom: { dish_name: 'Sample: Chicken Biryani', cook_name: 'Test', ingredients: 'basmati rice, chicken, yogurt, ghee, onions, garlic, ginger, saffron, cashews, spices', allergens: ['milk', 'tree_nuts'], diet_tags: [] },
}, loadLayout()), 'sample-labels.pdf'));

// Keep the screen in sync when the login session changes (e.g. expires).
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});

showView();
