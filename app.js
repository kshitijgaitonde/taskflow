// ═══════════════════════════════════════════════════════════
//  TaskFlow App – app.js
// ═══════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────
// Step 1: Replace with your Google OAuth Client ID
const GOOGLE_CLIENT_ID = '883637781494-2vb5bjeo04jtqmr22mo4v2ejfdls9tuo.apps.googleusercontent.com';

// Step 2: Replace with your Firebase project config
// Get it: Firebase Console → Project Settings → Your Apps → SDK Setup & Config
// This is the ONLY way to sync between laptop and phone!
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPetVrkWmo7gWb8ogwzTRksKVkxCfAYtA",
  authDomain: "taskflow-b30a7.firebaseapp.com",
  projectId: "taskflow-b30a7",
  storageBucket: "taskflow-b30a7.firebasestorage.app",
  messagingSenderId: "1015386918415",
  appId: "1:1015386918415:web:dc9e26ec1a615fbbeadd7a"
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

// Recurrence types
const RECUR_TYPES = [
  { id:'daily',    label:'Every Day' },
  { id:'weekly',   label:'Every Week (pick day)' },
  { id:'monthly',  label:'Every Month (pick date)' },
];

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ─── STATE ──────────────────────────────────────────────────
let state = {
  context: 'office',
  page: 'tasks',
  tasks: [],          // active one-off + generated recurring cards
  history: [],        // completed tasks archived after 24h
  recurring: [],      // recurring templates (never deleted, drive auto-generation)
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
      tasks:         state.tasks,
      history:       state.history || [],
      recurring:     state.recurring || [],
      lastDateCheck: state.lastDateCheck,
      updatedAt:     Date.now(),
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

function cloudListen() {
  const ref = userDocRef();
  if (!ref) return;
  if (unsubscribe) unsubscribe();

  setSyncDot('syncing');
  unsubscribe = ref.onSnapshot(snap => {
    if (!snap.exists) { setSyncDot('ok'); return; }
    const data = snap.data();
    if (!data.updatedAt || data.updatedAt <= (state._savedAt || 0)) {
      setSyncDot('ok'); return;
    }
    state.tasks        = data.tasks        || [];
    state.history      = data.history      || [];
    state.recurring    = data.recurring    || [];
    state.lastDateCheck= data.lastDateCheck|| null;
    state._savedAt     = data.updatedAt;
    localSave();
    autoShiftColumns(false);
    autoMoveToHistory();
    generateRecurringCards();
    renderColumns();
    renderHistory();
    renderRecurringList();
    setSyncDot('ok');
    updateSyncLabel();
  }, err => {
    console.warn('Firestore listener error:', err);
    setSyncDot('offline');
  });
}

// ─── LOCAL STORAGE ───────────────────────────────────────────
const STORAGE_KEY = 'taskflow_v6';

function localSave() {
  state._savedAt = state._savedAt || Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function localLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
      state.recurring = state.recurring || [];
    }
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
  state.context = 'office';
  applyContextTheme('office');
  initFirebase();
  cloudListen();
  autoShiftColumns(true);
  autoMoveToHistory();
  generateRecurringCards();
  renderColumns();
  renderHistory();
  renderRecurringList();
  setupNotifications();
  setupAutoSync();
}

// ─── DATE UTILS ──────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }

function mondayOf(d) {
  const dt = new Date(d); const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day===0 ? -6 : 1));
  return dt.toISOString().slice(0,10);
}

function getWeekNumber(d) {
  const dt = new Date(d);
  dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate() + 3 - (dt.getDay()+6)%7);
  const jan4 = new Date(dt.getFullYear(),0,4);
  return 1 + Math.round(((dt-jan4)/86400000 - 3 + (jan4.getDay()+6)%7)/7);
}

// ─── AUTO DATE SHIFTING ───────────────────────────────────────
function autoShiftColumns(showToast=true) {
  const today = todayStr();
  if (state.lastDateCheck === today) return;
  const prev = state.lastDateCheck;
  state.lastDateCheck = today;
  if (!prev) { localSave(); return; }

  const newWeek  = mondayOf(today) !== mondayOf(prev);
  const newMonth = today.slice(0,7) !== prev.slice(0,7);

  state.tasks = state.tasks.map(t => {
    if (t.recurringId) return t; // recurring cards handled separately
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

// ═══════════════════════════════════════════════════════════
//  RECURRING TASKS ENGINE
// ═══════════════════════════════════════════════════════════

/*
  A "recurring template" looks like:
  {
    id:        'r_...',
    text:      'Pay electricity bill',
    context:   'personal',
    starred:   false,
    type:      'daily' | 'weekly' | 'monthly',
    weekday:   0-6   (for weekly — 0=Sunday)
    monthDate: 1-31  (for monthly)
    createdAt: timestamp,
    lastGenerated: 'YYYY-MM-DD'  // date of last card generation
  }

  Column placement logic (looking ahead from today):
  - today     → target date IS today
  - tomorrow  → target date is tomorrow
  - thisweek  → target date is within this calendar week (Mon–Sun)
  - nextweek  → target date is within next calendar week
  - thismonth → target date is within this calendar month
  - nextmonth → target date is within next calendar month
*/

function nextOccurrence(r, fromDate) {
  // Returns the next date string on or after fromDate that this recurrence fires
  const from = new Date(fromDate + 'T00:00:00');
  if (r.type === 'daily') {
    return fromDate; // fires every day
  }
  if (r.type === 'weekly') {
    const targetDay = r.weekday; // 0=Sun…6=Sat
    const fromDay   = from.getDay();
    let daysAhead   = (targetDay - fromDay + 7) % 7;
    if (daysAhead === 0) daysAhead = 0; // today counts
    const d = new Date(from);
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().slice(0,10);
  }
  if (r.type === 'monthly') {
    const targetDate = r.monthDate;
    const d = new Date(from.getFullYear(), from.getMonth(), targetDate);
    // If that date has already passed this month, go to next month
    if (d < from) d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0,10);
  }
  return fromDate;
}

function columnForDate(targetStr, todayStr_) {
  // Given a target date string, which column should the card be in?
  const today    = new Date(todayStr_ + 'T00:00:00');
  const target   = new Date(targetStr  + 'T00:00:00');
  const diffDays = Math.round((target - today) / 86400000);

  if (diffDays < 0)  return null;       // past — skip
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';

  // Same calendar week as today?
  const todayMon  = mondayOf(todayStr_);
  const targetMon = mondayOf(targetStr);
  if (targetMon === todayMon) return 'thisweek';

  // Next calendar week?
  const nextMon = new Date(todayMon); nextMon.setDate(nextMon.getDate() + 7);
  const nextMonStr = nextMon.toISOString().slice(0,10);
  if (targetMon === nextMonStr) return 'nextweek';

  // Same month?
  if (targetStr.slice(0,7) === todayStr_.slice(0,7)) return 'thismonth';

  // Next month?
  const todayDate   = new Date(todayStr_);
  const nextMonthYM = new Date(todayDate.getFullYear(), todayDate.getMonth()+1, 1)
                        .toISOString().slice(0,7);
  if (targetStr.slice(0,7) === nextMonthYM) return 'nextmonth';

  return null; // too far — don't show yet
}

function generateRecurringCards() {
  const today = todayStr();
  state.recurring = state.recurring || [];

  state.recurring.forEach(r => {
    // Find the next occurrence from today
    const nextDate = nextOccurrence(r, today);
    if (!nextDate) return;

    const col = columnForDate(nextDate, today);
    if (!col) return; // too far in future

    // Check if a card for this recurrence already exists and is not done
    const existing = state.tasks.find(t =>
      t.recurringId === r.id && t.column !== 'done'
    );

    if (existing) {
      // Update its column if the date has shifted (e.g. tomorrow → today)
      const correctCol = col;
      if (existing.column !== correctCol) {
        existing.column = correctCol;
      }
      return;
    }

    // No active card — create one
    const card = {
      id:          genId(),
      text:        r.text,
      column:      col,
      context:     r.context,
      starred:     r.starred || false,
      recurringId: r.id,
      recurLabel:  recurLabel(r),
      createdAt:   Date.now(),
      doneAt:      null,
    };
    state.tasks.unshift(card);
  });
}

function recurLabel(r) {
  if (r.type === 'daily')   return '🔁 Daily';
  if (r.type === 'weekly')  return `🔁 Every ${WEEKDAYS[r.weekday]}`;
  if (r.type === 'monthly') return `🔁 Monthly on ${ordinal(r.monthDate)}`;
  return '🔁';
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n%100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// When a recurring card is marked Done, generate the NEXT card immediately
function completeRecurringCard(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.recurringId) return;

  // Mark done
  task.column = 'done';
  task.doneAt = Date.now();

  // Generate next occurrence
  const today   = todayStr();
  const r       = state.recurring.find(r => r.id === task.recurringId);
  if (!r) return;

  // Find next occurrence AFTER today (not today again — already completed)
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tmrwStr  = tomorrow.toISOString().slice(0,10);
  const nextDate = nextOccurrence(r, tmrwStr);
  if (!nextDate) return;
  const col      = columnForDate(nextDate, today);
  if (!col) return;

  const newCard = {
    id:          genId(),
    text:        r.text,
    column:      col,
    context:     r.context,
    starred:     r.starred || false,
    recurringId: r.id,
    recurLabel:  recurLabel(r),
    createdAt:   Date.now(),
    doneAt:      null,
  };
  state.tasks.unshift(newCard);
}

// ─── RECURRING MODAL ─────────────────────────────────────────
function openRecurModal() {
  document.getElementById('recur-modal').style.display = 'flex';
  document.getElementById('recur-text').focus();
  updateRecurFields();
}

function closeRecurModal() {
  document.getElementById('recur-modal').style.display = 'none';
  document.getElementById('recur-text').value = '';
  document.getElementById('recur-type').value = 'weekly';
  document.getElementById('recur-weekday').value = '1';
  document.getElementById('recur-monthdate').value = '1';
}

function updateRecurFields() {
  const type = document.getElementById('recur-type').value;
  document.getElementById('recur-weekday-row').style.display  = type==='weekly'  ? 'flex' : 'none';
  document.getElementById('recur-monthdate-row').style.display= type==='monthly' ? 'flex' : 'none';
}

function saveRecurring() {
  const text = document.getElementById('recur-text').value.trim();
  if (!text) { document.getElementById('recur-text').focus(); return; }

  const type      = document.getElementById('recur-type').value;
  const weekday   = parseInt(document.getElementById('recur-weekday').value);
  const monthDate = parseInt(document.getElementById('recur-monthdate').value);
  const starred   = document.getElementById('recur-star').checked;

  const r = {
    id:        genId().replace('t_','r_'),
    text,
    context:   state.context,
    starred,
    type,
    weekday:   type==='weekly'  ? weekday   : null,
    monthDate: type==='monthly' ? monthDate : null,
    createdAt: Date.now(),
  };

  state.recurring.push(r);
  generateRecurringCards(); // immediately place a card
  saveState();
  renderColumns();
  renderRecurringList();
  closeRecurModal();
  showToastMsg(`🔁 Recurring task created — ${recurLabel(r)}`);
}

function deleteRecurring(rid) {
  if (!confirm('Delete this recurring task? All future cards will stop appearing.')) return;
  state.recurring = state.recurring.filter(r => r.id !== rid);
  // Remove any active (non-done) cards linked to it
  state.tasks = state.tasks.filter(t => !(t.recurringId===rid && t.column!=='done'));
  saveState();
  renderColumns();
  renderRecurringList();
  showToastMsg('🗑️ Recurring task deleted');
}

function renderRecurringList() {
  const list  = document.getElementById('recur-list');
  const empty = document.getElementById('recur-empty');
  if (!list) return;
  const mine = (state.recurring||[]).filter(r => r.context===state.context);
  list.innerHTML = '';
  if (!mine.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  mine.forEach(r => {
    const div = document.createElement('div');
    div.className = 'recur-item';
    div.innerHTML = `
      <div class="recur-item-left">
        <span class="recur-badge">${recurLabel(r)}</span>
        <span class="recur-item-text">${escapeHtml(r.text)}${r.starred?' ⭐':''}</span>
      </div>
      <button class="btn-icon btn-delete" onclick="deleteRecurring('${r.id}')" title="Delete">✕</button>
    `;
    list.appendChild(div);
  });
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
  requestAnimationFrame(() => document.getElementById(`ii-${colId}`)?.focus());
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id!==id);
  saveState(); renderColumns();
}

function reorderTask(id, direction) {
  const task = state.tasks.find(t => t.id===id);
  if (!task) return;
  const siblings = state.tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.column===task.column && t.context===task.context);
  const posInSiblings = siblings.findIndex(({ t }) => t.id===id);
  if (direction==='up'   && posInSiblings===0) return;
  if (direction==='down' && posInSiblings===siblings.length-1) return;
  const swapPos = direction==='up' ? posInSiblings-1 : posInSiblings+1;
  const idxA = siblings[posInSiblings].i;
  const idxB = siblings[swapPos].i;
  const copy = [...state.tasks];
  [copy[idxA], copy[idxB]] = [copy[idxB], copy[idxA]];
  state.tasks = copy;
  saveState(); renderColumns();
  requestAnimationFrame(() => {
    document.querySelector(`.task-card[data-id="${id}"] .btn-${direction}`)?.focus();
  });
}

function toggleStar(id) {
  state.tasks = state.tasks.map(t => t.id===id ? {...t, starred:!t.starred} : t);
  saveState(); renderColumns();
  setupNotifInterval();
}

function moveTask(id, newCol) {
  const task = state.tasks.find(t => t.id===id);
  if (!task) return;

  if (newCol === 'done' && task.recurringId) {
    // Special handling — mark done and spawn next occurrence
    completeRecurringCard(id);
  } else {
    state.tasks = state.tasks.map(t =>
      t.id!==id ? t : {...t, column:newCol, doneAt:newCol==='done'?Date.now():null}
    );
  }

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
  div.className = `task-card${task.starred?' starred':''}${task.recurringId?' recurring':''}`;
  div.draggable = true;
  div.dataset.id = task.id;

  div.addEventListener('dragstart', e => {
    dragSrc = task.id; div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => { div.classList.remove('dragging'); dragSrc=null; });

  const recurBadge = task.recurringId
    ? `<span class="task-recur-badge">${task.recurLabel||'🔁'}</span>`
    : '';

  div.innerHTML = `
    <div class="task-reorder">
      <button class="btn-reorder btn-up"   onclick="reorderTask('${task.id}','up')"   title="Move up">▲</button>
      <button class="btn-reorder btn-down" onclick="reorderTask('${task.id}','down')" title="Move down">▼</button>
    </div>
    <div class="task-main">
      ${recurBadge}
      <span class="task-text">${escapeHtml(task.text)}</span>
    </div>
    <div class="task-actions">
      <button class="btn-icon btn-star${task.starred?' active':''}"
              onclick="toggleStar('${task.id}')"
              title="${task.starred?'Remove priority':'Mark as priority'}">
        ${task.starred?'⭐':'☆'}
      </button>
      <button class="btn-icon btn-move"
              onclick="toggleMoveMenu(event,'${task.id}')"
              title="Move to…">⇄ Move</button>
      <button class="btn-icon btn-delete"
              onclick="deleteTask('${task.id}')"
              title="${task.recurringId?'Remove this occurrence':'Delete task'}">✕</button>
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
      <td>${escapeHtml(t.text)}${t.recurringId?` <span style="font-size:0.7rem;opacity:0.6">${t.recurLabel||'🔁'}</span>`:''}</td>
      <td><span class="hbadge" style="background:${t.context==='office'?'#a55eea22':'#ff6b3522'};color:${t.context==='office'?'#a55eea':'#ff6b35'}">${t.context==='office'?'💼':'👤'} ${t.context}</span></td>
      <td><span class="hbadge" style="background:${col.color}22;color:${col.color}">${col.emoji} ${col.label}</span></td>
      <td style="color:var(--muted);font-size:0.78rem">${t.doneAt?new Date(t.doneAt).toLocaleDateString():'—'}</td>
      <td>${t.starred?'⭐':'—'}</td>
    `;
    body.appendChild(tr);
  });
}

// ─── MOVE MENU ───────────────────────────────────────────────
const moveMenuEl = document.getElementById('global-move-menu');
let moveMenuOpen    = false;
let activeMoveBtnId = null;

function toggleMoveMenu(event, taskId) {
  event.stopPropagation();
  if (moveMenuOpen && activeMoveBtnId === taskId) { closeMoveMenu(); return; }

  const task = state.tasks.find(t => t.id===taskId);
  if (!task) return;

  moveMenuEl.innerHTML = COLUMNS
    .filter(c => c.id !== task.column)
    .map(c => `
      <button class="move-option" onclick="moveTask('${taskId}','${c.id}')">
        <span class="move-dot" style="background:${c.color}"></span>${c.emoji} ${c.label}
      </button>`).join('');

  const btn  = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menuW = 172;
  const spaceRight = window.innerWidth - rect.left;
  const left = spaceRight >= menuW ? rect.left : rect.right - menuW;

  moveMenuEl.style.left = `${Math.max(8, left)}px`;
  moveMenuEl.style.top  = `${Math.min(rect.bottom + 6, window.innerHeight - 280)}px`;
  moveMenuEl.classList.add('open');
  moveMenuOpen = true;
  activeMoveBtnId = taskId;
}

function closeMoveMenu() {
  moveMenuEl.classList.remove('open');
  moveMenuOpen = false;
  activeMoveBtnId = null;
}

document.addEventListener('click', e => {
  if (moveMenuOpen && !moveMenuEl.contains(e.target)) closeMoveMenu();
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
  const strip    = document.getElementById('ctx-bar');
  const badge    = document.getElementById('ctx-badge');
  const logoMark = document.getElementById('logo-mark');
  const avatar   = document.getElementById('user-avatar-el');
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
  document.getElementById('tab-personal')?.classList.toggle('active', ctx==='personal');
  document.getElementById('tab-office')?.classList.toggle('active',   ctx==='office');
  applyContextTheme(ctx);
  localSave(); renderColumns(); renderHistory(); renderRecurringList();
}

function switchPage(page) {
  state.page = page;
  document.getElementById('page-tasks').style.display     = page==='tasks'     ? '':'none';
  document.getElementById('page-history').style.display   = page==='history'   ? '':'none';
  document.getElementById('page-recurring').style.display = page==='recurring' ? '':'none';
  document.getElementById('add-bar').style.display        = page==='tasks'     ? '':'none';
  document.getElementById('tab-tasks').classList.toggle('active',     page==='tasks');
  document.getElementById('tab-history').classList.toggle('active',   page==='history');
  document.getElementById('tab-recurring').classList.toggle('active', page==='recurring');
  if (page==='history')   renderHistory();
  if (page==='recurring') renderRecurringList();
}

// ─── SAVE & SYNC ─────────────────────────────────────────────
async function saveAndSync() {
  const btn = document.querySelector('.btn-sync');
  btn.innerHTML = '<span class="spin">🔄</span> Syncing…';
  btn.disabled  = true;
  autoShiftColumns(false);
  autoMoveToHistory();
  generateRecurringCards();
  await cloudSave();
  renderColumns(); renderHistory(); renderRecurringList();
  btn.innerHTML = '💾 Save &amp; Sync';
  btn.disabled  = false;
  showToastMsg('✅ Synced!');
}

function setupAutoSync() {
  setInterval(async () => {
    autoShiftColumns(false);
    autoMoveToHistory();
    generateRecurringCards();
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
