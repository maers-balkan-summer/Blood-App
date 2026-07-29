/* Health Log — app.js
 * Renders forms from schemas, posts to a Google Apps Script backend,
 * queues offline, and renders trend charts + review tables.
 */

const APP_VERSION = '2026.07.28-5';

//////////////////// Storage ////////////////////

const LS = {
  API_URL: 'healthlog_api_url',
  SECRET: 'healthlog_secret',
  QUEUE: 'healthlog_queue'
};

const getApiUrl = () => localStorage.getItem(LS.API_URL) || '';
const setApiUrl = (v) => localStorage.setItem(LS.API_URL, v);
const getSecret = () => localStorage.getItem(LS.SECRET) || '';
const setSecret = (v) => localStorage.setItem(LS.SECRET, v);
const getQueue = () => { try { return JSON.parse(localStorage.getItem(LS.QUEUE) || '[]'); } catch (e) { return []; } };
const setQueue = (q) => localStorage.setItem(LS.QUEUE, JSON.stringify(q));

//////////////////// API ////////////////////

function setConnStatus(status) {
  const dot = document.getElementById('conn-dot');
  if (!dot) return;
  dot.className = 'conn-dot ' + status;
}

function queueRecord(body) {
  const q = getQueue();
  q.push(body);
  setQueue(q);
}

async function apiPost(type, payload) {
  const url = getApiUrl();
  const secret = getSecret();
  const body = Object.assign({ recordType: type }, secret ? { secret } : {}, payload);
  if (!url) {
    queueRecord(body);
    setConnStatus('unset');
    return { ok: false, queued: true, error: 'No API URL set yet — saved on this phone, will sync once you add one in Settings.' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    setConnStatus('ok');
    return data;
  } catch (err) {
    queueRecord(body);
    setConnStatus('bad');
    return { ok: false, queued: true, error: String(err) };
  }
}

async function syncQueue(silent) {
  const url = getApiUrl();
  const q = getQueue();
  if (!url) {
    if (!silent) showToast('No API URL set yet — add one in Settings.', 'error');
    return { synced: 0, remaining: q.length };
  }
  if (!q.length) return { synced: 0, remaining: 0 };
  const remaining = [];
  let synced = 0;
  let lastError = '';
  for (const body of q) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) synced++; else { remaining.push(body); lastError = data.error || 'Server rejected the record'; }
    } catch (e) {
      remaining.push(body);
      lastError = String(e);
    }
  }
  setQueue(remaining);
  setConnStatus(remaining.length && synced === 0 ? 'bad' : (url ? 'ok' : 'unset'));
  if (!silent) showToast(`Synced ${synced}, ${remaining.length} remaining` + (remaining.length ? `: ${lastError}` : ''), remaining.length ? 'error' : 'success');
  return { synced, remaining: remaining.length };
}

// One-time repair for records queued before recordType/type were split apart
// (a colliding `type` field used to overwrite the routing type with the
// exercise/meditation/heartEvent category label). Infers the real record
// type from which fields are present, since each type has a distinct shape.
function repairLegacyQueue() {
  const q = getQueue();
  const validTypes = Object.keys(TYPE_META);
  let changed = false;
  const fixed = q.map(body => {
    if (body.recordType || validTypes.includes(body.type)) return body;
    let inferred = null;
    if ('intensity' in body) inferred = 'exercise';
    else if ('severity' in body || 'feeling' in body) inferred = 'heartEvent';
    else if ('sentiment' in body) inferred = 'meditation';
    if (!inferred) return body;
    changed = true;
    return Object.assign({}, body, { recordType: inferred });
  });
  if (changed) setQueue(fixed);
}

async function apiGet(type, params) {
  const url = getApiUrl();
  if (!url) return { ok: false, error: 'No API URL set yet. Add it in Settings.' };
  const secret = getSecret();
  const qp = new URLSearchParams(Object.assign({ type }, secret ? { secret } : {}, params || {}));
  try {
    const res = await fetch(`${url}?${qp.toString()}`);
    const data = await res.json();
    setConnStatus(data.ok ? 'ok' : 'bad');
    return data;
  } catch (err) {
    setConnStatus('bad');
    return { ok: false, error: String(err) };
  }
}

//////////////////// Utilities ////////////////////

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateInputValue(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function toTimeInputValue(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function combineTimestamp(dateStr, timeStr) { return `${dateStr}T${timeStr || '00:00'}:00`; }

function showToast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.hidden = true; }, 3200);
}

//////////////////// Form schemas ////////////////////

const TYPE_META = {
  bloodPressure: { label: 'Blood Pressure', icon: '🩺' },
  meditation: { label: 'Meditation', icon: '🧘' },
  exercise: { label: 'Exercise', icon: '🏃' },
  heartEvent: { label: 'Heart Event', icon: '❤️' }
};

const TYPE_PRESETS = {
  meditation: ['Breathing', 'Body scan', 'Guided', 'Mantra', 'Silent / unguided', 'Other'],
  exercise: ['Cardio', 'Strength', 'Yoga', 'Walking', 'Cycling', 'Sports', 'Other'],
  heartEvent: ['Palpitations', 'Racing heart', 'Skipped beat', 'Chest pain', 'Arrhythmia episode', 'Other']
};

function makeDefaultState(type) {
  const now = new Date();
  const base = { date: toDateInputValue(now), time: toTimeInputValue(now) };
  if (type === 'bloodPressure') {
    Object.assign(base, {
      period: now.getHours() < 12 ? 'AM' : 'PM',
      bathroomUsed: false, palpitations: false,
      excitingLastHour: false, excitingNextHour: false, betaBlockerTaken: false
    });
  }
  if (type === 'meditation' || type === 'exercise' || type === 'heartEvent') {
    base.types = [];
    base.typeOther = '';
  }
  return base;
}

const formStates = {
  bloodPressure: makeDefaultState('bloodPressure'),
  meditation: makeDefaultState('meditation'),
  exercise: makeDefaultState('exercise'),
  heartEvent: makeDefaultState('heartEvent')
};

//////////////////// Generic field builders (return HTML strings) ////////////////////

function fieldWrap(label, inner) {
  return `<div class="field"><label>${label}</label>${inner}</div>`;
}

function dateTimeFields(state) {
  return `
    ${fieldWrap('Date', `<input type="date" data-field="date" value="${state.date}">`)}
    ${fieldWrap('Time', `<input type="time" data-field="time" value="${state.time}">`)}`;
}

function segmentedField(name, label, options, state) {
  const btns = options.map(o =>
    `<button type="button" class="btn-choice ${state[name] === o ? 'selected' : ''}" data-field="${name}" data-value="${o}">${o}</button>`
  ).join('');
  return fieldWrap(label, `<div class="segmented">${btns}</div>`);
}

function boolField(name, label, state) {
  const v = !!state[name];
  return fieldWrap(label, `
    <div class="bool-toggle">
      <button type="button" class="btn-choice ${v ? 'selected yes' : ''}" data-field="${name}" data-value="true">Yes</button>
      <button type="button" class="btn-choice ${!v ? 'selected no' : ''}" data-field="${name}" data-value="false">No</button>
    </div>`);
}

function scale5Field(name, label, state, lowHint, highHint) {
  const cur = state[name];
  const btns = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="btn-choice ${cur == n ? 'selected' : ''}" data-field="${name}" data-value="${n}" data-num="1">${n}</button>`
  ).join('');
  return fieldWrap(label, `<div class="scale-row">${btns}</div><div class="scale-hint"><span>${lowHint || 'low'}</span><span>${highHint || 'high'}</span></div>`);
}

function numberField(name, label, state, opts) {
  opts = opts || {};
  const v = state[name] === undefined || state[name] === null ? '' : state[name];
  return fieldWrap(label, `<input type="number" inputmode="decimal" data-field="${name}" value="${v}" ${opts.step ? `step="${opts.step}"` : ''} placeholder="${opts.placeholder || ''}">`);
}

function textareaField(name, label, state) {
  const v = state[name] || '';
  return fieldWrap(label, `<textarea data-field="${name}" placeholder="Anything worth noting...">${v}</textarea>`);
}

function multiPillTypeField(type, state) {
  const options = TYPE_PRESETS[type];
  const selected = state.types || [];
  const btns = options.map(o =>
    `<button type="button" class="btn-choice ${selected.includes(o) ? 'selected' : ''}" data-field="types" data-value="${o}" data-multi="true">${o}</button>`
  ).join('');
  let extra = '';
  if (selected.includes('Other')) {
    extra = `<div class="field" style="margin-top:8px"><input type="text" data-field="typeOther" placeholder="Describe type..." value="${state.typeOther || ''}"></div>`;
  }
  return fieldWrap('Type (select all that apply)', `<div class="pill-select">${btns}</div>${extra}`);
}

//////////////////// Blood pressure readings block ////////////////////

function readingGroup(n, state, required) {
  const s = state[`systolic${n}`] ?? '';
  const d = state[`diastolic${n}`] ?? '';
  const b = state[`bpm${n}`] ?? '';
  return `
    <div class="reading-group">
      <div class="reading-label">Reading ${n}${required ? '' : ' (optional)'}</div>
      <div class="row3">
        <div><div class="mini-label">Systolic</div><input type="number" inputmode="numeric" data-field="systolic${n}" value="${s}"></div>
        <div><div class="mini-label">Diastolic</div><input type="number" inputmode="numeric" data-field="diastolic${n}" value="${d}"></div>
        <div><div class="mini-label">Pulse</div><input type="number" inputmode="numeric" data-field="bpm${n}" value="${b}"></div>
      </div>
    </div>`;
}

//////////////////// Form renderers ////////////////////

function renderBloodPressureForm(state) {
  return `
    <form data-form-type="bloodPressure">
      <div class="card">
        ${dateTimeFields(state)}
        ${segmentedField('period', 'Reading period', ['AM', 'PM'], state)}
      </div>
      <div class="card">
        ${readingGroup(1, state, true)}
        ${readingGroup(2, state, false)}
        ${readingGroup(3, state, false)}
      </div>
      <div class="card">
        ${state.period === 'AM' ? boolField('bathroomUsed', 'Used the bathroom before this reading?', state) : ''}
        ${boolField('palpitations', 'Currently having palpitations?', state)}
        ${numberField('sleepHours', 'Hours of sleep last night', state, { step: '0.25', placeholder: 'e.g. 7.5' })}
        ${numberField('drinksYesterday', 'Drinks yesterday', state)}
        ${state.period === 'PM' ? numberField('drinksToday', 'Drinks today', state) : ''}
        ${boolField('excitingLastHour', 'Anything exciting in the last hour?', state)}
        ${boolField('excitingNextHour', 'Anything exciting coming up in the next hour?', state)}
        ${state.period === 'PM' ? boolField('betaBlockerTaken', 'Beta blocker taken?', state) : ''}
      </div>
      <div class="card">
        ${scale5Field('workStress', 'Work stress', state, '1 calm', '5 slammed')}
        ${scale5Field('excitement', 'Excitement', state, '1 flat', '5 wired')}
        ${scale5Field('anxietySadnessWorry', 'Anxiety / sadness / worry', state, '1 fine', '5 heavy')}
        ${textareaField('notes', 'Notes', state)}
      </div>
      <button type="submit" class="btn-primary">Save reading</button>
    </form>`;
}

function renderMeditationForm(state) {
  return `
    <form data-form-type="meditation">
      <div class="card">
        ${dateTimeFields(state)}
        ${multiPillTypeField('meditation', state)}
        ${numberField('durationMinutes', 'Duration (minutes)', state, { placeholder: 'e.g. 15' })}
      </div>
      <div class="card">
        ${scale5Field('sentiment', 'Effectiveness', state, '1 rough', '5 great')}
        ${textareaField('notes', 'Notes', state)}
      </div>
      <button type="submit" class="btn-primary">Save session</button>
    </form>`;
}

function renderExerciseForm(state) {
  return `
    <form data-form-type="exercise">
      <div class="card">
        ${dateTimeFields(state)}
        ${multiPillTypeField('exercise', state)}
        ${numberField('durationMinutes', 'Duration (minutes)', state, { placeholder: 'e.g. 30' })}
      </div>
      <div class="card">
        ${scale5Field('intensity', 'Intensity', state, '1 easy', '5 max effort')}
        ${scale5Field('sentiment', 'How it felt', state, '1 bad', '5 great')}
        ${textareaField('notes', 'Notes', state)}
      </div>
      <button type="submit" class="btn-primary">Save workout</button>
    </form>`;
}

function renderHeartEventForm(state) {
  return `
    <form data-form-type="heartEvent">
      <div class="card">
        ${dateTimeFields(state)}
        ${multiPillTypeField('heartEvent', state)}
        ${numberField('durationMinutes', 'Duration (minutes, if known)', state, { placeholder: 'e.g. 5' })}
      </div>
      <div class="card">
        ${scale5Field('severity', 'Severity', state, '1 mild', '5 severe')}
        ${scale5Field('feeling', 'How it messed with your head', state, '1 chill', '5 really rattled')}
        ${textareaField('notes', 'Notes', state)}
      </div>
      <button type="submit" class="btn-primary">Save event</button>
    </form>`;
}

const FORM_RENDERERS = {
  bloodPressure: renderBloodPressureForm,
  meditation: renderMeditationForm,
  exercise: renderExerciseForm,
  heartEvent: renderHeartEventForm
};

function buildPayload(type, state) {
  const timestamp = combineTimestamp(state.date, state.time);
  if (type === 'bloodPressure') {
    return {
      timestamp, period: state.period || 'AM',
      systolic1: state.systolic1 || '', diastolic1: state.diastolic1 || '', bpm1: state.bpm1 || '',
      systolic2: state.systolic2 || '', diastolic2: state.diastolic2 || '', bpm2: state.bpm2 || '',
      systolic3: state.systolic3 || '', diastolic3: state.diastolic3 || '', bpm3: state.bpm3 || '',
      bathroomUsed: state.period === 'AM' ? !!state.bathroomUsed : '',
      palpitations: !!state.palpitations,
      sleepHours: state.sleepHours || '',
      drinksYesterday: state.drinksYesterday || '',
      drinksToday: state.period === 'PM' ? (state.drinksToday || '') : '',
      excitingLastHour: !!state.excitingLastHour,
      excitingNextHour: !!state.excitingNextHour,
      betaBlockerTaken: state.period === 'PM' ? !!state.betaBlockerTaken : '',
      workStress: state.workStress || '', excitement: state.excitement || '', anxietySadnessWorry: state.anxietySadnessWorry || '',
      notes: state.notes || ''
    };
  }
  const types = Array.isArray(state.types) ? state.types : [];
  const typeLabel = types.map(t => t === 'Other' ? (state.typeOther || 'Other').trim() : t).join(', ');
  if (type === 'meditation') {
    return { timestamp, type: typeLabel, durationMinutes: state.durationMinutes || '', sentiment: state.sentiment || '', notes: state.notes || '' };
  }
  if (type === 'exercise') {
    return { timestamp, type: typeLabel, durationMinutes: state.durationMinutes || '', intensity: state.intensity || '', sentiment: state.sentiment || '', notes: state.notes || '' };
  }
  if (type === 'heartEvent') {
    return { timestamp, type: typeLabel, severity: state.severity || '', durationMinutes: state.durationMinutes || '', feeling: state.feeling || '', notes: state.notes || '' };
  }
}

function validate(type, state) {
  if (type === 'bloodPressure') {
    if (!state.systolic1 || !state.diastolic1) return 'Enter at least the first systolic/diastolic reading.';
  } else if (type === 'meditation' || type === 'exercise') {
    if (!state.types || !state.types.length) return 'Pick at least one type.';
    if (!state.durationMinutes) return 'Enter a duration.';
  } else if (type === 'heartEvent') {
    if (!state.types || !state.types.length) return 'Pick at least one type.';
  }
  return null;
}

//////////////////// Tab rendering ////////////////////

let currentTab = 'bloodPressure';

function renderFormTab(type) {
  const view = document.getElementById('view');
  view.innerHTML = `<h2 class="view-title">${TYPE_META[type].icon} ${TYPE_META[type].label}</h2>` + FORM_RENDERERS[type](formStates[type]);
  const q = getQueue().length;
  if (q > 0) {
    const note = document.createElement('div');
    note.className = 'queue-note';
    note.textContent = `${q} entr${q === 1 ? 'y' : 'ies'} waiting to sync.`;
    view.appendChild(note);
  }
}

function renderView() {
  if (currentTab === 'trends') return renderTrendsTab();
  if (currentTab === 'settings') return renderSettingsTab();
  renderFormTab(currentTab);
}

function setActiveTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('view').scrollTop = 0;
  renderView();
}

//////////////////// Trends tab ////////////////////

let trendState = { type: 'bloodPressure', range: 30 };
let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach(c => c.destroy());
  chartInstances = [];
}

function withinRange(ts, days) {
  if (!days) return true;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ts).getTime() >= cutoff;
}

function renderTrendsTab() {
  const view = document.getElementById('view');
  const typeBtns = Object.keys(TYPE_META).map(t =>
    `<button type="button" class="btn-choice ${trendState.type === t ? 'selected' : ''}" data-trend-type="${t}">${TYPE_META[t].icon} ${TYPE_META[t].label}</button>`
  ).join('');
  const ranges = [{ v: 7, l: '7d' }, { v: 30, l: '30d' }, { v: 90, l: '90d' }, { v: 365, l: '1y' }, { v: 0, l: 'All' }];
  const rangeBtns = ranges.map(r =>
    `<button type="button" class="btn-choice ${trendState.range === r.v ? 'selected' : ''}" data-trend-range="${r.v}">${r.l}</button>`
  ).join('');

  view.innerHTML = `
    <h2 class="view-title">📈 Trends</h2>
    <div class="card">
      <div class="field"><label>Record type</label><div class="pill-select">${typeBtns}</div></div>
      <div class="field"><label>Range</label><div class="segmented">${rangeBtns}</div></div>
    </div>
    <div id="trend-content"><p class="muted">Loading…</p></div>
  `;
  loadTrend();
}

async function loadTrend() {
  const content = document.getElementById('trend-content');
  destroyCharts();
  const res = await apiGet(trendState.type, { limit: 1000 });
  if (!res.ok) {
    content.innerHTML = `<p class="muted">${res.error || 'Could not load data.'}</p>`;
    return;
  }
  let records = res.records.filter(r => r.timestamp && withinRange(r.timestamp, trendState.range));
  records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (!records.length) {
    content.innerHTML = `<p class="muted">No entries in this range yet.</p>`;
    return;
  }

  content.innerHTML = `<div class="card"><div id="chart-holder"></div></div><div class="card"><div class="table-scroll" id="table-holder"></div></div>`;
  const chartHolder = document.getElementById('chart-holder');

  if (trendState.type === 'bloodPressure') {
    renderBPCharts(chartHolder, records);
  } else if (trendState.type === 'meditation') {
    addChart(chartHolder, 'Duration (min)', records, 'durationMinutes', 'bar', '#38bdf8');
    addChart(chartHolder, 'Effectiveness (1-5)', records, 'sentiment', 'line', '#f87171');
  } else if (trendState.type === 'exercise') {
    addChart(chartHolder, 'Duration (min)', records, 'durationMinutes', 'bar', '#38bdf8');
    addChart(chartHolder, 'Intensity / How it felt (1-5)', records, ['intensity', 'sentiment'], 'line', ['#fbbf24', '#4ade80']);
  } else if (trendState.type === 'heartEvent') {
    addChart(chartHolder, 'Severity / Head-effect (1-5)', records, ['severity', 'feeling'], 'line', ['#f87171', '#fbbf24']);
  }

  renderTable(document.getElementById('table-holder'), records);
}

function labelsFor(records) {
  return records.map(r => {
    const d = new Date(r.timestamp);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  });
}

function addChart(holder, title, records, fields, kind, color) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="mini-label" style="margin-bottom:6px">${title}</div><div class="chart-wrap"><canvas></canvas></div>`;
  holder.appendChild(wrap);
  const canvas = wrap.querySelector('canvas');
  const fieldList = Array.isArray(fields) ? fields : [fields];
  const colorList = Array.isArray(color) ? color : [color];
  const datasets = fieldList.map((f, i) => ({
    label: f,
    data: records.map(r => r[f] === '' || r[f] === undefined ? null : Number(r[f])),
    borderColor: colorList[i % colorList.length],
    backgroundColor: colorList[i % colorList.length],
    spanGaps: true,
    tension: 0.3
  }));
  const chart = new Chart(canvas, {
    type: kind,
    data: { labels: labelsFor(records), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: fieldList.length > 1, labels: { color: '#93a2ba' } } },
      scales: {
        x: { ticks: { color: '#93a2ba', maxRotation: 60, minRotation: 60 }, grid: { color: '#2a3852' } },
        y: { ticks: { color: '#93a2ba' }, grid: { color: '#2a3852' } }
      }
    }
  });
  chartInstances.push(chart);
}

function renderBPCharts(holder, records) {
  const avg = (r, keys) => {
    const vals = keys.map(k => r[k]).filter(v => v !== '' && v !== undefined && v !== null).map(Number);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const withAvg = records.map(r => ({
    timestamp: r.timestamp,
    avgSystolic: avg(r, ['systolic1', 'systolic2', 'systolic3']),
    avgDiastolic: avg(r, ['diastolic1', 'diastolic2', 'diastolic3']),
    avgPulse: avg(r, ['bpm1', 'bpm2', 'bpm3'])
  }));
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="mini-label" style="margin-bottom:6px">Systolic / Diastolic (avg of readings)</div><div class="chart-wrap"><canvas id="bp-main"></canvas></div>
    <div class="mini-label" style="margin:14px 0 6px">Pulse (avg)</div><div class="chart-wrap"><canvas id="bp-pulse"></canvas></div>`;
  holder.appendChild(wrap);

  const labels = labelsFor(withAvg);
  const mainChart = new Chart(wrap.querySelector('#bp-main'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Systolic', data: withAvg.map(r => r.avgSystolic), borderColor: '#f87171', backgroundColor: '#f87171', spanGaps: true, tension: 0.3 },
        { label: 'Diastolic', data: withAvg.map(r => r.avgDiastolic), borderColor: '#38bdf8', backgroundColor: '#38bdf8', spanGaps: true, tension: 0.3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#93a2ba' } } },
      scales: {
        x: { ticks: { color: '#93a2ba', maxRotation: 60, minRotation: 60 }, grid: { color: '#2a3852' } },
        y: { ticks: { color: '#93a2ba' }, grid: { color: '#2a3852' } }
      }
    }
  });
  chartInstances.push(mainChart);

  const pulseChart = new Chart(wrap.querySelector('#bp-pulse'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Pulse', data: withAvg.map(r => r.avgPulse), borderColor: '#4ade80', backgroundColor: '#4ade80', spanGaps: true, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#93a2ba', maxRotation: 60, minRotation: 60 }, grid: { color: '#2a3852' } },
        y: { ticks: { color: '#93a2ba' }, grid: { color: '#2a3852' } }
      }
    }
  });
  chartInstances.push(pulseChart);
}

function renderTable(holder, records) {
  const cols = Object.keys(records[records.length - 1]).filter(c => c !== 'id');
  const rows = [...records].reverse();
  let html = '<table class="data-table"><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>' + cols.map(c => {
      let v = r[c];
      if (typeof v === 'boolean') v = v ? '✓' : '';
      if (c === 'timestamp' && v) v = new Date(v).toLocaleString();
      return `<td>${v === undefined || v === null ? '' : v}</td>`;
    }).join('') + '</tr>';
  }
  html += '</tbody></table>';
  holder.innerHTML = html;
}

//////////////////// Settings tab ////////////////////

function renderSettingsTab() {
  const view = document.getElementById('view');
  const q = getQueue().length;
  view.innerHTML = `
    <h2 class="view-title">⚙️ Settings</h2>
    <div class="card">
      <div class="field">
        <label>Apps Script Web App URL</label>
        <input type="text" id="set-url" placeholder="https://script.google.com/macros/s/.../exec" value="${getApiUrl()}">
      </div>
      <div class="field">
        <label>Shared secret (optional, only if you set SHARED_SECRET in the script)</label>
        <input type="text" id="set-secret" value="${getSecret()}">
      </div>
      <button class="btn-primary" id="save-settings">Save</button>
      <button class="btn-secondary" id="test-conn">Test connection</button>
    </div>
    <div class="card">
      <p class="muted">${q} entr${q === 1 ? 'y' : 'ies'} waiting to sync.</p>
      <button class="btn-secondary" id="sync-now">Sync now</button>
    </div>
    <div class="card">
      <p class="muted">Install: open this page in your phone's browser, then use "Add to Home Screen" (Safari share menu on iOS, or the install prompt / menu on Android Chrome).</p>
    </div>
    <p class="muted" style="text-align:center">App version ${APP_VERSION}</p>
  `;
  document.getElementById('save-settings').addEventListener('click', () => {
    setApiUrl(document.getElementById('set-url').value.trim());
    setSecret(document.getElementById('set-secret').value.trim());
    showToast('Settings saved', 'success');
    setConnStatus('unset');
  });
  document.getElementById('test-conn').addEventListener('click', async () => {
    const url = document.getElementById('set-url').value.trim();
    setApiUrl(url);
    const res = await apiGet('bloodPressure', { limit: 1 });
    showToast(res.ok ? 'Connected' : (res.error || 'Failed'), res.ok ? 'success' : 'error');
  });
  document.getElementById('sync-now').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    await syncQueue(false);
    renderSettingsTab();
  });
}

//////////////////// Event delegation ////////////////////

function initDelegation() {
  const view = document.getElementById('view');

  view.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-choice');
    if (btn) {
      const form = btn.closest('form');
      const field = btn.dataset.field;
      let value = btn.dataset.value;
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      if (form) {
        const type = form.dataset.formType;
        if (btn.dataset.multi === 'true') {
          const arr = formStates[type][field] || (formStates[type][field] = []);
          const idx = arr.indexOf(value);
          if (idx === -1) arr.push(value); else arr.splice(idx, 1);
        } else {
          formStates[type][field] = value;
        }
        renderFormTab(type);
      } else if (btn.dataset.trendType) {
        trendState.type = btn.dataset.trendType;
        renderTrendsTab();
      } else if (btn.dataset.trendRange !== undefined) {
        trendState.range = Number(btn.dataset.trendRange);
        renderTrendsTab();
      }
      return;
    }
  });

  view.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.dataset || !input.dataset.field) return;
    const form = input.closest('form');
    if (!form) return;
    const type = form.dataset.formType;
    formStates[type][input.dataset.field] = input.value;
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = e.target.dataset.formType;
    const state = formStates[type];
    const err = validate(type, state);
    if (err) { showToast(err, 'error'); return; }
    const payload = buildPayload(type, state);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    const res = await apiPost(type, payload);
    submitBtn.disabled = false;
    if (res.queued) {
      showToast(res.error || 'Saved locally — will sync later.', 'error');
    } else {
      showToast('Saved', 'success');
    }
    formStates[type] = makeDefaultState(type);
    renderFormTab(type);
  });
}

//////////////////// Init ////////////////////

function init() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
  initDelegation();
  setActiveTab('bloodPressure');
  setConnStatus('unset');

  repairLegacyQueue();
  if (getApiUrl() && getQueue().length) {
    syncQueue(true).then(() => { if (currentTab === 'settings') renderSettingsTab(); });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
