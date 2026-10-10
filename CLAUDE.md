# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jiu-Jitsu Map: a BJJ flow mapper (positions and transitions as a graph) as an offline PWA. There is no build step, no dependencies and no test suite; plain ES modules load straight from `index.html`. Preview with `python3 -m http.server 8080`.

(The parent `../CLAUDE.md` describes the shoryuken.me workspace; the one above that is an unrelated Rust project.)

## Shared-origin rules

Deployed at `/jjm/` next to other apps on shoryuken.me. See "Storage etiquette" in `README.md`:

- localStorage: only keys under `PREFIX` (`jjmap:v1:`) in `js/store.js`. "Delete all data" and the usage meter iterate localStorage but must only touch keys with that prefix.
- Cache Storage: only caches prefixed `jjmap-static-`; `activate` prunes only those.
- `sw.js` handles only requests inside `self.registration.scope` and reads only its own cache, never `caches.match()`.
- Manifest `id` is `/jiu-jitsu-map-6c1f9a2e`. Never change it once released.

## Releasing

The service worker is cache-first and waits for the user to accept an "Update" prompt (`jjmap:skip-waiting` message). To ship a change, bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`, and add any new file to `ASSETS`. Precaching uses `cache: 'reload'` so Cloudflare's 4 h max-age on JS/CSS can't freeze an old file into the new cache; keep it.

## Deployment

Live at https://shoryuken.me/jjm/ (`/var/www/shoryuken.me/jjm/`; see the server's `/var/www/shoryuken.me/CLAUDE.md`). Ship only the served files:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js styles.css js icons root@185.163.204.17:/var/www/shoryuken.me/jjm/
```
