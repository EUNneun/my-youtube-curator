# YouTube Curator

A small saved-video dashboard for a private YouTube playlist.

## What is included

- `index.html`, `app.js`, `style.css`: root GitHub Pages version of the saved video dashboard
- `site/`: same static page kept as a separate copy
- `scripts/sync_saved_playlists.py`: OAuth playlist sync script
- `config/playlists.json`: public playlist IDs to sync
- `.github/workflows/saved_youtube_sync.yml`: 30-minute GitHub Actions sync
- `docs/youtube_saved_sync.md`: setup guide

## Quick start

Open `index.html` to use the page with local/manual data.

For automatic YouTube sync, add a YouTube Data API key to GitHub Secrets as `YOUTUBE_API_KEY`, then follow `docs/youtube_saved_sync.md`.
