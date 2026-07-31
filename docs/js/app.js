/* Health Log — app.js
 * Renders forms from schemas, posts to a Google Apps Script backend,
 * queues offline, and renders trend charts + review tables.
 */

const APP_VERSION = '2026.07.30-1';

//////////////////// Storage ////////////////////

const LS = {
  API_URL: 'healthlog_api_url',
  SECRET: 'healthlog_secret',
  QUEUE: 'healthlog_queue',
  THEME: 'healthlog_theme'
};

const getApiUrl = () => localStorage.getItem(LS.API_URL) || '';
const setApiUrl = (v) => localStorage.setItem(LS.API_URL, v);
const getSecret = () => localStorage.getItem(LS.SECRET) || '';
const setSecret = (v) => localStorage.setItem(LS.SECRET, v);
const getQueue = () => { try { return JSON.parse(localStorage.getItem(LS.QUEUE) || '[]'); } catch (e) { return []; } };
const setQueue = (q) => localStorage.setItem(LS.QUEUE, JSON.stringify(q));

//////////////////// Theme ////////////////////

const getTheme = () => localStorage.getItem(LS.THEME) || 'dark';
function setTheme(theme) {
  localStorage.setItem(LS.THEME, theme);
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f7fb' : '#0f172a');
  if (currentTab === 'trends') renderTrendsTab();
}

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

const BP_THRESHOLDS = { systolic: 120, diastolic: 80, pulse: 80 };
const ALARM_COLOR = '#dc2626';
const PALP_COLOR = '#eab308';

const FILTER_FIELDS = {
  bloodPressure: [
    { key: 'period', label: 'Period', kind: 'select', options: ['AM', 'PM'] },
    { key: 'palpitations', label: 'Palpitations', kind: 'bool' },
    { key: 'bathroomUsed', label: 'Bathroom used', kind: 'bool' },
    { key: 'excitingLastHour', label: 'Exciting last hour', kind: 'bool' },
    { key: 'excitingNextHour', label: 'Exciting next hour', kind: 'bool' },
    { key: 'betaBlockerTaken', label: 'Beta blocker taken', kind: 'bool' },
    { key: 'sleepHours', label: 'Sleep hours', kind: 'number' },
    { key: 'drinksYesterday', label: 'Drinks yesterday', kind: 'number' },
    { key: 'drinksToday', label: 'Drinks today', kind: 'number' },
    { key: 'workStress', label: 'Work stress (1-5)', kind: 'number' },
    { key: 'excitement', label: 'Excitement (1-5)', kind: 'number' },
    { key: 'anxietySadnessWorry', label: 'Anxiety / sadness / worry (1-5)', kind: 'number' }
  ],
  meditation: [
    { key: 'sentiment', label: 'Effectiveness (1-5)', kind: 'number' },
    { key: 'durationMinutes', label: 'Duration (min)', kind: 'number' }
  ],
  exercise: [
    { key: 'intensity', label: 'Intensity (1-5)', kind: 'number' },
    { key: 'sentiment', label: 'How it felt (1-5)', kind: 'number' },
    { key: 'durationMinutes', label: 'Duration (min)', kind: 'number' }
  ],
  heartEvent: [
    { key: 'severity', label: 'Severity (1-5)', kind: 'number' },
    { key: 'feeling', label: 'Head-effect (1-5)', kind: 'number' },
    { key: 'durationMinutes', label: 'Duration (min)', kind: 'number' }
  ]
};

let trendState = { type: 'bloodPressure', range: 30, filters: {}, filtersOpen: false, highlightPalp: false, records: [], loadedType: null };
let chartInstances = [];

function chartTextColor() {
  return (getComputedStyle(document.documentElement).getPropertyValue('--text-dim') || '#93a2ba').trim();
}
function chartGridColor() {
  return (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#2a3852').trim();
}

function destroyCharts() {
  chartInstances.forEach(c => c.destroy());
  chartInstances = [];
}

function withinRange(ts, days) {
  if (!days) return true;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ts).getTime() >= cutoff;
}

function activeFilterCount() {
  return Object.values(trendState.filters).filter(f => {
    if (f === null || f === undefined) return false;
    if (typeof f === 'object') return f.val !== undefined && f.val !== '';
    return f !== 'any';
  }).length;
}

function filterOperatorField(key, label) {
  const f = trendState.filters[key] || {};
  const opBtns = ['>', '=', '<'].map(op =>
    `<button type="button" class="btn-choice ${f.op === op ? 'selected' : ''}" data-filter-op="${key}" data-op-value="${op}">${op}</button>`
  ).join('');
  return `<div class="field filter-field">
    <label>${label}</label>
    <div class="filter-row">
      <div class="segmented filter-op">${opBtns}</div>
      <input type="number" inputmode="decimal" class="filter-val" data-filter-value="${key}" value="${f.val !== undefined ? f.val : ''}" placeholder="value">
    </div>
  </div>`;
}

function filterBoolField(key, label) {
  const f = trendState.filters[key] || 'any';
  const btns = [['any', 'Any'], ['yes', 'Yes'], ['no', 'No']].map(([v, l]) =>
    `<button type="button" class="btn-choice ${f === v ? 'selected' : ''}" data-filter-bool="${key}" data-bool-value="${v}">${l}</button>`
  ).join('');
  return `<div class="field filter-field"><label>${label}</label><div class="segmented">${btns}</div></div>`;
}

function filterSelectField(key, label, options) {
  const f = trendState.filters[key] || 'any';
  const btns = ['any', ...options].map(v =>
    `<button type="button" class="btn-choice ${f === v ? 'selected' : ''}" data-filter-select="${key}" data-select-value="${v}">${v === 'any' ? 'Any' : v}</button>`
  ).join('');
  return `<div class="field filter-field"><label>${label}</label><div class="segmented">${btns}</div></div>`;
}

function renderFilters(type) {
  const defs = FILTER_FIELDS[type] || [];
  const showPalpToggle = type === 'bloodPressure';
  if (!defs.length && !showPalpToggle) return '';
  const count = activeFilterCount();
  const fieldsHtml = defs.map(d => {
    if (d.kind === 'number') return filterOperatorField(d.key, d.label);
    if (d.kind === 'bool') return filterBoolField(d.key, d.label);
    return filterSelectField(d.key, d.label, d.options);
  }).join('');
  const body = trendState.filtersOpen && defs.length
    ? `<div class="filters-body">${fieldsHtml}${count ? `<button type="button" class="btn-secondary" data-filters-clear="1">Clear filters</button>` : ''}</div>`
    : '';
  const palpToggle = showPalpToggle
    ? `<label class="palp-highlight-toggle"><input type="checkbox" data-highlight-palp="1" ${trendState.highlightPalp ? 'checked' : ''}> Highlight palp events</label>`
    : '';
  return `
    <div class="card">
      <div class="filters-toggle-row">
        ${defs.length ? `<button type="button" class="filters-toggle" data-filters-toggle="1">Filters${count ? ` (${count})` : ''} ${trendState.filtersOpen ? '▲' : '▼'}</button>` : ''}
        ${palpToggle}
      </div>
      ${body}
    </div>`;
}

function applyFilters(records, type) {
  const defs = FILTER_FIELDS[type] || [];
  const filters = trendState.filters;
  return records.filter(r => defs.every(def => {
    const f = filters[def.key];
    if (!f) return true;
    if (def.kind === 'number') {
      if (f.val === undefined || f.val === '') return true;
      if (r[def.key] === '' || r[def.key] === undefined || r[def.key] === null) return false;
      const num = Number(r[def.key]);
      const target = Number(f.val);
      if (f.op === '<') return num < target;
      if (f.op === '=') return num === target;
      return num > target; // default '>'
    }
    if (def.kind === 'bool') {
      if (f === 'any') return true;
      return !!r[def.key] === (f === 'yes');
    }
    if (def.kind === 'select') {
      if (f === 'any') return true;
      return r[def.key] === f;
    }
    return true;
  }));
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
    ${renderFilters(trendState.type)}
    <div id="trend-content"><p class="muted">Loading…</p></div>
  `;

  if (trendState.loadedType !== trendState.type) {
    loadTrend();
  } else {
    renderTrendContent();
  }
}

async function loadTrend() {
  const content = document.getElementById('trend-content');
  destroyCharts();
  const res = await apiGet(trendState.type, { limit: 1000 });
  if (!res.ok) {
    content.innerHTML = `<p class="muted">${res.error || 'Could not load data.'}</p>`;
    return;
  }
  trendState.loadedType = trendState.type;
  trendState.records = res.records.filter(r => r.timestamp);
  renderTrendContent();
}

function renderTrendContent() {
  const content = document.getElementById('trend-content');
  if (!content) return;
  destroyCharts();
  let records = trendState.records.filter(r => withinRange(r.timestamp, trendState.range));
  records = applyFilters(records, trendState.type);
  records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (!records.length) {
    content.innerHTML = `<p class="muted">No entries match this range/filter combo.</p>`;
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
  const axisColor = chartTextColor();
  const gridColor = chartGridColor();
  const chart = new Chart(canvas, {
    type: kind,
    data: { labels: labelsFor(records), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: fieldList.length > 1, labels: { color: axisColor } } },
      scales: {
        x: { ticks: { color: axisColor, maxRotation: 60, minRotation: 60 }, grid: { color: gridColor } },
        y: { ticks: { color: axisColor }, grid: { color: gridColor } }
      }
    }
  });
  chartInstances.push(chart);
}

function thresholdDataset(label, value, color, length) {
  return {
    label, data: Array(length).fill(value),
    borderColor: color, borderWidth: 1, borderDash: [6, 4],
    pointRadius: 0, fill: false, order: 10, isThreshold: true
  };
}

function alarmPointColor(records, threshold, normalColor) {
  return (ctx) => {
    if (trendState.highlightPalp && records[ctx.dataIndex] && records[ctx.dataIndex].palpitations) return PALP_COLOR;
    const v = ctx.raw;
    return (v !== null && v !== undefined && v > threshold) ? ALARM_COLOR : normalColor;
  };
}

function alarmPointRadius(records, threshold) {
  return (ctx) => {
    if (trendState.highlightPalp && records[ctx.dataIndex] && records[ctx.dataIndex].palpitations) return 6;
    const v = ctx.raw;
    return (v !== null && v !== undefined && v > threshold) ? 5 : 3;
  };
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
    avgPulse: avg(r, ['bpm1', 'bpm2', 'bpm3']),
    palpitations: !!r.palpitations
  }));
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="mini-label" style="margin-bottom:6px">Systolic / Diastolic (avg of readings) — dots turn red above 120 / 80</div><div class="chart-wrap"><canvas id="bp-main"></canvas></div>
    <div class="mini-label" style="margin:14px 0 6px">Pulse (avg) — dots turn red above 80</div><div class="chart-wrap"><canvas id="bp-pulse"></canvas></div>`;
  holder.appendChild(wrap);

  const axisColor = chartTextColor();
  const gridColor = chartGridColor();
  const labels = labelsFor(withAvg);
  const legendFilter = (item, data) => !data.datasets[item.datasetIndex].isThreshold;

  const mainChart = new Chart(wrap.querySelector('#bp-main'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Systolic', data: withAvg.map(r => r.avgSystolic),
          borderColor: '#f87171', backgroundColor: '#f87171',
          pointBackgroundColor: alarmPointColor(withAvg, BP_THRESHOLDS.systolic, '#f87171'),
          pointBorderColor: alarmPointColor(withAvg, BP_THRESHOLDS.systolic, '#f87171'),
          pointRadius: alarmPointRadius(withAvg, BP_THRESHOLDS.systolic),
          spanGaps: true, tension: 0.3
        },
        {
          label: 'Diastolic', data: withAvg.map(r => r.avgDiastolic),
          borderColor: '#38bdf8', backgroundColor: '#38bdf8',
          pointBackgroundColor: alarmPointColor(withAvg, BP_THRESHOLDS.diastolic, '#38bdf8'),
          pointBorderColor: alarmPointColor(withAvg, BP_THRESHOLDS.diastolic, '#38bdf8'),
          pointRadius: alarmPointRadius(withAvg, BP_THRESHOLDS.diastolic),
          spanGaps: true, tension: 0.3
        },
        thresholdDataset(`Systolic threshold (${BP_THRESHOLDS.systolic})`, BP_THRESHOLDS.systolic, 'rgba(248,113,113,0.5)', labels.length),
        thresholdDataset(`Diastolic threshold (${BP_THRESHOLDS.diastolic})`, BP_THRESHOLDS.diastolic, 'rgba(56,189,248,0.5)', labels.length)
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: axisColor, filter: legendFilter } } },
      scales: {
        x: { ticks: { color: axisColor, maxRotation: 60, minRotation: 60 }, grid: { color: gridColor } },
        y: { ticks: { color: axisColor }, grid: { color: gridColor } }
      }
    }
  });
  chartInstances.push(mainChart);

  const pulseChart = new Chart(wrap.querySelector('#bp-pulse'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Pulse', data: withAvg.map(r => r.avgPulse),
          borderColor: '#4ade80', backgroundColor: '#4ade80',
          pointBackgroundColor: alarmPointColor(withAvg, BP_THRESHOLDS.pulse, '#4ade80'),
          pointBorderColor: alarmPointColor(withAvg, BP_THRESHOLDS.pulse, '#4ade80'),
          pointRadius: alarmPointRadius(withAvg, BP_THRESHOLDS.pulse),
          spanGaps: true, tension: 0.3
        },
        thresholdDataset(`Pulse threshold (${BP_THRESHOLDS.pulse})`, BP_THRESHOLDS.pulse, 'rgba(74,222,128,0.5)', labels.length)
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false, labels: { filter: legendFilter } } },
      scales: {
        x: { ticks: { color: axisColor, maxRotation: 60, minRotation: 60 }, grid: { color: gridColor } },
        y: { ticks: { color: axisColor }, grid: { color: gridColor } }
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
      <div class="field">
        <label>Appearance</label>
        <div class="segmented">
          <button type="button" class="btn-choice ${getTheme() === 'dark' ? 'selected' : ''}" data-theme-choice="dark">🌙 Dark</button>
          <button type="button" class="btn-choice ${getTheme() === 'light' ? 'selected' : ''}" data-theme-choice="light">☀️ Light</button>
        </div>
      </div>
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
        trendState.filters = {};
        trendState.filtersOpen = false;
        renderTrendsTab();
      } else if (btn.dataset.trendRange !== undefined) {
        trendState.range = Number(btn.dataset.trendRange);
        renderTrendsTab();
      } else if (btn.dataset.themeChoice) {
        setTheme(btn.dataset.themeChoice);
        renderSettingsTab();
      } else if (btn.dataset.filterOp) {
        const key = btn.dataset.filterOp;
        trendState.filters[key] = Object.assign({}, trendState.filters[key], { op: btn.dataset.opValue });
        renderTrendsTab();
      } else if (btn.dataset.filterBool) {
        trendState.filters[btn.dataset.filterBool] = btn.dataset.boolValue;
        renderTrendsTab();
      } else if (btn.dataset.filterSelect) {
        trendState.filters[btn.dataset.filterSelect] = btn.dataset.selectValue;
        renderTrendsTab();
      }
      return;
    }
    if (e.target.closest('[data-filters-toggle]')) {
      trendState.filtersOpen = !trendState.filtersOpen;
      renderTrendsTab();
      return;
    }
    if (e.target.closest('[data-filters-clear]')) {
      trendState.filters = {};
      renderTrendsTab();
      return;
    }
  });

  view.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.dataset) return;
    if (input.dataset.highlightPalp) {
      trendState.highlightPalp = input.checked;
      renderTrendContent();
      return;
    }
    if (input.dataset.filterValue) {
      const key = input.dataset.filterValue;
      const existing = trendState.filters[key] || { op: '>' };
      trendState.filters[key] = Object.assign({}, existing, { val: input.value });
      renderTrendContent();
      return;
    }
    if (!input.dataset.field) return;
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getTheme() === 'light' ? '#f5f7fb' : '#0f172a');

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
