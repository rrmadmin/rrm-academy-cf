#!/usr/bin/env node
/**
 * Phase U — Upload STUC recordings from Drive to Cloudflare Stream
 *           + export Gemini transcripts as markdown for Phase D ingestion.
 *
 * One-shot script. Brian invokes manually:
 *
 *   export CLOUDFLARE_ACCOUNT_ID=$(op read 'op://Automation/<redacted>/credential')
 *   node scripts/upload-stuc-recordings.mjs
 *
 *   # Or to skip a course:
 *   SKIP=functional-lab-testing-napro,aip-diet-inflammation node scripts/upload-stuc-recordings.mjs
 *
 * Auth (auto-resolved):
 *   gcloud auth application-default print-access-token       — Drive
 *   op read 'op://Automation/<redacted>/credential' — CF Stream
 *
 * Outputs:
 *   /tmp/stuc-uploads/<courseId>.mp4        downloaded MP4 (kept for retry)
 *   /tmp/stuc-stream-uids.json              { courseId: { streamUid, durationSeconds, thumbnailUrl } }
 *   /tmp/stuc-transcripts/<courseId>.md     formatted Gemini transcript
 *
 * Idempotent: skips an MP4 if its courseId already has a streamUid in the
 * UIDs file; skips a transcript if the .md already exists. Delete the per-file
 * artifact to force a re-run.
 *
 * Plan reference: ~/.claude/plans/lets-make-a-plan-joyful-nebula.md (Phase U).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const COURSES = [
  { id: 'hormones-through-the-lifespan', mp4FileId: '1icG_wcRx6effYoQMELhtboFtMj685R6h', transcriptDocId: '1K2IKgDMl6jDDzmK1mcHivfdk7zzSAbBvZysFR1jVIrM' },
  { id: 'pelvic-floor-rehabilitation', mp4FileId: '1N3-54obYRIMV-kPL-31xnR3-Xkt5x_vi', transcriptDocId: '1VpUba2GrTPA79ARVjxYwBj1-En7UAFFgIw5UFnJkIUk' },
  { id: 'infertility-existential-trauma', mp4FileId: '1MhXc4yewhqSgkuQeAPEEcXagauxSzxPs', transcriptDocId: '1LHXr6S7Sfn5Mo_aX1MRKuN35rk86LhUSQs9HAHqe2ao' },
  { id: 'fertility-based-family-planning', mp4FileId: '1kOTmozQBINWeW4ucDIUcojjnEFdf9oeD', transcriptDocId: '1WbjPZ6yE3sling5brMyiQx1fRRA4TotiMWqwoxM3zR8' },
  { id: 'aip-diet-inflammation', mp4FileId: '13-lXiw45KsetUAkwT49zbPYkRP8AAqgh', transcriptDocId: '1Cz62CvFzrO6Hjp1u8NZ9sD38zRfTTxP3Ja9H3dYTp0Y' },
  { id: 'functional-lab-testing-napro', mp4FileId: null, transcriptDocId: '1ln6g4BFS7s4AkrbPYxUMWtsflUIMiFrdcN5j9_lkbMg' },
];

const TMP = '/tmp';
const UPLOAD_DIR = `${TMP}/stuc-uploads`;
const TRANSCRIPT_DIR = `${TMP}/stuc-transcripts`;
const UIDS_FILE = `${TMP}/stuc-stream-uids.json`;
const CHUNK_SIZE = 50 * 1024 * 1024;
const READY_TIMEOUT_MS = 10 * 60 * 1000;

function shell(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function loadUids() {
  if (!fs.existsSync(UIDS_FILE)) return {};
  return JSON.parse(fs.readFileSync(UIDS_FILE, 'utf8'));
}

function saveUids(map) {
  fs.writeFileSync(UIDS_FILE, JSON.stringify(map, null, 2) + '\n');
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function driveDownload(fileId, driveToken, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    console.log(`  [skip] ${path.basename(destPath)} already on disk (${fmtBytes(fs.statSync(destPath).size)})`);
    return;
  }
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${driveToken}`, 'x-goog-user-project': 'rrm-academy' },
  });
  if (!r.ok) throw new Error(`Drive download ${fileId}: HTTP ${r.status} — ${await r.text().catch(() => '')}`);
  console.log(`  [drive] downloading ${fileId} → ${destPath}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(destPath));
  console.log(`  [drive] downloaded ${fmtBytes(fs.statSync(destPath).size)}`);
}

async function tusUpload(filePath, accountId, streamToken) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const totalBytes = stat.size;

  const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${streamToken}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(totalBytes),
      'Upload-Metadata': `name ${Buffer.from(fileName).toString('base64')}`,
    },
  });
  if (createRes.status !== 201) {
    throw new Error(`Stream tus create: HTTP ${createRes.status} — ${await createRes.text().catch(() => '')}`);
  }
  const uploadUrl = createRes.headers.get('Location');
  const uid = createRes.headers.get('stream-media-id');
  if (!uploadUrl || !uid) throw new Error('Stream tus create missing Location / stream-media-id headers');

  const fd = fs.openSync(filePath, 'r');
  let offset = 0;
  try {
    while (offset < totalBytes) {
      const size = Math.min(CHUNK_SIZE, totalBytes - offset);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, offset);
      const patchRes = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${streamToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: buf,
      });
      if (patchRes.status !== 204) {
        throw new Error(`tus PATCH @ offset ${offset}: HTTP ${patchRes.status} — ${await patchRes.text().catch(() => '')}`);
      }
      const newOffset = parseInt(patchRes.headers.get('Upload-Offset') || '0', 10);
      if (newOffset !== offset + size) {
        throw new Error(`tus offset mismatch: expected ${offset + size}, got ${newOffset}`);
      }
      offset = newOffset;
      const pct = (offset / totalBytes * 100).toFixed(1);
      process.stdout.write(`\r  [stream] uploaded ${pct}% (${fmtBytes(offset)} / ${fmtBytes(totalBytes)})`);
    }
  } finally {
    fs.closeSync(fd);
  }
  process.stdout.write('\n');
  return uid;
}

async function pollReady(uid, accountId, streamToken) {
  const start = Date.now();
  let lastStatus = '';
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`, {
      headers: { Authorization: `Bearer ${streamToken}` },
    });
    if (r.ok) {
      const { result } = await r.json();
      if (result?.readyToStream) {
        return {
          uid,
          duration: result.duration ?? 0,
          thumbnail: result.thumbnail ?? null,
          status: result.status?.state ?? 'ready',
        };
      }
      const status = result?.status?.state ?? 'unknown';
      if (status !== lastStatus) {
        console.log(`  [stream] status: ${status}${result?.status?.pctComplete ? ` (${result.status.pctComplete}%)` : ''}`);
        lastStatus = status;
      }
    }
    await new Promise(res => setTimeout(res, 5000));
  }
  throw new Error(`Stream UID ${uid} did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
}

function formatTranscript(raw) {
  let md = raw.replace(/^﻿/, '');
  md = md.replace(/^.*Notes by Gemini.*\n?/im, '');
  md = md.replace(/^([\p{L}][\p{L}\p{M} .'-]{1,80})\s*\((\d{1,2}:\d{2}(?::\d{2})?)\):\s*/gmu, '\n**$1** _($2)_: ');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim() + '\n';
}

async function exportTranscript(docId, driveToken, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`  [skip] transcript ${path.basename(destPath)} already exported`);
    return;
  }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${driveToken}`, 'x-goog-user-project': 'rrm-academy' },
  });
  if (!r.ok) throw new Error(`Export Doc ${docId}: HTTP ${r.status} — ${await r.text().catch(() => '')}`);
  const raw = await r.text();
  const md = formatTranscript(raw);
  fs.writeFileSync(destPath, md);
  console.log(`  [drive] transcript exported (${md.length} chars) → ${destPath}`);
}

async function main() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

  const skip = new Set((process.env.SKIP || '').split(',').map(s => s.trim()).filter(Boolean));

  console.log('Resolving credentials…');
  const driveToken = shell('gcloud auth application-default print-access-token');
  const streamToken = shell(`op read 'op://Automation/<redacted>/credential'`);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    || (() => {
      try { return shell(`op read 'op://Automation/<redacted>/credential'`); }
      catch { throw new Error('Set CLOUDFLARE_ACCOUNT_ID env var (or create 1P item "Cloudflare Account ID")'); }
    })();
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID missing');
  console.log(`  drive token len=${driveToken.length}, stream token len=${streamToken.length}, account=${accountId.slice(0, 8)}…\n`);

  const uids = loadUids();

  for (const c of COURSES) {
    if (skip.has(c.id)) {
      console.log(`[${c.id}] SKIPPED (env)`);
      continue;
    }
    console.log(`\n[${c.id}]`);

    if (c.transcriptDocId) {
      try {
        await exportTranscript(c.transcriptDocId, driveToken, `${TRANSCRIPT_DIR}/${c.id}.md`);
      } catch (err) {
        console.error(`  [transcript] FAIL: ${err.message}`);
      }
    }

    if (!c.mp4FileId) {
      console.log('  [info] no MP4 — Stream upload skipped');
      continue;
    }
    if (uids[c.id]?.streamUid) {
      console.log(`  [skip] already uploaded → ${uids[c.id].streamUid}`);
      continue;
    }

    const mp4Path = `${UPLOAD_DIR}/${c.id}.mp4`;
    try {
      await driveDownload(c.mp4FileId, driveToken, mp4Path);
      console.log('  [stream] tus uploading…');
      const uid = await tusUpload(mp4Path, accountId, streamToken);
      console.log(`  [stream] uid: ${uid}, polling for ready…`);
      const meta = await pollReady(uid, accountId, streamToken);
      uids[c.id] = {
        streamUid: meta.uid,
        durationSeconds: Math.round(meta.duration),
        thumbnailUrl: meta.thumbnail,
      };
      saveUids(uids);
      console.log(`  [done] ${c.id}: uid=${meta.uid}, duration=${meta.duration}s, status=${meta.status}`);
    } catch (err) {
      console.error(`  [video] FAIL: ${err.message}`);
    }
  }

  console.log(`\nUIDs file → ${UIDS_FILE}`);
  console.log(`Transcripts dir → ${TRANSCRIPT_DIR}/`);
  console.log('\nNext: Phase D wiring per course via /courses-update skill.');
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
