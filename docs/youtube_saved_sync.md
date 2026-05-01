# YouTube playlist auto sync

YouTube Data API cannot read Watch Later or watch history items. This project syncs a normal YouTube playlist instead.

The current playlist is configured in `config/playlists.json`:

```text
PLAvDqgTD9HsLLKc56FhJkEtKG2XIaIJ3L
```

Because the playlist is public, OAuth is not required for sync. Use a YouTube Data API key stored in GitHub Secrets.

## Local setup

1. Create a YouTube Data API key in Google Cloud.
2. Set it as an environment variable locally.
3. Run the sync:

```powershell
pip install -r requirements.txt
$env:YOUTUBE_API_KEY="YOUR_API_KEY"
python scripts/sync_saved_playlists.py
```

## GitHub Actions setup

Add this repository secret:

- `YOUTUBE_API_KEY`: YouTube Data API key

Optional:

- `YOUTUBE_SAVED_PLAYLIST_IDS`: one playlist ID, or multiple IDs separated by commas
- `YOUTUBE_OAUTH_TOKEN_JSON`: only needed if you later sync private playlists

The workflow `.github/workflows/saved_youtube_sync.yml` runs every 30 minutes and writes:

- `saved_videos.json`
- `videos.json`
- `site/videos.json`

The root page at `index.html` loads `videos.json` automatically when served from GitHub Pages or any local web server.

## Limits

- Watch Later is blocked by the YouTube Data API.
- The integration is polling-based. YouTube does not provide a simple push event for "user added video to playlist" in this setup.
- Current summaries are metadata placeholders. Add transcript collection and an LLM summarizer to generate real content summaries.
