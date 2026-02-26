#!/usr/bin/env node
/**
 * STUC Community Post Import Script
 *
 * Parses scraped Wix discussion posts and generates INSERT SQL
 * for community_post and community_comment tables.
 *
 * Usage:
 *   node scripts/import-stuc-posts.mjs > scripts/import-stuc-posts.sql
 */

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const POSTS_FILE = '/Users/brian/Downloads/Here is a summary of all posts scraped from the Save the Uterus Club group discussion page (ordered newest to oldest)_.md';

// ── Author name → D1 user_id mapping ──
const AUTHOR_MAP = {
  'Brian Whittaker': '301eb55c3f388e65f3f42b14e635dc7a',
  'Naomi Whittaker, MD': '710134def83240b7b47b22a9c9579c0c',
  'Naomi Whittaker': '710134def83240b7b47b22a9c9579c0c',
  'RRM Academy': '4d7f0ae529404c359ed5ed597979f451',
  'Lorraine Truman': '5baf84d1ad1b4ac2b4463e4131ab6ae4',
  'Ana Garcia': 'cd71fe5782704012a259c7110458dedf',
  'Rita Johnson': '0b1bca629c734892a437b383abb99757',
  'Victoria Bergin': 'f55028c3b50c41f990d4f8c7086f0857',
  'Hannah Barringer': '47d2b12000714f2583b6eed4a9047fdb',
  'Hannah Barringer, RN, BSN': '47d2b12000714f2583b6eed4a9047fdb',
  'Kelsie Frank': 'f8d67d49d4454242b3fd9490ff3db4bc',
  'Ginny Noce': 'be4f5d800f7743d4b38888cd62a14ebb',
  'Shannon Tarr': 'c1b918b524f241b5ba1e2b63d73a8773',
  'Daniela Castillo': '3b94468c6879478685aa248870191a82',
  'Kelsey Bowen': '37af13fcc4de416f8a7602a01d4f6d9c',
  'Hannah Ducote': '07ea3c422156439a8571dd3a066ed598',
  'Marah Van Diest': '03986543f8fd49a08328ada8a97a54a4',
  'OvaWellness': '8ff76022b5e14be7b6fe6098b4e8a858',
  'Rebecca Vavilov': '8ff76022b5e14be7b6fe6098b4e8a858',
  'k.carithers': '7ed24b6bb6264be3926f13127249a7f4',
  'Kristen Carithers': '7ed24b6bb6264be3926f13127249a7f4',
  'elenaclimov': 'a44412912d6f4d99a94491d563a2ee90',
  'miaranck': 'a77338f8edcf4f8ea0d5dcf99b308f2b',
  'Lauren G': '52444a16bb194bd7a3d628100cf241e7',
  'Lauren Gillissie': '52444a16bb194bd7a3d628100cf241e7',
};

const SYSTEM_ACCOUNT = '4d7f0ae529404c359ed5ed597979f451'; // RRM Academy (admin)

// ── Tag → post type mapping ──
function mapType(tags, title, content) {
  if (!tags && !title && !content) return 'discussion';
  const combined = `${tags || ''} ${title || ''}`.toLowerCase();
  if (combined.includes('live call')) return 'event';
  if (combined.includes('call recording') || combined.includes('call notes') || combined.includes('recording')) return 'resource';
  if (combined.includes('guide')) return 'resource';
  if (content && content.includes('joined the group')) return 'discussion';
  return 'discussion';
}

// ── Parse date strings ──
function parseDate(dateStr) {
  if (!dateStr) return null;
  // Remove parenthetical and "implied from context" notes
  dateStr = dateStr.replace(/\s*\(implied.*?\)/gi, '').replace(/\s*\*.*?\*/g, '').trim();

  // Handle "X days ago (Mon DD, YYYY)"
  const parenMatch = dateStr.match(/\(([A-Za-z]+ \d{1,2},?\s*\d{4})\)/);
  if (parenMatch) dateStr = parenMatch[1];

  // Handle "X days ago" without parenthetical — use Feb 26, 2026 as reference
  if (/^\d+ days? ago/.test(dateStr)) {
    const days = parseInt(dateStr);
    const ref = new Date('2026-02-26');
    ref.setDate(ref.getDate() - days);
    return ref.toISOString().slice(0, 10) + ' 12:00';
  }

  // Try standard date parsing
  // Clean up escapes
  dateStr = dateStr.replace(/\\,/g, ',').replace(/\\/g, '');
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10) + ' 12:00';
  }

  return null;
}

function newId() {
  return randomUUID().replace(/-/g, '');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/'/g, "''");
}

// ── Parse the markdown file ──
function parsePosts(text) {
  const posts = [];

  // Split on "### **Post N**"
  const sections = text.split(/### \*\*Post \d+\*?\*?\s*(?:\(.*?\))?\s*\*?\*?/);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;

    // Extract the main content line (inside ## **...**)
    // The format is: ## **Author: NAME (ROLE) Date: DATE Title: TITLE Content: CONTENT Tag: TAG | Stats: STATS Comment: COMMENTER – "TEXT"**
    let content = section;
    // Remove ## ** prefix and ** suffix
    content = content.replace(/^#+\s*\*\*/, '').replace(/\*\*\s*$/, '');

    // Parse author
    let author = null;
    const authorMatch = content.match(/^Author:\s*(.+?)\s*(?:\([^)]*\))?\s*Date:/);
    if (authorMatch) {
      author = authorMatch[1].trim();
      // Remove role suffixes like (Super Hero), (Club Member), etc.
      author = author.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    // Parse date
    let date = null;
    const dateMatch = content.match(/Date:\s*(.+?)(?:\s*Title:|Content:|Stats:|$)/);
    if (dateMatch) {
      date = parseDate(dateMatch[1].trim());
    }

    // Parse title
    let title = null;
    const titleMatch = content.match(/Title:\s*(.+?)\s*Content:/);
    if (titleMatch) {
      title = titleMatch[1].trim().replace(/\\!/g, '!').replace(/\\\./g, '.').replace(/\\/g, '');
    }

    // Parse body content
    let body = null;
    const contentMatch = content.match(/Content:\s*(.+?)(?:\s*Tag:|Stats:|Comment:)/);
    if (contentMatch) {
      body = contentMatch[1].trim().replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\\!/g, '!').replace(/\\/g, '');
    }

    // Check for "joined the group" pattern
    if (!body && !title && content.includes('joined the group')) {
      const joinMatch = content.match(/Date:\s*(.+?)·?\s*joined the group/);
      if (joinMatch) {
        date = parseDate(joinMatch[1].trim());
      }
      body = `${author || 'Someone'} joined the group.`;
      title = 'Welcome!';
    }

    // If still no body, try to extract from the raw section
    if (!body && !title) {
      const rawContentMatch = content.match(/Content:\s*(.+?)(?:\s*Stats:|$)/);
      if (rawContentMatch) {
        body = rawContentMatch[1].trim().replace(/\\/g, '');
      }
    }

    // Parse tags
    let tags = null;
    const tagMatch = content.match(/Tag:\s*(.+?)\s*\|/);
    if (tagMatch) {
      tags = tagMatch[1].trim();
    }

    // Parse comments
    const comments = [];
    const commentParts = content.split(/Comment:\s*/);
    for (let j = 1; j < commentParts.length; j++) {
      let commentText = commentParts[j].trim();
      // Remove trailing **
      commentText = commentText.replace(/\*\*\s*$/, '').trim();

      // Parse commenter name and text
      const commentMatch = commentText.match(/^(.+?)\s*–\s*(.+)/s);
      if (commentMatch) {
        let commenterName = commentMatch[1].trim().replace(/\\/g, '');
        let commentBody = commentMatch[2].trim().replace(/^"/, '').replace(/"$/, '').replace(/\\!/g, '!').replace(/\\/g, '');
        comments.push({ author: commenterName, text: commentBody });
      }
    }

    // Determine post type
    const type = mapType(tags, title, body);

    // Extract event link (Google Meet)
    let eventLink = null;
    let eventDate = null;
    if (type === 'event') {
      const meetMatch = (body || '').match(/(https:\/\/meet\.google\.com\/[a-z-]+)/);
      if (meetMatch) eventLink = meetMatch[1];
      // Event date is the post date for live calls
      eventDate = date;
    }

    // Extract resource URL (Google Docs, YouTube, Spotify)
    let resourceUrl = null;
    if (type === 'resource') {
      const urlMatch = (body || '').match(/(https:\/\/(?:docs\.google\.com|youtu\.be|drive\.google\.com|open\.spotify\.com)[^\s)]+)/);
      if (urlMatch) resourceUrl = urlMatch[1];
    }

    posts.push({
      postNum: i,
      author,
      authorId: author ? (AUTHOR_MAP[author] || null) : null,
      date,
      title: title || (type === 'event' ? 'Live Call' : (type === 'resource' ? 'Recording & Notes' : 'Discussion')),
      body: body || '',
      type,
      tags,
      eventLink,
      eventDate,
      resourceUrl,
      pinned: i === 73 ? 1 : 0, // Pin the welcome post
      comments,
    });
  }

  return posts;
}

// ── Main ──
const text = readFileSync(POSTS_FILE, 'utf8');
const posts = parsePosts(text);

// Generate SQL
const out = process.stdout;
out.write('-- STUC community post import — generated ' + new Date().toISOString() + '\n');
out.write('-- ' + posts.length + ' posts from Wix Save the Uterus Club discussion\n\n');

let postCount = 0;
let commentCount = 0;
let unmatchedAuthors = new Set();

for (const post of posts) {
  const postId = newId();
  const authorId = post.authorId || SYSTEM_ACCOUNT;

  if (!post.authorId && post.author) {
    unmatchedAuthors.add(post.author);
    // Prepend original author name to body for unmatched authors
    post.body = `[Originally posted by ${post.author}]\n\n${post.body}`;
  }

  out.write(`-- Post ${post.postNum}: ${esc(post.title?.slice(0, 60) || '(no title)')}\n`);
  out.write(`INSERT OR IGNORE INTO community_post (id, author_id, type, title, body, pinned, event_date, event_link, resource_url, created_at, updated_at, channel) VALUES (\n`);
  out.write(`  '${postId}',\n`);
  out.write(`  '${authorId}',\n`);
  out.write(`  '${post.type}',\n`);
  out.write(`  '${esc(post.title || '')}',\n`);
  out.write(`  '${esc(post.body)}',\n`);
  out.write(`  ${post.pinned},\n`);
  out.write(`  ${post.eventDate ? `'${post.eventDate}'` : 'NULL'},\n`);
  out.write(`  ${post.eventLink ? `'${esc(post.eventLink)}'` : 'NULL'},\n`);
  out.write(`  ${post.resourceUrl ? `'${esc(post.resourceUrl)}'` : 'NULL'},\n`);
  out.write(`  '${post.date || '2025-06-28 12:00'}',\n`);
  out.write(`  '${post.date || '2025-06-28 12:00'}',\n`);
  out.write(`  'stuc'\n`);
  out.write(`);\n\n`);
  postCount++;

  // Generate comment INSERTs
  for (const comment of post.comments) {
    const commentId = newId();
    let commentAuthorId = SYSTEM_ACCOUNT;
    const commentAuthorName = comment.author.replace(/\s*\([^)]*\)\s*$/, '').trim();

    if (AUTHOR_MAP[commentAuthorName]) {
      commentAuthorId = AUTHOR_MAP[commentAuthorName];
    } else {
      // Prepend original author name
      comment.text = `[${commentAuthorName}] ${comment.text}`;
    }

    out.write(`INSERT OR IGNORE INTO community_comment (id, post_id, author_id, content, created_at) VALUES (\n`);
    out.write(`  '${commentId}',\n`);
    out.write(`  '${postId}',\n`);
    out.write(`  '${commentAuthorId}',\n`);
    out.write(`  '${esc(comment.text)}',\n`);
    out.write(`  '${post.date || '2025-06-28 12:00'}'\n`);
    out.write(`);\n\n`);
    commentCount++;
  }
}

// Summary to stderr
const err = process.stderr;
err.write('\n=== STUC Community Import Summary ===\n');
err.write(`Posts parsed:         ${posts.length}\n`);
err.write(`Post INSERTs:         ${postCount}\n`);
err.write(`Comment INSERTs:      ${commentCount}\n`);
err.write(`Unmatched authors:    ${unmatchedAuthors.size}\n`);
if (unmatchedAuthors.size > 0) {
  err.write('\nUnmatched:\n');
  for (const name of unmatchedAuthors) {
    err.write(`  - ${name}\n`);
  }
}
err.write('=====================================\n');
