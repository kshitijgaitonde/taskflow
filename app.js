// ═══════════════════════════════════════════════════════════
//  TaskFlow App – app.js
// ═══════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────
// Step 1: Replace with your Google OAuth Client ID
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

// Step 2: Replace with your Firebase project config
// Get it: Firebase Console → Project Settings → Your Apps → SDK Setup & Config
// This is the ONLY way to sync between laptop and phone!
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const USE_FIREBASE = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

// ─── COLUMNS ────────────────────────────────────────────────
const COLUMNS = [
  { id:'today',     label:'Today',      emoji:'🔥', color:'#ff6b35' },
  { id:'tomorrow',  label:'Tomorrow',   emoji:'🌅', color:'#f7c948' },
  { id:'thisweek',  label:'This Week',  emoji:'📆', color:'#2ecc71' },
  { id:'nextweek',  label:'Next Week',  emoji:'🗓️', color:'#17c0eb' },
  { id:'thismonth', label:'This Month', emoji:'📅', color:'#a55eea' },
  { id:'nextmonth', label:'Next Month', emoji:'🗃️', color:'#fd79a8' },
  { id:'done',      label:'Done',       emoji:'✅', color:'#636e72' },
];
const COL_MAP = Object.fromEntries(COLUMNS.map(c => [c.id, c]));

// ─── STATE ──────────────────────────────────────────────────
let state = {
  context: 'office', // always default to office on load
  page: 'tasks',
  tasks: [],
  history: [],
  lastDateCheck: null,
  user: null,
};

let db = null;
let unsubscribe = null;
let dragSrc = null;
let notifInterval = null;

// ─── FIREBASE ───────────────────────────────────────────────
function initFirebase() {
  if (!USE_FIREBASE) {
    showFBBanner('⚠️ No Firebase config — data is local only. Add FIREBASE_CONFIG in app.js to sync across devices.');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    hideFBBanner();
  } catch(e) {
    console.warn('Firebase init error:', e);
    showFBBanner('⚠️ Firebase error — falling back to local storage only.');
  }
}

function showFBBanner(msg) {
  const b = document.getElementById('firebase-banner');
  b.style.display = 'flex';
  document.getElementById('firebase-status').textContent = msg;
}
function hideFBBanner() {
  document.getElementById('firebase-banner').style.display = 'none';
}

// ─── CLOUD SYNC ─────────────────────────────────────────────
function userDocRef() {
  if (!db || !state.user) return null;
  const id = state.user.email.replace(/[^a-zA-Z0-9]/g, '_');
  return db.collection('taskflow_users').doc(id);
}

async function cloudSave() {
  const ref = userDocRef();
  if (!ref) { localSave(); return; }
  setSyncDot('syncing');
  try {
    await ref.set({
      tasks: state.tasks,
      history: state.history || [],
      lastDateCheck: state.lastDateCheck,
      updatedAt: Date.now(),
    }, { merge: true });
    localSave();
    setSyncDot('ok');
    updateSyncLabel();
  } catch(e) {
    console.warn('Cloud save failed:', e);
    localSave();
    setSyncDot('offline');
  }
}

// Real-time listener — this is what makes phone↔laptop sync work!
function cloudListen() {
  const ref = userDocRef();
  if (!ref) return;
  if (unsubscribe) unsubscribe();

  setSyncDot('syncing');
  unsubscribe = ref.onSnapshot(snap => {
    if (!snap.exists) { setSyncDot('ok'); return; }
    const data = snap.data();
    // Only overwrite if cloud is newer than what we last saved locally
    if (!data.updatedAt || data.updatedAt <= (state._savedAt || 0)) {
      setSyncDot('ok'); return;
    }
    state.tasks        = data.tasks        || [];
    state.history      = data.history      || [];
    state.lastDateCheck= data.lastDateCheck|| null;
    state._savedAt     = data.updatedAt;
    localSave();
    autoShiftColumns(false);
    autoMoveToHistory();
    renderColumns();
    renderHistory();
    setSyncDot('ok');
    updateSyncLabel();
  }, err => {
    console.warn('Firestore listener error:', err);
    setSyncDot('offline');
  });
}

// ─── LOCAL STORAGE ───────────────────────────────────────────
const STORAGE_KEY = 'taskflow_v4';

function localSave() {
  state._savedAt = state._savedAt || Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function localLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch(e) {}
}

function saveState() { cloudSave(); }

function setSyncDot(status) {
  const colors = { ok:'#2ecc71', syncing:'#f7c948', offline:'#ff6b35' };
  const c = colors[status];
  const d1 = document.getElementById('sync-dot');
  const d2 = document.getElementById('sync-dot-2');
  if (d1) { d1.style.background = c; d1.style.boxShadow = `0 0 6px ${c}`; d1.className = `sync-dot${status==='syncing'?' syncing':''}`; }
  if (d2) d2.style.background = c;
}

function updateSyncLabel() {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = `Synced ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}

// ─── GOOGLE SIGN-IN ──────────────────────────────────────────
function handleGoogleSignIn() {
  if (GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleToken });
    google.accounts.id.prompt();
  } else {
    // Demo mode
    loginUser({ name:'Demo User', email:'demo@taskflow.app',
      picture:'https://ui-avatars.com/api/?name=Demo+User&background=6c63ff&color=fff&size=64' });
  }
}

function onGoogleToken(resp) {
  const p = JSON.parse(atob(resp.credential.split('.')[1]));
  loginUser({ name:p.name, email:p.email, picture:p.picture });
}

function loginUser(user) {
  state.user = user;
  document.getElementById('login-screen').style.display = 'none';
  const app = document.getElementById('app');
  app.style.display = 'flex'; app.style.flexDirection = 'column';
  document.getElementById('user-name-el').textContent = user.name.split(' ')[0];
  const av = document.getElementById('user-avatar-el');
  if (user.picture) { av.src = user.picture; av.style.display = 'block'; }
  localSave();
  initApp();
}

function signOut() {
  if (!confirm('Sign out of TaskFlow?')) return;
  if (unsubscribe) unsubscribe();
  state.user = null;
  localSave();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  clearInterval(notifInterval);
}

// ─── INIT ────────────────────────────────────────────────────
function initApp() {
  // Always start on office tab regardless of saved state
  state.context = 'office';
  applyContextTheme('office');
  initFirebase();
  cloudListen();           // subscribe to real-time updates
  autoShiftColumns(true);
  autoMoveToHistory();
  renderColumns();
  renderHistory();
  setupNotifications();
  setupAutoSync();
}

// ─── DATE SHIFTING ───────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }
function mondayOf(d) {
  const dt = new Date(d); const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day===0 ? -6 : 1));
  return dt.toISOString().slice(0,10);
}

function autoShiftColumns(showToast=true) {
  const today = todayStr();
  if (state.lastDateCheck === today) return;
  const prev = state.lastDateCheck;
  state.lastDateCheck = today;
  if (!prev) { localSave(); return; }

  const newWeek  = mondayOf(today) !== mondayOf(prev);
  const newMonth = today.slice(0,7) !== prev.slice(0,7);

  state.tasks = state.tasks.map(t => {
    let c = t.column;
    if (c==='tomorrow')                    c = 'today';
    if (newWeek  && c==='nextweek')        c = 'thisweek';
    if (newWeek  && c==='thisweek')        c = 'today';
    if (newMonth && c==='nextmonth')       c = 'thismonth';
    if (newMonth && c==='thismonth')       c = 'today';
    return { ...t, column:c };
  });
  if (showToast) showToastMsg('📅 Columns auto-updated for today!');
}

function autoMoveToHistory() {
  const cutoff = Date.now() - 24*60*60*1000;
  const old = state.tasks.filter(t => t.column==='done' && t.doneAt && t.doneAt < cutoff);
  if (!old.length) return;
  state.history = [...(state.history||[]), ...old];
  state.tasks   = state.tasks.filter(t => !(t.column==='done' && t.doneAt && t.doneAt < cutoff));
}

// ─── TASK CRUD ───────────────────────────────────────────────
function genId() { return `t_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }

function makeTask(text, colId) {
  return { id:genId(), text, column:colId, context:state.context,
           starred:false, createdAt:Date.now(), doneAt:null };
}

function addTask() {
  const inp = document.getElementById('task-input');
  const text = inp.value.trim();
  if (!text) { inp.focus(); return; }
  const col = document.getElementById('col-select').value;
  state.tasks.unshift(makeTask(text, col));
  inp.value=''; inp.focus();
  saveState(); renderColumns();
  showToastMsg(`✅ Added to ${COL_MAP[col].label}`);
}

function addInlineTask(colId) {
  const inp = document.getElementById(`ii-${colId}`);
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) { inp.focus(); return; }
  state.tasks.unshift(makeTask(text, colId));
  inp.value='';
  saveState(); renderColumns();
  // restore focus to same column's input after re-render
  requestAnimationFrame(() => document.getElementById(`ii-${colId}`)?.focus());
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id!==id);
  saveState(); renderColumns();
}

function toggleStar(id) {
  state.tasks = state.tasks.map(t => t.id===id ? {...t, starred:!t.starred} : t);
  saveState(); renderColumns();
  setupNotifInterval();
}

function moveTask(id, newCol) {
  state.tasks = state.tasks.map(t =>
    t.id!==id ? t : {...t, column:newCol, doneAt:newCol==='done'?Date.now():null}
  );
  closeMoveMenu();
  saveState(); renderColumns(); renderHistory();
  showToastMsg(`↪ Moved to ${COL_MAP[newCol].label}`);
}

// ─── RENDER ──────────────────────────────────────────────────
function ctxTasks() { return state.tasks.filter(t => t.context===state.context); }

function renderColumns() {
  const grid = document.getElementById('columns-grid');
  grid.innerHTML = '';

  COLUMNS.forEach(col => {
    const tasks  = ctxTasks().filter(t => t.column===col.id);
    const isDone = col.id === 'done';
    const card   = document.createElement('div');
    card.className = 'column-card';

    // Fix 3: No inline-add for Done column
    const inlineAdd = isDone ? '' : `
      <div class="inline-add-row">
        <input class="inline-add-input" id="ii-${col.id}"
               placeholder="+ Add task here…"
               onkeydown="if(event.key==='Enter')addInlineTask('${col.id}')" />
        <button class="inline-add-btn" onclick="addInlineTask('${col.id}')">＋</button>
      </div>`;

    card.innerHTML = `
      <div class="col-header" style="background:${col.color}18;">
        <div class="col-header-left">
          <span class="col-emoji">${col.emoji}</span>
          <span class="col-label" style="color:${col.color}">${col.label}</span>
        </div>
        <span class="col-badge" style="color:${col.color}">${tasks.length}</span>
      </div>
      <div class="col-divider" style="background:${col.color}20"></div>
      <div class="col-body" id="cb-${col.id}"
           ondragover="onDragOver(event,'${col.id}')"
           ondrop="onDrop(event,'${col.id}')"
           ondragleave="onDragLeave(event)">
        ${tasks.length===0 ? '<div class="drop-hint">Drop tasks here</div>' : ''}
      </div>
      ${inlineAdd}
    `;

    grid.appendChild(card);
    const body = card.querySelector('.col-body');
    tasks.forEach(t => body.appendChild(buildTaskEl(t)));
  });
}

function buildTaskEl(task) {
  const div = document.createElement('div');
  div.className = `task-card${task.starred?' starred':''}`;
  div.draggable = true;
  div.dataset.id = task.id;

  div.addEventListener('dragstart', e => {
    dragSrc = task.id; div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => { div.classList.remove('dragging'); dragSrc=null; });

  div.innerHTML = `
    <span class="task-text">${escapeHtml(task.text)}</span>
    <div class="task-actions">
      <button class="btn-icon btn-star${task.starred?' active':''}"
              onclick="toggleStar('${task.id}')"
              title="${task.starred?'Remove priority':'Mark as priority'}">
        ${task.starred?'⭐':'☆'}
      </button>
      <button class="btn-icon btn-move"
              onmouseenter="openMoveMenu(event,'${task.id}')"
              title="Move to…">⇄ Move</button>
      <button class="btn-icon btn-delete"
              onclick="deleteTask('${task.id}')"
              title="Delete task">✕</button>
    </div>
  `;
  return div;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderHistory() {
  const body  = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');
  if (!body) return;
  const items = (state.history||[]).filter(t => t.context===state.context);
  body.innerHTML = '';
  if (!items.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  [...items].sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).forEach(t => {
    const col = COL_MAP[t.column]||COL_MAP['done'];
    const tr  = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.text)}</td>
      <td><span class="hbadge" style="background:${t.context==='office'?'#a55eea22':'#ff6b3522'};color:${t.context==='office'?'#a55eea':'#ff6b35'}">${t.context==='office'?'💼':'👤'} ${t.context}</span></td>
      <td><span class="hbadge" style="background:${col.color}22;color:${col.color}">${col.emoji} ${col.label}</span></td>
      <td style="color:var(--muted);font-size:0.78rem">${t.doneAt?new Date(t.doneAt).toLocaleDateString():'—'}</td>
      <td>${t.starred?'⭐':'—'}</td>
    `;
    body.appendChild(tr);
  });
}

// ─── MOVE MENU (Fix 2: hover-safe, always on top) ────────────
const moveMenuEl = document.getElementById('global-move-menu');
let moveMenuTimer = null;
let moveMenuOpen  = false;

function openMoveMenu(event, taskId) {
  clearTimeout(moveMenuTimer);
  const task = state.tasks.find(t => t.id===taskId);
  if (!task) return;

  // Build options
  moveMenuEl.innerHTML = COLUMNS
    .filter(c => c.id !== task.column)
    .map(c => `
      <button class="move-option" onmousedown="moveTask('${taskId}','${c.id}')">
        <span class="move-dot" style="background:${c.color}"></span>${c.emoji} ${c.label}
      </button>`).join('');

  // Position right below the button, smart edge detection
  const btn  = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menuW = 172;
  const spaceRight = window.innerWidth - rect.left;
  const left = spaceRight >= menuW ? rect.left : rect.right - menuW;
  const top  = rect.bottom + 6;

  moveMenuEl.style.left = `${Math.max(8, left)}px`;
  moveMenuEl.style.top  = `${Math.min(top, window.innerHeight - 280)}px`;
  moveMenuEl.classList.add('open');
  moveMenuOpen = true;

  // ── Keep open while hovering btn OR menu, close after leaving both ──
  btn.onmouseleave = () => { moveMenuTimer = setTimeout(closeMoveMenu, 180); };
  moveMenuEl.onmouseenter = () => clearTimeout(moveMenuTimer);
  moveMenuEl.onmouseleave = () => { moveMenuTimer = setTimeout(closeMoveMenu, 180); };
}

function closeMoveMenu() {
  moveMenuEl.classList.remove('open');
  moveMenuOpen = false;
}

// Close on outside click or scroll
document.addEventListener('click', e => {
  if (!moveMenuEl.contains(e.target)) closeMoveMenu();
});
document.addEventListener('scroll', closeMoveMenu, true);

// ─── DRAG & DROP ─────────────────────────────────────────────
function onDragOver(event, colId) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.getElementById(`cb-${colId}`)?.classList.add('drag-over');
  event.currentTarget.closest('.column-card')?.classList.add('drag-target');
}
function onDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
  event.currentTarget.closest('.column-card')?.classList.remove('drag-target');
}
function onDrop(event, colId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  event.currentTarget.closest('.column-card')?.classList.remove('drag-target');
  if (dragSrc) moveTask(dragSrc, colId);
}

// ─── NAVIGATION ──────────────────────────────────────────────
function applyContextTheme(ctx) {
  const body = document.body;
  body.classList.remove('ctx-personal','ctx-office');
  body.classList.add(`ctx-${ctx}`);

  // Update accent colour strip at top
  const strip = document.getElementById('ctx-bar');
  const badge = document.getElementById('ctx-badge');
  const logoMark = document.getElementById('logo-mark');
  const avatar = document.getElementById('user-avatar-el');

  if (ctx === 'office') {
    if (strip)    strip.style.background = 'linear-gradient(90deg,#0ea5a0,#34d1cb,#10b981)';
    if (badge)    { badge.textContent = '💼 OFFICE'; badge.style.background = '#0ea5a0'; }
    if (logoMark) logoMark.style.background = 'linear-gradient(135deg,#0ea5a0,#10b981)';
    if (avatar)   avatar.style.borderColor = '#0ea5a0';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#06151a');
  } else {
    if (strip)    strip.style.background = 'linear-gradient(90deg,#6c63ff,#a55eea,#fd79a8)';
    if (badge)    { badge.textContent = '👤 PERSONAL'; badge.style.background = '#6c63ff'; }
    if (logoMark) logoMark.style.background = 'linear-gradient(135deg,#6c63ff,#fd79a8)';
    if (avatar)   avatar.style.borderColor = '#6c63ff';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#060614');
  }
}

function switchContext(ctx) {
  state.context = ctx;
  // Update pill tab active state
  document.getElementById('tab-personal')?.classList.toggle('active', ctx==='personal');
  document.getElementById('tab-office')?.classList.toggle('active',   ctx==='office');
  applyContextTheme(ctx);
  localSave(); renderColumns(); renderHistory();
}

function switchPage(page) {
  state.page = page;
  document.getElementById('page-tasks').style.display    = page==='tasks'   ? '':'none';
  document.getElementById('page-history').style.display  = page==='history' ? '':'none';
  document.getElementById('add-bar').style.display       = page==='tasks'   ? '':'none';
  document.getElementById('tab-tasks').classList.toggle('active',   page==='tasks');
  document.getElementById('tab-history').classList.toggle('active', page==='history');
  if (page==='history') renderHistory();
}

// ─── SAVE & SYNC ─────────────────────────────────────────────
async function saveAndSync() {
  const btn = document.querySelector('.btn-sync');
  btn.innerHTML = '<span class="spin">🔄</span> Syncing…';
  btn.disabled  = true;
  autoShiftColumns(false);
  autoMoveToHistory();
  await cloudSave();
  renderColumns(); renderHistory();
  btn.innerHTML = '💾 Save &amp; Sync';
  btn.disabled  = false;
  showToastMsg('✅ Synced!');
}

function setupAutoSync() {
  setInterval(async () => {
    autoShiftColumns(false);
    autoMoveToHistory();
    await cloudSave();
    renderColumns(); renderHistory();
  }, 3*60*1000);
}

// ─── NOTIFICATIONS ───────────────────────────────────────────
function setupNotifications() {
  if ('Notification' in window && Notification.permission==='default')
    document.getElementById('notif-banner').style.display='flex';
  else if (Notification.permission==='granted') setupNotifInterval();
}

function requestNotifications() {
  Notification.requestPermission().then(p => {
    document.getElementById('notif-banner').style.display='none';
    if (p==='granted') { setupNotifInterval(); showToastMsg('🔔 Notifications on!'); }
  });
}

function setupNotifInterval() {
  clearInterval(notifInterval);
  const starred = state.tasks.filter(t => t.starred && t.column!=='done');
  if (!starred.length || Notification.permission!=='granted') return;
  sendReminder(starred);
  notifInterval = setInterval(() => {
    const cur = state.tasks.filter(t => t.starred && t.column!=='done');
    if (cur.length) sendReminder(cur); else clearInterval(notifInterval);
  }, 2*60*60*1000);
}

function sendReminder(tasks) {
  new Notification('⭐ TaskFlow Priority Reminder', {
    body: `${tasks.length} priority task(s):\n${tasks.map(t=>'• '+t.text).join('\n')}`,
    icon: 'icons/icon-192.png',
  });
}

// ─── TOAST ───────────────────────────────────────────────────
function showToastMsg(msg) {
  const t = document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

// ─── BOOT ────────────────────────────────────────────────────
(function boot() {
  localLoad();
  if (state.user) loginUser(state.user);
})();
