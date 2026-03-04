# What-is-RRM Live Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated editor page at `/what-is-rrm/edit` where Naomi can visually edit the what-is-rrm pillar page content, with changes persisting to a JSON data file on disk.

**Architecture:** Extract the 2182-line static `.astro` page content into a structured JSON file. Refactor the Astro page to render from JSON using `set:html`. Build a dedicated editor page with section-level rich text editing, drag-to-reorder, add/remove sections, and a local API endpoint that writes JSON back to disk. Editor is dev-server-only (localhost).

**Tech Stack:** Astro 5 (SSG), vanilla JS + contentEditable for rich text, SortableJS (CDN) for drag-to-reorder, Node.js fs for API writes, cheerio for one-time HTML extraction.

---

## Task 1: Install cheerio and write the content extraction script

**Files:**
- Modify: `package.json` (add cheerio devDependency)
- Create: `scripts/extract-what-is-rrm.mjs`

**Step 1: Install cheerio**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm install --save-dev cheerio
```

**Step 2: Write the extraction script**

Create `scripts/extract-what-is-rrm.mjs`. This script:
1. Reads `src/pages/what-is-rrm/index.astro`
2. Extracts the HTML between `<article class="prose">` and `</article>`
3. Parses with cheerio
4. Splits content into sections at each `<h2>` boundary
5. Extracts FAQ `<details>` items into a separate array
6. Extracts references `<ol>` items into a separate array
7. Extracts CTA box
8. Writes `src/data/what-is-rrm.json`

```js
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { load } from 'cheerio';

const src = readFileSync('src/pages/what-is-rrm/index.astro', 'utf-8');

// Extract the article HTML (between <article class="prose"> and </article>)
const articleMatch = src.match(/<article class="prose">([\s\S]*?)<\/article>/);
if (!articleMatch) throw new Error('Could not find <article class="prose">');

const $ = load(articleMatch[1], { decodeEntities: false });

// --- Extract meta from frontmatter ---
const titleMatch = src.match(/headline:\s*'([^']+)'/);
const descMatch = src.match(/description:\s*\n\s*'([^']+)'/);

const meta = {
  title: titleMatch?.[1] || 'What is Restorative Reproductive Medicine (RRM)?',
  description: descMatch?.[1] || '',
  author: 'Naomi Whittaker, MD',
  authorTitle: 'Board-Certified OBGYN and NaProTechnology Fellow',
  publishDate: '2026-03-01',
  modifiedDate: new Date().toISOString().slice(0, 10),
};

// --- Extract TOC titles from desktop nav ---
const tocMatch = src.match(/<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/);
const $toc = load(tocMatch?.[1] || '', { decodeEntities: false });
const tocMap = {};
$toc('a').each((_, el) => {
  const href = $toc(el).attr('href')?.replace('#', '');
  if (href) tocMap[href] = $toc(el).text().trim();
});

// --- Extract sections ---
// Strategy: walk top-level children of article. Group by h2 boundaries.
const sections = [];
let currentSection = null;

// First, handle the tldr aside which comes before the first h2
const tldr = $('aside.tldr');
if (tldr.length) {
  const h2 = tldr.find('h2');
  const id = h2.attr('id') || 'key-takeaways';
  const title = h2.text().trim();
  h2.remove(); // remove heading from content
  sections.push({
    id,
    title,
    tocTitle: tocMap[id] || title,
    type: 'tldr',
    content: tldr.html().trim(),
  });
  tldr.remove();
}

// Walk remaining top-level elements
const articleChildren = $('body').children(); // cheerio wraps in body
articleChildren.each((_, el) => {
  const $el = $(el);
  const tag = el.tagName?.toLowerCase();

  // Skip already-processed tldr
  if ($el.hasClass('tldr')) return;

  // Skip FAQ section (handled separately)
  if ($el.hasClass('faq-list')) return;

  // Skip references section (handled separately)
  if ($el.hasClass('references')) return;

  // Skip CTA box (handled separately)
  if ($el.hasClass('cta-box')) return;

  if (tag === 'h2') {
    // Start new section
    if (currentSection) {
      sections.push(currentSection);
    }
    const id = $el.attr('id') || '';
    const title = $el.text().trim();
    currentSection = {
      id,
      title,
      tocTitle: tocMap[id] || title,
      type: 'section',
      content: '',
    };
  } else if (currentSection) {
    // Append to current section
    currentSection.content += $.html($el);
  }
  // else: content before first h2 that isn't tldr (unlikely, skip)
});
if (currentSection) sections.push(currentSection);

// Clean up section content (trim whitespace)
sections.forEach(s => {
  s.content = s.content.trim();
});

// --- Extract FAQ ---
const faq = [];
$('.faq-list details').each((_, el) => {
  const $el = $(el);
  const question = $el.find('summary').text().trim();
  const answerDiv = $el.find('.faq-answer');
  faq.push({
    question,
    answer: answerDiv.html()?.trim() || '',
  });
});

// --- Extract references ---
const references = [];
$('.references ol li').each((i, el) => {
  references.push({
    id: i + 1,
    html: $(el).html().trim(),
  });
});

// --- Extract CTA ---
const ctaBox = $('.cta-box');
const cta = {
  heading: ctaBox.find('h3').text().trim(),
  buttons: [],
};
ctaBox.find('a.btn').each((_, el) => {
  const $a = $(el);
  cta.buttons.push({
    text: $a.text().trim(),
    href: $a.attr('href'),
    style: $a.hasClass('btn--primary') ? 'primary' : 'secondary',
  });
});

// --- Assemble and write ---
const data = { meta, sections, faq, references, cta };

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/what-is-rrm.json', JSON.stringify(data, null, 2));

console.log(`Extracted:`);
console.log(`  ${sections.length} sections`);
console.log(`  ${faq.length} FAQ items`);
console.log(`  ${references.length} references`);
console.log(`  CTA: "${cta.heading}" with ${cta.buttons.length} buttons`);
console.log(`Written to src/data/what-is-rrm.json`);
```

**Step 3: Run extraction**

```bash
cd ~/iCode/projects/rrm-academy-cf && node scripts/extract-what-is-rrm.mjs
```

Expected output: `Extracted: ~15 sections, 24 FAQ items, 39 references, CTA with 3 buttons`

**Step 4: Verify JSON is valid and complete**

```bash
node -e "const d=require('./src/data/what-is-rrm.json'); console.log('Sections:', d.sections.map(s=>s.id).join(', ')); console.log('FAQ:', d.faq.length); console.log('Refs:', d.references.length);"
```

Visually spot-check a few sections to confirm content is intact.

**Step 5: Commit**

```bash
git add scripts/extract-what-is-rrm.mjs src/data/what-is-rrm.json package.json package-lock.json
git commit -m "feat: extract what-is-rrm content to JSON data file"
```

---

## Task 2: Build the API endpoint for saving JSON

**Files:**
- Create: `src/pages/api/what-is-rrm.ts`

**Step 1: Create the API endpoint**

`src/pages/api/what-is-rrm.ts`:

```ts
import type { APIRoute } from 'astro';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const DATA_PATH = join(process.cwd(), 'src/data/what-is-rrm.json');

export const GET: APIRoute = async () => {
  try {
    const data = readFileSync(DATA_PATH, 'utf-8');
    return new Response(data, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to read data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    writeFileSync(DATA_PATH, JSON.stringify(body, null, 2));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to save' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

**Important:** This only works during `astro dev`. In static builds, this endpoint won't exist. That's the intended behavior -- the editor is dev-only.

**Step 2: Verify endpoint works**

Start dev server, then:
```bash
curl -s http://localhost:4321/api/what-is-rrm | node -e "process.stdin.on('data',d=>console.log('sections:',JSON.parse(d).sections.length))"
```

Expected: `sections: 15` (or however many were extracted)

**Step 3: Commit**

```bash
git add src/pages/api/what-is-rrm.ts
git commit -m "feat: add dev-only API endpoint for what-is-rrm content"
```

---

## Task 3: Refactor index.astro to render from JSON

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`
- Reference: `src/data/what-is-rrm.json`

This is the largest task. The goal: replace all hardcoded HTML content in the article body with template loops over the JSON data, while preserving the full `<style>` block and JSON-LD frontmatter unchanged.

**Step 1: Add JSON import to frontmatter**

At the top of the frontmatter (after the BaseLayout import), add:

```ts
import data from '../../data/what-is-rrm.json';
const { meta, sections, faq, references, cta } = data;
```

**Step 2: Replace TOC sections**

Replace both the mobile TOC (`<details class="toc-mobile">`) and desktop TOC (`<nav class="toc">`) `<ol>` contents with:

```astro
<ol>
  {sections.map(s => (
    <li><a href={`#${s.id}`}>{s.tocTitle}</a></li>
  ))}
  {faq.length > 0 && <li><a href="#faq">FAQ</a></li>}
</ol>
```

**Step 3: Replace article body**

Replace everything inside `<article class="prose">` (from the first `<aside class="tldr">` through the closing `</div>` of cta-box) with:

```astro
{sections.map(s => {
  if (s.type === 'tldr') {
    return (
      <aside class="tldr">
        <h2 id={s.id}>{s.title}</h2>
        <Fragment set:html={s.content} />
      </aside>
    );
  }
  return (
    <>
      <h2 id={s.id}>{s.title}</h2>
      <Fragment set:html={s.content} />
    </>
  );
})}

{faq.length > 0 && (
  <>
    <h2 id="faq">Frequently Asked Questions</h2>
    <div class="faq-list">
      {faq.map(item => (
        <details>
          <summary>{item.question}</summary>
          <div class="faq-answer">
            <Fragment set:html={item.answer} />
          </div>
        </details>
      ))}
    </div>
  </>
)}

<section class="references" id="references">
  <h2>References</h2>
  <ol>
    {references.map(ref => (
      <li id={`ref-${ref.id}`}>
        <Fragment set:html={ref.html} />
      </li>
    ))}
  </ol>
</section>

<div class="cta-box">
  <h3>{cta.heading}</h3>
  {cta.buttons.map(btn => (
    <p><a href={btn.href} class={`btn btn--${btn.style}`}>{btn.text}</a></p>
  ))}
</div>
```

**Step 4: Keep everything else unchanged**

- JSON-LD frontmatter: keep as-is (it references section IDs that still exist)
- `<style>` block: keep entire block unchanged
- Breadcrumb, author byline, page-updated: keep as-is
- Pagefind meta: keep as-is

**Step 5: Verify the rendered page matches the original**

```bash
open -a "Comet" "http://localhost:4321/what-is-rrm/"
```

Visually compare. Check:
- All 15 sections render
- TOC links work
- FAQ accordions work
- References numbered correctly
- Charts and data visualizations render
- CTA buttons render
- Mobile TOC works

**Step 6: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "refactor: render what-is-rrm from JSON data file"
```

---

## Task 4: Build the editor page

**Files:**
- Create: `src/pages/what-is-rrm/edit.astro`

This is the core deliverable. A full-page editor at `/what-is-rrm/edit` with:

1. **Section sidebar** (left): draggable list of section titles, add/remove buttons
2. **Editor panel** (center): rich text editing via contentEditable with formatting toolbar
3. **Preview panel** (right): live-rendered preview in an iframe pointing to `/what-is-rrm/`
4. **Tab system**: Sections | FAQ | References | CTA | Meta
5. **Save button**: POST to `/api/what-is-rrm`, triggers iframe reload

**Step 1: Create the editor page**

`src/pages/what-is-rrm/edit.astro`:

The page structure:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Edit: What is RRM? | RRM Academy</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.css" />
</head>
<body>
  <div id="editor-app">
    <!-- Top bar -->
    <header class="editor-bar">
      <div class="editor-bar__left">
        <a href="/what-is-rrm/" class="editor-bar__back">&larr; Back to page</a>
        <h1 class="editor-bar__title">Editing: What is RRM?</h1>
      </div>
      <div class="editor-bar__right">
        <span id="save-status" class="save-status">Loaded</span>
        <button id="btn-save" class="btn-save">Save</button>
      </div>
    </header>

    <!-- Tab navigation -->
    <nav class="editor-tabs">
      <button class="tab active" data-tab="sections">Sections</button>
      <button class="tab" data-tab="faq">FAQ (<span id="faq-count">0</span>)</button>
      <button class="tab" data-tab="references">References (<span id="ref-count">0</span>)</button>
      <button class="tab" data-tab="cta">CTA</button>
      <button class="tab" data-tab="meta">Meta</button>
    </nav>

    <!-- Main editor area -->
    <div class="editor-main">

      <!-- Left: section/item list -->
      <aside class="editor-sidebar" id="sidebar">
        <!-- Populated by JS per active tab -->
      </aside>

      <!-- Center: editing area -->
      <div class="editor-content" id="editor-content">
        <!-- Formatting toolbar -->
        <div class="toolbar" id="toolbar">
          <button data-cmd="bold" title="Bold"><b>B</b></button>
          <button data-cmd="italic" title="Italic"><i>I</i></button>
          <button data-cmd="createLink" title="Link">&#128279;</button>
          <button data-cmd="insertUnorderedList" title="Bullet list">&#8226;</button>
          <button data-cmd="insertOrderedList" title="Numbered list">1.</button>
          <button data-cmd="formatBlock" data-val="h3" title="Heading 3">H3</button>
          <button data-cmd="formatBlock" data-val="h4" title="Heading 4">H4</button>
          <button data-cmd="superscript" title="Superscript">x&sup2;</button>
          <button data-cmd="removeFormat" title="Clear formatting">&times;</button>
          <button id="btn-source" title="Toggle HTML source">&lt;/&gt;</button>
        </div>

        <!-- Rich text area -->
        <div id="editor-field" contenteditable="true" class="editor-field"></div>

        <!-- Source code area (hidden by default) -->
        <textarea id="source-field" class="source-field" style="display:none"></textarea>

        <!-- Section metadata (shown for sections tab) -->
        <div id="section-meta" class="section-meta">
          <label>Section ID: <input type="text" id="meta-id" /></label>
          <label>Title: <input type="text" id="meta-title" /></label>
          <label>TOC Title: <input type="text" id="meta-toc" /></label>
          <label>Type:
            <select id="meta-type">
              <option value="section">Section</option>
              <option value="tldr">TL;DR / Key Takeaways</option>
            </select>
          </label>
        </div>

        <!-- FAQ editor (shown for faq tab) -->
        <div id="faq-meta" class="section-meta" style="display:none">
          <label>Question: <input type="text" id="faq-question" class="faq-question-input" /></label>
        </div>

        <!-- Reference editor (shown for references tab) -->
        <div id="ref-meta" class="section-meta" style="display:none">
          <label>Ref #: <input type="text" id="ref-id" readonly /></label>
        </div>

        <!-- CTA editor (shown for cta tab) -->
        <div id="cta-editor" style="display:none">
          <label>Heading: <input type="text" id="cta-heading" /></label>
          <div id="cta-buttons-list"></div>
          <button id="cta-add-btn" class="btn-add">+ Add Button</button>
        </div>

        <!-- Meta editor (shown for meta tab) -->
        <div id="meta-editor" style="display:none">
          <label>Page Title: <input type="text" id="page-title" /></label>
          <label>Description: <textarea id="page-desc" rows="3"></textarea></label>
          <label>Author: <input type="text" id="page-author" /></label>
          <label>Author Title: <input type="text" id="page-author-title" /></label>
          <label>Publish Date: <input type="date" id="page-pub-date" /></label>
          <label>Modified Date: <input type="date" id="page-mod-date" /></label>
        </div>
      </div>

      <!-- Right: live preview -->
      <div class="editor-preview">
        <iframe id="preview-frame" src="/what-is-rrm/"></iframe>
      </div>

    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
  <script>
    // === STATE ===
    let data = null;
    let activeTab = 'sections';
    let activeIndex = 0;
    let sourceMode = false;
    let dirty = false;

    // === INIT ===
    async function init() {
      const res = await fetch('/api/what-is-rrm');
      data = await res.json();
      renderSidebar();
      selectItem(0);
      updateCounts();
      initSortable();
      initToolbar();
      initTabs();
    }

    // === TABS ===
    function initTabs() {
      document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeTab = btn.dataset.tab;
          activeIndex = 0;
          renderSidebar();
          selectItem(0);
          updateEditorVisibility();
        });
      });
    }

    function updateEditorVisibility() {
      const ef = document.getElementById('editor-field');
      const sf = document.getElementById('source-field');
      const tb = document.getElementById('toolbar');
      const sm = document.getElementById('section-meta');
      const fm = document.getElementById('faq-meta');
      const rm = document.getElementById('ref-meta');
      const ce = document.getElementById('cta-editor');
      const me = document.getElementById('meta-editor');

      // Hide all
      [sm, fm, rm, ce, me].forEach(el => el.style.display = 'none');
      ef.style.display = 'block';
      sf.style.display = 'none';
      tb.style.display = 'flex';
      sourceMode = false;

      if (activeTab === 'sections') sm.style.display = 'flex';
      else if (activeTab === 'faq') fm.style.display = 'flex';
      else if (activeTab === 'references') rm.style.display = 'flex';
      else if (activeTab === 'cta') {
        ef.style.display = 'none';
        tb.style.display = 'none';
        ce.style.display = 'block';
        renderCTAEditor();
      }
      else if (activeTab === 'meta') {
        ef.style.display = 'none';
        tb.style.display = 'none';
        me.style.display = 'block';
        renderMetaEditor();
      }
    }

    // === SIDEBAR ===
    function getItems() {
      if (activeTab === 'sections') return data.sections;
      if (activeTab === 'faq') return data.faq;
      if (activeTab === 'references') return data.references;
      return [];
    }

    function getItemLabel(item, i) {
      if (activeTab === 'sections') return item.tocTitle || item.title;
      if (activeTab === 'faq') return item.question.slice(0, 50) + (item.question.length > 50 ? '...' : '');
      if (activeTab === 'references') return `[${item.id}] ${item.html.replace(/<[^>]+>/g, '').slice(0, 40)}...`;
      return '';
    }

    function renderSidebar() {
      const sidebar = document.getElementById('sidebar');
      const items = getItems();
      if (activeTab === 'cta' || activeTab === 'meta') {
        sidebar.innerHTML = '<p class="sidebar-note">Edit in the main panel</p>';
        return;
      }
      sidebar.innerHTML = `
        <div id="item-list" class="item-list">
          ${items.map((item, i) => `
            <div class="item-row ${i === activeIndex ? 'active' : ''}" data-index="${i}">
              <span class="drag-handle">&#9776;</span>
              <span class="item-label">${getItemLabel(item, i)}</span>
              <button class="item-delete" data-index="${i}" title="Delete">&times;</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-add" id="btn-add-item">+ Add ${activeTab === 'sections' ? 'Section' : activeTab === 'faq' ? 'Question' : 'Reference'}</button>
      `;

      // Event listeners
      sidebar.querySelectorAll('.item-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.classList.contains('item-delete')) return;
          saveCurrentItem();
          selectItem(parseInt(row.dataset.index));
        });
      });

      sidebar.querySelectorAll('.item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          if (confirm(`Delete this ${activeTab.slice(0, -1)}?`)) {
            deleteItem(idx);
          }
        });
      });

      document.getElementById('btn-add-item')?.addEventListener('click', addItem);
    }

    function initSortable() {
      // Re-init on each sidebar render
      const list = document.getElementById('item-list');
      if (list) {
        new Sortable(list, {
          handle: '.drag-handle',
          animation: 150,
          onEnd: (evt) => {
            const items = getItems();
            const moved = items.splice(evt.oldIndex, 1)[0];
            items.splice(evt.newIndex, 0, moved);
            activeIndex = evt.newIndex;
            markDirty();
            renderSidebar();
          }
        });
      }
    }

    // === ITEM SELECTION ===
    function selectItem(index) {
      const items = getItems();
      if (index < 0 || index >= items.length) return;
      activeIndex = index;

      // Update sidebar active state
      document.querySelectorAll('.item-row').forEach((row, i) => {
        row.classList.toggle('active', i === index);
      });

      const item = items[index];
      const ef = document.getElementById('editor-field');

      if (activeTab === 'sections') {
        ef.innerHTML = item.content;
        document.getElementById('meta-id').value = item.id;
        document.getElementById('meta-title').value = item.title;
        document.getElementById('meta-toc').value = item.tocTitle;
        document.getElementById('meta-type').value = item.type;
      } else if (activeTab === 'faq') {
        ef.innerHTML = item.answer;
        document.getElementById('faq-question').value = item.question;
      } else if (activeTab === 'references') {
        ef.innerHTML = item.html;
        document.getElementById('ref-id').value = item.id;
      }

      updateEditorVisibility();
      initSortable();
    }

    function saveCurrentItem() {
      if (activeTab === 'cta' || activeTab === 'meta') return;
      const items = getItems();
      if (activeIndex < 0 || activeIndex >= items.length) return;

      const content = sourceMode
        ? document.getElementById('source-field').value
        : document.getElementById('editor-field').innerHTML;

      if (activeTab === 'sections') {
        items[activeIndex].content = content;
        items[activeIndex].id = document.getElementById('meta-id').value;
        items[activeIndex].title = document.getElementById('meta-title').value;
        items[activeIndex].tocTitle = document.getElementById('meta-toc').value;
        items[activeIndex].type = document.getElementById('meta-type').value;
      } else if (activeTab === 'faq') {
        items[activeIndex].answer = content;
        items[activeIndex].question = document.getElementById('faq-question').value;
      } else if (activeTab === 'references') {
        items[activeIndex].html = content;
      }
      markDirty();
    }

    // === ADD / DELETE ===
    function addItem() {
      if (activeTab === 'sections') {
        data.sections.push({
          id: 'new-section-' + Date.now(),
          title: 'New Section',
          tocTitle: 'New Section',
          type: 'section',
          content: '<p>Enter content here.</p>',
        });
      } else if (activeTab === 'faq') {
        data.faq.push({
          question: 'New question?',
          answer: '<p>Answer here.</p>',
        });
      } else if (activeTab === 'references') {
        const nextId = data.references.length > 0
          ? Math.max(...data.references.map(r => r.id)) + 1
          : 1;
        data.references.push({ id: nextId, html: 'New reference.' });
      }
      markDirty();
      renderSidebar();
      selectItem(getItems().length - 1);
      initSortable();
    }

    function deleteItem(index) {
      const items = getItems();
      items.splice(index, 1);
      // Renumber references
      if (activeTab === 'references') {
        data.references.forEach((r, i) => r.id = i + 1);
      }
      markDirty();
      if (activeIndex >= items.length) activeIndex = items.length - 1;
      renderSidebar();
      if (items.length > 0) selectItem(Math.max(0, activeIndex));
      initSortable();
      updateCounts();
    }

    // === CTA EDITOR ===
    function renderCTAEditor() {
      document.getElementById('cta-heading').value = data.cta.heading;
      const list = document.getElementById('cta-buttons-list');
      list.innerHTML = data.cta.buttons.map((btn, i) => `
        <div class="cta-btn-row">
          <input type="text" value="${btn.text}" data-field="text" data-index="${i}" placeholder="Button text" />
          <input type="text" value="${btn.href}" data-field="href" data-index="${i}" placeholder="/path/" />
          <select data-field="style" data-index="${i}">
            <option value="primary" ${btn.style === 'primary' ? 'selected' : ''}>Primary</option>
            <option value="secondary" ${btn.style === 'secondary' ? 'selected' : ''}>Secondary</option>
          </select>
          <button class="item-delete" onclick="deleteCTAButton(${i})">&times;</button>
        </div>
      `).join('');

      list.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', () => {
          const i = parseInt(el.dataset.index);
          data.cta.buttons[i][el.dataset.field] = el.value;
          markDirty();
        });
      });

      document.getElementById('cta-heading').addEventListener('input', (e) => {
        data.cta.heading = e.target.value;
        markDirty();
      });

      document.getElementById('cta-add-btn').onclick = () => {
        data.cta.buttons.push({ text: 'New Button', href: '/', style: 'secondary' });
        markDirty();
        renderCTAEditor();
      };
    }

    window.deleteCTAButton = function(i) {
      data.cta.buttons.splice(i, 1);
      markDirty();
      renderCTAEditor();
    };

    // === META EDITOR ===
    function renderMetaEditor() {
      document.getElementById('page-title').value = data.meta.title;
      document.getElementById('page-desc').value = data.meta.description;
      document.getElementById('page-author').value = data.meta.author;
      document.getElementById('page-author-title').value = data.meta.authorTitle;
      document.getElementById('page-pub-date').value = data.meta.publishDate;
      document.getElementById('page-mod-date').value = data.meta.modifiedDate;

      ['page-title', 'page-desc', 'page-author', 'page-author-title', 'page-pub-date', 'page-mod-date'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
          const key = {
            'page-title': 'title', 'page-desc': 'description',
            'page-author': 'author', 'page-author-title': 'authorTitle',
            'page-pub-date': 'publishDate', 'page-mod-date': 'modifiedDate',
          }[id];
          data.meta[key] = e.target.value;
          markDirty();
        });
      });
    }

    // === TOOLBAR ===
    function initToolbar() {
      document.querySelectorAll('.toolbar button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const cmd = btn.dataset.cmd;
          if (cmd === 'createLink') {
            const url = prompt('Enter URL:');
            if (url) document.execCommand(cmd, false, url);
          } else if (cmd === 'formatBlock') {
            document.execCommand(cmd, false, `<${btn.dataset.val}>`);
          } else {
            document.execCommand(cmd, false, null);
          }
          markDirty();
        });
      });

      // Source toggle
      document.getElementById('btn-source').addEventListener('click', () => {
        const ef = document.getElementById('editor-field');
        const sf = document.getElementById('source-field');
        if (sourceMode) {
          ef.innerHTML = sf.value;
          ef.style.display = 'block';
          sf.style.display = 'none';
        } else {
          sf.value = ef.innerHTML;
          ef.style.display = 'none';
          sf.style.display = 'block';
        }
        sourceMode = !sourceMode;
      });

      // Track changes
      document.getElementById('editor-field').addEventListener('input', () => markDirty());
      document.getElementById('source-field').addEventListener('input', () => markDirty());
    }

    // === SAVE ===
    function markDirty() {
      dirty = true;
      document.getElementById('save-status').textContent = 'Unsaved changes';
      document.getElementById('save-status').classList.add('dirty');
    }

    async function save() {
      saveCurrentItem();
      data.meta.modifiedDate = new Date().toISOString().slice(0, 10);

      document.getElementById('save-status').textContent = 'Saving...';
      try {
        const res = await fetch('/api/what-is-rrm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Save failed');
        dirty = false;
        document.getElementById('save-status').textContent = 'Saved';
        document.getElementById('save-status').classList.remove('dirty');
        // Reload preview after a short delay (Astro HMR needs a moment)
        setTimeout(() => {
          document.getElementById('preview-frame').contentWindow.location.reload();
        }, 1000);
      } catch (e) {
        document.getElementById('save-status').textContent = 'Save failed!';
      }
    }

    document.getElementById('btn-save').addEventListener('click', save);

    // Ctrl+S to save
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });

    // Warn on unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    function updateCounts() {
      document.getElementById('faq-count').textContent = data.faq.length;
      document.getElementById('ref-count').textContent = data.references.length;
    }

    // === START ===
    init();
  </script>

  <!-- styles: see step 2 below -->
</body>
</html>
```

**Step 2: Add editor styles**

Add a `<style>` block inside `<head>` with the full editor CSS. Key styles needed:

- **Layout:** CSS grid with sidebar (220px) + editor (1fr) + preview (1fr)
- **Editor bar:** fixed top bar with save button, back link, status
- **Tabs:** horizontal tab strip below the bar
- **Sidebar:** scrollable list with drag handles, active state highlighting
- **Editor field:** contentEditable div with min-height, border, padding, font matching the site
- **Toolbar:** horizontal button strip with formatting commands
- **Section meta:** form inputs below the editor field
- **Preview:** full-height iframe, no border
- **Responsive:** collapse preview on narrow screens

The CSS should use the site's existing CSS variables where possible (`var(--text-primary)`, etc.) but can define its own since it uses a standalone HTML document.

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }

.editor-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 1rem; background: #1a1a2e; color: #fff;
  position: sticky; top: 0; z-index: 100;
}
.editor-bar__left { display: flex; align-items: center; gap: 1rem; }
.editor-bar__back { color: #a0a0c0; text-decoration: none; font-size: 0.875rem; }
.editor-bar__title { font-size: 1rem; font-weight: 600; }
.editor-bar__right { display: flex; align-items: center; gap: 0.75rem; }
.save-status { font-size: 0.8125rem; color: #7a7; }
.save-status.dirty { color: #e94; }
.btn-save {
  background: #4a6; color: #fff; border: none; padding: 0.4rem 1.2rem;
  border-radius: 4px; cursor: pointer; font-weight: 600;
}
.btn-save:hover { background: #5b7; }

.editor-tabs {
  display: flex; gap: 0; background: #2a2a3e; padding: 0 1rem;
}
.tab {
  background: none; border: none; color: #888; padding: 0.6rem 1rem;
  cursor: pointer; font-size: 0.8125rem; border-bottom: 2px solid transparent;
}
.tab.active { color: #fff; border-bottom-color: #6c8; }

.editor-main {
  display: grid; grid-template-columns: 220px 1fr 1fr;
  height: calc(100vh - 80px); overflow: hidden;
}

.editor-sidebar {
  background: #fff; border-right: 1px solid #ddd;
  overflow-y: auto; padding: 0.5rem;
}
.item-list { display: flex; flex-direction: column; gap: 2px; }
.item-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 0.5rem; border-radius: 4px; cursor: pointer;
  font-size: 0.8125rem; line-height: 1.3;
}
.item-row:hover { background: #f0f0f0; }
.item-row.active { background: #e8f0e8; font-weight: 600; }
.drag-handle { cursor: grab; color: #aaa; user-select: none; }
.item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-delete {
  background: none; border: none; color: #c88; cursor: pointer;
  font-size: 1rem; opacity: 0; transition: opacity 0.15s;
}
.item-row:hover .item-delete { opacity: 1; }
.btn-add {
  display: block; width: 100%; margin-top: 0.5rem; padding: 0.5rem;
  background: #f8f8f8; border: 1px dashed #ccc; border-radius: 4px;
  cursor: pointer; font-size: 0.8125rem; color: #666;
}

.editor-content {
  display: flex; flex-direction: column; overflow-y: auto;
  background: #fff; border-right: 1px solid #ddd;
}
.toolbar {
  display: flex; gap: 2px; padding: 0.4rem; background: #fafafa;
  border-bottom: 1px solid #eee; flex-shrink: 0;
}
.toolbar button {
  background: #fff; border: 1px solid #ddd; padding: 0.3rem 0.6rem;
  cursor: pointer; border-radius: 3px; font-size: 0.8125rem;
}
.toolbar button:hover { background: #eef; }
.editor-field {
  flex: 1; padding: 1.5rem; font-size: 0.9375rem; line-height: 1.7;
  outline: none; overflow-y: auto;
}
.editor-field h3 { font-size: 1.1rem; margin: 1rem 0 0.5rem; }
.editor-field h4 { font-size: 1rem; margin: 0.75rem 0 0.5rem; }
.editor-field p { margin-bottom: 0.75rem; }
.editor-field ul, .editor-field ol { margin: 0.5rem 0 0.75rem 1.5rem; }
.source-field {
  flex: 1; padding: 1rem; font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8125rem; line-height: 1.5; border: none; resize: none;
  outline: none; background: #1e1e2e; color: #cdd6f4;
}
.section-meta {
  display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.75rem;
  background: #f9f9f9; border-top: 1px solid #eee; flex-shrink: 0;
}
.section-meta label {
  display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem;
}
.section-meta input, .section-meta select {
  padding: 0.25rem 0.5rem; border: 1px solid #ddd; border-radius: 3px;
  font-size: 0.8125rem;
}
.faq-question-input { width: 100%; }

.cta-btn-row {
  display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center;
}
.cta-btn-row input, .cta-btn-row select {
  padding: 0.3rem 0.5rem; border: 1px solid #ddd; border-radius: 3px;
  font-size: 0.8125rem;
}
.cta-btn-row input:first-child { flex: 1; }

#meta-editor label {
  display: block; margin-bottom: 0.75rem; font-size: 0.875rem;
}
#meta-editor input, #meta-editor textarea {
  display: block; width: 100%; margin-top: 0.25rem;
  padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px;
}

.editor-preview {
  background: #fff; overflow: hidden;
}
.editor-preview iframe {
  width: 100%; height: 100%; border: none;
}
.sidebar-note { padding: 1rem; color: #888; font-size: 0.8125rem; }

@media (max-width: 900px) {
  .editor-main { grid-template-columns: 180px 1fr; }
  .editor-preview { display: none; }
}
```

**Step 3: Verify editor loads**

```bash
open -a "Comet" "http://localhost:4321/what-is-rrm/edit"
```

Check:
- All sections appear in sidebar
- Clicking a section loads its content in editor
- Formatting toolbar works (bold, italic, link)
- Source toggle shows HTML
- FAQ tab shows questions
- References tab shows citations
- CTA tab shows button editor
- Meta tab shows page metadata
- Save writes to disk and reloads preview

**Step 4: Commit**

```bash
git add src/pages/what-is-rrm/edit.astro
git commit -m "feat: add live editor page for what-is-rrm content"
```

---

## Task 5: End-to-end verification

**Step 1: Full edit-save-render cycle**

1. Open editor at `/what-is-rrm/edit`
2. Select "Key Takeaways" section
3. Edit some text (add a word)
4. Click Save
5. Verify preview iframe updates
6. Reload `/what-is-rrm/` in a separate tab -- confirm change persists
7. Check `src/data/what-is-rrm.json` -- confirm file updated on disk

**Step 2: Test section reordering**

1. Drag a section in the sidebar
2. Save
3. Verify TOC and page render in new order

**Step 3: Test add/delete**

1. Add a new section
2. Edit title and content
3. Save and verify it appears on page
4. Delete the test section
5. Save and verify it's gone

**Step 4: Test FAQ editing**

1. Switch to FAQ tab
2. Edit a question and answer
3. Save and verify FAQ section updates

**Step 5: Verify no regressions**

- All 15 original sections render correctly
- Chart visualizations still display (CSS-based charts in HTML content)
- Citation links work (anchor scrolling)
- FAQ accordions open/close
- Mobile TOC works
- Schema.org JSON-LD still present in page source

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete what-is-rrm live editor system"
```

---

## Notes

- **Dev-only:** The API endpoint and editor page only work during `astro dev`. In production builds, they won't exist.
- **No auth:** This is localhost-only. No authentication needed.
- **JSON-LD:** The structured data in the frontmatter is currently static. A future enhancement could regenerate it from JSON data.
- **Extraction script:** `scripts/extract-what-is-rrm.mjs` is a one-time tool. Can be deleted after initial extraction, or kept for reference.
- **Astro HMR:** When the JSON file changes on disk, Astro's dev server should hot-reload the page automatically since it's imported in the frontmatter.
