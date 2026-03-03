# Commentary Voice Narration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI-generated voice narration to Dr. Naomi Whittaker's commentary blog posts, with zero pageload performance impact. POC: one post end-to-end.

**Architecture:** Chatterbox TTS generates chunked audio from Airtable markdown content, converts to MP3, uploads to R2. A vanilla JS web component renders a click-to-expand audio player. Airtable gets a new `Audio URL` field piped through the existing fetch pipeline.

**Tech Stack:** Chatterbox TTS (Python 3.11), ffmpeg, Cloudflare R2, Astro components, vanilla JS Web Components

---

## Critical Context for the Executing Agent

### Project Location
- **Site repo:** `/Users/brian/iCode/projects/rrm-academy-cf/`
- **Chatterbox venv:** `/Users/brian/iCode/tools/chatterbox-env/` (activate: `source ~/iCode/tools/chatterbox-env/bin/activate`)
- **Voice sample:** `/Users/brian/Downloads/naomi voice sample 1.wav`
- **Audio generation scripts:** `/Users/brian/iCode/tools/` (this is where the new script goes)

### Airtable
- **Base ID:** `app1CKV1heL0qH2Oz` (Editorial Commentary Blog)
- **Table ID:** `tblS8q3XHj6mhwxvl` (Editorial Calendar)
- **PAT:** `source ~/.zshrc && op read 'op://Automation/OpenClaw Airtable PAT/credential'`
- **Author field value:** `Naomi Whittaker, MD` (NOT "Dr. Naomi Whittaker")
- **POC post:** `rec7aQ4iRUufWOLFR` -- "Uterine Isthmocele: The Overlooked C-Section Scar and Restorative Care", slug: `uterine-isthmocele-c-section-scar-restorative-solutions`, 4829 words

### R2
- **Bucket:** `rrm-assets` (bound as `R2_ASSETS` in wrangler.toml)
- **Existing catch-all:** `functions/api/assets/[[path]].js` -- serves any R2 key with auto content-type and immutable caching
- **MUST add `mp3` to CONTENT_TYPES map** in the catch-all (currently only has pdf, png, jpg, jpeg, webp, gif, svg)
- **Upload tool:** `npx wrangler r2 object put rrm-assets/audio/commentary/{slug}.mp3 --file=path/to/file.mp3 --content-type=audio/mpeg`
- **Served at:** `https://rrmacademy.org/api/assets/audio/commentary/{slug}.mp3`

### Chatterbox TTS Rules (CRITICAL)
- **MUST chunk text into 1-2 sentences per `generate()` call** -- long text causes rushing and mispronunciation
- Concatenate chunks with `torch.zeros(1, int(model.sr * 0.6))` pauses between them
- Spell out all numbers as words ("twenty-six" not "26")
- Strip markdown formatting, citation superscripts, and HTML before TTS
- Acronyms (RRM, PCOS, NaPro, FABM) pass through fine as-is

### Design System (CSS Variables)
- Accent purple: `var(--accent)` (#725e7e), hover: `var(--accent-hover)` (#4c3e54)
- Text colors: `var(--text-primary)`, `var(--text-secondary)` (#636261), `var(--text-tertiary)`
- Spacing: `var(--space-2)` through `var(--space-12)`
- Radius: `var(--radius-md)`
- Border: `var(--border-color)`
- Serif font: `'Cormorant Garamond', 'Georgia', serif`
- Sans font: inherited (system default on site)
- The byline component uses `font-size: 0.8125rem` and `var(--text-secondary)` -- the audio player button should match this visual weight

### Existing File State (exact code to modify)

**`src/lib/blog-config.mjs` line 15-27:** FIELDS array needs `'Audio URL'` added
**`src/lib/fetch-blog-data.mjs` line 68-80:** posts.push transform needs `audioUrl` mapping
**`src/lib/blog.ts` line 7-19:** BlogPost interface needs `audioUrl?: string`
**`src/lib/blog.ts` line 26-48:** transformRecord needs `audioUrl` mapping
**`src/pages/commentary/[...slug].astro` line 220:** After `<AuthorByline>`, insert AudioPlayer
**`functions/api/assets/[[path]].js` line 6-14:** CONTENT_TYPES needs `mp3: 'audio/mpeg'`

---

### Task 1: Add mp3 content type to R2 asset serving function

**Files:**
- Modify: `functions/api/assets/[[path]].js:6-14`

**Step 1: Add mp3 to CONTENT_TYPES**

In `functions/api/assets/[[path]].js`, add `mp3: 'audio/mpeg'` to the CONTENT_TYPES object:

```javascript
const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
};
```

**Step 2: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add functions/api/assets/\[\[path\]\].js
git commit -m "feat: add mp3 content type to R2 asset serving"
```

---

### Task 2: Update Airtable fetch pipeline for audioUrl

**Files:**
- Modify: `src/lib/blog-config.mjs:15-27`
- Modify: `src/lib/fetch-blog-data.mjs:68-80`
- Modify: `src/lib/blog.ts:7-19` and `src/lib/blog.ts:26-48`

**Step 1: Add 'Audio URL' to FIELDS array**

In `src/lib/blog-config.mjs`, add `'Audio URL'` to the FIELDS array (after `'SEO Keywords'`):

```javascript
export const FIELDS = [
  'Title',
  'Slug',
  'Content',
  'Excerpt',
  'Author',
  'Content Pillar',
  'Processed Cover URL',
  'Actual Publish Date',
  'Status',
  'Word Count',
  'SEO Keywords',
  'Audio URL',
];
```

**Step 2: Add audioUrl to BlogPost interface**

In `src/lib/blog.ts`, add `audioUrl` to the interface (after `seoKeywords: string;`):

```typescript
export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  contentPillar: string;
  coverImageUrl: string;
  publishDate: string;
  wordCount: number;
  seoKeywords: string;
  audioUrl: string;
}
```

**Step 3: Add audioUrl to transformRecord**

In `src/lib/blog.ts`, in the `transformRecord` function return object (after `seoKeywords` line):

```typescript
    seoKeywords: f['SEO Keywords'] || '',
    audioUrl: f['Audio URL'] || '',
```

**Step 4: Add audioUrl to fetch-blog-data.mjs transform**

In `src/lib/fetch-blog-data.mjs`, in the `posts.push` block (after `seoKeywords` line):

```javascript
        seoKeywords: f['SEO Keywords'] || '',
        audioUrl: f['Audio URL'] || '',
```

**Step 5: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add src/lib/blog-config.mjs src/lib/blog.ts src/lib/fetch-blog-data.mjs
git commit -m "feat: add audioUrl to blog data pipeline"
```

---

### Task 3: Build AudioPlayer.astro web component

**Files:**
- Create: `src/components/AudioPlayer.astro`

**Step 1: Create the component**

Create `src/components/AudioPlayer.astro` with this exact content:

```astro
---
interface Props {
  audioUrl: string;
}

const { audioUrl } = Astro.props;
---
<audio-player data-src={audioUrl}>
  <button class="audio-btn" type="button" aria-label="Listen to this article">
    <svg class="audio-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6,4 20,12 6,20" />
    </svg>
    <span class="audio-label">Listen to this article</span>
  </button>
</audio-player>

<script>
class AudioPlayerElement extends HTMLElement {
  connectedCallback() {
    this._btn = this.querySelector('.audio-btn');
    this._expanded = false;
    this._audio = null;
    this._playing = false;
    this._rate = 1;
    this._btn.addEventListener('click', () => {
      if (!this._expanded) {
        this._expand();
      } else {
        this._toggle();
      }
    });
  }

  _expand() {
    this._expanded = true;
    this._audio = new Audio(this.dataset.src);
    this._audio.preload = 'metadata';

    // Build player UI
    this.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'audio-player';

    // Top row: play/pause + progress + time
    const row = document.createElement('div');
    row.className = 'audio-row';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'audio-play';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
    row.appendChild(playBtn);

    const progress = document.createElement('input');
    progress.type = 'range';
    progress.className = 'audio-progress';
    progress.min = '0';
    progress.max = '100';
    progress.value = '0';
    progress.step = '0.1';
    progress.setAttribute('aria-label', 'Seek');
    row.appendChild(progress);

    const time = document.createElement('span');
    time.className = 'audio-time';
    time.textContent = '0:00 / 0:00';
    row.appendChild(time);

    wrap.appendChild(row);

    // Bottom row: speed
    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'audio-speed';
    speedBtn.textContent = '1x';
    speedBtn.setAttribute('aria-label', 'Playback speed');
    wrap.appendChild(speedBtn);

    this.appendChild(wrap);

    // Wire events
    const fmt = (s) => {
      if (isNaN(s)) return '0:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    };

    this._audio.addEventListener('loadedmetadata', () => {
      time.textContent = '0:00 / ' + fmt(this._audio.duration);
    });

    this._audio.addEventListener('timeupdate', () => {
      const pct = (this._audio.currentTime / this._audio.duration) * 100;
      progress.value = String(pct);
      time.textContent = fmt(this._audio.currentTime) + ' / ' + fmt(this._audio.duration);
    });

    this._audio.addEventListener('ended', () => {
      this._playing = false;
      playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
      playBtn.setAttribute('aria-label', 'Play');
    });

    playBtn.addEventListener('click', () => this._toggle());

    progress.addEventListener('input', () => {
      if (this._audio.duration) {
        this._audio.currentTime = (progress.value / 100) * this._audio.duration;
      }
    });

    const speeds = [1, 1.5, 2];
    speedBtn.addEventListener('click', () => {
      const idx = (speeds.indexOf(this._rate) + 1) % speeds.length;
      this._rate = speeds[idx];
      this._audio.playbackRate = this._rate;
      speedBtn.textContent = this._rate + 'x';
    });

    this._playBtn = playBtn;
    this._audio.play();
    this._playing = true;
    playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    playBtn.setAttribute('aria-label', 'Pause');
  }

  _toggle() {
    if (!this._audio) return;
    if (this._playing) {
      this._audio.pause();
      this._playing = false;
      this._playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
      this._playBtn.setAttribute('aria-label', 'Play');
    } else {
      this._audio.play();
      this._playing = true;
      this._playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      this._playBtn.setAttribute('aria-label', 'Pause');
    }
  }
}

customElements.define('audio-player', AudioPlayerElement);
</script>

<style>
  audio-player {
    display: block;
    margin-top: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .audio-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--accent);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .audio-btn:hover {
    border-color: var(--accent);
    color: var(--accent-hover);
  }

  .audio-icon {
    flex-shrink: 0;
  }

  .audio-player {
    padding: var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--purple-50);
  }

  .audio-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .audio-play {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    cursor: pointer;
    transition: background 0.15s;
  }
  .audio-play:hover {
    background: var(--accent-hover);
  }

  .audio-progress {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--purple-200);
    border-radius: 2px;
    cursor: pointer;
  }
  .audio-progress::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .audio-time {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    min-width: 5.5em;
    text-align: right;
  }

  .audio-speed {
    margin-top: var(--space-2);
    padding: 2px var(--space-2);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: transparent;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .audio-speed:hover {
    border-color: var(--accent);
  }
</style>
```

**Step 2: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add src/components/AudioPlayer.astro
git commit -m "feat: add AudioPlayer web component (zero pageload impact)"
```

---

### Task 4: Wire AudioPlayer into commentary detail page

**Files:**
- Modify: `src/pages/commentary/[...slug].astro:2-5` (imports) and `src/pages/commentary/[...slug].astro:220` (render)

**Step 1: Add import**

In `src/pages/commentary/[...slug].astro`, add the AudioPlayer import after the AuthorByline import (line 3):

```astro
import AuthorByline from '../../components/AuthorByline.astro';
import AudioPlayer from '../../components/AudioPlayer.astro';
```

**Step 2: Render AudioPlayer after AuthorByline**

In the template, after line 220 (`<AuthorByline author={post.author} date={post.publishDate} />`), add:

```astro
      <AuthorByline author={post.author} date={post.publishDate} />
      {post.audioUrl && <AudioPlayer audioUrl={post.audioUrl} />}
```

**Step 3: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add src/pages/commentary/\[...slug\].astro
git commit -m "feat: render AudioPlayer on commentary posts with audio"
```

---

### Task 5: Generate POC audio and upload to R2

**Files:**
- Create: `/Users/brian/iCode/tools/generate-commentary-audio.py`

**Step 1: Fetch the POC post content from Airtable**

```bash
source ~/.zshrc && curl -s "https://api.airtable.com/v0/app1CKV1heL0qH2Oz/tblS8q3XHj6mhwxvl/rec7aQ4iRUufWOLFR?fields%5B%5D=Content&fields%5B%5D=Slug&fields%5B%5D=Title" \
  -H "Authorization: Bearer $(op read 'op://Automation/OpenClaw Airtable PAT/credential')" \
  | python3 -m json.tool > /tmp/poc-post.json
```

Verify: should see `uterine-isthmocele-c-section-scar-restorative-solutions` as the slug.

**Step 2: Create the generation script**

Create `/Users/brian/iCode/tools/generate-commentary-audio.py`:

```python
#!/usr/bin/env python3
"""Generate voice narration for RRM Academy commentary posts.

Usage:
    source ~/iCode/tools/chatterbox-env/bin/activate
    python generate-commentary-audio.py --input /tmp/poc-post.json --output /tmp/narration.wav

The input JSON should be an Airtable record with fields.Content (markdown).
"""
import argparse
import json
import re
import subprocess
import sys

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

VOICE_SAMPLE = "/Users/brian/Downloads/naomi voice sample 1.wav"
PAUSE_SECONDS = 0.6


def strip_markdown(md: str) -> str:
    """Remove markdown formatting, citations, and HTML from text."""
    text = md
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove images: ![alt](url)
    text = re.sub(r'!\[[^\]]*\]\([^)]+\)', '', text)
    # Remove links but keep text: [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Remove citation superscripts (numbers at end of words/sentences)
    text = re.sub(r'(?<=[.!?a-zA-Z])\d{1,3}(?=[\s.,;:!?]|$)', '', text)
    # Remove heading markers
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    # Remove bold/italic markers
    text = re.sub(r'\*{1,3}', '', text)
    text = re.sub(r'_{1,3}', '', text)
    # Remove horizontal rules
    text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    # Remove blockquote markers
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    # Remove bullet/list markers
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    # Collapse multiple newlines
    text = re.sub(r'\n{2,}', '\n', text)
    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    return text.strip()


def chunk_text(text: str) -> list[str]:
    """Split text into 1-2 sentence chunks for TTS."""
    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks = []
    current = ""
    for sent in sentences:
        if not current:
            current = sent
        elif len(current) + len(sent) < 200:
            current = current + " " + sent
        else:
            chunks.append(current)
            current = sent
    if current:
        chunks.append(current)

    return chunks


def number_to_words(text: str) -> str:
    """Convert common numbers to words for natural TTS."""
    # This handles the most common cases in medical writing
    number_map = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
        '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
        '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
        '18': 'eighteen', '19': 'nineteen', '20': 'twenty', '25': 'twenty-five',
        '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty',
        '70': 'seventy', '80': 'eighty', '90': 'ninety', '100': 'one hundred',
    }
    # Replace standalone numbers (not part of larger numbers or codes)
    for num, word in sorted(number_map.items(), key=lambda x: -len(x[0])):
        text = re.sub(r'\b' + num + r'\b', word, text)
    # Handle percentages
    text = re.sub(r'(\d+)%', r'\1 percent', text)
    return text


def generate_audio(chunks: list[str], model, output_path: str):
    """Generate audio for each chunk and concatenate."""
    all_wavs = []
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {chunk[:60]}...")
        wav = model.generate(chunk, audio_prompt_path=VOICE_SAMPLE)
        all_wavs.append(wav)
        pause = torch.zeros(1, int(model.sr * PAUSE_SECONDS))
        all_wavs.append(pause)

    combined = torch.cat(all_wavs, dim=1)
    torchaudio.save(output_path, combined, model.sr)
    print(f"Saved WAV: {output_path}")


def wav_to_mp3(wav_path: str, mp3_path: str):
    """Convert WAV to MP3 using ffmpeg."""
    subprocess.run([
        'ffmpeg', '-y', '-i', wav_path,
        '-codec:a', 'libmp3lame', '-b:a', '128k',
        '-ac', '1', '-ar', '24000',
        mp3_path
    ], check=True, capture_output=True)
    print(f"Saved MP3: {mp3_path}")


def main():
    parser = argparse.ArgumentParser(description='Generate commentary narration')
    parser.add_argument('--input', required=True, help='Airtable record JSON file')
    parser.add_argument('--output', required=True, help='Output WAV path')
    parser.add_argument('--mp3', help='Also convert to MP3 at this path')
    args = parser.parse_args()

    with open(args.input) as f:
        record = json.load(f)

    content = record.get('fields', {}).get('Content', '')
    title = record.get('fields', {}).get('Title', 'Unknown')
    if not content:
        print("Error: No Content field in record")
        sys.exit(1)

    print(f"Processing: {title}")
    text = strip_markdown(content)
    text = number_to_words(text)
    chunks = chunk_text(text)
    print(f"Split into {len(chunks)} chunks")

    print("Loading Chatterbox model...")
    model = ChatterboxTTS.from_pretrained(device="cpu")

    generate_audio(chunks, model, args.output)

    if args.mp3:
        wav_to_mp3(args.output, args.mp3)


if __name__ == '__main__':
    main()
```

**Step 3: Run the generation on the POC post**

```bash
source ~/iCode/tools/chatterbox-env/bin/activate
cd ~/iCode/tools
python generate-commentary-audio.py \
  --input /tmp/poc-post.json \
  --output /tmp/narration.wav \
  --mp3 /tmp/narration.mp3
```

Expected: This will take several minutes on CPU. Output is `/tmp/narration.mp3`.

**IMPORTANT:** Before uploading, play the MP3 and have Brian review it:
```bash
open /tmp/narration.mp3
```

Wait for Brian's approval before proceeding to Step 4.

**Step 4: Upload MP3 to R2**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler r2 object put \
  rrm-assets/audio/commentary/uterine-isthmocele-c-section-scar-restorative-solutions.mp3 \
  --file=/tmp/narration.mp3 \
  --content-type=audio/mpeg
```

Verify: `CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler r2 object head rrm-assets/audio/commentary/uterine-isthmocele-c-section-scar-restorative-solutions.mp3`

---

### Task 6: Set Audio URL in Airtable and rebuild

**Step 1: Add Audio URL field to Airtable (manual or API)**

Using Airtable API, update the POC record with the audio URL:

```bash
source ~/.zshrc && curl -s -X PATCH \
  "https://api.airtable.com/v0/app1CKV1heL0qH2Oz/tblS8q3XHj6mhwxvl/rec7aQ4iRUufWOLFR" \
  -H "Authorization: Bearer $(op read 'op://Automation/OpenClaw Airtable PAT/credential')" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Audio URL":"https://rrmacademy.org/api/assets/audio/commentary/uterine-isthmocele-c-section-scar-restorative-solutions.mp3"}}'
```

NOTE: The `Audio URL` field must exist in Airtable first. If it doesn't exist yet, create it manually in the Airtable UI as a "Single line text" field, OR use the Airtable field creation API.

**Step 2: Re-fetch blog data**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
source ~/.zshrc
AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') node src/lib/fetch-blog-data.mjs
```

Verify: `cat src/data/posts.json | python3 -c "import sys,json; posts=json.load(sys.stdin); [print(p['slug'], p.get('audioUrl','')) for p in posts if p.get('audioUrl')]"`

**Step 3: Build and deploy**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run build
```

Check the built HTML for the audio player:
```bash
grep -l "audio-player" dist/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/index.html
```

**Step 4: Deploy**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add -A && git push
```

(The GitHub Action will build and deploy to CF Pages automatically.)

**Step 5: Verify live**

Visit: `https://rrmacademy.org/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/`

Confirm:
- "Listen to this article" button appears between byline and content
- Clicking expands the player and starts playback
- Progress bar, time display, and speed toggle all work
- Page without audioUrl (any other post) does NOT show the player
