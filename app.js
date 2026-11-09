function navTo(name) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active-screen');
  });

  document.getElementById(`screen-${name}`).classList.add('active-screen');

  if (name === 'calender') {
    renderCalender();
  }
}

function renderCalender() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const blanks = (first.getDay() + 6) % 7;

  let html = ''; 

  for (let i = 0; i < blanks; i++) {
    html += '<div class="cal-day"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === now.getDate();
    html += `<div class="cal-day${isToday ? ' today' : ''}"><span class="day-number">${day}</span></div>`;
  }

  document.getElementById('calender-grid').innerHTML = html;
  document.getElementById('calender-month-title').textContent =
    first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
}

