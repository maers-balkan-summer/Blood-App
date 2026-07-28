# Health Log

A phone-installable app for logging Blood Pressure, Meditation, Exercise, and
Heart Event entries, backed by a free Google Sheet. Includes trend charts and
a review table for each record type.

- `docs/` — the installable web app (PWA). GitHub Pages serves this folder.
- `apps-script/Code.gs` — the backend. Paste into a Google Apps Script project
  bound to a Google Sheet; it exposes a small JSON API the app talks to.
- `serve.ps1` — optional local test server (no install needed) so you can
  preview the app on your computer before deploying. Run
  `powershell -ExecutionPolicy Bypass -File serve.ps1` and open
  `http://localhost:8420/`. It's not needed once the app is on GitHub Pages.

No servers to run, no accounts beyond Google + GitHub, no cost.

## 1. Create the Google Sheet backend

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank
   spreadsheet. Name it something like "Health Log Data".
2. In the sheet, go to **Extensions > Apps Script**.
3. Delete the default `Code.gs` contents and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this project.
4. Click the disk/Save icon.
5. In the function dropdown at the top (next to Debug), select `setupSheets`
   and click **Run**. The first run will ask you to authorize the script —
   approve it (it only touches this one spreadsheet). This creates the four
   tabs (`BloodPressure`, `Meditation`, `Exercise`, `HeartEvent`) with headers.
6. (Optional, recommended) Add a shared secret so random people can't write to
   your sheet even if they guess the URL:
   - Project Settings (gear icon) > **Script Properties** > Add property.
   - Property: `SHARED_SECRET`, Value: any long random string you make up.
   - You'll paste this same string into the app's Settings tab later.
7. Click **Deploy > New deployment**.
   - Type: **Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Click **Deploy**, authorize again if asked.
8. Copy the **Web app URL** (ends in `/exec`). This is your private API
   endpoint — keep it like a password. You'll paste it into the app.

Whenever you edit `Code.gs` later, use **Deploy > Manage deployments > Edit
(pencil) > New version > Deploy** — editing the script alone does not update
the live URL's behavior.

## 2. Publish the app on GitHub Pages

1. Create a new GitHub repository (public is fine — it contains no personal
   data, just app code; your actual entries live only in your private Sheet).
2. Push this project's contents to it, e.g.:
   ```bash
   git init
   git add .
   git commit -m "Health Log app"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. On GitHub: **Settings > Pages** > Source: **Deploy from a branch** > Branch:
   `main`, folder: **/docs** > Save.
4. After a minute, GitHub shows your live URL, something like
   `https://<you>.github.io/<repo>/`.

## 3. Install on your phone

1. Open the GitHub Pages URL in your phone's browser.
2. **iOS (Safari):** tap the Share icon > **Add to Home Screen**.
   **Android (Chrome):** tap the menu (⋮) > **Add to Home screen** / **Install
   app** (or use the install banner if it appears).
3. Open the app icon from your home screen — it now runs full-screen like a
   native app.
4. Go to the **Settings** tab inside the app and paste in the Apps Script
   `/exec` URL from step 1. If you set a `SHARED_SECRET`, paste that too.
   Tap **Save**, then **Test connection** to confirm it's wired up.

## Using it

- The four main tabs are quick-entry forms. Date/time default to "now" but
  are editable for logging things after the fact.
- Blood Pressure supports up to 3 readings per entry, and shows/hides a few
  fields depending on whether you mark the entry AM or PM.
- If you're offline (or haven't set the API URL yet), entries save locally on
  the phone and show a "waiting to sync" count; use **Sync now** in Settings
  once you're back online.
- **Trends** tab: pick a record type and a time range to see charts (e.g.
  average systolic/diastolic over time for BP) plus a full data table below
  for reviewing raw entries.
- All data lives in your Google Sheet — open it directly any time for ad hoc
  analysis, pivot tables, or backups.

## Notes / limitations

- This is intentionally a lightweight personal tool, not a medical device or
  HIPAA-grade system. Don't use it for anything beyond personal tracking.
- The Apps Script URL acts as your API key. Anyone with it (and your shared
  secret, if set) can write rows to your sheet — don't post it publicly.
- Chart.js loads from a CDN on first load and is cached by the service worker
  afterward, so charts still render offline once you've opened the Trends tab
  at least once with a connection.
