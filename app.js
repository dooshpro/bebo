const STORAGE_KEY = 'bebo-data';
const OLD_KEY = 'bebo-period-days';
const MONTH_LIMIT = 12;
const DAY_MS = 86400000;
const LIMITS = { period: { min: 1, max: 10 }, cycle: { min: 20, max: 45 } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  const number = Math.round(parseFloat(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    return null;
  }
}

function loadData() {
  const saved = readStorage(STORAGE_KEY) || {};
  return {
    periodDays: cleanDates(saved.periodDays ?? readStorage(OLD_KEY)),
    periodLength: clamp(saved.periodLength, LIMITS.period, 5),
    cycleLength: clamp(saved.cycleLength, LIMITS.cycle, 28)
  };
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (error) {
    console.warn('could not save', error);
  }
}

function monthFromOffset(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

function monthTitle(first) {
  return first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
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

  return { cycleDay, phase, message };
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

function actionLabel(info) {
  if (!info) return 'set up data';
  return info.phase === 'menstruation' ? 'you are on it.' : 'log period today';
}

function renderDashboard() {
  const info = cycleInfo(new Date());
  const look = info ? PHASES[info.phase] : WELCOME;

  document.documentElement.style.setProperty('--dynamic', look.color);
  document.getElementById('cycle-day-number').textContent = info ? info.cycleDay : '-';
  document.getElementById('cycle-phase').textContent = info ? info.phase : 'welcome';
  document.getElementById('cycle-message').textContent = info ? info.message : 'tap the gear icon to log your dates.';
  document.getElementById('cat-image').src = look.image;
  document.getElementById('quick-action-btn').textContent = actionLabel(info);
}

function handleQuickAction() {
  const info = cycleInfo(new Date());

  if (!info || info.phase === 'menstruation') {
    navTo('settings');
    return;
  }

  toggleDay(dateKey(new Date()));
}

function dayCell(date, { isMuted = false, canTap = false } = {}) {
  const key = dateKey(date);

  const classes = ['cal-day'];
  if (isMuted) classes.push('muted');
  if (canTap) classes.push('tappable');
  if (key === dateKey(new Date())) classes.push('today');
  if (appData.periodDays.includes(key)) classes.push('period');

  const onclick = canTap ? ` onclick="toggleDay('${key}')"` : '';

  return `<div class="${classes.join(' ')}"${onclick}><span class="day-number">${date.getDate()}</span></div>`;
}

function changeMonth(delta) {
  currentMonthOffset += delta;
  currentMonthOffset = Math.max(-MONTH_LIMIT, Math.min(MONTH_LIMIT, currentMonthOffset));
  renderCalender();
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

  // Date rolls month -1 and 12 over into the neighbouring year
  for (let i = leading - 1; i >= 0; i--) {
    html += dayCell(new Date(year, month - 1, daysInPrevMonth - i), { isMuted: true });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    html += dayCell(new Date(year, month, day));
  }

  for (let n = 1; n <= trailing; n++) {
    html += dayCell(new Date(year, month + 1, n), { isMuted: true });
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

  if (key > dateKey(new Date()) && !isMarked) return;

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
  const todayKey = dateKey(new Date());

  let html = '<div></div>'.repeat(leading);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = dateKey(date);
    const isFuture = key > todayKey;

    // a marked future day stays tappable so it can be removed
    const canTap = !isFuture || appData.periodDays.includes(key);

    html += dayCell(date, { isMuted: isFuture, canTap });
  }

  document.getElementById('settings-calender-grid').innerHTML = html;
  document.getElementById('settings-month-title').textContent = monthTitle(first);

  document.getElementById('settings-next-month-btn').disabled = settingsMonthOffset >= 0;
}

function fillSettingsForm() {
  document.getElementById('period-length').value = appData.periodLength;
  document.getElementById('cycle-length').value = appData.cycleLength;
}

function saveSettings() {
  appData.periodLength = clamp(document.getElementById('period-length').value, LIMITS.period, appData.periodLength);
  appData.cycleLength = clamp(document.getElementById('cycle-length').value, LIMITS.cycle, appData.cycleLength);
  saveData();
  fillSettingsForm();
  renderDashboard();
}

renderDashboard();
