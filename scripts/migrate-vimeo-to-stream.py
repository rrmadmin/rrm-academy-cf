#!/usr/bin/env python3
"""
Migrate Vimeo videos to Cloudflare Stream.

Downloads each video via yt-dlp (1080p), uploads to CF Stream via tus,
records the mapping, then deletes the local file. Resumable — skips
videos already in the mapping file.

Usage:
    # Set env vars (or they'll be read from 1Password / env):
    export CF_STREAM_TOKEN="your-cf-api-token-with-stream-edit"
    export CF_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a"

    python3 scripts/migrate-vimeo-to-stream.py

    # Or do a dry run first:
    python3 scripts/migrate-vimeo-to-stream.py --dry-run
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from base64 import b64encode

# --- Config ---
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "ecf2c5bc8b5ebd634bcb587b3890910a")
CF_TOKEN = os.environ.get("CF_STREAM_TOKEN", "")
COURSES_JSON = Path(__file__).parent.parent / "src" / "data" / "courses.json"
MAPPING_FILE = Path(__file__).parent / "vimeo-to-stream-mapping.json"
DOWNLOAD_DIR = Path(__file__).parent / "vimeo-downloads"
TUS_ENDPOINT = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/stream"
CHUNK_SIZE = 50 * 1024 * 1024  # 50 MB chunks for tus upload
MAX_RETRIES = 3
FORMAT = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_mapping():
    if MAPPING_FILE.exists():
        with open(MAPPING_FILE) as f:
            return json.load(f)
    return {}


def save_mapping(mapping):
    with open(MAPPING_FILE, "w") as f:
        json.dump(mapping, f, indent=2)


def get_all_vimeo_ids():
    """Extract all vimeo IDs from courses.json with metadata."""
    with open(COURSES_JSON) as f:
        courses = json.load(f)

    videos = []
    for course in courses:
        for section in course.get("sections", []):
            for step in section.get("steps", []):
                vid = step.get("vimeoId")
                if vid:
                    videos.append({
                        "vimeoId": str(vid),
                        "title": step.get("title", "Unknown"),
                        "course": course.get("title", "Unknown"),
                        "stepId": step.get("id", ""),
                    })
    return videos


def download_vimeo(vimeo_id, output_path):
    """Download a Vimeo video using yt-dlp. Returns True on success."""
    url = f"https://vimeo.com/{vimeo_id}"
    cmd = [
        "yt-dlp",
        "-f", FORMAT,
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        "--no-playlist",
        "--retries", "3",
        "--fragment-retries", "3",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            return True
        log(f"  yt-dlp error: {result.stderr[-200:]}")
        return False
    except subprocess.TimeoutExpired:
        log("  yt-dlp timed out after 10 min")
        return False


def tus_upload(file_path, video_name):
    """Upload a file to CF Stream via tus protocol. Returns stream UID or None."""
    file_size = os.path.getsize(file_path)
    name_b64 = b64encode(video_name.encode()).decode()

    # Step 1: Create the upload
    headers = {
        "Authorization": f"Bearer {CF_TOKEN}",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": str(file_size),
        "Upload-Metadata": f"name {name_b64}",
    }

    req = urllib.request.Request(TUS_ENDPOINT, method="POST", headers=headers)
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        log(f"  tus create failed ({e.code}): {body[:200]}")
        return None

    location = resp.headers.get("Location") or resp.headers.get("location")
    stream_uid = resp.headers.get("stream-media-id")
    if not location:
        log("  tus create: no Location header returned")
        return None

    log(f"  tus upload created: {stream_uid or '?'}")

    # Step 2: Upload file in chunks
    offset = 0
    with open(file_path, "rb") as f:
        while offset < file_size:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break

            patch_headers = {
                "Authorization": f"Bearer {CF_TOKEN}",
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": str(offset),
                "Content-Type": "application/offset+octet-stream",
                "Content-Length": str(len(chunk)),
            }

            for attempt in range(MAX_RETRIES):
                try:
                    patch_req = urllib.request.Request(
                        location, data=chunk, method="PATCH", headers=patch_headers
                    )
                    patch_resp = urllib.request.urlopen(patch_req)
                    new_offset = patch_resp.headers.get("Upload-Offset")
                    if new_offset:
                        offset = int(new_offset)
                    else:
                        offset += len(chunk)
                    pct = int(offset / file_size * 100)
                    log(f"  uploaded {offset}/{file_size} ({pct}%)")
                    break
                except urllib.error.HTTPError as e:
                    body = e.read().decode(errors="replace")
                    log(f"  tus patch attempt {attempt+1} failed ({e.code}): {body[:150]}")
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(5 * (attempt + 1))
                    else:
                        log("  giving up on this chunk")
                        return None
                except Exception as e:
                    log(f"  tus patch error: {e}")
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(5 * (attempt + 1))
                    else:
                        return None

    # Extract stream UID from location URL if not in headers
    if not stream_uid and location:
        # Location is like https://api.cloudflare.com/.../stream/<uid>
        stream_uid = location.rstrip("/").rsplit("/", 1)[-1]

    return stream_uid


def main():
    dry_run = "--dry-run" in sys.argv

    if not CF_TOKEN and not dry_run:
        print("Error: Set CF_STREAM_TOKEN env var (CF API token with Stream:Edit)")
        print("  export CF_STREAM_TOKEN='your-token-here'")
        sys.exit(1)

    videos = get_all_vimeo_ids()
    mapping = load_mapping()

    log(f"Found {len(videos)} videos across all courses")
    log(f"Already migrated: {len(mapping)}")

    remaining = [v for v in videos if v["vimeoId"] not in mapping]
    log(f"Remaining: {len(remaining)}")

    if dry_run:
        log("DRY RUN — listing videos to migrate:")
        for v in remaining:
            log(f"  [{v['course'][:30]}] {v['title']} (vimeo:{v['vimeoId']})")
        return

    DOWNLOAD_DIR.mkdir(exist_ok=True)

    failed = []
    for i, video in enumerate(remaining):
        vid = video["vimeoId"]
        log(f"\n{'='*60}")
        log(f"[{i+1}/{len(remaining)}] {video['title']}")
        log(f"  Course: {video['course']}")
        log(f"  Vimeo ID: {vid}")

        dl_path = DOWNLOAD_DIR / f"{vid}.mp4"

        # Download
        if not dl_path.exists():
            log("  Downloading from Vimeo...")
            ok = download_vimeo(vid, dl_path)
            if not ok:
                log("  FAILED to download — skipping")
                failed.append(video)
                continue
        else:
            log("  Already downloaded, reusing")

        file_mb = dl_path.stat().st_size / (1024 * 1024)
        log(f"  File size: {file_mb:.1f} MB")

        # Upload
        log("  Uploading to CF Stream...")
        clean_name = f"{video['course']} - {video['title']}"
        stream_uid = tus_upload(dl_path, clean_name)

        if stream_uid:
            log(f"  Stream UID: {stream_uid}")
            mapping[vid] = {
                "streamUid": stream_uid,
                "title": video["title"],
                "course": video["course"],
                "stepId": video["stepId"],
            }
            save_mapping(mapping)

            # Clean up downloaded file
            dl_path.unlink()
            log("  Local file deleted")
        else:
            log("  FAILED to upload — keeping local file for retry")
            failed.append(video)

        # Brief pause between videos to be polite
        if i < len(remaining) - 1:
            time.sleep(2)

    log(f"\n{'='*60}")
    log(f"DONE. Migrated: {len(mapping)}. Failed: {len(failed)}.")
    if failed:
        log("Failed videos:")
        for v in failed:
            log(f"  - {v['title']} (vimeo:{v['vimeoId']})")
    log(f"Mapping saved to: {MAPPING_FILE}")


if __name__ == "__main__":
    main()
