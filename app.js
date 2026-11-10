const STORAGE_KEY = 'bebo-period-days';

function loadPeriodDays() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function savePeriodDays() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(periodDays));
  } catch (error) {
    console.warn('could not save', error);
  }
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let currentMonthOffset = 0;
const MONTH_LIMIT = 12;

let periodDays = loadPeriodDays();

function navTo(name) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active-screen');
  });

  document.getElementById(`screen-${name}`).classList.add('active-screen');

  if (name === 'calender') {
    currentMonthOffset = 0;
    renderCalender();
  }
}

function toggleDay(key) {
  if (periodDays.includes(key)) {
    periodDays = periodDays.filter(saved => saved !== key);
  } else {
    periodDays.push(key);
    periodDays.sort();
  }

  savePeriodDays();
  renderCalender();
}

function changeMonth(delta) {
  currentMonthOffset += delta;

  currentMonthOffset = Math.max(-MONTH_LIMIT, Math.min(MONTH_LIMIT, currentMonthOffset));

  renderCalender();
}

function dayCell(date, isMuted) {
  const key = dateKey(date);

  const classes = ['cal-day'];
  if (isMuted) classes.push('muted');
  if (key === dateKey(new Date())) classes.push('today');
  if (periodDays.includes(key)) classes.push('period');

  return `<div class="${classes.join(' ')}" onclick="toggleDay('${key}')"><span class="day-number">${date.getDate()}</span></div>`;
}

function renderCalender() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + currentMonthOffset, 1);
  const year = first.getFullYear();
  const month = first.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const leading = (first.getDay() + 6) % 7;

  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;

  let html = '';

  for (let i = leading - 1; i >= 0; i--) {
    html += dayCell(new Date(year, month - 1, daysInPrevMonth - i), true);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    html += dayCell(new Date(year, month, day), false);
  }

  for (let n = 1; n <= trailing; n++) {
    html += dayCell(new Date(year, month + 1, n), true);
  }

  document.getElementById('calender-grid').innerHTML = html;
  document.getElementById('calender-month-title').textContent =
    first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();

  document.getElementById('prev-month-btn').disabled = currentMonthOffset <= -MONTH_LIMIT;
  document.getElementById('next-month-btn').disabled = currentMonthOffset >= MONTH_LIMIT;
}
