#!/usr/bin/env python3
"""Sync videos from OAuth-accessible YouTube playlists.

YouTube Data API does not expose Watch Later or watch history items.
Use this with one or more playlists that the authenticated account owns,
for example a private playlist named "Summary Inbox".
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"]
CLIENT_SECRET_PATH = Path(os.environ.get("YOUTUBE_CLIENT_SECRET_FILE", "client_secret.json"))
TOKEN_PATH = Path(os.environ.get("YOUTUBE_TOKEN_FILE", "token.json"))
PLAYLIST_IDS = [
    item.strip()
    for item in os.environ.get("YOUTUBE_SAVED_PLAYLIST_IDS", "").split(",")
    if item.strip()
]
OUTPUT_PATHS = [
    Path("saved_videos.json"),
    Path("videos.json"),
    Path("site/videos.json"),
]


def load_credentials():
    token_json = os.environ.get("YOUTUBE_OAUTH_TOKEN_JSON")
    if token_json:
        credentials = Credentials.from_authorized_user_info(json.loads(token_json), SCOPES)
    elif TOKEN_PATH.exists():
        credentials = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    else:
        if not CLIENT_SECRET_PATH.exists():
            raise FileNotFoundError(
                "OAuth client file not found. Put client_secret.json in the project root "
                "or set YOUTUBE_CLIENT_SECRET_FILE."
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_PATH), SCOPES)
        credentials = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(credentials.to_json(), encoding="utf-8")

    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        if not token_json:
            TOKEN_PATH.write_text(credentials.to_json(), encoding="utf-8")

    return credentials


def fetch_playlist_items(youtube, playlist_id):
    page_token = None
    videos = []

    while True:
        response = youtube.playlistItems().list(
            part="snippet,contentDetails",
            playlistId=playlist_id,
            maxResults=50,
            pageToken=page_token,
        ).execute()

        for item in response.get("items", []):
            snippet = item.get("snippet", {})
            content = item.get("contentDetails", {})
            video_id = content.get("videoId") or snippet.get("resourceId", {}).get("videoId")
            if not video_id:
                continue

            title = snippet.get("title") or "Untitled video"
            channel = (
                snippet.get("videoOwnerChannelTitle")
                or snippet.get("channelTitle")
                or "Unknown channel"
            )
            thumbnails = snippet.get("thumbnails", {})
            thumbnail = (
                thumbnails.get("high", {}).get("url")
                or thumbnails.get("medium", {}).get("url")
                or f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
            )
            saved_at = snippet.get("publishedAt") or content.get("videoPublishedAt") or ""

            videos.append({
                "id": video_id,
                "video_id": video_id,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "title": title,
                "channel": channel,
                "savedAt": saved_at,
                "published_at": content.get("videoPublishedAt") or "",
                "playlistId": playlist_id,
                "topic": guess_topic(title),
                "summary": make_summary(title, channel),
                "thumbnail": thumbnail,
                "source": "saved_playlist",
                "syncedAt": datetime.now(timezone.utc).isoformat(),
            })

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return videos


def guess_topic(title):
    text = title.lower()
    rules = [
        ("AI Automation", ["ai", "agent", "automation", "llm", "gpt"]),
        ("Planning", ["product", "strategy", "roadmap"]),
        ("Research", ["research", "interview", "ux"]),
        ("Development", ["code", "coding", "developer", "api"]),
        ("Marketing", ["marketing", "growth", "brand"]),
    ]
    for topic, words in rules:
        if any(word in text for word in words):
            return topic
    return "Uncategorized"


def make_summary(title, channel):
    return (
        f"Saved video from {channel}: {title}. This placeholder summary is based on "
        "playlist metadata; connect transcript collection and an LLM step for full summaries."
    )


def merge_unique(videos):
    merged = {}
    for path in OUTPUT_PATHS:
        if path.exists():
            try:
                for video in json.loads(path.read_text(encoding="utf-8")):
                    video_id = video.get("id") or video.get("video_id")
                    if video_id:
                        merged[video_id] = video
            except json.JSONDecodeError:
                pass

    for video in videos:
        merged[video["id"]] = {**merged.get(video["id"], {}), **video}

    return sorted(merged.values(), key=lambda item: item.get("savedAt", ""), reverse=True)


def main():
    if not PLAYLIST_IDS:
        print("ERROR: set YOUTUBE_SAVED_PLAYLIST_IDS to one or more playlist IDs", file=sys.stderr)
        sys.exit(1)

    credentials = load_credentials()
    youtube = build("youtube", "v3", credentials=credentials)

    synced = []
    for playlist_id in PLAYLIST_IDS:
        try:
            playlist_videos = fetch_playlist_items(youtube, playlist_id)
            print(f"{playlist_id}: {len(playlist_videos)} videos")
            synced.extend(playlist_videos)
        except HttpError as error:
            print(f"ERROR: failed to sync playlist {playlist_id}: {error}", file=sys.stderr)
            raise

    videos = merge_unique(synced)
    for path in OUTPUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Saved playlist sync complete: {len(videos)} total videos")


if __name__ == "__main__":
    main()
