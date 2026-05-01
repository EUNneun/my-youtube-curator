# YouTube playlist auto sync

YouTube Data API cannot read Watch Later or watch history items. This project syncs a normal YouTube playlist instead.

The current playlist is configured in `config/playlists.json`:

```text
PLAvDqgTD9HsLLKc56FhJkEtKG2XIaIJ3L
```

Because the playlist is public, OAuth is not required for sync. The workflow can read the public playlist without an API key. A YouTube Data API key is optional and can be added later for a more official sync path.

## Local setup

Run the sync:

```powershell
pip install -r requirements.txt
python scripts/sync_saved_playlists.py
```

## GitHub Actions setup

No secret is required for the current public playlist setup.

Optional repository secrets:

- `YOUTUBE_API_KEY`: YouTube Data API key
- `YOUTUBE_SAVED_PLAYLIST_IDS`: one playlist ID, or multiple IDs separated by commas
- `YOUTUBE_OAUTH_TOKEN_JSON`: only needed if you later sync private playlists

The workflow `.github/workflows/saved_youtube_sync.yml` runs every 30 minutes and writes:

- `saved_videos.json`
- `videos.json`
- `site/videos.json`

The root page at `index.html` loads `videos.json` automatically when served from GitHub Pages or any local web server.

## If the page is empty

Check these in order:

1. GitHub repository `Settings -> Secrets and variables -> Actions` has `YOUTUBE_API_KEY`.
2. Repository `Actions` tab has a successful `Saved YouTube Sync` run.
3. The repository file list contains `videos.json` in the root.
4. Open the Pages URL again with a hard refresh.

If the workflow succeeds but creates only a small list, YouTube's public feed fallback may be limiting results. Add `YOUTUBE_API_KEY` later if you need the official full playlist API path.

You can run the sync immediately from `Actions -> Saved YouTube Sync -> Run workflow`.

## Limits

- Watch Later is blocked by the YouTube Data API.
- The integration is polling-based. YouTube does not provide a simple push event for "user added video to playlist" in this setup.
- Current summaries are metadata placeholders. Add transcript collection and an LLM summarizer to generate real content summaries.
