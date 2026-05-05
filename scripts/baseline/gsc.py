#!/usr/bin/env python3
"""Capture GSC top-N indexed pages baseline.

Usage:
  python3 scripts/baseline/gsc.py                       # rolling 7d ending yesterday
  python3 scripts/baseline/gsc.py --start 2026-04-28 --end 2026-05-04
  python3 scripts/baseline/gsc.py --rows 500
"""
import argparse
import json
import subprocess
import sys
from datetime import date, timedelta
from urllib import request


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', help='YYYY-MM-DD (defaults to 7 days before --end)')
    ap.add_argument('--end', help='YYYY-MM-DD (defaults to yesterday)')
    ap.add_argument('--rows', type=int, default=200, help='rowLimit (default 200)')
    ap.add_argument('--site', default='sc-domain:rrmacademy.org')
    args = ap.parse_args()

    end = args.end or (date.today() - timedelta(days=1)).isoformat()
    start = args.start or (date.fromisoformat(end) - timedelta(days=6)).isoformat()

    token = subprocess.check_output(
        ['gcloud', 'auth', 'application-default', 'print-access-token'], text=True
    ).strip()

    url = f'https://searchconsole.googleapis.com/webmasters/v3/sites/{args.site.replace(":", "%3A")}/searchAnalytics/query'
    body = {
        'startDate': start,
        'endDate': end,
        'dimensions': ['page'],
        'rowLimit': args.rows,
    }
    req = request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'X-Goog-User-Project': 'rrm-academy',
        },
        method='POST',
    )
    try:
        with request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        rows = data.get('rows', [])
        out = [
            {
                'page': r['keys'][0],
                'clicks': r['clicks'],
                'impressions': r['impressions'],
                'ctr': r['ctr'],
                'position': r['position'],
            }
            for r in rows
        ]
        json.dump(
            {'period': {'start': start, 'end': end}, 'total_pages': len(out), 'pages': out},
            sys.stdout,
            indent=2,
        )
    except Exception as e:
        print(f'GSC query failed: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
