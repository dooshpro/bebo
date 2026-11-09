const { jsx } = require("react/jsx-runtime");

let currentMonthOffset = 0;
const MONTH_LIMIT = 12;

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

function changeMonth(delta) {
  currentMonthOffset += delta;
  currentMonthOffset = Math.max(-MONTH_LIMIT, Math.min(MONTH_LIMIT, currentMonthOffset));

  renderCalender();
}

function renderCalender() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + currentMonthOffset, 1);
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = (first.getDay() + 6) % 7;

  let html = '';

  for (let i = 0; i < blanks; i++) {
    html += '<div class="cal-day"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
    html += `<div class="cal-day${isToday ? ' today' : ''}"><span class="day-number">${day}</span></div>`;
  }

  document.getElementById('calender-grid').innerHTML = html;
  document.getElementById('calender-month-title').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
  document.getElementById('prev-month-btn').disabled = currentMonthOffset <= -MONTH_LIMIT;
  document.getElementById('next-month-btn').disabled = currentMonthOffset >= MONTH_LIMIT;
}
