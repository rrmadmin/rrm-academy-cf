#!/usr/bin/env python3
"""Capture GSC top-200 indexed pages baseline."""
import json
import os
import sys
from urllib import request

CRED_PATH = os.path.expanduser('~/iCode/scripts/.gcp-token.json') if os.path.exists(os.path.expanduser('~/iCode/scripts/.gcp-token.json')) else None

# Try a simple shell-out to gcloud since ADC is set up per memory
import subprocess
token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token'], text=True).strip()

site = 'sc-domain:rrmacademy.org'
url = f'https://searchconsole.googleapis.com/webmasters/v3/sites/{site.replace(":", "%3A")}/searchAnalytics/query'
body = {
    'startDate': '2026-04-28',
    'endDate': '2026-05-04',
    'dimensions': ['page'],
    'rowLimit': 200,
}
req = request.Request(url, data=json.dumps(body).encode(), headers={
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json',
    'X-Goog-User-Project': 'rrm-academy',
}, method='POST')
try:
    with request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    rows = data.get('rows', [])
    out = [{'page': r['keys'][0], 'clicks': r['clicks'], 'impressions': r['impressions'], 'ctr': r['ctr'], 'position': r['position']} for r in rows]
    json.dump({'period': {'start': body['startDate'], 'end': body['endDate']}, 'total_pages': len(out), 'pages': out}, sys.stdout, indent=2)
except Exception as e:
    print(f"GSC query failed: {e}", file=sys.stderr)
    sys.exit(1)
