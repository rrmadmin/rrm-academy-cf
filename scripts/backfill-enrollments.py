#!/usr/bin/env python3
"""
Match Wix course participant CSVs (name-only) to D1 users and generate
INSERT OR IGNORE SQL for missing enrollment records.

Matching strategy:
  1. Exact full name match (case-insensitive)
  2. Username matches email prefix (e.g. "zsluzala" matches "zsluzala@...")
  3. First+Last partial match against D1 first_name/last_name fields
"""

import json
import uuid
import re
from pathlib import Path

# --- Load D1 data ---
with open("/tmp/d1_enrollments.json") as f:
    d1_enrollments = json.load(f)

with open("/tmp/d1_users.json") as f:
    d1_users = json.load(f)

# Build indexes
enrolled = set()  # (email, course_id) pairs
for e in d1_enrollments:
    enrolled.add((e["email"].lower().strip(), e["course_id"]))

# User indexes for matching
by_name = {}       # lowered full name -> list of user dicts
by_email_prefix = {}  # email prefix (before @) -> list of user dicts
by_first_last = {}    # (first, last) -> list of user dicts

for u in d1_users:
    email = (u["email"] or "").lower().strip()
    name = (u["name"] or "").lower().strip()
    first = (u["first_name"] or "").lower().strip()
    last = (u["last_name"] or "").lower().strip()
    u["_email"] = email

    if name:
        by_name.setdefault(name, []).append(u)
    if email:
        prefix = email.split("@")[0]
        by_email_prefix.setdefault(prefix, []).append(u)
    if first and last:
        by_first_last.setdefault((first, last), []).append(u)

SKIP_NAMES = {
    "rrm academy administrator", "brian whittaker", "brian whittak",
    "naomi whittaker", "device"
}

# Manual overrides from enrich-progress.mjs + newly resolved matches
MANUAL_OVERRIDES = {
    "Maggie McCarthy": "maggievdb@gmail.com",
    "Kendal Fraser - Reproductive Health Education": "kendalfertility@gmail.com",
    "Pam Schoenfeld": "womenfamilynutrition@gmail.com",
    "Lauren Gillissie": "degra1lm@gmail.com",
    "Kimberly Camosse": "kim.naprodr@gmail.com",
    "stephaniforg": "stephanieforg@gmail.com",
    "chu.lindsa yn": "chu.lindsayn@gmail.com",
    "mary.g.bruno": "marybrunocrms@gmail.com",
    "Laura Golden": None,  # no D1 account with that name
    "Ashley Klein": None,  # no confident match
    "Marvelous odunayo WixTv": None,  # spam/bot
    "neeraj Kumar": None,  # no D1 account
    "daniell132": None,  # ignore per enrich script
    "Galaxie _": None,  # no match
    "Christine Obeid": None,  # no match
    "Shae Diller": None,  # no confident match (Alexis Diller is different person)
    "Amanda Mucek": None,  # no confident match
}

def match_user(wix_name):
    """Try to match a Wix display name to a D1 user. Returns (email, method) or (None, None)."""
    name_lower = wix_name.lower().strip()

    if name_lower in SKIP_NAMES:
        return None, "skip"

    # Check manual overrides first
    if wix_name in MANUAL_OVERRIDES:
        email = MANUAL_OVERRIDES[wix_name]
        if email is None:
            return None, "skip_manual"
        return email, "manual"

    # 1. Exact full name match
    if name_lower in by_name:
        candidates = by_name[name_lower]
        if len(candidates) == 1:
            return candidates[0]["_email"], "exact_name"

    # 2. Username → email prefix (for handles like "zsluzala", "kimNP")
    # Only try if name has no spaces (looks like a username)
    if " " not in name_lower:
        if name_lower in by_email_prefix:
            candidates = by_email_prefix[name_lower]
            if len(candidates) == 1:
                return candidates[0]["_email"], "email_prefix"

    # 3. Split "First Last" and match against first_name + last_name
    parts = wix_name.strip().split()
    if len(parts) >= 2:
        first = parts[0].lower()
        last = parts[-1].lower()
        key = (first, last)
        if key in by_first_last:
            candidates = by_first_last[key]
            if len(candidates) == 1:
                return candidates[0]["_email"], "first_last"

    # 4. Try username with dots/underscores as email prefix
    if " " not in name_lower:
        # Try common patterns: username, username with dots
        for prefix, users in by_email_prefix.items():
            if prefix == name_lower or prefix.replace(".", "") == name_lower.replace(".", ""):
                if len(users) == 1:
                    return users[0]["_email"], "prefix_fuzzy"

    return None, "no_match"


# --- Parse Wix CSVs ---
wix_courses = {
    "rrm-vs-ivf": Path.home() / "Downloads/course participants - rrm vs ivf.csv",
    "masterclass-endo-surgery": Path.home() / "Downloads/course participants - masterclass.csv",
    "long-term-endo": Path.home() / "Downloads/course participants - long term endo.csv",
    "postpartum": Path.home() / "Downloads/course participants - PPD and Anxiety.csv",
}

def parse_wix_csv(path):
    participants = []
    with open(path) as f:
        for line in f:
            line = line.strip().strip('"')
            parts = line.split(",")
            if len(parts) < 3:
                continue
            try:
                int(parts[0])
            except ValueError:
                continue
            name = parts[1].strip()
            participants.append(name)
    return participants


# --- Generate SQL ---
sql_lines = []
sql_lines.append("-- Backfill missing enrollment records from Wix participant CSVs")
sql_lines.append(f"-- Generated {__import__('datetime').datetime.now().isoformat()}")
sql_lines.append("")

total_inserts = 0
total_already = 0
total_skipped = 0
total_unmatched = 0
unmatched_report = {}

for course_id, csv_path in wix_courses.items():
    if not csv_path.exists():
        continue

    participants = parse_wix_csv(csv_path)
    course_inserts = 0
    course_already = 0
    course_unmatched = []

    sql_lines.append(f"-- === {course_id} ({len(participants)} Wix participants) ===")

    for name in participants:
        email, method = match_user(name)

        if method == "skip":
            total_skipped += 1
            continue

        if email is None:
            course_unmatched.append(name)
            total_unmatched += 1
            continue

        # Check if already enrolled
        if (email, course_id) in enrolled:
            course_already += 1
            total_already += 1
            continue

        # Generate INSERT
        eid = uuid.uuid4().hex
        escaped_email = email.replace("'", "''")
        sql_lines.append(
            f"INSERT OR IGNORE INTO enrollment (id, user_id, course_id, enrolled_at) "
            f"VALUES ('{eid}', (SELECT id FROM user WHERE email = '{escaped_email}'), "
            f"'{course_id}', datetime('now')); "
            f"-- {name} → {email} ({method})"
        )
        enrolled.add((email, course_id))  # prevent dupes across courses
        course_inserts += 1
        total_inserts += 1

    sql_lines.append(f"-- {course_id}: {course_inserts} new, {course_already} already enrolled, {len(course_unmatched)} unmatched")
    sql_lines.append("")

    if course_unmatched:
        unmatched_report[course_id] = course_unmatched

# Summary
sql_lines.insert(2, f"-- Total: {total_inserts} INSERTs, {total_already} already enrolled, {total_skipped} skipped (admin), {total_unmatched} unmatched")

print("\n".join(sql_lines))

# Print unmatched report to stderr
import sys
if unmatched_report:
    print("\n\n=== UNMATCHED (no D1 account found) ===", file=sys.stderr)
    for cid, names in unmatched_report.items():
        print(f"\n{cid}:", file=sys.stderr)
        for n in names:
            print(f"  - {n}", file=sys.stderr)
    print(f"\nTotal unmatched: {total_unmatched}", file=sys.stderr)
