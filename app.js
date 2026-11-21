if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.error('service worker failed', err));
  });
}

const STORAGE_KEY = 'bebo-data';
const OLD_KEY = 'bebo-period-days';
const NOTIF_KEY = 'bebo-last-notif';
const MONTH_LIMIT = 12;
const DAY_MS = 86400000;
const LIMITS = { period: { min: 1, max: 10 }, cycle: { min: 20, max: 45 } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAILBOX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[0-9a-f]{64}$/; // aes-256 key as hex

// logs this close together count as one period
const SAME_PERIOD_GAP = 5;
const FERTILE_BEFORE = 5;
const FERTILE_AFTER = 1;

const PHASES = {
  'menstruation': { message: 'taking it easy right now.', color: '#f49eab', image: 'cat/men.png' },
  'follicular phase': { message: 'your body is building\ntowards ovulation.', color: '#a3c9a8', image: 'cat/fol.png' },
  'fertile window': { message: 'fertility is building up.', color: '#6a9cd2', image: 'cat/ovu.png' },
  'ovulation': { message: 'ovulation is likely today.\nfertility is high.', color: '#6a9cd2', image: 'cat/ovu.png' },
  'luteal phase': { message: 'winding down and\npreparing to reset.', color: '#b5a6d9', image: 'cat/lut.png' },
  'late': { message: 'taking a little longer\nthis month.', color: '#f2b28c', image: 'cat/lat.png' }
};
const WELCOME = { color: '#6a9cd2', image: 'cat/lut.png' };

// not toISOString(): it converts to utc and can give the previous day
function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

function mean(numbers) {
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return dateKey(parseKey(value)) === value;
}

function cleanDates(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isDateKey))].sort();
}

function clamp(value, { min, max }, fallback) {
  return Math.min(max, Math.max(min, parseInt(value, 10) || fallback));
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    return null;
  }
}

function cleanNotifs(saved) {
  const notifs = saved && typeof saved === 'object' ? saved : {};
  return { master: Boolean(notifs.master), period: notifs.period !== false, fertile: notifs.fertile !== false };
}

function cleanSync(saved) {
  const none = { role: null, mailbox: null, key: null };
  if (!saved || typeof saved !== 'object') return none;

  const { role, mailbox, key } = saved;
  if (role !== 'owner' && role !== 'partner') return none;
  if (!MAILBOX_RE.test(mailbox) || !KEY_RE.test(key)) return none;
  return { role, mailbox, key };
}

function loadData() {
  const saved = readStorage(STORAGE_KEY) || {};
  return {
    periodDays: cleanDates(saved.periodDays ?? readStorage(OLD_KEY)),
    periodLength: clamp(saved.periodLength, LIMITS.period, 5),
    cycleLength: clamp(saved.cycleLength, LIMITS.cycle, 28),
    notifs: cleanNotifs(saved.notifs),
    sync: cleanSync(saved.sync)
  };
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (error) {
    console.warn('could not save', error);
  }
}

function isOwner() {
  return appData.sync.role === 'owner';
}

function isPartner() {
  return appData.sync.role === 'partner';
}

function monthFromOffset(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

function monthTitle(first) {
  return first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function groupPeriods() {
  const periods = [];
  for (const date of appData.periodDays.map(parseKey)) {
    const last = periods[periods.length - 1];
    if (last && daysBetween(last.end, date) <= SAME_PERIOD_GAP) {
      last.end = date;
    } else {
      periods.push({ start: date, end: date });
    }
  }
  return periods;
}

function periodLength(period) {
  return daysBetween(period.start, period.end) + 1;
}

function averages(periods) {
  const recent = periods.slice(-7);
  const gaps = [];
  const lengths = [];

  for (let i = 1; i < recent.length; i++) {
    const gap = daysBetween(recent[i - 1].start, recent[i].start);
    if (gap >= LIMITS.cycle.min && gap <= LIMITS.cycle.max) gaps.push(gap);
    lengths.push(periodLength(recent[i - 1]));
  }

  return {
    cycle: gaps.length ? Math.round(mean(gaps)) : appData.cycleLength,
    period: lengths.length ? Math.round(mean(lengths)) : appData.periodLength
  };
}

// ovulation is about 14 days before the next period
function ovulationDay(cycleLen) {
  return Math.max(1, cycleLen - 14);
}

function phaseOf(cycleDay, cycleLen, periodLen, isLogged) {
  const ovulation = ovulationDay(cycleLen);

  if (isLogged || cycleDay <= periodLen) return 'menstruation';
  if (cycleDay < ovulation - FERTILE_BEFORE) return 'follicular phase';
  if (cycleDay === ovulation) return 'ovulation';
  if (cycleDay <= ovulation + FERTILE_AFTER) return 'fertile window';
  if (cycleDay <= cycleLen) return 'luteal phase';
  return 'late';
}

function cycleInfo(date) {
  const periods = groupPeriods();
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  if (!periods.length || target < periods[0].start) return null;

  let index = periods.length - 1;
  while (periods[index].start > target) index--;

  const active = periods[index];
  const daysIn = daysBetween(active.start, target);
  let cycleDay, cycleLen, periodLen;

  if (index < periods.length - 1) {
    cycleLen = daysBetween(active.start, periods[index + 1].start);
    periodLen = periodLength(active);
    cycleDay = daysIn + 1;
  } else {
    const avg = averages(periods);
    cycleLen = avg.cycle;
    periodLen = avg.period;

    if (target <= today) {
      cycleDay = daysIn + 1;
    } else if (daysBetween(active.start, today) >= cycleLen) {
      return null;
    } else {
      cycleDay = (daysIn % cycleLen) + 1;
    }
  }

  const isLogged = appData.periodDays.includes(dateKey(target));
  const phase = phaseOf(cycleDay, cycleLen, periodLen, isLogged);
  const pastOvulation = cycleDay > ovulationDay(cycleLen);
  const message = phase === 'fertile window' && pastOvulation ? 'fertility is winding down.' : PHASES[phase].message;
  const fertileStart = ovulationDay(cycleLen) - FERTILE_BEFORE;

  return { cycleDay, cycleLen, fertileStart, phase, message };
}

let appData = loadData();
let currentMonthOffset = 0;
let settingsMonthOffset = 0;

function navTo(name) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active-screen');
  });
  document.getElementById(`screen-${name}`).classList.add('active-screen');

  if (name === 'dashboard') {
    renderDashboard();
  }

  if (name === 'calender') {
    currentMonthOffset = 0;
    renderCalender();
  }

  if (name === 'settings') {
    settingsMonthOffset = 0;
    fillSettingsForm();
    renderSettingsCalender();
  }
}

function setActionButton(info) {
  const dot = info ? `<span class="action-dot ${info.phase === 'menstruation' ? 'pink-bg' : 'blue-bg'}"></span> ` : '';
  const label = !info ? 'set up data' : info.phase === 'menstruation' ? 'you are on it.' : 'log period today';
  document.getElementById('quick-action-btn').innerHTML = `${dot}${label}  <img src="icon/next.png" class="btn-arrow" alt="">`;
}

function renderDashboard() {
  const info = cycleInfo(new Date());
  const look = info ? PHASES[info.phase] : WELCOME;

  document.documentElement.style.setProperty('--dynamic', look.color);
  document.getElementById('cycle-day-number').textContent = info ? info.cycleDay : '-';
  document.getElementById('cycle-phase').textContent = info ? info.phase : 'welcome';
  document.getElementById('cycle-message').textContent = info ? info.message : 'tap the gear icon to log your dates.';
  document.getElementById('cat-image').src = look.image;
  setActionButton(info);
  renderWeekStrip();
}

function renderWeekStrip() {
  const today = new Date();
  let html = '';

  for (let i = -3; i <= 3; i++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const info = cycleInfo(date);
    const name = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

    let dot = 'dot';
    if (i === 0) {
      dot += ' today';
    } else if (info && info.phase === 'menstruation') {
      dot += ' pink';
    } else if (info && (info.phase === 'ovulation' || info.phase === 'fertile window')) {
      dot += ' blue';
    } else if (i < 0) {
      dot += ' hollow';
    }

    html += `<div class="day-item${i === 0 ? ' active' : ''}"><span class="day-name">${name}</span><span class="day-num">${date.getDate()}</span><span class="${dot}"></span></div>`;
  }

  document.getElementById('week-strip').innerHTML = html;
}

function handleQuickAction() {
  const info = cycleInfo(new Date());

  if (!info || info.phase === 'menstruation') {
    navTo('settings');
    return;
  }

  const today = dateKey(new Date());
  if (!appData.periodDays.includes(today)) {
    appData.periodDays.push(today);
    appData.periodDays.sort();
    saveData();
    renderDashboard();
  }
}

function changeMonth(delta) {
  currentMonthOffset += delta;
  currentMonthOffset = Math.max(-MONTH_LIMIT, Math.min(MONTH_LIMIT, currentMonthOffset));
  renderCalender();
}

function mutedDay(n) {
  return `<div class="cal-day muted"><span class="day-number">${n}</span></div>`;
}

function calenderDay(date) {
  const key = dateKey(date);
  const info = cycleInfo(date);
  const classes = ['cal-day'];
  let circle = '';
  let dot = '';

  if (info && info.phase === 'menstruation') {
    if (appData.periodDays.includes(key) || date <= startOfDay(new Date())) {
      classes.push('logged-period');
    } else {
      classes.push('pink-text');
      dot = '<span class="dot pink"></span>';
    }
  } else if (info && info.phase === 'ovulation') {
    classes.push('fertile-day', 'ovulation-day');
    circle = '<span class="ovulation-circle"></span>';
    dot = '<span class="dot blue"></span>';
  } else if (info && info.phase === 'fertile window') {
    classes.push('fertile-day');
    dot = '<span class="dot blue"></span>';
  }

  return `<div class="${classes.join(' ')}">${circle}<span class="day-number">${date.getDate()}</span>${dot}</div>`;
}

function renderCalender() {
  const first = monthFromOffset(currentMonthOffset);
  const year = first.getFullYear();
  const month = first.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // monday-first
  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;

  let html = '';

  for (let i = leading - 1; i >= 0; i--) {
    html += mutedDay(daysInPrevMonth - i);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    html += calenderDay(new Date(year, month, day));
  }

  for (let n = 1; n <= trailing; n++) {
    html += mutedDay(n);
  }

  document.getElementById('calender-grid').innerHTML = html;
  document.getElementById('calender-month-title').textContent = monthTitle(first);

  document.getElementById('prev-month-btn').disabled = currentMonthOffset <= -MONTH_LIMIT;
  document.getElementById('next-month-btn').disabled = currentMonthOffset >= MONTH_LIMIT;
}

function changeSettingsMonth(delta) {
  settingsMonthOffset = Math.min(0, settingsMonthOffset + delta);
  renderSettingsCalender();
}

function toggleDay(key) {
  const isMarked = appData.periodDays.includes(key);

  if (key > dateKey(new Date()) && !isMarked) {
    alert('you cannot log a period for a future date.');
    return;
  }

  if (isMarked) {
    appData.periodDays = appData.periodDays.filter(saved => saved !== key);
  } else {
    appData.periodDays.push(key);
    appData.periodDays.sort();
  }

  saveData();
  renderSettingsCalender();
  renderDashboard();
}

function renderSettingsCalender() {
  const first = monthFromOffset(settingsMonthOffset);
  const year = first.getFullYear();
  const month = first.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;

  let html = '<div></div>'.repeat(leading);

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(year, month, day));
    const state = appData.periodDays.includes(key) ? 'settings-logged' : 'settings-unlogged';

    html += `<div class="settings-cal-day" onclick="toggleDay('${key}')"><span class="${state}">${day}</span></div>`;
  }

  document.getElementById('settings-calender-grid').innerHTML = html;
  document.getElementById('settings-month-title').textContent = monthTitle(first);

  document.getElementById('settings-next-month-btn').disabled = settingsMonthOffset >= 0;
}

function fillSettingsForm() {
  document.getElementById('setting-period-length').value = appData.periodLength;
  document.getElementById('setting-cycle-length').value = appData.cycleLength;

  const allowed = 'Notification' in window && Notification.permission === 'granted';
  const master = appData.notifs.master && allowed;
  document.getElementById('master-notif-toggle').checked = master;
  document.getElementById('sub-notifs').classList.toggle('off', !master);
  document.getElementById('notif-period').checked = appData.notifs.period;
  document.getElementById('notif-fertile').checked = appData.notifs.fertile;
}

function saveSettings() {
  appData.periodLength = clamp(document.getElementById('setting-period-length').value, LIMITS.period, 5);
  appData.cycleLength = clamp(document.getElementById('setting-cycle-length').value, LIMITS.cycle, 28);
  appData.notifs.period = document.getElementById('notif-period').checked;
  appData.notifs.fertile = document.getElementById('notif-fertile').checked;
  saveData();
  fillSettingsForm();
  renderDashboard();
}

async function toggleNotifications() {
  const toggle = document.getElementById('master-notif-toggle');

  if (toggle.checked) {
    if (!('Notification' in window)) {
      alert('this browser does not support notifications.');
      toggle.checked = false;
    } else if ((await Notification.requestPermission()) !== 'granted') {
      alert('notifications are blocked. turn them on in your browser settings.');
      toggle.checked = false;
    }
  }

  appData.notifs.master = toggle.checked;
  document.getElementById('sub-notifs').classList.toggle('off', !toggle.checked);
  saveSettings();
  if (toggle.checked) checkReminders();
}

//reminder first time the app is opened each day, not at fixed time
async function checkReminders() {
  if (!appData.notifs.master) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  const now = new Date();
  const today = cycleInfo(now);
  const tomorrow = cycleInfo(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  const due = [];

  if (appData.notifs.period) {
    if (tomorrow && tomorrow.cycleDay === 1) {
      due.push(['period', 'your period is expected tomorrow.']);
    } else if (today && today.phase === 'late' && today.cycleDay === today.cycleLen + 1) {
      due.push(['period', 'your period is expected today.']);
    }
  }

  if (appData.notifs.fertile && today && today.phase === 'fertile window' && today.cycleDay === today.fertileStart) {
    due.push(['fertile', 'your fertile window starts today.']);
  }

  const stored = readStorage(NOTIF_KEY);
  const last = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

  const todayKey = dateKey(now);
  const fresh = due.filter(([type]) => last[type] !== todayKey);
  if (fresh.length === 0) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    for (const [type, body] of fresh) {
      await reg.showNotification('bebo.', { body, icon: 'favicon.png', tag: `bebo-${type}` });
      last[type] = todayKey;
    }
    localStorage.setItem(NOTIF_KEY, JSON.stringify(last));
  } catch (error) {
    console.error('could not show notification', error);
  }
}

function exportData() {
  const backup = {
    pastPeriods: appData.periodDays,
    cycleLength: appData.cycleLength,
    periodLength: appData.periodLength
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bebo_backup_${dateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = loaded => {
    let imported;
    try {
      imported = JSON.parse(loaded.target.result);
    } catch (error) {
      alert('could not read that file.');
      return;
    }

    if (!imported || !Array.isArray(imported.pastPeriods)) {
      alert('that does not look like a bebo backup.');
      return;
    }

    appData.periodDays = cleanDates(imported.pastPeriods);
    appData.cycleLength = clamp(imported.cycleLength, LIMITS.cycle, 28);
    appData.periodLength = clamp(imported.periodLength, LIMITS.period, 5);

    saveData();
    fillSettingsForm();
    renderSettingsCalender();
    renderDashboard();
    alert('backup restored.');
  };
  reader.readAsText(file);
  input.value = ''; // so the same file can be picked again
}

const catImage = document.getElementById('cat-image');
catImage.onerror = () => {
  if (!catImage.src.endsWith(WELCOME.image)) catImage.src = WELCOME.image;
};

renderDashboard();
checkReminders();

//coming back to the app: new day?
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderDashboard();
  checkReminders();
});
