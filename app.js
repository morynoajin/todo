/* ========== CONSTANTS ========== */
const STORAGE_KEY = 'todo-pwa-v2';
const COLORS = ['#2564CF','#107C10','#C50F1F','#8764B8','#038387','#F7630C','#E3008C','#7A7574'];
const ICONS  = ['📋','💼','🛒','🏠','📚','🏋️','🎯','✈️','💡','🎵'];
const DAYS   = ['일','월','화','수','목','금','토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

/* ========== STATE ========== */
let S = {
  tasks: [], lists: [], groups: [],
  cfg: {
    dark: false, view: 'myday', sort: 'created',
    showDone: true, addMyDay: false,
    dailyNotif: false, dailyNotifTime: '09:00', dailyNotifLastSent: null,
  },
  sel: null,        // selected task id
  q: '',            // search query
  calCfg: null,     // { taskId, field, y, m }
  doneOpen: true,   // completed section expanded
  reminderTimers: [],
};

/* ========== UTILITIES ========== */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// KST(UTC+9) 기준 오늘 날짜 문자열 "YYYY-MM-DD" 반환.
// 인수를 주면 그 Date를 KST 날짜로 변환.
function getKSTDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
}
// KST 기준 "HH:MM" 반환
function getKSTTimeStr(d) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2,'0')}:${String(kst.getUTCMinutes()).padStart(2,'0')}`;
}
// 날짜 문자열 "YYYY-MM-DD"를 UTC 정오로 파싱 (시간대 오차 없이 날짜 산술에 사용)
function dateDt(dateStr) { return new Date(dateStr + 'T12:00:00Z'); }

const todayStr = getKSTDate;       // 기존 호출부 호환 유지
const nowISO = () => new Date().toISOString();
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const t = todayStr();
  const dt = new Date(y, m - 1, day);
  const tomDt = dateDt(t); tomDt.setUTCDate(tomDt.getUTCDate() + 1);
  const tomStr = tomDt.toISOString().slice(0, 10);
  if (d === t) return '오늘';
  if (d === tomStr) return '내일';
  const now = new Date();
  const diff = Math.round((dt - now) / 86400000);
  if (diff < -1) return `${y === now.getFullYear() ? '' : y + '년 '}${m}월 ${day}일`;
  return `${y === now.getFullYear() ? '' : y + '년 '}${m}월 ${day}일`;
}
function isPast(d) { return d && d < todayStr(); }
function isToday(d) { return d === todayStr(); }

/* ========== STORAGE ========== */
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch(e) {} }
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      S.tasks  = p.tasks  || [];
      S.lists  = p.lists  || [];
      S.groups = p.groups || [];
      S.cfg    = { ...S.cfg, ...(p.cfg || {}) };
      S.sel    = p.sel || null;
      S.doneOpen = p.doneOpen !== undefined ? p.doneOpen : true;
    }
  } catch(e) {}
}

/* ========== DARK MODE ========== */
function applyDark() {
  document.body.classList.toggle('dark', S.cfg.dark);
  document.getElementById('theme-color-meta').content = S.cfg.dark ? '#1b1a19' : '#2564CF';
}
function toggleDarkMode() { S.cfg.dark = !S.cfg.dark; applyDark(); save(); }

/* ========== SIDEBAR ========== */
let sidebarOpen = false;
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
  document.getElementById('overlay').classList.toggle('active', sidebarOpen);
}
function closeSidebar() {
  sidebarOpen = false;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
}

/* ========== VIEWS ========== */
const VIEW_LABELS = {
  myday: '나의 하루', important: '중요', planned: '계획됨', all: '전체 작업'
};

function switchView(v) {
  S.cfg.view = v; S.sel = null;
  closeSidebar(); closeDetail(); save(); render();
}

function getViewTasks(view) {
  const t = todayStr();
  return S.tasks.filter(task => {
    if (view === 'myday')     return task.myDay && task.myDayDate === t;
    if (view === 'important') return task.important;
    if (view === 'planned')   return !!task.dueDate;
    if (view === 'all')       return true;
    return task.listId === view.replace('list-', '');
  });
}

function filterTasks(tasks) {
  if (!S.q) return tasks;
  const q = S.q.toLowerCase();
  return tasks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.note && t.note.toLowerCase().includes(q)) ||
    t.subtasks.some(s => s.title.toLowerCase().includes(q))
  );
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    // Always put completed at end
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    switch (S.cfg.sort) {
      case 'importance': {
        if (a.important !== b.important) return a.important ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      }
      case 'dueDate': {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      case 'name': return a.title.localeCompare(b.title, 'ko');
      default: return b.createdAt.localeCompare(a.createdAt);
    }
  });
}

/* ========== RENDER MAIN ========== */
function render() {
  renderSidebar();
  renderTaskList();
  renderDetail();
  updateCounts();
}

/* ========== SIDEBAR RENDER ========== */
function renderSidebar() {
  const v = S.cfg.view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === v);
  });

  // Lists container
  const container = document.getElementById('lists-container');
  let html = '';

  // Ungrouped lists
  const ungrouped = S.lists.filter(l => !l.groupId);
  for (const l of ungrouped) {
    const listView = 'list-' + l.id;
    const cnt = S.tasks.filter(t => t.listId === l.id && !t.completed).length;
    html += listItemHtml(l, listView === v, cnt);
  }

  // Groups
  for (const g of S.groups) {
    const groupLists = S.lists.filter(l => l.groupId === g.id);
    html += `<div class="group-wrap">
      <button class="group-header" onclick="toggleGroup('${g.id}')">
        <span class="group-chevron ${g.collapsed ? 'collapsed' : ''}">▶</span>
        <span class="group-name-text">${esc(g.name)}</span>
        <button class="group-more" onclick="event.stopPropagation();showGroupCtx('${g.id}',event)">•••</button>
      </button>
      <div class="group-lists ${g.collapsed ? 'collapsed' : ''}">`;
    for (const l of groupLists) {
      const listView = 'list-' + l.id;
      const cnt = S.tasks.filter(t => t.listId === l.id && !t.completed).length;
      html += listItemHtml(l, listView === v, cnt);
    }
    html += `</div></div>`;
  }

  container.innerHTML = html;
}

function listItemHtml(l, active, cnt) {
  const listView = 'list-' + l.id;
  return `<div class="list-item ${active ? 'active' : ''}" onclick="switchView('${listView}')">
    <span class="list-dot" style="background:${l.color}"></span>
    <span class="list-name">${esc(l.name)}</span>
    ${cnt > 0 ? `<span class="list-count">${cnt}</span>` : ''}
    <button class="list-more" onclick="event.stopPropagation();showListCtx('${l.id}',event)">•••</button>
  </div>`;
}

/* ========== TASK LIST RENDER ========== */
function renderTaskList() {
  const viewTitle = VIEW_LABELS[S.cfg.view] ||
    (S.lists.find(l => 'list-' + l.id === S.cfg.view) || {}).name || '';
  document.getElementById('view-title').textContent = viewTitle;

  const el = document.getElementById('task-list');
  let tasks = filterTasks(getViewTasks(S.cfg.view));
  tasks = sortTasks(tasks);

  if (!tasks.length && !S.q) {
    el.innerHTML = emptyStateHtml();
    return;
  }
  if (!tasks.length) {
    el.innerHTML = `<div class="empty-state"><p>검색 결과가 없습니다.</p></div>`;
    return;
  }

  const active = tasks.filter(t => !t.completed);
  const done   = tasks.filter(t => t.completed);

  let html = '';
  for (const t of active) html += taskItemHtml(t);

  if (done.length && S.cfg.showDone) {
    html += `<div class="completed-toggle" onclick="toggleDoneSection()">
      <span class="completed-chevron ${S.doneOpen ? 'open' : ''}">▶</span>
      완료됨 ${done.length}개
    </div>`;
    if (S.doneOpen) {
      for (const t of done) html += taskItemHtml(t);
    }
  }

  el.innerHTML = html;
}

function emptyStateHtml() {
  const v = S.cfg.view;
  const msgs = {
    myday: ['☀️','오늘 할 일을 추가해 보세요'],
    important: ['⭐','별표 작업이 없습니다'],
    planned: ['📅','마감일이 있는 작업이 없습니다'],
    all: ['📋','작업이 없습니다'],
  };
  const [icon, msg] = msgs[v] || ['📋','작업이 없습니다'];
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

function taskItemHtml(t) {
  const list = t.listId ? S.lists.find(l => l.id === t.listId) : null;
  const selected = S.sel === t.id;
  const isComplex = S.cfg.view !== 'all' && S.cfg.view !== 'myday';

  let metaHtml = '';
  if (t.dueDate) {
    const cls = isPast(t.dueDate) ? 'due-past' : isToday(t.dueDate) ? 'due-today' : '';
    metaHtml += `<span class="task-meta-item ${cls}">
      <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      ${fmtDate(t.dueDate)}</span>`;
  }
  if (t.subtasks.length) {
    const done = t.subtasks.filter(s => s.completed).length;
    metaHtml += `<span class="task-meta-item">
      <svg class="icon" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/></svg>
      ${done}/${t.subtasks.length}</span>`;
  }
  if (t.reminder) {
    metaHtml += `<span class="task-meta-item">
      <svg class="icon" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      알림</span>`;
  }
  if (t.repeat) {
    metaHtml += `<span class="task-meta-item">
      <svg class="icon" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
      반복</span>`;
  }
  if (list && ['myday','important','planned','all'].includes(S.cfg.view)) {
    metaHtml += `<span class="task-meta-item">
      <span class="list-dot" style="background:${list.color};width:8px;height:8px;border-radius:50%;display:inline-block;"></span>
      ${esc(list.name)}</span>`;
  }

  return `<div class="task-item ${t.completed ? 'completed' : ''} ${selected ? 'selected' : ''}"
    onclick="openDetail('${t.id}')" data-id="${t.id}">
    <button class="checkbox-btn ${t.completed ? 'checked' : ''}"
      onclick="event.stopPropagation();toggleComplete('${t.id}')"></button>
    <div class="task-body">
      <span class="task-title">${esc(t.title)}</span>
      ${metaHtml ? `<div class="task-meta">${metaHtml}</div>` : ''}
    </div>
    <button class="star-btn ${t.important ? 'starred' : ''}"
      onclick="event.stopPropagation();toggleImportant('${t.id}')">
      <svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>
  </div>`;
}

/* ========== COUNTS ========== */
function updateCounts() {
  const t = todayStr();
  const active = S.tasks.filter(x => !x.completed);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
  set('cnt-myday',     active.filter(x => x.myDay && x.myDayDate === t).length || '');
  set('cnt-important', active.filter(x => x.important).length || '');
  set('cnt-planned',   active.filter(x => x.dueDate).length || '');
  set('cnt-all',       active.length || '');
}

/* ========== DETAIL PANEL ========== */
function openDetail(id) {
  S.sel = id;
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  renderDetail();
  // Highlight in list
  document.querySelectorAll('.task-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  // Mobile: show overlay
  if (window.innerWidth < 768) {
    document.getElementById('overlay').classList.add('active');
  }
}

function closeDetail() {
  S.sel = null;
  document.getElementById('detail-panel').classList.add('hidden');
  document.querySelectorAll('.task-item').forEach(el => el.classList.remove('selected'));
  if (window.innerWidth < 768) {
    document.getElementById('overlay').classList.remove('active');
  }
}

function renderDetail() {
  const panel = document.getElementById('detail-panel');
  if (!S.sel) { panel.classList.add('hidden'); return; }
  const t = S.tasks.find(x => x.id === S.sel);
  if (!t) { panel.classList.add('hidden'); return; }

  const list = t.listId ? S.lists.find(l => l.id === t.listId) : null;
  const todayDate = todayStr();
  const inMyDay = t.myDay && t.myDayDate === todayDate;

  const repeatLabels = { daily:'매일', weekly:'매주', monthly:'매월', custom:'사용자 지정' };

  let subtasksHtml = '';
  for (const s of t.subtasks) {
    subtasksHtml += `<div class="subtask-item">
      <div class="sub-checkbox ${s.completed ? 'checked' : ''}" onclick="toggleSubtask('${t.id}','${s.id}')"></div>
      <input class="sub-title ${s.completed ? 'completed' : ''}" value="${esc(s.title)}"
        onblur="updateSubtaskTitle('${t.id}','${s.id}',this.value)"
        onkeydown="if(event.key==='Enter')this.blur()">
      <button class="sub-delete icon-btn" onclick="deleteSubtask('${t.id}','${s.id}')">
        <svg class="icon" style="width:14px;height:14px" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }

  const created = new Date(t.createdAt);
  const createdFmt = `${created.getFullYear()}년 ${created.getMonth()+1}월 ${created.getDate()}일 생성`;

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-drag-handle" onclick="if(window.innerWidth<768)closeDetail()" style="cursor:pointer"></div>
    <div class="detail-task-header">
      <button class="checkbox-btn ${t.completed ? 'checked' : ''}" style="width:24px;height:24px"
        onclick="toggleComplete('${t.id}')"></button>
      <div class="detail-title-wrap">
        <textarea class="detail-title ${t.completed ? 'completed' : ''}" rows="2"
          id="detail-title-input"
          onblur="updateTaskTitle('${t.id}',this.value)"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur()}"
        >${esc(t.title)}</textarea>
      </div>
      <button class="star-btn ${t.important ? 'starred' : ''}" onclick="toggleImportant('${t.id}')">
        <svg class="icon" style="width:22px;height:22px" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="detail-close icon-btn" onclick="closeDetail()">✕</button>
    </div>

    <div class="detail-section">
      <button class="detail-action ${inMyDay ? 'active' : ''}" onclick="toggleMyDay('${t.id}')">
        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <span class="action-text">${inMyDay ? '나의 하루에서 제거' : '나의 하루에 추가'}</span>
      </button>

      <button class="detail-action ${t.dueDate ? 'active' : ''}" onclick="showDatePicker('${t.id}','due',event)">
        <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span class="action-text">${t.dueDate ? fmtDate(t.dueDate) : '마감일 추가'}</span>
        ${t.dueDate ? `<button onclick="event.stopPropagation();updateTask('${t.id}',{dueDate:null})" style="font-size:12px;color:var(--text3);padding:2px 4px">✕</button>` : ''}
      </button>

      <button class="detail-action ${t.reminder ? 'active' : ''}" onclick="showReminderModal('${t.id}')">
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="action-text">${t.reminder ? fmtReminder(t.reminder) : '알림 추가'}</span>
        ${t.reminder ? `<button onclick="event.stopPropagation();updateTask('${t.id}',{reminder:null})" style="font-size:12px;color:var(--text3);padding:2px 4px">✕</button>` : ''}
      </button>

      <button class="detail-action ${t.repeat ? 'active' : ''}" onclick="showRepeatModal('${t.id}')">
        <svg class="icon" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span class="action-text">${t.repeat ? (repeatLabels[t.repeat] || t.repeat) : '반복 추가'}</span>
        ${t.repeat ? `<button onclick="event.stopPropagation();updateTask('${t.id}',{repeat:null})" style="font-size:12px;color:var(--text3);padding:2px 4px">✕</button>` : ''}
      </button>

      ${list ? `<button class="detail-action">
        <span class="list-dot" style="background:${list.color};width:10px;height:10px;border-radius:50%;display:inline-block;"></span>
        <span class="action-text">${esc(list.name)}</span>
      </button>` : ''}
    </div>

    <div class="subtask-section">
      <div id="subtask-list">${subtasksHtml}</div>
      <div class="add-subtask">
        <div class="sub-checkbox"></div>
        <input id="new-subtask-input" placeholder="단계 추가"
          onkeydown="handleNewSubtask(event,'${t.id}')">
      </div>
    </div>

    <div class="note-section">
      <textarea class="note-textarea" placeholder="메모 추가"
        onblur="updateTaskNote('${t.id}',this.value)">${esc(t.note || '')}</textarea>
    </div>

    <div class="detail-footer">
      <span>${createdFmt}</span>
      <button class="delete-task-btn" onclick="confirmDeleteTask('${t.id}')">삭제</button>
    </div>`;
}

function fmtReminder(r) {
  if (!r) return '';
  const d = new Date(r);
  const dateStr = fmtDate(getKSTDate(d));
  const time = getKSTTimeStr(d);
  return `${dateStr} ${time}`;
}

/* ========== TASK OPERATIONS ========== */
function addTask(title) {
  if (!title.trim()) return;
  const t = todayStr();
  const view = S.cfg.view;
  const isMyDayView = view === 'myday';
  const listId = view.startsWith('list-') ? view.replace('list-', '') : null;

  const task = {
    id: uid(), listId, title: title.trim(),
    completed: false, important: false,
    note: '', dueDate: null, reminder: null,
    repeat: null, repeatInterval: 1, repeatUnit: 'days',
    myDay: isMyDayView || S.cfg.addMyDay,
    myDayDate: (isMyDayView || S.cfg.addMyDay) ? t : null,
    subtasks: [],
    createdAt: nowISO(), completedAt: null,
  };
  S.tasks.unshift(task);
  save(); render();
}

function updateTask(id, changes) {
  const idx = S.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  S.tasks[idx] = { ...S.tasks[idx], ...changes };
  save(); render();
  if (changes.reminder) scheduleReminder(S.tasks[idx]);
}

function toggleComplete(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) return;
  const done = !t.completed;
  if (done && t.repeat) createRepeatTask(t);
  updateTask(id, { completed: done, completedAt: done ? nowISO() : null });
}

function toggleImportant(id) {
  const t = S.tasks.find(x => x.id === id);
  if (t) updateTask(id, { important: !t.important });
}

function toggleMyDay(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) return;
  const inMyDay = t.myDay && t.myDayDate === todayStr();
  updateTask(id, { myDay: !inMyDay, myDayDate: !inMyDay ? todayStr() : null });
}

function deleteTask(id) {
  S.tasks = S.tasks.filter(t => t.id !== id);
  if (S.sel === id) { S.sel = null; }
  save(); render();
  closeDetail();
}

function confirmDeleteTask(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) return;
  showModal(`<div class="modal-header"><span>작업 삭제</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body"><p style="font-size:14px;color:var(--text2)">"${esc(t.title)}"을(를) 삭제하시겠습니까?</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-danger" onclick="deleteTask('${id}');closeModal()">삭제</button>
    </div>`);
}

function createRepeatTask(task) {
  const next = getNextDate(task.dueDate, task.repeat, task.repeatInterval, task.repeatUnit);
  const newTask = {
    ...task, id: uid(), completed: false, completedAt: null,
    dueDate: next,
    reminder: task.reminder ? shiftReminder(task.reminder, task.dueDate, next) : null,
    subtasks: task.subtasks.map(s => ({ ...s, completed: false })),
    createdAt: nowISO(),
    myDay: isToday(next), myDayDate: isToday(next) ? todayStr() : null,
  };
  S.tasks.push(newTask);
}

function getNextDate(d, repeat, interval, unit) {
  if (!d) return null;
  const dt = dateDt(d); // UTC 정오로 파싱해 시간대 오차 방지
  if (repeat === 'daily')        dt.setUTCDate(dt.getUTCDate() + 1);
  else if (repeat === 'weekly')  dt.setUTCDate(dt.getUTCDate() + 7);
  else if (repeat === 'monthly') dt.setUTCMonth(dt.getUTCMonth() + 1);
  else if (repeat === 'custom') {
    if (unit === 'days')        dt.setUTCDate(dt.getUTCDate() + interval);
    else if (unit === 'weeks')  dt.setUTCDate(dt.getUTCDate() + interval * 7);
    else if (unit === 'months') dt.setUTCMonth(dt.getUTCMonth() + interval);
  }
  return dt.toISOString().slice(0, 10);
}

function shiftReminder(remISO, oldDate, newDate) {
  if (!remISO || !oldDate || !newDate) return null;
  const old = dateDt(oldDate);
  const nxt = dateDt(newDate);
  const diff = nxt - old;
  return new Date(new Date(remISO).getTime() + diff).toISOString();
}

function updateTaskTitle(id, val) {
  if (val.trim()) updateTask(id, { title: val.trim() });
}
function updateTaskNote(id, val) { updateTask(id, { note: val }); }

/* ========== SUBTASK OPERATIONS ========== */
function addSubtask(taskId, title) {
  if (!title.trim()) return;
  const t = S.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.subtasks.push({ id: uid(), title: title.trim(), completed: false });
  save(); renderDetail();
}

function toggleSubtask(taskId, subtaskId) {
  const t = S.tasks.find(x => x.id === taskId);
  if (!t) return;
  const s = t.subtasks.find(x => x.id === subtaskId);
  if (s) { s.completed = !s.completed; save(); renderDetail(); }
}

function updateSubtaskTitle(taskId, subtaskId, val) {
  const t = S.tasks.find(x => x.id === taskId);
  if (!t) return;
  const s = t.subtasks.find(x => x.id === subtaskId);
  if (s && val.trim()) { s.title = val.trim(); save(); }
}

function deleteSubtask(taskId, subtaskId) {
  const t = S.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.subtasks = t.subtasks.filter(s => s.id !== subtaskId);
  save(); renderDetail();
}

function handleNewSubtask(e, taskId) {
  if (e.key === 'Enter') {
    addSubtask(taskId, e.target.value);
    e.target.value = '';
  }
}

/* ========== LIST OPERATIONS ========== */
function addList(name, color, groupId) {
  const list = { id: uid(), name: name.trim(), color: color || COLORS[0], groupId: groupId || null, createdAt: nowISO() };
  S.lists.push(list);
  save(); render(); switchView('list-' + list.id);
}

function updateList(id, changes) {
  const idx = S.lists.findIndex(l => l.id === id);
  if (idx >= 0) { S.lists[idx] = { ...S.lists[idx], ...changes }; save(); render(); }
}

function deleteList(id) {
  S.lists = S.lists.filter(l => l.id !== id);
  S.tasks.forEach(t => { if (t.listId === id) t.listId = null; });
  if (S.cfg.view === 'list-' + id) S.cfg.view = 'myday';
  save(); render();
}

/* ========== GROUP OPERATIONS ========== */
function addGroup(name) {
  S.groups.push({ id: uid(), name: name.trim(), collapsed: false, createdAt: nowISO() });
  save(); render();
}

function updateGroup(id, changes) {
  const idx = S.groups.findIndex(g => g.id === id);
  if (idx >= 0) { S.groups[idx] = { ...S.groups[idx], ...changes }; save(); render(); }
}

function deleteGroup(id) {
  S.lists.forEach(l => { if (l.groupId === id) l.groupId = null; });
  S.groups = S.groups.filter(g => g.id !== id);
  save(); render();
}

function toggleGroup(id) {
  const g = S.groups.find(x => x.id === id);
  if (g) { g.collapsed = !g.collapsed; save(); render(); }
}

/* ========== UI HANDLERS ========== */
function handleNewTaskKey(e) {
  if (e.key === 'Enter') {
    addTask(e.target.value);
    e.target.value = '';
  }
}

function focusInput() { document.getElementById('new-task-input').focus(); }
function onInputFocus() { document.querySelector('.add-task-bar').style.borderColor = 'var(--accent)'; }
function onInputBlur()  { document.querySelector('.add-task-bar').style.borderColor = ''; }

function toggleAddToMyDay() {
  S.cfg.addMyDay = !S.cfg.addMyDay;
  document.getElementById('myday-add-btn').classList.toggle('active', S.cfg.addMyDay);
  save();
}

function toggleDoneSection() {
  S.doneOpen = !S.doneOpen;
  save(); renderTaskList();
}

let sortOpen = false;
function toggleSort() {
  sortOpen = !sortOpen;
  document.getElementById('sort-menu').classList.toggle('hidden', !sortOpen);
}

function setSortBy(s) {
  S.cfg.sort = s;
  sortOpen = false;
  document.getElementById('sort-menu').classList.add('hidden');
  document.querySelectorAll('.sort-opt').forEach(el =>
    el.classList.toggle('active', el.dataset.sort === s));
  save(); renderTaskList();
}

function toggleShowCompleted() {
  S.cfg.showDone = !S.cfg.showDone;
  const btn = document.getElementById('show-done-btn');
  btn.style.opacity = S.cfg.showDone ? '1' : '.4';
  save(); renderTaskList();
}

/* ========== SEARCH ========== */
function handleSearch(val) {
  S.q = val;
  document.getElementById('search-clear').classList.toggle('hidden', !val);
  renderTaskList();
}
function clearSearch() {
  document.getElementById('search-input').value = '';
  handleSearch('');
}

/* ========== MODALS ========== */
function showModal(html) {
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-body').innerHTML = html;
}
function closeModal() {
  document.getElementById('modal-bg').classList.add('hidden');
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}

/* ========== LIST MODALS ========== */
let _selectedColor = COLORS[0];

function showAddListModal() {
  _selectedColor = COLORS[0];
  const swatches = COLORS.map((c, i) =>
    `<div class="color-swatch ${i===0?'selected':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`
  ).join('');
  showModal(`<div class="modal-header"><span>새 목록</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <label class="modal-label">목록 이름</label>
      <input class="modal-input" id="new-list-name" placeholder="목록 이름 입력" autofocus
        onkeydown="if(event.key==='Enter')submitAddList()">
      <label class="modal-label">색상</label>
      <div class="color-picker">${swatches}</div>
      <label class="modal-label">그룹 (선택)</label>
      <select class="modal-select" id="new-list-group">
        <option value="">없음</option>
        ${S.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitAddList()">만들기</button>
    </div>`);
  setTimeout(() => document.getElementById('new-list-name')?.focus(), 100);
}

function selectColor(c, el) {
  _selectedColor = c;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

function submitAddList() {
  const name = document.getElementById('new-list-name')?.value;
  const groupId = document.getElementById('new-list-group')?.value;
  if (!name?.trim()) return;
  addList(name, _selectedColor, groupId);
  closeModal();
}

function showAddGroupModal() {
  showModal(`<div class="modal-header"><span>새 그룹</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <label class="modal-label">그룹 이름</label>
      <input class="modal-input" id="new-group-name" placeholder="그룹 이름 입력"
        onkeydown="if(event.key==='Enter')submitAddGroup()">
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitAddGroup()">만들기</button>
    </div>`);
  setTimeout(() => document.getElementById('new-group-name')?.focus(), 100);
}

function submitAddGroup() {
  const name = document.getElementById('new-group-name')?.value;
  if (!name?.trim()) return;
  addGroup(name);
  closeModal();
}

function showListCtx(id, e) {
  const list = S.lists.find(l => l.id === id);
  if (!list) return;
  showCtxMenu(e, [
    { label: '이름 변경', action: () => showRenameListModal(id) },
    { label: '삭제', action: () => confirmDeleteList(id), danger: true },
  ]);
}

function showGroupCtx(id, e) {
  showCtxMenu(e, [
    { label: '이름 변경', action: () => showRenameGroupModal(id) },
    { label: '그룹 해제', action: () => { S.lists.forEach(l=>{ if(l.groupId===id)l.groupId=null; }); deleteGroup(id); } },
    { label: '삭제', action: () => { deleteGroup(id); }, danger: true },
  ]);
}

function showRenameListModal(id) {
  const list = S.lists.find(l => l.id === id);
  if (!list) return;
  const swatches = COLORS.map(c =>
    `<div class="color-swatch ${c===list.color?'selected':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`
  ).join('');
  _selectedColor = list.color;
  showModal(`<div class="modal-header"><span>목록 편집</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <label class="modal-label">목록 이름</label>
      <input class="modal-input" id="edit-list-name" value="${esc(list.name)}"
        onkeydown="if(event.key==='Enter')submitRenameList('${id}')">
      <label class="modal-label">색상</label>
      <div class="color-picker">${swatches}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitRenameList('${id}')">저장</button>
    </div>`);
  setTimeout(() => { const el = document.getElementById('edit-list-name'); if(el){el.focus();el.select();} }, 100);
}

function submitRenameList(id) {
  const name = document.getElementById('edit-list-name')?.value;
  if (!name?.trim()) return;
  updateList(id, { name: name.trim(), color: _selectedColor });
  closeModal();
}

function confirmDeleteList(id) {
  const list = S.lists.find(l => l.id === id);
  if (!list) return;
  showModal(`<div class="modal-header"><span>목록 삭제</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body"><p style="font-size:14px;color:var(--text2)">"${esc(list.name)}" 목록과 안의 작업을 삭제하시겠습니까?</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-danger" onclick="S.tasks=S.tasks.filter(t=>t.listId!=='${id}');deleteList('${id}');closeModal()">삭제</button>
    </div>`);
}

function showRenameGroupModal(id) {
  const g = S.groups.find(x => x.id === id);
  if (!g) return;
  showModal(`<div class="modal-header"><span>그룹 이름 변경</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <input class="modal-input" id="edit-group-name" value="${esc(g.name)}"
        onkeydown="if(event.key==='Enter'){updateGroup('${id}',{name:document.getElementById('edit-group-name').value});closeModal()}">
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="updateGroup('${id}',{name:document.getElementById('edit-group-name').value});closeModal()">저장</button>
    </div>`);
  setTimeout(() => { const el = document.getElementById('edit-group-name'); if(el){el.focus();el.select();} }, 100);
}

/* ========== CONTEXT MENU ========== */
function showCtxMenu(e, items) {
  e.stopPropagation();
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = items.map(item =>
    `<button class="ctx-item ${item.danger ? 'danger' : ''}" onclick="closeCtxMenu();(${item.action.toString()})()">${item.label}</button>`
  ).join('');
  menu.classList.remove('hidden');
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - items.length * 44 - 8);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}
function closeCtxMenu() { document.getElementById('ctx-menu').classList.add('hidden'); }

/* ========== DATE PICKER ========== */
function showDatePicker(taskId, field, e) {
  e && e.stopPropagation && e.stopPropagation();
  const task = S.tasks.find(t => t.id === taskId);
  const existing = task && task[field === 'due' ? 'dueDate' : field];
  const now = existing ? new Date(existing + 'T00:00:00') : new Date();
  S.calCfg = { taskId, field, y: now.getFullYear(), m: now.getMonth() };
  renderCalendar();

  const popup = document.getElementById('cal-popup');
  popup.classList.remove('hidden');

  // Position
  if (e && e.clientX) {
    let x = e.clientX, y = e.clientY + 12;
    if (x + 320 > window.innerWidth) x = window.innerWidth - 320;
    if (y + 380 > window.innerHeight) y = e.clientY - 380;
    popup.style.left = x + 'px';
    popup.style.top  = y + 'px';
  } else {
    popup.style.left = '50%';
    popup.style.top  = '50%';
    popup.style.transform = 'translate(-50%,-50%)';
  }
}

function renderCalendar() {
  const cfg = S.calCfg;
  if (!cfg) return;
  const { y, m, taskId, field } = cfg;
  const task = S.tasks.find(t => t.id === taskId);
  const selDate = task ? (field === 'due' ? task.dueDate : null) : null;

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const t = todayStr();

  let cells = '';
  // Day labels
  for (const d of DAYS) cells += `<div class="cal-day-label">${d}</div>`;
  // Empty cells
  for (let i = 0; i < firstDay; i++) cells += `<div class="cal-day empty"></div>`;
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isT = dateStr === t;
    const isSel = dateStr === selDate;
    const isPt = dateStr < t;
    cells += `<div class="cal-day ${isT?'today':''} ${isSel?'selected':''} ${isPt&&!isT?'past':''}"
      onclick="pickDate('${dateStr}')">${d}</div>`;
  }

  const todayDt = dateDt(t);
  const tomDt = new Date(todayDt); tomDt.setUTCDate(tomDt.getUTCDate() + 1);
  const tomStr = tomDt.toISOString().slice(0, 10);
  const dow = todayDt.getUTCDay(); // 0=일, 1=월 ...
  const daysToNextMon = dow === 0 ? 1 : 8 - dow;
  const nwDt = new Date(todayDt); nwDt.setUTCDate(nwDt.getUTCDate() + daysToNextMon);
  const nwStr = nwDt.toISOString().slice(0, 10);

  document.getElementById('cal-content').innerHTML = `
    <div class="cal-header">
      <button class="cal-nav" onclick="calNav(event,-1)">‹</button>
      <span>${y}년 ${MONTHS[m]}</span>
      <button class="cal-nav" onclick="calNav(event,1)">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-shortcuts">
      <button class="cal-shortcut" onclick="pickDate('${t}')">오늘</button>
      <button class="cal-shortcut" onclick="pickDate('${tomStr}')">내일</button>
      <button class="cal-shortcut" onclick="pickDate('${nwStr}')">다음 주</button>
    </div>
    <div class="cal-actions">
      <button class="btn btn-secondary" onclick="closeCalendar()">닫기</button>
      ${selDate ? `<button class="btn btn-danger" onclick="clearDate()">날짜 제거</button>` : ''}
    </div>`;
}

function calNav(e, dir) {
  e.stopPropagation();
  S.calCfg.m += dir;
  if (S.calCfg.m < 0)  { S.calCfg.m = 11; S.calCfg.y--; }
  if (S.calCfg.m > 11) { S.calCfg.m = 0;  S.calCfg.y++; }
  renderCalendar();
}

function pickDate(dateStr) {
  const { taskId, field } = S.calCfg;
  if (field === 'due') updateTask(taskId, { dueDate: dateStr });
  closeCalendar();
}

function clearDate() {
  const { taskId, field } = S.calCfg;
  if (field === 'due') updateTask(taskId, { dueDate: null });
  closeCalendar();
}

function closeCalendar() {
  document.getElementById('cal-popup').classList.add('hidden');
  document.getElementById('cal-popup').style.transform = '';
  S.calCfg = null;
}

/* ========== REMINDER ========== */
function showReminderModal(taskId) {
  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;

  const existing = task.reminder ? new Date(task.reminder) : null;
  const dateVal = existing ? getKSTDate(existing) : todayStr();
  const timeVal = existing ? getKSTTimeStr(existing) : '09:00';

  showModal(`<div class="modal-header"><span>알림 설정</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <label class="modal-label">날짜</label>
      <input class="modal-input" type="date" id="rem-date" value="${dateVal}">
      <label class="modal-label">시간</label>
      <input class="modal-input" type="time" id="rem-time" value="${timeVal}">
    </div>
    <div class="modal-footer">
      ${task.reminder ? `<button class="btn btn-danger" onclick="updateTask('${taskId}',{reminder:null});closeModal()">제거</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitReminder('${taskId}')">저장</button>
    </div>`);
}

function submitReminder(taskId) {
  const date = document.getElementById('rem-date')?.value;
  const time = document.getElementById('rem-time')?.value;
  if (!date || !time) return;
  const iso = new Date(`${date}T${time}:00+09:00`).toISOString();
  updateTask(taskId, { reminder: iso });
  closeModal();
  requestNotifPermission();
}

/* ========== REPEAT ========== */
function showRepeatModal(taskId) {
  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;
  const cur = task.repeat || '';
  const opts = [
    ['daily','매일'], ['weekly','매주'], ['monthly','매월'], ['custom','사용자 지정']
  ];
  const optsHtml = opts.map(([val, label]) =>
    `<label class="repeat-opt ${cur===val?'selected':''}">
      <input type="radio" name="rep" value="${val}" ${cur===val?'checked':''} onchange="onRepeatChange()">
      ${label}
    </label>`
  ).join('');

  showModal(`<div class="modal-header"><span>반복 설정</span><button onclick="closeModal()" class="icon-btn">✕</button></div>
    <div class="modal-body">
      <div class="repeat-opts" id="repeat-opts">${optsHtml}</div>
      <div class="custom-repeat" id="custom-repeat" style="${cur==='custom'?'':'display:none'}">
        <span>매</span>
        <input type="number" id="rep-interval" min="1" max="999" value="${task.repeatInterval||1}" style="width:60px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <select id="rep-unit" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
          <option value="days" ${task.repeatUnit==='days'?'selected':''}>일</option>
          <option value="weeks" ${task.repeatUnit==='weeks'?'selected':''}>주</option>
          <option value="months" ${task.repeatUnit==='months'?'selected':''}>개월</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      ${task.repeat ? `<button class="btn btn-danger" onclick="updateTask('${taskId}',{repeat:null});closeModal()">반복 해제</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitRepeat('${taskId}')">저장</button>
    </div>`);
}

function onRepeatChange() {
  const val = document.querySelector('input[name="rep"]:checked')?.value;
  document.getElementById('custom-repeat').style.display = val === 'custom' ? 'flex' : 'none';
  document.querySelectorAll('.repeat-opt').forEach(el => {
    const inp = el.querySelector('input');
    el.classList.toggle('selected', inp && inp.checked);
  });
}

function submitRepeat(taskId) {
  const val = document.querySelector('input[name="rep"]:checked')?.value;
  if (!val) return;
  const interval = parseInt(document.getElementById('rep-interval')?.value || '1');
  const unit = document.getElementById('rep-unit')?.value || 'days';
  updateTask(taskId, { repeat: val, repeatInterval: interval, repeatUnit: unit });
  closeModal();
}

/* ========== NOTIFICATIONS ========== */
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function scheduleReminder(task) {
  if (!task.reminder) return;
  const ms = new Date(task.reminder).getTime() - Date.now();
  if (ms <= 0) return;
  if (ms > 86400000 * 7) return; // Don't schedule >7 days
  const timer = setTimeout(() => {
    fireNotification(task);
  }, ms);
  S.reminderTimers.push({ taskId: task.id, timer });
}

function fireNotification(task) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    showBanner(`⏰ ${task.title}`);
    return;
  }
  try {
    new Notification('할 일 알림', {
      body: task.title,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: task.id,
    });
  } catch(e) { showBanner(`⏰ ${task.title}`); }
}

function showBanner(msg) {
  const el = document.createElement('div');
  el.className = 'notif-banner';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function checkMissedReminders() {
  const now = new Date();
  for (const t of S.tasks) {
    if (!t.completed && t.reminder) {
      const rem = new Date(t.reminder);
      if (rem <= now && rem > new Date(now.getTime() - 3600000)) {
        showBanner(`⏰ ${t.title}`);
      }
    }
  }
}

function scheduleAllReminders() {
  S.reminderTimers.forEach(x => clearTimeout(x.timer));
  S.reminderTimers = [];
  for (const t of S.tasks) {
    if (!t.completed && t.reminder) scheduleReminder(t);
  }
}

/* ========== SERVICE WORKER ========== */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .catch(e => console.warn('SW register failed', e));
  }
}

/* ========== URL PARAMS (shortcuts / share target) ========== */
let _dailyNotifTimer = null; // outside state so it's not serialized

function handleURLParams() {
  const params = new URLSearchParams(location.search);
  if (!params.toString()) return;

  // Clean URL immediately so refresh doesn't re-trigger
  history.replaceState(null, '', location.pathname);

  // ── Share Target (공유받기) ──────────────────────────────────
  const shareTitle = params.get('title');
  const shareText  = params.get('text');
  const shareUrl   = params.get('url');
  if (shareTitle || shareText || shareUrl) {
    // Derive task title and note from shared content
    const title = (shareTitle || shareText?.split('\n')[0] || shareUrl || '공유된 항목')
                    .trim().slice(0, 200);
    const noteParts = [];
    if (shareTitle && shareText) noteParts.push(shareText); // text becomes note when title exists
    if (shareUrl) noteParts.push(shareUrl);
    const note = noteParts.join('\n').trim();
    setTimeout(() => showShareModal(title, note), 450);
    return;
  }

  // ── View shortcuts ───────────────────────────────────────────
  const view = params.get('view');
  if (view && ['myday','important','planned','all'].includes(view)) {
    switchView(view);
  }

  // ── Action shortcuts ─────────────────────────────────────────
  const action = params.get('action');
  if (action === 'add') {
    setTimeout(() => document.getElementById('new-task-input')?.focus(), 450);
  } else if (action === 'search') {
    setTimeout(() => {
      if (window.innerWidth < 768 && !sidebarOpen) toggleSidebar();
      document.getElementById('search-input')?.focus();
    }, 450);
  }
}

/* ========== SHARE MODAL ========== */
function showShareModal(title, note) {
  showModal(`
    <div class="modal-header">
      <span>공유된 내용 추가</span>
      <button onclick="closeModal()" class="icon-btn">✕</button>
    </div>
    <div class="modal-body">
      <label class="modal-label">작업 제목</label>
      <input class="modal-input" id="share-title" value="${esc(title)}"
        onkeydown="if(event.key==='Enter')submitShare()">
      <label class="modal-label">메모</label>
      <textarea class="modal-input" id="share-note" rows="3"
        style="resize:vertical;min-height:72px">${esc(note)}</textarea>
      <label class="modal-label">목록 (선택)</label>
      <select class="modal-select" id="share-list">
        <option value="">없음</option>
        ${S.lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="submitShare()">추가</button>
    </div>`);
  setTimeout(() => { const el = document.getElementById('share-title'); el?.focus(); el?.select(); }, 100);
}

function submitShare() {
  const title  = document.getElementById('share-title')?.value?.trim();
  const note   = document.getElementById('share-note')?.value || '';
  const listId = document.getElementById('share-list')?.value || null;
  if (!title) return;
  const task = {
    id: uid(), listId: listId || null, title,
    completed: false, important: false, note,
    dueDate: null, reminder: null, repeat: null,
    repeatInterval: 1, repeatUnit: 'days',
    myDay: false, myDayDate: null,
    subtasks: [], createdAt: nowISO(), completedAt: null,
  };
  S.tasks.unshift(task);
  save(); render(); closeModal();
  setTimeout(() => openDetail(task.id), 100);
}

/* ========== DAILY NOTIFICATION ========== */
function scheduleDailyNotification() {
  clearTimeout(_dailyNotifTimer);
  if (!S.cfg.dailyNotif || Notification.permission !== 'granted') return;

  const [h, m] = S.cfg.dailyNotifTime.split(':').map(Number);
  const hh = String(h).padStart(2, '0'), mm = String(m).padStart(2, '0');
  const todayKST = getKSTDate();

  // Build today's notification time in KST
  let notifTime = new Date(`${todayKST}T${hh}:${mm}:00+09:00`);

  // If already past, aim for tomorrow
  if (notifTime <= new Date()) {
    const tom = dateDt(todayKST); tom.setUTCDate(tom.getUTCDate() + 1);
    notifTime = new Date(`${tom.toISOString().slice(0, 10)}T${hh}:${mm}:00+09:00`);
  }

  _dailyNotifTimer = setTimeout(() => {
    sendDailyNotification();
    scheduleDailyNotification(); // reschedule for next day
  }, notifTime - new Date());
}

function checkDailyNotification() {
  // On app open: fire missed notification (within 1 h window)
  if (!S.cfg.dailyNotif || Notification.permission !== 'granted') return;
  if (S.cfg.dailyNotifLastSent === getKSTDate()) return; // already sent today

  const [h, m] = S.cfg.dailyNotifTime.split(':').map(Number);
  const hh = String(h).padStart(2, '0'), mm = String(m).padStart(2, '0');
  const notifTime = new Date(`${getKSTDate()}T${hh}:${mm}:00+09:00`);
  const now = new Date();
  // Fire if we missed it by up to 1 hour
  if (now >= notifTime && now - notifTime < 3600000) {
    sendDailyNotification();
  }
}

function sendDailyNotification() {
  const t = getKSTDate();
  const count = S.tasks.filter(x => !x.completed && x.myDay && x.myDayDate === t).length;
  const body  = count > 0 ? `오늘 할 일 ${count}개 있어요` : '오늘 할 일을 추가해보세요!';

  try {
    const n = new Notification('할 일', {
      body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'daily-notif', renotify: true,
    });
    n.onclick = () => { window.focus(); switchView('myday'); n.close(); };
  } catch(e) {
    showBanner(`☀️ ${body}`);
  }

  S.cfg.dailyNotifLastSent = t;
  save();
}

/* ========== SETTINGS MODAL ========== */
function showSettingsModal() {
  const t = getKSTDate();
  const todayCount = S.tasks.filter(x => !x.completed && x.myDay && x.myDayDate === t).length;

  showModal(`
    <div class="modal-header">
      <span>설정</span>
      <button onclick="closeModal()" class="icon-btn">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <span class="settings-label">일일 알림</span>
        <div class="toggle-row">
          <label>매일 아침 할 일 알림 받기</label>
          <label class="toggle-switch">
            <input type="checkbox" id="notif-toggle" ${S.cfg.dailyNotif ? 'checked' : ''}
              onchange="onNotifToggle(this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div id="notif-time-wrap" style="${S.cfg.dailyNotif ? '' : 'display:none'}">
          <label class="modal-label">알림 시간</label>
          <input class="modal-input time-input" type="time" id="notif-time"
            value="${S.cfg.dailyNotifTime}">
          <p class="settings-hint">
            알림 클릭 시 '나의 하루' 화면으로 이동합니다.<br>
            현재 오늘 할 일: <strong>${todayCount}개</strong>
          </p>
        </div>
      </div>

      <div class="settings-section">
        <span class="settings-label">앱 단축키</span>
        <p class="settings-hint">
          홈 화면 아이콘을 <strong>길게 누르면</strong> 빠른 메뉴가 나타납니다.<br>
          • 새 작업 추가 &nbsp;• 오늘 할 일 &nbsp;• 중요 작업 &nbsp;• 검색
        </p>
      </div>

      <div class="settings-section">
        <span class="settings-label">공유 받기</span>
        <p class="settings-hint">
          다른 앱에서 텍스트/링크를 공유할 때<br>
          <strong>'할 일'</strong> 앱을 선택하면 새 작업으로 자동 추가됩니다.
        </p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
      <button class="btn btn-primary" onclick="saveSettings()">저장</button>
    </div>`);
}

function onNotifToggle(checked) {
  document.getElementById('notif-time-wrap').style.display = checked ? '' : 'none';
}

function saveSettings() {
  const dailyNotif     = document.getElementById('notif-toggle')?.checked ?? false;
  const dailyNotifTime = document.getElementById('notif-time')?.value || '09:00';

  S.cfg.dailyNotif     = dailyNotif;
  S.cfg.dailyNotifTime = dailyNotifTime;
  save();
  closeModal();

  clearTimeout(_dailyNotifTimer);
  if (dailyNotif) {
    requestNotifPermission().then(() => {
      if (Notification.permission === 'granted') {
        checkDailyNotification();
        scheduleDailyNotification();
      } else {
        showBanner('알림 권한을 허용해야 일일 알림을 받을 수 있어요.');
        S.cfg.dailyNotif = false;
        save();
      }
    });
  }
}

/* ========== OVERLAY ========== */
function overlayClick() {
  if (S.sel !== null) {
    closeDetail();
    document.getElementById('overlay').classList.remove('active');
  } else {
    closeSidebar();
  }
}

/* ========== GLOBAL CLICK HANDLER ========== */
document.addEventListener('click', e => {
  // Close sort menu
  if (!e.target.closest('#sort-menu') && !e.target.closest('.icon-btn')) {
    if (sortOpen) { sortOpen = false; document.getElementById('sort-menu').classList.add('hidden'); }
  }
  // Close context menu
  if (!e.target.closest('#ctx-menu')) closeCtxMenu();
  // Close calendar
  if (!e.target.closest('#cal-popup') && !e.target.closest('.detail-action')) closeCalendar();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(); closeCalendar(); closeCtxMenu();
    if (S.sel) closeDetail();
  }
});

/* ========== INIT ========== */
function init() {
  load();
  applyDark();
  // Set sort button state
  document.querySelectorAll('.sort-opt').forEach(el =>
    el.classList.toggle('active', el.dataset.sort === S.cfg.sort));
  document.getElementById('show-done-btn').style.opacity = S.cfg.showDone ? '1' : '.4';
  document.getElementById('myday-add-btn').classList.toggle('active', S.cfg.addMyDay);

  render();
  scheduleAllReminders();
  checkMissedReminders();
  checkDailyNotification();
  scheduleDailyNotification();
  registerSW();
  handleURLParams();

  // KST 자정에 My Day 목록 갱신 (KST 다음날 00:00+09:00 = UTC 전날 15:00)
  const tomorrowKST = dateDt(todayStr()); tomorrowKST.setUTCDate(tomorrowKST.getUTCDate() + 1);
  const kstMidnight = new Date(tomorrowKST.toISOString().slice(0, 10) + 'T00:00:00+09:00');
  setTimeout(() => { render(); scheduleAllReminders(); }, kstMidnight - new Date());
}

document.addEventListener('DOMContentLoaded', init);
