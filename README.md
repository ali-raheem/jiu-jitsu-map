# Jiu-Jitsu Map

A static, installable, offline-first web app for mapping your BJJ game:

- **States** (positions such as closed guard or mount), grouped by perspective (neutral / bottom / top / scramble).
- **Microstates** are variations inside a state: grips, posture, underhooks.
- **Techniques (transitions)** move you from a state or microstate to another one, or to a finish.
- **Failures and backups**: for each technique, where you end up when it fails, what goes wrong, and which backup techniques you chain into. Mark techniques as *Failing* to track the ones that aren't working.
- **Flow graph**: an auto-laid-out diagram you can drag, pan, and zoom. Failure paths are drawn as dashed red lines.
- **Share**: a link that carries the whole map (compressed) in its `#fragment`, so nothing is uploaded. You can also share or download a `.jjmap.json` file.
- **Backup & restore**: ⚙ → *Export all maps* saves one backup file. Importing it offers **Restore**, which replaces maps that are already on the device with the backup version (with Undo), or **Add as copies**. Maps not in the backup are never touched.
- **Print**: a clean printout with a graph page, a table per state, and a "When it goes wrong" summary. Save it as a PDF from the print dialog.

## Run / deploy

No build step. Serve the folder from any static host (GitHub Pages, Netlify, `python3 -m http.server`).
All paths are relative, so it also works from a sub-path. The service worker needs HTTPS (or `localhost`).

## Storage etiquette

- localStorage: only keys prefixed `jjmap:v1:` (`index`, `prefs`, `map:<id>`). Writes are debounced, and "Delete all data" removes only these keys.
- Cache Storage: only caches prefixed `jjmap-static-`. Old versions are pruned on activate.
- Calls `navigator.storage.persist()` at startup, again on first edit, and after install. You can also request it from **Data & storage** (⚙), which shows its status.
- Manifest `id`: `/jiu-jitsu-map-6c1f9a2e`.

## Releasing an update

Bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/app.js`). Users get an "Update" prompt.
