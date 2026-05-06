#!/usr/bin/env python3
"""Poll CF Stream clips until all readyToStream:true."""
import json
import subprocess
import sys
import time
from pathlib import Path

if len(sys.argv) != 2:
    print("Usage: poll-clips.py <course-id>")
    sys.exit(1)

course_id = sys.argv[1]
base = Path(__file__).parent
clip_path = base / "clip-uids" / f"{course_id}.json"

clip_map = json.loads(clip_path.read_text())

cf_token = subprocess.check_output(
    ["op", "read", "op://Automation/CF - Stream - account/credential"]
).decode().strip()
cf_account = "ecf2c5bc8b5ebd634bcb587b3890910a"

START = time.time()
TIMEOUT = 600  # 10 minutes

print(f"Polling {len(clip_map)} clips for {course_id}...")

while time.time() - START < TIMEOUT:
    all_ready = True
    statuses = []
    for step_id, info in clip_map.items():
        clip_uid = info["clipUid"]
        r = subprocess.run(
            ["curl", "-sS", f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/stream/{clip_uid}",
             "-H", f"Authorization: Bearer {cf_token}"],
            capture_output=True, text=True,
        )
        d = json.loads(r.stdout)
        result = d.get("result", {})
        ready = result.get("readyToStream", False)
        state = result.get("status", {}).get("state", "?")
        pct = result.get("status", {}).get("pctComplete", "")
        statuses.append((step_id, state, ready, pct))
        if not ready:
            all_ready = False

    elapsed = int(time.time() - START)
    print(f"\n[{elapsed}s] Status:")
    for step_id, state, ready, pct in statuses:
        marker = "✓" if ready else " "
        pct_str = f" ({pct}%)" if pct else ""
        print(f"  {marker} {step_id}: {state}{pct_str}")

    if all_ready:
        print(f"\nAll {len(clip_map)} clips ready in {elapsed}s")
        sys.exit(0)

    time.sleep(15)

print(f"\nTIMEOUT after {TIMEOUT}s")
sys.exit(1)
