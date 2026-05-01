# YouTube saved video auto sync

YouTube Data API cannot read Watch Later or watch history items. For automatic sync, create a normal private playlist such as `Summary Inbox`, then save videos into that playlist.

## Local setup

1. Create a private YouTube playlist for videos you want summarized.
2. Create a Google OAuth client for a desktop app.
3. Download the OAuth client JSON and save it as `client_secret.json` in the project root.
4. Run the first sync locally:

```powershell
pip install -r requirements.txt
$env:YOUTUBE_SAVED_PLAYLIST_IDS="PLAYLIST_ID"
python scripts/sync_saved_playlists.py
```

The first run opens a browser login and creates `token.json`. Do not commit `client_secret.json` or `token.json`.

## GitHub Actions setup

Add these repository secrets:

- `YOUTUBE_SAVED_PLAYLIST_IDS`: one playlist ID, or multiple IDs separated by commas
- `YOUTUBE_OAUTH_TOKEN_JSON`: the full contents of local `token.json`

The workflow `.github/workflows/saved_youtube_sync.yml` runs every 30 minutes and writes:

- `saved_videos.json`
- `videos.json`
- `site/videos.json`

The root page at `index.html` loads `videos.json` automatically when served from GitHub Pages or any local web server.

## Limits

- Watch Later is blocked by the YouTube Data API.
- The integration is polling-based. YouTube does not provide a simple push event for "user added video to playlist" in this setup.
- Current summaries are metadata placeholders. Add transcript collection and an LLM summarizer to generate real content summaries.
