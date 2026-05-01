# YouTube Curator

A small saved-video dashboard for a private YouTube playlist.

## What is included

- `index.html`, `app.js`, `style.css`: root GitHub Pages version of the saved video dashboard
- `site/`: same static page kept as a separate copy
- `scripts/sync_saved_playlists.py`: OAuth playlist sync script
- `.github/workflows/saved_youtube_sync.yml`: 30-minute GitHub Actions sync
- `docs/youtube_saved_sync.md`: setup guide

## Quick start

Open `index.html` to use the page with local/manual data.

For automatic YouTube sync, create a private playlist, set up Google OAuth, then follow `docs/youtube_saved_sync.md`.
