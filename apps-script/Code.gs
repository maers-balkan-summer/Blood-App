/**
 * Health Log backend — Google Apps Script Web App.
 * Deploy as a Web App (execute as: Me, access: Anyone with the link).
 * Writes/reads rows in a bound Google Sheet, one tab per record type.
 *
 * SETUP:
 * 1. Create a Google Sheet.
 * 2. Extensions > Apps Script, paste this file in as Code.gs.
 * 3. (Optional but recommended) Project Settings > Script Properties > add
 *    SHARED_SECRET = some-long-random-string. If set, every request must
 *    include a matching "secret" field or it is rejected.
 * 4. Deploy > New deployment > type "Web app". Execute as "Me",
 *    "Who has access": Anyone. Copy the /exec URL — that's what you paste
 *    into the app's Settings tab.
 * 5. Re-deploy (Manage deployments > Edit > new version) whenever you
 *    change this file — Apps Script does not auto-update live deployments.
 */

var SHEETS = {
  bloodPressure: {
    tab: 'BloodPressure',
    fields: ['id', 'timestamp', 'period',
      'systolic1', 'diastolic1', 'bpm1',
      'systolic2', 'diastolic2', 'bpm2',
      'systolic3', 'diastolic3', 'bpm3',
      'bathroomUsed', 'palpitations', 'sleepHours',
      'drinksYesterday', 'drinksToday',
      'excitingLastHour', 'excitingNextHour', 'betaBlockerTaken',
      'workStress', 'excitement', 'anxietySadnessWorry', 'notes']
  },
  meditation: {
    tab: 'Meditation',
    fields: ['id', 'timestamp', 'type', 'durationMinutes', 'sentiment', 'notes']
  },
  exercise: {
    tab: 'Exercise',
    fields: ['id', 'timestamp', 'type', 'durationMinutes', 'intensity', 'sentiment', 'notes']
  },
  heartEvent: {
    tab: 'HeartEvent',
    fields: ['id', 'timestamp', 'type', 'severity', 'durationMinutes', 'feeling', 'notes']
  }
};

function doGet(e) {
  try {
    var type = e.parameter.type;
    if (!type || !SHEETS[type]) {
      return jsonOutput({ ok: false, error: 'Unknown or missing type. Valid: ' + Object.keys(SHEETS).join(', ') });
    }
    var secretError = checkSecret_(e.parameter.secret);
    if (secretError) return jsonOutput(secretError);

    var def = SHEETS[type];
    var sheet = ensureSheet_(def.tab, def.fields);
    var rows = sheet.getDataRange().getValues();
    var headers = rows.shift() || def.fields;
    var records = rows
      .filter(function (r) { return r.join('') !== ''; })
      .map(function (r) {
        var obj = {};
        headers.forEach(function (h, i) { obj[h] = r[i]; });
        return obj;
      });

    var limit = parseInt(e.parameter.limit, 10);
    if (limit && records.length > limit) {
      records = records.slice(records.length - limit);
    }

    return jsonOutput({ ok: true, type: type, records: records });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type;
    if (!type || !SHEETS[type]) {
      return jsonOutput({ ok: false, error: 'Unknown or missing type. Valid: ' + Object.keys(SHEETS).join(', ') });
    }
    var secretError = checkSecret_(body.secret);
    if (secretError) return jsonOutput(secretError);

    var def = SHEETS[type];
    var sheet = ensureSheet_(def.tab, def.fields);
    if (!body.id) body.id = Utilities.getUuid();

    var row = def.fields.map(function (f) {
      var v = body[f];
      return (v === undefined || v === null) ? '' : v;
    });
    sheet.appendRow(row);

    return jsonOutput({ ok: true, id: body.id });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function checkSecret_(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expected && provided !== expected) {
    return { ok: false, error: 'Invalid or missing secret' };
  }
  return null;
}

function ensureSheet_(tabName, fields) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(fields);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(fields);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run this once manually from the Apps Script editor to pre-create all tabs with headers. */
function setupSheets() {
  Object.keys(SHEETS).forEach(function (type) {
    ensureSheet_(SHEETS[type].tab, SHEETS[type].fields);
  });
}
