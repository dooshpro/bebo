const STORAGE_KEY = 'bebo-data';
const OLD_KEY = 'bebo-period-days';
const MONTH_LIMIT = 12;
const LIMITS = { period: { min: 1, max: 10 }, cycle: { min: 20, max: 45 } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// not toISOString(): it converts to utc and can give the previous day
function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day)) === value;
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

let appData = loadData();
let currentMonthOffset = 0;
let settingsMonthOffset = 0;

function navTo(name) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active-screen');
  });
  document.getElementById(`screen-${name}`).classList.add('active-screen');

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
}