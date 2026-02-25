# Google Meet Recording Pipeline — Design Document

**Goal:** Automatically detect new Google Meet call recordings, upload them to Cloudflare Stream, extract Gemini notes and chat transcripts, and create community posts for STUC members.

**Status:** Approved design — implementation is Task 8 of the Vimeo-to-Stream migration plan.

---

## 1. Google Meet Output Analysis

Every Google Meet call with recording enabled produces up to three files in the designated Drive folder:

| File Type | MIME Type | Naming Pattern | Typical Size |
|-----------|-----------|----------------|-------------|
| Recording | `video/mp4` | `[Title] - Recording.mp4` | 200 MB -- 2 GB |
| Gemini Notes | Google Doc | `[Title] - Notes by Gemini` | N/A (native Doc) |
| Chat Transcript | Plain text | `[Title] - Chat Transcript.txt` or `[Title] - Chat.txt` | 1 -- 50 KB |

**Titled meetings** (e.g., "STUC Monthly Call") produce files like:
- `STUC Monthly Call - Recording.mp4`
- `STUC Monthly Call - Notes by Gemini`
- `STUC Monthly Call - Chat Transcript.txt`

**Untitled meetings** use the auto-generated meeting code as the title:
- `axe-fhqv-jcv - Recording.mp4`
- `axe-fhqv-jcv - Notes by Gemini`

**File grouping strategy:** Strip known suffixes (` - Recording`, ` - Notes by Gemini`, ` - Chat Transcript`, ` - Chat`) to recover the shared title prefix. All files from the same call share this prefix.

**Drive folder ID:** `1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf`

All recordings land in this single folder. No subfolders.

---

## 2. Pipeline Architecture

```
Google Drive (Meet folder: 1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf)
    |  new MP4 detected
    v
n8n Workflow (n8n.rrmacademy.org)
    |
    +-- 1. Detect new recording
    +-- 2. Wait 5 min (Gemini notes lag behind the recording)
    +-- 3. Fetch sibling files (notes + chat)
    +-- 4. Extract text from Gemini Doc + chat
    +-- 5. Upload MP4 to Cloudflare Stream
    +-- 6. Trigger AI caption generation
    +-- 7. Create community post (D1 via CF API)
    +-- 8. Update matching event post resource_url
    +-- 9. Send notification (optional)
```

The pipeline is event-driven: a new MP4 appearing in the Drive folder triggers the entire chain. A daily reconciliation poll acts as a safety net for missed triggers.

---

## 3. n8n Workflow Design

### Node 1: Trigger — Google Drive Watch

- **Type:** Google Drive Trigger
- **Config:** Watch folder `1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf` for new files
- **Poll interval:** Every 5 minutes
- **Output:** File metadata (id, name, mimeType, createdTime)

### Node 2: Filter — MP4 Only

- **Type:** IF node
- **Condition:** `mimeType === 'video/mp4'`
- **Purpose:** Ignore Gemini Docs and chat files that also appear in the folder. The recording is the canonical trigger; siblings are fetched in a later step.

### Node 3: Dedup — Skip Already-Processed

- **Type:** Code node
- **Logic:** Check the file ID against n8n static data (`$getWorkflowStaticData('global')`). If already processed, stop. Otherwise, add the file ID to the processed set.
- **Why here:** Prevents re-processing if the trigger fires twice for the same file, or during daily reconciliation.

### Node 4: Wait — Gemini Notes Lag

- **Type:** Wait node
- **Duration:** 5 minutes
- **Reason:** Gemini notes are generated asynchronously after the recording saves. They typically appear within 2--3 minutes but can take longer.

### Node 5: List Siblings — Find Related Files

- **Type:** Google Drive Search
- **Query:** Search folder `1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf` for files whose name starts with the meeting title prefix (extracted by stripping ` - Recording` from the MP4 filename).
- **Output:** Array of sibling files (0--2 results: Gemini Doc, chat transcript, or both).

### Node 6: Read Notes — Export Gemini Doc

- **Type:** Google Drive (download/export)
- **Config:** Export as `text/plain` (Google Docs export MIME type)
- **Condition:** Only runs if a Gemini notes Doc was found in Node 5
- **Output:** Plain text of the meeting notes

### Node 7: Read Chat — Download Transcript

- **Type:** Google Drive (download file)
- **Config:** Download as-is (already plain text)
- **Condition:** Only runs if a chat transcript was found in Node 5
- **Output:** Raw chat text

### Node 8: Code — Parse and Format

- **Type:** Code node
- **Input:** MP4 filename, notes text (or null), chat text (or null)
- **Logic:**
  1. Extract meeting title by stripping ` - Recording` suffix
  2. Parse date from file `createdTime`
  3. Format the post body as markdown:

```javascript
const title = mp4Name.replace(/ - Recording\.mp4$/i, '');
const date = new Date(createdTime).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric'
});

let body = '';
if (notesText) {
  body += `## Meeting Notes\n\n${notesText}\n\n`;
}
if (chatText) {
  body += `---\n\n## Chat Highlights\n\n${chatText}`;
}

return {
  meetingTitle: title,
  formattedDate: date,
  postTitle: `Recording: ${title} — ${date}`,
  postBody: body.trim()
};
```

### Node 9: Upload to Stream

- **Type:** Execute Command node (preferred) or HTTP Request with tus protocol
- **Command:** Runs the upload script from Task 7 of the migration plan on the n8n droplet:
  ```bash
  node /opt/scripts/upload-to-stream.js \
    --file "/tmp/{{mp4_file}}" \
    --name "{{meetingTitle}} — {{formattedDate}}"
  ```
- **Alternative (HTTP):** Direct tus upload via HTTP Request node to `https://api.cloudflare.com/client/v4/accounts/{account_id}/stream` with the API token in headers
- **Output:** Stream video UID

### Node 10: Caption Generation

- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/{video_uid}/captions/en`
- **Headers:** `Authorization: Bearer {STREAM_API_TOKEN}`
- **Body:** `{ "model": "automatic" }`
- **Purpose:** Triggers Cloudflare's AI-generated captions. Runs asynchronously; no need to wait for completion.

### Node 11: D1 Insert — Create Community Post

- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query`
- **Headers:** `Authorization: Bearer {D1_API_TOKEN}`
- **Body:**
  ```json
  {
    "sql": "INSERT INTO community_post (id, author_id, type, title, body, resource_url, created_at, updated_at) VALUES (?, ?, 'resource', ?, ?, ?, datetime('now'), datetime('now'))",
    "params": ["{generated_uuid}", "system-automation", "{postTitle}", "{postBody}", "https://rrmacademy.org/community/recordings/{stream_uid}"]
  }
  ```

### Node 12: Event Update — Link Recording to Event Post

- **Type:** HTTP Request
- **Method:** POST
- **URL:** Same D1 API endpoint
- **Body:**
  ```json
  {
    "sql": "UPDATE community_post SET resource_url = ? WHERE type = 'event' AND title LIKE ? AND resource_url IS NULL ORDER BY created_at DESC LIMIT 1",
    "params": ["https://rrmacademy.org/community/recordings/{stream_uid}", "%{meetingTitle}%"]
  }
  ```
- **Purpose:** If a staff member created an event post for this call beforehand, this backfills the recording URL so the events view shows the recording link for past events.

### Node 13: Notification (Optional)

- **Type:** HTTP Request or email node
- **Purpose:** Notify a Slack channel or send an email confirming the recording was processed. Low priority; implement when the rest is stable.

---

## 4. Community Post Format

The pipeline creates a `resource`-type community post with this structure:

```json
{
  "id": "rec_2026-02-25_stuc-monthly-call",
  "author_id": "system-automation",
  "type": "resource",
  "title": "Recording: STUC Monthly Call — February 25, 2026",
  "body": "## Meeting Notes\n\n[Gemini notes text]\n\n---\n\n## Chat Highlights\n\n[Chat transcript text]",
  "resource_url": "https://rrmacademy.org/community/recordings/abc123def456",
  "pinned": 0,
  "event_date": null,
  "event_link": null,
  "created_at": "2026-02-25T19:00:00Z",
  "updated_at": "2026-02-25T19:00:00Z"
}
```

The `resource_url` points to a page route (`/community/recordings/[stream-uid]`) that embeds the Cloudflare Stream player. Members see the video, AI-generated captions, meeting notes, and chat transcript all in one view.

When Gemini notes or chat are unavailable, those sections are simply omitted from the body. The recording itself is the minimum viable post.

---

## 5. System User

Automated posts need an author. Rather than attributing them to Brian's account, create a dedicated system user:

```sql
INSERT INTO user (id, email, name, first_name, last_name, role)
VALUES (
  'system-automation',
  'system@rrmacademy.org',
  'RRM Academy',
  'RRM',
  'Academy',
  'admin'
);
```

| Field | Value |
|-------|-------|
| `id` | `system-automation` |
| `name` | `RRM Academy` |
| `email` | `system@rrmacademy.org` |
| `role` | `admin` |

This user appears as the author on automated community posts. The `admin` role allows it to create `resource`-type posts (which require `admin` per the permission matrix). It has no password, no Stripe customer, and no session -- it exists only as a foreign key target for `community_post.author_id`.

---

## 6. File Grouping Algorithm

Matching related files from the same meeting call:

### Step 1: Extract the Title Prefix

Strip known suffixes from the filename, in order:

```
 - Recording.mp4
 - Recording
 - Notes by Gemini
 - Chat Transcript.txt
 - Chat Transcript
 - Chat.txt
 - Chat
```

What remains is the meeting title prefix. Examples:

| Filename | Stripped Title |
|----------|---------------|
| `STUC Monthly Call - Recording.mp4` | `STUC Monthly Call` |
| `STUC Monthly Call - Notes by Gemini` | `STUC Monthly Call` |
| `STUC Monthly Call - Chat Transcript.txt` | `STUC Monthly Call` |
| `axe-fhqv-jcv - Recording.mp4` | `axe-fhqv-jcv` |

### Step 2: Match by Prefix

Query Google Drive for all files in the recordings folder whose name starts with the extracted prefix. This returns the recording, notes, and chat files as a group.

### Step 3: Handle Untitled Meetings

Untitled meetings use auto-generated codes (e.g., `axe-fhqv-jcv`) that are unique per call, so prefix matching works the same way.

If prefix matching fails (edge case: the title was changed after recording), fall back to timestamp proximity -- files created within 30 minutes of the MP4 are likely from the same call.

### Chat Suffix Inconsistency

Google Meet uses both ` - Chat` and ` - Chat Transcript` as suffixes. The stripping logic must handle both. Order matters: strip ` - Chat Transcript` before ` - Chat` to avoid leaving ` Transcript` behind.

---

## 7. Failure Handling

### Gemini Notes Not Ready After 5 Minutes

- **First retry:** Wait an additional 10 minutes, then re-check for the notes Doc.
- **Final fallback:** After 15 minutes total, proceed without notes. Create the community post with just the recording and chat (if available). The notes can be manually added later by editing the post.

### Upload to Stream Fails

- **Retry:** n8n's built-in retry mechanism -- 3 attempts with exponential backoff (1 min, 5 min, 15 min).
- **After 3 failures:** Log the error, mark the file ID as `failed` in static data (not `processed`), and continue. The daily reconciliation will pick it up for another attempt.

### D1 Insert Fails

- **Retry:** 3 attempts with exponential backoff.
- **After 3 failures:** The Stream upload already succeeded, so the video exists. Log the error. Manual intervention: create the community post through the admin UI using the Stream UID from the logs.

### Daily Reconciliation

A scheduled workflow (cron trigger, runs at 06:00 UTC) acts as a safety net:

1. List all MP4 files in the recordings folder
2. Compare against the processed file IDs in n8n static data
3. For any unprocessed files, run them through the full pipeline
4. For any `failed` files, retry once

This catches files missed due to trigger downtime, transient errors, or n8n restarts.

---

## 8. Prerequisites

All of these must be in place before the pipeline workflow is built:

| Prerequisite | Dependency | Status |
|-------------|------------|--------|
| Cloudflare Stream enabled on account | Migration plan Task 1 | Pending |
| Stream API token (upload + captions scopes) | Cloudflare dashboard | Pending |
| Cloudflare API token with D1 write | Cloudflare dashboard | Pending |
| n8n Google Drive credentials (with Docs read scope) | n8n.rrmacademy.org | Pending |
| Upload script deployed to n8n droplet | Migration plan Task 7 | Pending |
| `system-automation` user in D1 | Section 5 of this doc | Pending |
| `community_post` table in D1 | Community plan Task 1 | Pending |
| Recording player page route (`/community/recordings/[uid]`) | Community implementation | Pending |

---

## 9. Manual Fallback

When n8n is down, the automation quota is exhausted, or a recording needs immediate processing:

**Step 1: Download the MP4**

Download the recording from Google Drive to a local machine or the n8n droplet.

**Step 2: Upload to Cloudflare Stream**

```bash
node upload-to-stream.js --file "STUC Monthly Call - Recording.mp4" --name "STUC Monthly Call — February 25, 2026"
```

Note the Stream UID from the output.

**Step 3: Trigger Captions**

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/{uid}/captions/en" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"model":"automatic"}'
```

**Step 4: Create the Community Post**

Use the community admin UI at `/community` (logged in as staff) to create a new Resource post:
- **Title:** `Recording: STUC Monthly Call — February 25, 2026`
- **Body:** Paste Gemini notes and chat transcript (copy from Google Drive)
- **Resource URL:** `https://rrmacademy.org/community/recordings/{uid}`

**Step 5: Mark as Processed**

If the automation resumes later, add the Google Drive file ID to n8n's static data to prevent duplicate processing. This can be done via the n8n UI by editing the workflow's static data directly.
