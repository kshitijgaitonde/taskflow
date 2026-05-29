// ═══════════════════════════════════════════════════════════
//  TaskFlow App – app.js  (v7 — Recurring column in dashboard)
// ═══════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = '883637781494-2vb5bjeo04jtqmr22mo4v2ejfdls9tuo.apps.googleusercontent.com';

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
const WEEKDAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ─── STATE ──────────────────────────────────────────────────
let state = {
  context: 'office',
  page: 'tasks',
  tasks: [],
  history: [],
  recurring: [],
  lastDateCheck: null,
  user: null,
};

let db = null, unsubscribe = null, dragSrc = null, notifInterval = null;

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
  } catch(e) { showFBBanner('⚠️ Firebase error — falling back to local storage only.'); }
}
function showFBBanner(msg) {
  document.getElementById('firebase-banner').style.display='flex';
  document.getElementById('firebase-status').textContent=msg;
}
function hideFBBanner() { document.getElementById('firebase-banner').style.display='none'; }

function userDocRef() {
  if (!db || !state.user) return null;
  return db.collection('taskflow_users').doc(state.user.email.replace(/[^a-zA-Z0-9]/g,'_'));
}

async function cloudSave() {
  const ref = userDocRef();
  if (!ref) { localSave(); return; }
  setSyncDot('syncing');
  try {
    await ref.set({ tasks:state.tasks, history:state.history||[], recurring:state.recurring||[],
                    lastDateCheck:state.lastDateCheck, updatedAt:Date.now() }, { merge:true });
    localSave(); setSyncDot('ok'); updateSyncLabel();
  } catch(e) { localSave(); setSyncDot('offline'); }
}

function cloudListen() {
  const ref = userDocRef();
  if (!ref) return;
  if (unsubscribe) unsubscribe();
  setSyncDot('syncing');
  unsubscribe = ref.onSnapshot(snap => {
    if (!snap.exists) { setSyncDot('ok'); return; }
    const data = snap.data();
    if (!data.updatedAt || data.updatedAt <= (state._savedAt||0)) { setSyncDot('ok'); return; }
    state.tasks=data.tasks||[]; state.history=data.history||[];
    state.recurring=data.recurring||[]; state.lastDateCheck=data.lastDateCheck||null;
    state._savedAt=data.updatedAt;
    localSave(); autoShiftColumns(false); autoMoveToHistory();
    generateRecurringCards(); renderAll();
    setSyncDot('ok'); updateSyncLabel();
  }, () => setSyncDot('offline'));
}

// ─── LOCAL STORAGE ───────────────────────────────────────────
const STORAGE_KEY = 'taskflow_v7';
function localSave() {
  state._savedAt = state._savedAt||Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}
function localLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const s=JSON.parse(raw); state={...state,...s}; state.recurring=state.recurring||[]; }
  } catch(e) {}
}
function saveState() { cloudSave(); }

function setSyncDot(s) {
  const c={ok:'#2ecc71',syncing:'#f7c948',offline:'#ff6b35'}[s];
  const d1=document.getElementById('sync-dot'), d2=document.getElementById('sync-dot-2');
  if(d1){d1.style.background=c;d1.style.boxShadow=`0 0 6px ${c}`;d1.className=`sync-dot${s==='syncing'?' syncing':''}`;}
  if(d2) d2.style.background=c;
}
function updateSyncLabel() {
  const el=document.getElementById('sync-status');
  if(el) el.textContent=`Synced ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}

// ─── SIGN IN ─────────────────────────────────────────────────
function handleGoogleSignIn() {
  if (GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID, callback:onGoogleToken});
    google.accounts.id.prompt();
  } else {
    loginUser({name:'Demo User',email:'demo@taskflow.app',
      picture:'https://ui-avatars.com/api/?name=Demo+User&background=6c63ff&color=fff&size=64'});
  }
}
function onGoogleToken(r) {
  const p=JSON.parse(atob(r.credential.split('.')[1]));
  loginUser({name:p.name,email:p.email,picture:p.picture});
}
function loginUser(user) {
  state.user=user;
  document.getElementById('login-screen').style.display='none';
  const app=document.getElementById('app'); app.style.display='flex'; app.style.flexDirection='column';
  document.getElementById('user-name-el').textContent=user.name.split(' ')[0];
  const av=document.getElementById('user-avatar-el');
  if(user.picture){av.src=user.picture;av.style.display='block';}
  localSave(); initApp();
}
function signOut() {
  if(!confirm('Sign out of TaskFlow?')) return;
  if(unsubscribe) unsubscribe();
  state.user=null; localSave();
  document.getElementById('app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  clearInterval(notifInterval);
}

// ─── INIT ────────────────────────────────────────────────────
function initApp() {
  state.context='office'; applyContextTheme('office');
  initFirebase(); cloudListen();
  autoShiftColumns(true); autoMoveToHistory();
  generateRecurringCards(); renderAll();
  setupNotifications(); setupAutoSync();
}
function renderAll() { renderColumns(); renderHistory(); }

// ─── DATE UTILS ──────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }
function mondayOf(d) {
  const dt=new Date(d), day=dt.getDay();
  dt.setDate(dt.getDate()-day+(day===0?-6:1));
  return dt.toISOString().slice(0,10);
}

// ─── AUTO SHIFT ──────────────────────────────────────────────
function autoShiftColumns(toast=true) {
  const today=todayStr();
  if(state.lastDateCheck===today) return;
  const prev=state.lastDateCheck; state.lastDateCheck=today;
  if(!prev){localSave();return;}
  const newWeek=mondayOf(today)!==mondayOf(prev);
  const newMonth=today.slice(0,7)!==prev.slice(0,7);
  state.tasks=state.tasks.map(t=>{
    if(t.recurringId) return t;
    let c=t.column;
    if(c==='tomorrow') c='today';
    if(newWeek&&c==='nextweek') c='thisweek';
    if(newWeek&&c==='thisweek') c='today';
    if(newMonth&&c==='nextmonth') c='thismonth';
    if(newMonth&&c==='thismonth') c='today';
    return {...t,column:c};
  });
  if(toast) showToastMsg('📅 Columns auto-updated for today!');
}
function autoMoveToHistory() {
  const cutoff=Date.now()-24*60*60*1000;
  const old=state.tasks.filter(t=>t.column==='done'&&t.doneAt&&t.doneAt<cutoff);
  if(!old.length) return;
  state.history=[...(state.history||[]),...old];
  state.tasks=state.tasks.filter(t=>!(t.column==='done'&&t.doneAt&&t.doneAt<cutoff));
}

// ═══════════════════════════════════════════════════════════
//  RECURRING ENGINE  (supports multiple days/dates)
// ═══════════════════════════════════════════════════════════

/*
  Template shape:
  {
    id, text, context, starred, type: 'daily'|'weekly'|'monthly',
    weekdays:   [0-6, ...]   e.g. [1,4] = Mon+Thu
    monthDates: [1-28, ...]  e.g. [1,15] = 1st and 15th
    createdAt
  }
  Each weekday/monthDate combination spawns its own card.
  recurringId on a card = `${templateId}_${day/date}` so each slot is independent.
*/

function ordinal(n) {
  const s=['th','st','nd','rd']; const v=n%100;
  return n+(s[(v-20)%10]||s[v]||s[0]);
}

function recurLabel(r) {
  if(r.type==='daily') return '🔁 Every Day';
  if(r.type==='weekly') {
    const days=(r.weekdays||[]).map(d=>WEEKDAY_NAMES[d]).join(', ');
    return `🔁 Every ${days||'?'}`;
  }
  if(r.type==='monthly') {
    const dates=(r.monthDates||[]).map(d=>ordinal(d)).join(', ');
    return `🔁 Monthly on ${dates||'?'}`;
  }
  return '🔁';
}

function nextOccurrenceForSlot(type, slotVal, fromDate) {
  // Returns the next date ≥ fromDate for this specific slot
  const from=new Date(fromDate+'T00:00:00');
  if(type==='daily') return fromDate;
  if(type==='weekly') {
    const target=slotVal; // 0-6
    const diff=(target-from.getDay()+7)%7;
    const d=new Date(from); d.setDate(d.getDate()+diff);
    return d.toISOString().slice(0,10);
  }
  if(type==='monthly') {
    const target=slotVal; // 1-28
    const d=new Date(from.getFullYear(),from.getMonth(),target);
    if(d<from) d.setMonth(d.getMonth()+1);
    return d.toISOString().slice(0,10);
  }
  return fromDate;
}

function columnForDate(targetStr, todayS) {
  const today=new Date(todayS+'T00:00:00');
  const target=new Date(targetStr+'T00:00:00');
  const diff=Math.round((target-today)/86400000);
  if(diff<0) return null;
  if(diff===0) return 'today';
  if(diff===1) return 'tomorrow';
  const tm=mondayOf(todayS), tt=mondayOf(targetStr);
  if(tt===tm) return 'thisweek';
  const nm=new Date(tm); nm.setDate(nm.getDate()+7);
  if(tt===nm.toISOString().slice(0,10)) return 'nextweek';
  if(targetStr.slice(0,7)===todayS.slice(0,7)) return 'thismonth';
  const nextMYM=new Date(today.getFullYear(),today.getMonth()+1,1).toISOString().slice(0,7);
  if(targetStr.slice(0,7)===nextMYM) return 'nextmonth';
  return null;
}

function slotsFor(r) {
  // Returns array of slot values to iterate
  if(r.type==='daily')   return [0];           // single slot, val ignored
  if(r.type==='weekly')  return r.weekdays||[];
  if(r.type==='monthly') return r.monthDates||[];
  return [];
}

function generateRecurringCards() {
  const today=todayStr();
  state.recurring=state.recurring||[];

  state.recurring.forEach(r => {
    const slots=slotsFor(r);
    slots.forEach(slotVal => {
      const slotId = r.type==='daily' ? r.id : `${r.id}_${slotVal}`;

      // Next occurrence date for this slot
      const nextDate = r.type==='daily'
        ? today
        : nextOccurrenceForSlot(r.type, slotVal, today);

      const col=columnForDate(nextDate, today);
      if(!col) return;

      // Find existing active card for this slot
      const existing=state.tasks.find(t=>t.recurringId===slotId && t.column!=='done');
      if(existing) {
        // Update column if it shifted (e.g. tomorrow → today)
        if(existing.column!==col) existing.column=col;
        return;
      }

      // Create new card for this slot
      state.tasks.unshift({
        id:       genId(),
        text:     r.text,
        column:   col,
        context:  r.context,
        starred:  r.starred||false,
        recurringId: slotId,
        recurTemplateId: r.id,
        recurLabel: slotLabelFor(r, slotVal),
        createdAt: Date.now(),
        doneAt:   null,
      });
    });
  });
}

function slotLabelFor(r, slotVal) {
  if(r.type==='daily')   return '🔁 Every Day';
  if(r.type==='weekly')  return `🔁 Every ${WEEKDAY_NAMES[slotVal]||'?'}`;
  if(r.type==='monthly') return `🔁 ${ordinal(slotVal)} of month`;
  return '🔁';
}

function completeRecurringCard(taskId) {
  const task=state.tasks.find(t=>t.id===taskId);
  if(!task||!task.recurringId) return;
  task.column='done'; task.doneAt=Date.now();

  // Spawn next card for same slot (tomorrow onwards)
  const r=state.recurring.find(r=>r.id===task.recurTemplateId);
  if(!r) return;
  const today=todayStr();
  const tmrw=new Date(); tmrw.setDate(tmrw.getDate()+1);
  const tmrwStr=tmrw.toISOString().slice(0,10);

  // Extract slotVal from recurringId  e.g. "r_123_5" → 5
  const slotVal=task.recurringId.includes('_') && r.type!=='daily'
    ? parseInt(task.recurringId.split('_').pop())
    : 0;

  const nextDate=r.type==='daily' ? tmrwStr : nextOccurrenceForSlot(r.type,slotVal,tmrwStr);
  const col=columnForDate(nextDate,today);
  if(!col) return;

  state.tasks.unshift({
    id:genId(), text:r.text, column:col, context:r.context,
    starred:r.starred||false,
    recurringId:task.recurringId,
    recurTemplateId:r.id,
    recurLabel:task.recurLabel,
    createdAt:Date.now(), doneAt:null,
  });
}

// ─── CHIP MULTI-SELECT UI ────────────────────────────────────
function toggleChip(btn, group) {
  btn.classList.toggle('selected');
}

function getSelectedChips(groupId) {
  return [...document.querySelectorAll(`#chips-${groupId} .chip.selected`)]
    .map(b=>parseInt(b.dataset.val));
}

// ─── RECURRING MODAL ─────────────────────────────────────────
function openRecurModal() {
  document.getElementById('recur-modal').style.display='flex';
  // Clear chips
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));
  document.getElementById('recur-text').value='';
  document.getElementById('recur-type').value='weekly';
  document.getElementById('recur-star').checked=false;
  updateRecurFields();
  document.getElementById('recur-text').focus();
}
function closeRecurModal() {
  document.getElementById('recur-modal').style.display='none';
}
function updateRecurFields() {
  const type=document.getElementById('recur-type').value;
  document.getElementById('recur-weekday-row').style.display  = type==='weekly'  ?'block':'none';
  document.getElementById('recur-monthdate-row').style.display= type==='monthly' ?'block':'none';
}
function saveRecurring() {
  const text=document.getElementById('recur-text').value.trim();
  if(!text){document.getElementById('recur-text').focus();return;}
  const type=document.getElementById('recur-type').value;
  const starred=document.getElementById('recur-star').checked;

  let weekdays=[], monthDates=[];
  if(type==='weekly') {
    weekdays=getSelectedChips('weekly');
    if(!weekdays.length){showToastMsg('⚠️ Please select at least one day');return;}
  }
  if(type==='monthly') {
    monthDates=getSelectedChips('monthly');
    if(!monthDates.length){showToastMsg('⚠️ Please select at least one date');return;}
  }

  const r={
    id:genId().replace('t_','r_'),
    text, context:state.context, starred, type,
    weekdays, monthDates, createdAt:Date.now(),
  };
  state.recurring.push(r);
  generateRecurringCards();
  saveState(); renderAll();
  closeRecurModal();
  showToastMsg(`🔁 Recurring task created — ${recurLabel(r)}`);
}

function deleteRecurring(rid) {
  if(!confirm('Delete this recurring task? All future cards will stop appearing.')) return;
  state.recurring=state.recurring.filter(r=>r.id!==rid);
  state.tasks=state.tasks.filter(t=>!(t.recurTemplateId===rid&&t.column!=='done'));
  saveState(); renderAll();
  showToastMsg('🗑️ Recurring task deleted');
}

// ─── TASK CRUD ───────────────────────────────────────────────
function genId(){return `t_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;}
function makeTask(text,colId){
  return{id:genId(),text,column:colId,context:state.context,starred:false,createdAt:Date.now(),doneAt:null};
}
function addTask(){
  const inp=document.getElementById('task-input');
  const text=inp.value.trim(); if(!text){inp.focus();return;}
  const col=document.getElementById('col-select').value;
  state.tasks.unshift(makeTask(text,col));
  inp.value=''; inp.focus(); saveState(); renderColumns();
  showToastMsg(`✅ Added to ${COL_MAP[col].label}`);
}
function addInlineTask(colId){
  const inp=document.getElementById(`ii-${colId}`);
  if(!inp) return; const text=inp.value.trim(); if(!text){inp.focus();return;}
  state.tasks.unshift(makeTask(text,colId)); inp.value='';
  saveState(); renderColumns();
  requestAnimationFrame(()=>document.getElementById(`ii-${colId}`)?.focus());
}
function deleteTask(id){
  state.tasks=state.tasks.filter(t=>t.id!==id);
  saveState(); renderColumns();
}
function reorderTask(id,dir){
  const task=state.tasks.find(t=>t.id===id); if(!task) return;
  const sibs=state.tasks.map((t,i)=>({t,i})).filter(({t})=>t.column===task.column&&t.context===state.context);
  const pos=sibs.findIndex(({t})=>t.id===id);
  if(dir==='up'&&pos===0) return;
  if(dir==='down'&&pos===sibs.length-1) return;
  const swp=dir==='up'?pos-1:pos+1;
  const copy=[...state.tasks];
  [copy[sibs[pos].i],copy[sibs[swp].i]]=[copy[sibs[swp].i],copy[sibs[pos].i]];
  state.tasks=copy; saveState(); renderColumns();
  requestAnimationFrame(()=>document.querySelector(`.task-card[data-id="${id}"] .btn-${dir}`)?.focus());
}
function toggleStar(id){
  state.tasks=state.tasks.map(t=>t.id===id?{...t,starred:!t.starred}:t);
  saveState(); renderColumns(); setupNotifInterval();
}
function moveTask(id,newCol){
  const task=state.tasks.find(t=>t.id===id); if(!task) return;
  if(newCol==='done'&&task.recurringId) completeRecurringCard(id);
  else state.tasks=state.tasks.map(t=>t.id!==id?t:{...t,column:newCol,doneAt:newCol==='done'?Date.now():null});
  closeMoveMenu(); saveState(); renderColumns(); renderHistory();
  showToastMsg(`↪ Moved to ${COL_MAP[newCol].label}`);
}

// ─── RENDER ──────────────────────────────────────────────────
function ctxTasks(){return state.tasks.filter(t=>t.context===state.context);}

function renderColumns() {
  const grid=document.getElementById('columns-grid');
  grid.innerHTML='';

  // ── Regular task columns ──────────────────────────────────
  COLUMNS.forEach(col=>{
    const tasks=ctxTasks().filter(t=>t.column===col.id);
    const isDone=col.id==='done';
    const card=document.createElement('div');
    card.className='column-card';
    const inlineAdd=isDone?'':`
      <div class="inline-add-row">
        <input class="inline-add-input" id="ii-${col.id}"
               placeholder="+ Add task here…"
               onkeydown="if(event.key==='Enter')addInlineTask('${col.id}')" />
        <button class="inline-add-btn" onclick="addInlineTask('${col.id}')">＋</button>
      </div>`;
    card.innerHTML=`
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
        ${tasks.length===0?'<div class="drop-hint">Drop tasks here</div>':''}
      </div>
      ${inlineAdd}`;
    grid.appendChild(card);
    const body=card.querySelector('.col-body');
    tasks.forEach(t=>body.appendChild(buildTaskEl(t)));
  });

  // ── Recurring column ──────────────────────────────────────
  const mine=(state.recurring||[]).filter(r=>r.context===state.context);
  const recurCol=document.createElement('div');
  recurCol.className='recur-column';
  recurCol.innerHTML=`
    <div class="recur-col-hdr">
      <div style="display:flex;align-items:center;gap:0.5rem">
        <span style="font-size:1rem">🔁</span>
        <span style="font-weight:700;font-size:0.75rem;letter-spacing:0.6px;text-transform:uppercase;color:#17c0eb">Recurring</span>
      </div>
      <span style="font-size:0.65rem;font-weight:700;font-family:var(--mono);color:#17c0eb;background:rgba(23,192,235,0.15);padding:0.1rem 0.45rem;border-radius:50px">${mine.length}</span>
    </div>
    <div class="recur-col-body" id="recur-col-body">
      ${mine.length===0?'<div class="drop-hint" style="font-size:0.72rem">No recurring tasks yet</div>':''}
    </div>
    <div class="recur-col-footer">
      <button class="btn-add-recur" onclick="openRecurModal()">＋ Add Recurring Task</button>
    </div>`;
  grid.appendChild(recurCol);

  const body=recurCol.querySelector('#recur-col-body');
  mine.forEach(r=>{
    const item=document.createElement('div');
    item.className='recur-item';
    item.innerHTML=`
      <div class="recur-item-main">
        <span class="recur-badge">${recurLabel(r)}</span>
        <span class="recur-item-text">${escapeHtml(r.text)}${r.starred?' ⭐':''}</span>
      </div>
      <button class="btn-icon btn-delete" onclick="deleteRecurring('${r.id}')" title="Delete recurring task" style="flex-shrink:0">✕</button>`;
    body.appendChild(item);
  });
}

function buildTaskEl(task){
  const div=document.createElement('div');
  div.className=`task-card${task.starred?' starred':''}${task.recurringId?' recurring':''}`;
  div.draggable=true; div.dataset.id=task.id;
  div.addEventListener('dragstart',e=>{dragSrc=task.id;div.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  div.addEventListener('dragend',()=>{div.classList.remove('dragging');dragSrc=null;});
  const recurBadge=task.recurringId?`<span class="task-recur-badge">${task.recurLabel||'🔁'}</span>`:'';
  div.innerHTML=`
    <div class="task-reorder">
      <button class="btn-reorder btn-up"   onclick="reorderTask('${task.id}','up')"   title="Move up">▲</button>
      <button class="btn-reorder btn-down" onclick="reorderTask('${task.id}','down')" title="Move down">▼</button>
    </div>
    <div class="task-main">
      ${recurBadge}
      <span class="task-text">${escapeHtml(task.text)}</span>
    </div>
    <div class="task-actions">
      <button class="btn-icon btn-star${task.starred?' active':''}" onclick="toggleStar('${task.id}')" title="${task.starred?'Remove priority':'Mark as priority'}">${task.starred?'⭐':'☆'}</button>
      <button class="btn-icon btn-move" onclick="toggleMoveMenu(event,'${task.id}')" title="Move to…">⇄ Move</button>
      <button class="btn-icon btn-delete" onclick="deleteTask('${task.id}')" title="Delete">✕</button>
    </div>`;
  return div;
}

function escapeHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function renderHistory(){
  const body=document.getElementById('history-body');
  const empty=document.getElementById('history-empty');
  if(!body) return;
  const items=(state.history||[]).filter(t=>t.context===state.context);
  body.innerHTML='';
  if(!items.length){empty.style.display='block';return;}
  empty.style.display='none';
  [...items].sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).forEach(t=>{
    const col=COL_MAP[t.column]||COL_MAP['done'];
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${escapeHtml(t.text)}${t.recurringId?` <span style="font-size:0.7rem;opacity:0.6">${t.recurLabel||'🔁'}</span>`:''}</td>
      <td><span class="hbadge" style="background:${t.context==='office'?'#a55eea22':'#ff6b3522'};color:${t.context==='office'?'#a55eea':'#ff6b35'}">${t.context==='office'?'💼':'👤'} ${t.context}</span></td>
      <td><span class="hbadge" style="background:${col.color}22;color:${col.color}">${col.emoji} ${col.label}</span></td>
      <td style="color:var(--muted);font-size:0.78rem">${t.doneAt?new Date(t.doneAt).toLocaleDateString():'—'}</td>
      <td>${t.starred?'⭐':'—'}</td>`;
    body.appendChild(tr);
  });
}

// ─── MOVE MENU ───────────────────────────────────────────────
const moveMenuEl=document.getElementById('global-move-menu');
let moveMenuOpen=false, activeMoveBtnId=null;
function toggleMoveMenu(event,taskId){
  event.stopPropagation();
  if(moveMenuOpen&&activeMoveBtnId===taskId){closeMoveMenu();return;}
  const task=state.tasks.find(t=>t.id===taskId); if(!task) return;
  moveMenuEl.innerHTML=COLUMNS.filter(c=>c.id!==task.column)
    .map(c=>`<button class="move-option" onclick="moveTask('${taskId}','${c.id}')"><span class="move-dot" style="background:${c.color}"></span>${c.emoji} ${c.label}</button>`).join('');
  const btn=event.currentTarget, rect=btn.getBoundingClientRect(), menuW=172;
  const left=window.innerWidth-rect.left>=menuW?rect.left:rect.right-menuW;
  moveMenuEl.style.left=`${Math.max(8,left)}px`;
  moveMenuEl.style.top=`${Math.min(rect.bottom+6,window.innerHeight-280)}px`;
  moveMenuEl.classList.add('open'); moveMenuOpen=true; activeMoveBtnId=taskId;
}
function closeMoveMenu(){moveMenuEl.classList.remove('open');moveMenuOpen=false;activeMoveBtnId=null;}
document.addEventListener('click',e=>{if(moveMenuOpen&&!moveMenuEl.contains(e.target))closeMoveMenu();});
document.addEventListener('scroll',closeMoveMenu,true);

// ─── DRAG & DROP ─────────────────────────────────────────────
function onDragOver(event,colId){
  event.preventDefault(); event.dataTransfer.dropEffect='move';
  document.getElementById(`cb-${colId}`)?.classList.add('drag-over');
  event.currentTarget.closest('.column-card')?.classList.add('drag-target');
}
function onDragLeave(event){
  event.currentTarget.classList.remove('drag-over');
  event.currentTarget.closest('.column-card')?.classList.remove('drag-target');
}
function onDrop(event,colId){
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  event.currentTarget.closest('.column-card')?.classList.remove('drag-target');
  if(dragSrc) moveTask(dragSrc,colId);
}

// ─── NAVIGATION ──────────────────────────────────────────────
function applyContextTheme(ctx){
  document.body.classList.remove('ctx-personal','ctx-office');
  document.body.classList.add(`ctx-${ctx}`);
  const strip=document.getElementById('ctx-bar'), badge=document.getElementById('ctx-badge');
  const logoMark=document.getElementById('logo-mark'), avatar=document.getElementById('user-avatar-el');
  if(ctx==='office'){
    if(strip) strip.style.background='linear-gradient(90deg,#0ea5a0,#34d1cb,#10b981)';
    if(badge){badge.textContent='💼 OFFICE';badge.style.background='#0ea5a0';}
    if(logoMark) logoMark.style.background='linear-gradient(135deg,#0ea5a0,#10b981)';
    if(avatar) avatar.style.borderColor='#0ea5a0';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#06151a');
  } else {
    if(strip) strip.style.background='linear-gradient(90deg,#6c63ff,#a55eea,#fd79a8)';
    if(badge){badge.textContent='👤 PERSONAL';badge.style.background='#6c63ff';}
    if(logoMark) logoMark.style.background='linear-gradient(135deg,#6c63ff,#fd79a8)';
    if(avatar) avatar.style.borderColor='#6c63ff';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#060614');
  }
}
function switchContext(ctx){
  state.context=ctx;
  document.getElementById('tab-personal')?.classList.toggle('active',ctx==='personal');
  document.getElementById('tab-office')?.classList.toggle('active',ctx==='office');
  applyContextTheme(ctx); localSave(); renderAll();
}
function switchPage(page){
  state.page=page;
  document.getElementById('page-tasks').style.display    =page==='tasks'  ?'':'none';
  document.getElementById('page-history').style.display  =page==='history'?'':'none';
  document.getElementById('add-bar').style.display       =page==='tasks'  ?'':'none';
  document.getElementById('tab-tasks').classList.toggle('active',   page==='tasks');
  document.getElementById('tab-history').classList.toggle('active', page==='history');
  if(page==='history') renderHistory();
}

// ─── SAVE & SYNC ─────────────────────────────────────────────
async function saveAndSync(){
  const btn=document.querySelector('.btn-sync');
  btn.innerHTML='<span class="spin">🔄</span> Syncing…'; btn.disabled=true;
  autoShiftColumns(false); autoMoveToHistory(); generateRecurringCards();
  await cloudSave(); renderAll();
  btn.innerHTML='💾 Save &amp; Sync'; btn.disabled=false;
  showToastMsg('✅ Synced!');
}
function setupAutoSync(){
  setInterval(async()=>{
    autoShiftColumns(false); autoMoveToHistory(); generateRecurringCards();
    await cloudSave(); renderAll();
  }, 3*60*1000);
}

// ─── NOTIFICATIONS ───────────────────────────────────────────
function setupNotifications(){
  if('Notification' in window&&Notification.permission==='default')
    document.getElementById('notif-banner').style.display='flex';
  else if(Notification.permission==='granted') setupNotifInterval();
}
function requestNotifications(){
  Notification.requestPermission().then(p=>{
    document.getElementById('notif-banner').style.display='none';
    if(p==='granted'){setupNotifInterval();showToastMsg('🔔 Notifications on!');}
  });
}
function setupNotifInterval(){
  clearInterval(notifInterval);
  const starred=state.tasks.filter(t=>t.starred&&t.column!=='done');
  if(!starred.length||Notification.permission!=='granted') return;
  sendReminder(starred);
  notifInterval=setInterval(()=>{
    const cur=state.tasks.filter(t=>t.starred&&t.column!=='done');
    if(cur.length) sendReminder(cur); else clearInterval(notifInterval);
  }, 2*60*60*1000);
}
function sendReminder(tasks){
  new Notification('⭐ TaskFlow Priority Reminder',{
    body:`${tasks.length} priority task(s):\n${tasks.map(t=>'• '+t.text).join('\n')}`,
    icon:'icons/icon-192.png',
  });
}

// ─── TOAST ───────────────────────────────────────────────────
function showToastMsg(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2600);
}

// ─── BOOT ────────────────────────────────────────────────────
(function boot(){
  localLoad();
  if(state.user) loginUser(state.user);
})();
