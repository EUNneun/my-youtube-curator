#!/usr/bin/env python3
"""Sync videos from YouTube playlists.

Public playlists can be synced with YOUTUBE_API_KEY. Private playlists
can still use OAuth via YOUTUBE_OAUTH_TOKEN_JSON or local token.json.
If no API key or OAuth token is available, public playlist pages are parsed
without credentials.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    Request = None
    Credentials = None
    InstalledAppFlow = None
    build = None
    HttpError = Exception

SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"]
CLIENT_SECRET_PATH = Path(os.environ.get("YOUTUBE_CLIENT_SECRET_FILE", "client_secret.json"))
TOKEN_PATH = Path(os.environ.get("YOUTUBE_TOKEN_FILE", "token.json"))
PLAYLIST_CONFIG_PATH = Path("config/playlists.json")
OUTPUT_PATHS = [
    Path("saved_videos.json"),
    Path("videos.json"),
    Path("site/videos.json"),
]


def load_playlist_ids():
    env_value = os.environ.get("YOUTUBE_SAVED_PLAYLIST_IDS", "")
    ids = [item.strip() for item in env_value.split(",") if item.strip()]
    if ids:
        return ids

    if PLAYLIST_CONFIG_PATH.exists():
        data = json.loads(PLAYLIST_CONFIG_PATH.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else data.get("playlists", [])
        return [
            item.get("id", "").strip() if isinstance(item, dict) else str(item).strip()
            for item in rows
            if (item.get("id", "").strip() if isinstance(item, dict) else str(item).strip())
        ]

    return []


def build_youtube_client():
    if build is None:
        return None

    api_key = os.environ.get("YOUTUBE_API_KEY")
    if api_key:
        return build("youtube", "v3", developerKey=api_key)

    if not os.environ.get("YOUTUBE_OAUTH_TOKEN_JSON") and not TOKEN_PATH.exists() and not CLIENT_SECRET_PATH.exists():
        return None

    credentials = load_credentials()
    return build("youtube", "v3", credentials=credentials)


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


def fetch_public_playlist_items(playlist_id):
    videos = fetch_public_playlist_page(playlist_id)
    if videos:
        return videos
    return fetch_public_playlist_feed(playlist_id)


def fetch_public_playlist_page(playlist_id):
    html = fetch_text(f"https://www.youtube.com/playlist?list={playlist_id}")
    initial_data = extract_yt_initial_data(html)
    if not initial_data:
        return []

    renderers = []
    collect_renderers(initial_data, "playlistVideoRenderer", renderers)

    videos = []
    seen = set()
    for renderer in renderers:
        video_id = renderer.get("videoId")
        if not video_id or video_id in seen:
            continue
        seen.add(video_id)
        title = text_from_runs(renderer.get("title")) or "Untitled video"
        channel = text_from_runs(renderer.get("shortBylineText")) or "Unknown channel"
        thumb = thumbnail_from_renderer(renderer) or f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        videos.append(make_video_record(
            video_id=video_id,
            title=title,
            channel=channel,
            playlist_id=playlist_id,
            thumbnail=thumb,
            saved_at="",
            description="",
        ))

    return videos


def fetch_public_playlist_feed(playlist_id):
    xml = fetch_text(f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}")
    entries = re.findall(r"<entry>(.*?)</entry>", xml, flags=re.S)
    videos = []
    for entry in entries:
        video_id = xml_text(entry, "yt:videoId")
        if not video_id:
            continue
        title = xml_text(entry, "title") or "Untitled video"
        channel = xml_text(entry, "name") or "Unknown channel"
        published = xml_text(entry, "published")
        videos.append(make_video_record(
            video_id=video_id,
            title=title,
            channel=channel,
            playlist_id=playlist_id,
            thumbnail=f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
            saved_at=published,
            description="",
        ))
    return videos


def fetch_text(url):
    request = UrlRequest(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_yt_initial_data(html):
    marker = "var ytInitialData = "
    start = html.find(marker)
    if start == -1:
        marker = "window[\"ytInitialData\"] = "
        start = html.find(marker)
    if start == -1:
        return None

    start = html.find("{", start)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(html)):
        char = html[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == "\"":
                in_string = False
        else:
            if char == "\"":
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(html[start:index + 1])
    return None


def collect_renderers(value, key, results):
    if isinstance(value, dict):
        if key in value:
            results.append(value[key])
        for child in value.values():
            collect_renderers(child, key, results)
    elif isinstance(value, list):
        for child in value:
            collect_renderers(child, key, results)


def text_from_runs(value):
    if not isinstance(value, dict):
        return ""
    if value.get("simpleText"):
        return value["simpleText"]
    runs = value.get("runs", [])
    return "".join(run.get("text", "") for run in runs).strip()


def thumbnail_from_renderer(renderer):
    thumbnails = renderer.get("thumbnail", {}).get("thumbnails", [])
    if not thumbnails:
        return ""
    return unquote(thumbnails[-1].get("url", ""))


def xml_text(xml, tag):
    match = re.search(rf"<{re.escape(tag)}[^>]*>(.*?)</{re.escape(tag)}>", xml, flags=re.S)
    if not match:
        return ""
    return (
        match.group(1)
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .strip()
    )


def make_video_record(video_id, title, channel, playlist_id, thumbnail, saved_at, description):
    return {
        "id": video_id,
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": title,
        "channel": channel,
        "savedAt": saved_at,
        "published_at": saved_at,
        "playlistId": playlist_id,
        "topic": guess_topic(title),
        "summary": description or make_summary(title, channel),
        "thumbnail": thumbnail,
        "source": "public_playlist",
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }


def guess_topic(title):
    text = title.lower()
    rules = [
        ("AI 자동화", ["ai", "agent", "automation", "llm", "gpt", "자동화", "에이전트"]),
        ("기획", ["product", "strategy", "roadmap", "기획", "전략", "프로덕트"]),
        ("리서치", ["research", "interview", "ux", "리서치", "인터뷰", "사용자"]),
        ("개발", ["code", "coding", "developer", "api", "개발", "코딩"]),
        ("마케팅", ["marketing", "growth", "brand", "마케팅", "브랜드"]),
    ]
    for topic, words in rules:
        if any(word in text for word in words):
            return topic
    return "미분류"


def make_summary(title, channel):
    return (
        f"{channel} 채널의 영상입니다. 제목은 \"{title}\"이며, 현재는 공개 재생목록의 메타데이터를 바탕으로 "
        "자동 정리했습니다. 자막 수집과 AI 요약 단계를 연결하면 실제 영상 내용 기반 요약으로 확장할 수 있습니다."
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
    playlist_ids = load_playlist_ids()
    if not playlist_ids:
        print("ERROR: set YOUTUBE_SAVED_PLAYLIST_IDS to one or more playlist IDs", file=sys.stderr)
        sys.exit(1)

    youtube = build_youtube_client()

    synced = []
    for playlist_id in playlist_ids:
        try:
            if youtube is None:
                playlist_videos = fetch_public_playlist_items(playlist_id)
            else:
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
