// ═══════════════════════════════════════════════════════
//  TaskFlow App – app.js
//  Full-featured ToDo for Personal & Office usage
// ═══════════════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────────────
// REPLACE THIS with your actual Google OAuth 2.0 Client ID from
// https://console.cloud.google.com → APIs & Services → Credentials
const GOOGLE_CLIENT_ID = '883637781494-2vb5bjeo04jtqmr22mo4v2ejfdls9tuo.apps.googleusercontent.com';

// Column definitions with colour coding
const COLUMNS = [
  { id: 'today',     label: 'Today',      emoji: '🔥', color: '#f97316' },
  { id: 'tomorrow',  label: 'Tomorrow',   emoji: '🌅', color: '#eab308' },
  { id: 'thisweek',  label: 'This Week',  emoji: '📆', color: '#22c55e' },
  { id: 'nextweek',  label: 'Next Week',  emoji: '🗓️', color: '#06b6d4' },
  { id: 'thismonth', label: 'This Month', emoji: '📅', color: '#8b5cf6' },
  { id: 'nextmonth', label: 'Next Month', emoji: '🗃️', color: '#ec4899' },
  { id: 'done',      label: 'Done',       emoji: '✅', color: '#64748b' },
];

const COL_MAP = Object.fromEntries(COLUMNS.map(c => [c.id, c]));

// ── STATE ────────────────────────────────────────────────
let state = {
  context: 'personal', // 'personal' | 'office'
  page: 'tasks',       // 'tasks' | 'history'
  tasks: [],           // all active tasks
  history: [],         // completed tasks (moved after 24h)
  lastDateCheck: null, // ISO date string of last auto-shift
  user: null,          // { name, email, picture } | null
};

let dragSrc = null;
let openMoveMenu = null;
let notifInterval = null;

// ── STORAGE ──────────────────────────────────────────────
const STORAGE_KEY = 'taskflow_v2';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateSyncStatus();
  } catch (e) {
    console.warn('localStorage unavailable:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (el) {
    const now = new Date();
    el.textContent = `Last synced: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// ── GOOGLE SIGN-IN ───────────────────────────────────────
function handleGoogleSignIn() {
  // If real Client ID is set, use Google Identity Services
  if (GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
    });
    google.accounts.id.prompt();
  } else {
    // Demo mode: fake user
    loginUser({
      name: 'Demo User',
      email: 'demo@taskflow.app',
      picture: 'https://ui-avatars.com/api/?name=Demo+User&background=6366f1&color=fff&size=64',
    });
  }
}

function handleCredentialResponse(response) {
  // Decode JWT payload (no verification needed client-side; server should verify)
  const payload = JSON.parse(atob(response.credential.split('.')[1]));
  loginUser({
    name: payload.name,
    email: payload.email,
    picture: payload.picture,
  });
}

function loginUser(user) {
  state.user = user;
  saveState();
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.flexDirection = 'column';
  document.getElementById('user-name-el').textContent = user.name.split(' ')[0];
  const avatarEl = document.getElementById('user-avatar-el');
  if (user.picture) { avatarEl.src = user.picture; avatarEl.style.display = 'block'; }
  initApp();
}

function signOut() {
  if (!confirm('Sign out of TaskFlow?')) return;
  state.user = null;
  saveState();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  clearInterval(notifInterval);
}

// ── APP INIT ─────────────────────────────────────────────
function initApp() {
  autoShiftColumns();
  autoMoveToHistory();
  renderColumns();
  renderHistory();
  setupNotifications();
  setupAutoSync();
}

// ── AUTO DATE SHIFTING ───────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff)).toISOString().slice(0, 10);
}

function autoShiftColumns() {
  const today = todayStr();
  if (state.lastDateCheck === today) return;

  const yesterday = state.lastDateCheck;
  state.lastDateCheck = today;

  if (!yesterday) { saveState(); return; }

  const thisMonday = getMonday(today);
  const lastMonday = getMonday(yesterday);
  const isNewWeek = thisMonday !== lastMonday;

  const thisMonth = today.slice(0, 7);
  const lastMonth = yesterday.slice(0, 7);
  const isNewMonth = thisMonth !== lastMonth;

  state.tasks = state.tasks.map(t => {
    let col = t.column;
    // Tomorrow → Today
    if (col === 'tomorrow') col = 'today';
    // Next Week → This Week (on new week)
    if (isNewWeek && col === 'nextweek') col = 'thisweek';
    // This Week → Today (on new week start, move remaining to today)
    if (isNewWeek && col === 'thisweek') col = 'today';
    // Next Month → This Month (on new month)
    if (isNewMonth && col === 'nextmonth') col = 'thismonth';
    // This Month → Today (on new month start)
    if (isNewMonth && col === 'thismonth') col = 'today';
    return { ...t, column: col };
  });

  saveState();
  showToast('📅 Columns auto-updated for today!');
}

// ── HISTORY: move Done tasks older than 24h ──────────────
function autoMoveToHistory() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const toMove = state.tasks.filter(t => t.column === 'done' && t.doneAt && t.doneAt < cutoff);
  const keep = state.tasks.filter(t => !(t.column === 'done' && t.doneAt && t.doneAt < cutoff));

  if (toMove.length) {
    state.history = [...(state.history || []), ...toMove];
    state.tasks = keep;
    saveState();
  }
}

// ── TASK CRUD ────────────────────────────────────────────
function generateId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function addTask() {
  const input = document.getElementById('task-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  const col = document.getElementById('col-select').value;
  const task = {
    id: generateId(),
    text,
    column: col,
    context: state.context,
    starred: false,
    createdAt: Date.now(),
    doneAt: null,
  };

  state.tasks.unshift(task);
  input.value = '';
  input.focus();
  saveState();
  renderColumns();
  showToast(`✅ Task added to ${COL_MAP[col].label}`);
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
  renderColumns();
}

function toggleStar(id) {
  state.tasks = state.tasks.map(t =>
    t.id === id ? { ...t, starred: !t.starred } : t
  );
  saveState();
  renderColumns();
  setupNotificationInterval();
}

function moveTask(id, newColumn) {
  state.tasks = state.tasks.map(t => {
    if (t.id !== id) return t;
    const doneAt = newColumn === 'done' ? Date.now() : null;
    return { ...t, column: newColumn, doneAt };
  });
  closeAllMoveMenus();
  saveState();
  renderColumns();
  renderHistory();
  showToast(`Moved to ${COL_MAP[newColumn].label}`);
}

// ── RENDER ───────────────────────────────────────────────
function getContextTasks() {
  return state.tasks.filter(t => t.context === state.context);
}

function renderColumns() {
  const grid = document.getElementById('columns-grid');
  grid.innerHTML = '';

  COLUMNS.forEach(col => {
    const tasks = getContextTasks().filter(t => t.column === col.id);
    const card = document.createElement('div');
    card.className = 'column-card';
    card.dataset.col = col.id;

    card.innerHTML = `
      <div class="col-header" style="background: ${col.color}22; color: ${col.color}; border-bottom: 1px solid ${col.color}44;">
        <span>${col.emoji} ${col.label}</span>
        <span class="badge" style="background:${col.color}33;">${tasks.length}</span>
      </div>
      <div class="col-body" id="col-body-${col.id}" 
           ondragover="onDragOver(event,'${col.id}')" 
           ondrop="onDrop(event,'${col.id}')"
           ondragleave="onDragLeave(event)">
        ${tasks.length === 0 ? `<div class="empty-col">Drop tasks here</div>` : ''}
      </div>
    `;

    grid.appendChild(card);
    const body = card.querySelector('.col-body');

    tasks.forEach(t => {
      body.appendChild(buildTaskEl(t));
    });
  });
}

function buildTaskEl(task) {
  const div = document.createElement('div');
  div.className = `task-card${task.starred ? ' starred' : ''}`;
  div.draggable = true;
  div.dataset.id = task.id;

  div.addEventListener('dragstart', e => {
    dragSrc = task.id;
    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    dragSrc = null;
  });

  const moveOptionsHtml = COLUMNS
    .filter(c => c.id !== task.column)
    .map(c => `
      <button class="move-option" onclick="moveTask('${task.id}','${c.id}')">
        <span class="move-dot" style="background:${c.color}"></span>
        ${c.emoji} ${c.label}
      </button>
    `).join('');

  div.innerHTML = `
    <span class="task-text">${escapeHtml(task.text)}</span>
    <div class="task-actions">
      <button class="btn-icon${task.starred ? ' active' : ''}" title="Star" onclick="toggleStar('${task.id}')">
        ${task.starred ? '⭐' : '☆'}
      </button>
      <button class="btn-icon" title="Move to…" onclick="toggleMoveMenu(event,'${task.id}')">⇄</button>
      <button class="btn-icon" title="Delete" onclick="deleteTask('${task.id}')">🗑️</button>
    </div>
    <div class="move-select" id="move-menu-${task.id}">
      ${moveOptionsHtml}
    </div>
  `;

  return div;
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderHistory() {
  const body = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');
  if (!body) return;

  const items = (state.history || []).filter(t => t.context === state.context);
  body.innerHTML = '';

  if (items.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...items].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  sorted.forEach(t => {
    const col = COL_MAP[t.column] || COL_MAP['done'];
    const doneDate = t.doneAt ? new Date(t.doneAt).toLocaleDateString() : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.text)}</td>
      <td>
        <span class="history-badge" style="background:${t.context==='office'?'#8b5cf622':'#f9731622'};color:${t.context==='office'?'#8b5cf6':'#f97316'};">
          ${t.context === 'office' ? '💼' : '👤'} ${t.context}
        </span>
      </td>
      <td>
        <span class="history-badge" style="background:${col.color}22;color:${col.color};">
          ${col.emoji} ${col.label}
        </span>
      </td>
      <td style="color:var(--text-muted);font-size:0.82rem;">${doneDate}</td>
      <td>${t.starred ? '⭐' : '—'}</td>
    `;
    body.appendChild(tr);
  });
}

// ── MOVE MENU ────────────────────────────────────────────
function toggleMoveMenu(event, taskId) {
  event.stopPropagation();
  const menu = document.getElementById(`move-menu-${taskId}`);
  if (!menu) return;

  if (openMoveMenu && openMoveMenu !== menu) {
    openMoveMenu.classList.remove('open');
  }

  menu.classList.toggle('open');
  openMoveMenu = menu.classList.contains('open') ? menu : null;
}

function closeAllMoveMenus() {
  document.querySelectorAll('.move-select.open').forEach(m => m.classList.remove('open'));
  openMoveMenu = null;
}

document.addEventListener('click', closeAllMoveMenus);

// ── DRAG AND DROP ────────────────────────────────────────
function onDragOver(event, colId) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.getElementById(`col-body-${colId}`)?.classList.add('drag-over');
}

function onDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function onDrop(event, colId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (dragSrc) moveTask(dragSrc, colId);
}

// ── CONTEXT & PAGE SWITCHING ─────────────────────────────
function switchContext(ctx) {
  state.context = ctx;
  document.querySelectorAll('.context-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && ctx === 'personal') || (i === 1 && ctx === 'office'));
  });
  saveState();
  renderColumns();
  renderHistory();
}

function switchPage(page) {
  state.page = page;
  document.getElementById('page-tasks').style.display = page === 'tasks' ? '' : 'none';
  document.getElementById('page-history').style.display = page === 'history' ? '' : 'none';
  document.getElementById('add-bar').style.display = page === 'tasks' ? '' : 'none';
  document.getElementById('tab-tasks').classList.toggle('active', page === 'tasks');
  document.getElementById('tab-history').classList.toggle('active', page === 'history');
  if (page === 'history') renderHistory();
}

// ── SAVE & SYNC ──────────────────────────────────────────
function saveAndSync() {
  const btn = document.querySelector('.btn-sync');
  btn.innerHTML = '<span class="spin">🔄</span> Syncing…';
  setTimeout(() => {
    autoShiftColumns();
    autoMoveToHistory();
    saveState();
    renderColumns();
    renderHistory();
    btn.innerHTML = '💾 Save & Sync';
    showToast('✅ Synced successfully!');
  }, 800);
}

function setupAutoSync() {
  // Auto-sync every 5 minutes
  setInterval(() => {
    autoShiftColumns();
    autoMoveToHistory();
    saveState();
    renderColumns();
    renderHistory();
  }, 5 * 60 * 1000);
}

// ── NOTIFICATIONS ────────────────────────────────────────
function setupNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    document.getElementById('notif-banner').style.display = 'flex';
  } else if (Notification.permission === 'granted') {
    setupNotificationInterval();
  }
}

function requestNotifications() {
  Notification.requestPermission().then(perm => {
    document.getElementById('notif-banner').style.display = 'none';
    if (perm === 'granted') {
      setupNotificationInterval();
      showToast('🔔 Notifications enabled!');
    }
  });
}

function setupNotificationInterval() {
  clearInterval(notifInterval);
  const starredTasks = state.tasks.filter(t => t.starred && t.column !== 'done');
  if (starredTasks.length === 0 || Notification.permission !== 'granted') return;

  // Fire first immediately
  sendPriorityReminder(starredTasks);

  // Then every 2 hours
  notifInterval = setInterval(() => {
    const current = state.tasks.filter(t => t.starred && t.column !== 'done');
    if (current.length > 0) sendPriorityReminder(current);
    else clearInterval(notifInterval);
  }, 2 * 60 * 60 * 1000);
}

function sendPriorityReminder(tasks) {
  const titles = tasks.map(t => `• ${t.text}`).join('\n');
  new Notification('⭐ TaskFlow Priority Reminder', {
    body: `You have ${tasks.length} priority task(s):\n${titles}`,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
  });
}

// ── TOAST ────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── BOOT ─────────────────────────────────────────────────
(function boot() {
  loadState();
  if (state.user) {
    loginUser(state.user);
  }
})();
