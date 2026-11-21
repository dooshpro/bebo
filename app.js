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

// role is null
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

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/[\da-f]{2}/gi).map(pair => parseInt(pair, 16)));
}

async function makeKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return toHex(await crypto.subtle.exportKey('raw', key));
}

function importKey(keyHex) {
  return crypto.subtle.importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

//12 byte iv + ciphertext
async function encryptData(data, keyHex) {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return toHex(packed);
}

async function decryptData(hex, keyHex) {
  try {
    const packed = fromHex(hex);
    const key = await importKey(keyHex);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (error) {
    return null;
  }
}

const SYNC_SERVER = 'https://bebo-sync.shvpnd0.workers.dev';
const DESTROYED = 'DESTROYED';

function mailboxUrl(mailbox) {
  return `${SYNC_SERVER}/${mailbox}`;
}

async function postToMailbox(mailbox, text) {
  const response = await fetch(mailboxUrl(mailbox), {
    method: 'POST',
    body: text,
    headers: { 'Content-Type': 'text/plain' }
  });
  if (!response.ok) throw new Error(`sync server answered ${response.status}`);
}

function syncPayload() {
  return { pastPeriods: appData.periodDays, cycleLength: appData.cycleLength, periodLength: appData.periodLength };
}

async function sendSnapshot() {
  if (!isOwner()) return false;

  try {
    const text = await encryptData(syncPayload(), appData.sync.key);
    await postToMailbox(appData.sync.mailbox, text);
    return true;
  } catch (error) {
    console.warn('could not sync', error);
    return false;
  }
}

let pushQueue = Promise.resolve();

function pushToCloud() {
  pushQueue = pushQueue.then(sendSnapshot);
  return pushQueue;
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
  document.getElementById('quick-action-btn').innerHTML = `${dot}${label}  <img src="icon/next.png" class="btn-arrow" alt="">`;
}

function renderDashboard() {
  const info = cycleInfo(new Date());
  const look = info ? PHASES[info.phase] : WELCOME;
  const empty = isPartner() ? 'waiting for her data to sync.' : 'tap the gear icon to log your dates.';

  document.documentElement.style.setProperty('--dynamic', look.color);
  document.getElementById('partner-prefix').hidden = !isPartner();
  document.getElementById('quick-action-btn').hidden = isPartner();
  document.getElementById('cycle-day-number').textContent = info ? info.cycleDay : '-';
  document.getElementById('cycle-phase').textContent = info ? info.phase : 'welcome';
  document.getElementById('cycle-message').textContent = info ? info.message : empty;
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
  if (isPartner()) return;
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
    pushToCloud();
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
  if (isPartner()) return;

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
  pushToCloud();
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
  fillSyncSection();
}

function partnerLink() {
  const page = location.href.split(/[?#]/)[0];
  return `${page}?sync=${appData.sync.mailbox}#${appData.sync.key}`;
}

function fillSyncSection() {
  const partner = isPartner();
  const shared = isOwner();

  document.getElementById('owner-settings-block').hidden = partner;
  document.getElementById('backup-section').hidden = partner;
  document.getElementById('owner-sync-controls').hidden = partner;
  document.getElementById('disconnect-partner-btn').hidden = !partner;
  document.getElementById('sync-desc').textContent = partner
    ? 'you are in partner mode. this is a read-only view of her cycle.'
    : 'share an encrypted link so your partner can see your cycle.';

  document.getElementById('generate-link-btn').textContent = shared ? 'generate new link' : 'generate link';
  document.getElementById('revoke-link-btn').hidden = !shared;
  document.getElementById('link-row').hidden = !shared;
  document.getElementById('sync-link-output').value = shared ? partnerLink() : '';
}

async function generatePartnerLink() {
  const button = document.getElementById('generate-link-btn');
  const previous = appData.sync;
  button.disabled = true;

  try {
    appData.sync = { role: 'owner', mailbox: crypto.randomUUID(), key: await makeKey() };
    if (!(await pushToCloud())) throw new Error('first push failed');
    saveData();

    if (previous.role === 'owner') postToMailbox(previous.mailbox, DESTROYED).catch(() => {});
  } catch (error) {
    appData.sync = previous;
    alert('could not create a link right now. check your connection and try again.');
  }

  button.disabled = false;
  fillSyncSection();
}

async function revokePartnerLink() {
  if (!isOwner()) return;
  if (!confirm('revoke partner access? the current link will stop working.')) return;

  try {
    await postToMailbox(appData.sync.mailbox, DESTROYED);
  } catch (error) {
    alert('could not reach the sync server, so the link is still active. try again.');
    return;
  }

  appData.sync = cleanSync(null);
  saveData();
  fillSyncSection();
}

async function copyPartnerLink() {
  const output = document.getElementById('sync-link-output');
  const button = document.getElementById('copy-link-btn');
  output.select();

  try {
    await navigator.clipboard.writeText(output.value);
    button.textContent = 'copied';
  } catch (error) {
    button.textContent = 'selected';
  }
  setTimeout(() => { button.textContent = 'copy'; }, 1500);
}

function leavePartnerMode() {
  try {
    [STORAGE_KEY, OLD_KEY, NOTIF_KEY].forEach(name => localStorage.removeItem(name));
  } catch (error) {
    console.warn('could not clear data', error);
  }
  location.replace(location.pathname);
}

function disconnectPartner() {
  if (!isPartner()) return;
  if (!confirm('disconnect from partner? this device will reset to an empty state.')) return;
  leavePartnerMode();
}

function joinFromLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('sync')) return;

  const mailbox = params.get('sync');
  const key = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);

  if (!MAILBOX_RE.test(mailbox) || !KEY_RE.test(key)) {
    alert('that partner link looks broken. ask for a new one.');
    return;
  }

  const hasOwnData = !isPartner() && (appData.periodDays.length > 0 || isOwner());
  if (hasOwnData && !confirm('this device will switch to partner mode and its own cycle data will be removed. export a backup first if you want to keep it. continue?')) return;

  appData.periodDays = [];
  appData.periodLength = 5;
  appData.cycleLength = 28;
  appData.sync = { role: 'partner', mailbox, key };
  saveData();
}

let pulling = false;

async function pullFromCloud() {
  if (!isPartner() || pulling) return;
  pulling = true;

  try {
    const response = await fetch(mailboxUrl(appData.sync.mailbox));
    const text = (await response.text()).trim();

    if (text === DESTROYED) {
      alert('the link was revoked or replaced, so this device is being disconnected.');
      leavePartnerMode();
      return;
    }

    const data = text ? await decryptData(text, appData.sync.key) : null;
    if (!data) return;

    appData.periodDays = cleanDates(data.pastPeriods);
    appData.cycleLength = clamp(data.cycleLength, LIMITS.cycle, 28);
    appData.periodLength = clamp(data.periodLength, LIMITS.period, 5);
    saveData();
    renderDashboard();
  } catch (error) {
    console.warn('could not fetch her data', error);
  } finally {
    pulling = false;
  }
}

function saveSettings() {
  if (!isPartner()) {
    appData.periodLength = clamp(document.getElementById('setting-period-length').value, LIMITS.period, 5);
    appData.cycleLength = clamp(document.getElementById('setting-cycle-length').value, LIMITS.cycle, 28);
  }
  appData.notifs.period = document.getElementById('notif-period').checked;
  appData.notifs.fertile = document.getElementById('notif-fertile').checked;
  saveData();
  pushToCloud();
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
  const who = isPartner() ? 'her' : 'your';

  if (appData.notifs.period) {
    if (tomorrow && tomorrow.cycleDay === 1) {
      due.push(['period', `${who} period is expected tomorrow.`]);
    } else if (today && today.phase === 'late' && today.cycleDay === today.cycleLen + 1) {
      due.push(['period', `${who} period is expected today.`]);
    }
  }

  if (appData.notifs.fertile && today && today.phase === 'fertile window' && today.cycleDay === today.fertileStart) {
    due.push(['fertile', `${who} fertile window starts today.`]);
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
  if (isPartner()) return;

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
  if (!file || isPartner()) return;

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
    pushToCloud();
    fillSettingsForm();
    renderSettingsCalender();
    renderDashboard();
    alert('backup restored.');
  };
  reader.readAsText(file);
  input.value = '';
}

const catImage = document.getElementById('cat-image');
catImage.onerror = () => {
  if (!catImage.src.endsWith(WELCOME.image)) catImage.src = WELCOME.image;
};

joinFromLink();
renderDashboard();
checkReminders();
pushToCloud();
pullFromCloud();

//coming back to the app: new day?
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderDashboard();
  checkReminders();
  pushToCloud();
  pullFromCloud();
});
