#!/usr/bin/env node
import fs from 'node:fs';

export function checkRails(html, opts) {
  const { mode, target, sibling } = opts;

  const hasLiveRailTo = (href) => {
    const re = new RegExp(`<a[^>]*class="[^"]*audience-rail[^"]*"[^>]*href="${escapeRegex(href)}"`);
    return re.test(html);
  };
  const hasInertRailTo = (href) => {
    const re = new RegExp(`<span[^>]*data-rail-state="inert"[^>]*data-future-href="${escapeRegex(href)}"`);
    return re.test(html) || new RegExp(`<span[^>]*data-future-href="${escapeRegex(href)}"[^>]*data-rail-state="inert"`).test(html);
  };

  if (mode === 'back-edit') {
    if (!target) return { ok: false, error: 'back-edit mode requires --target' };
    if (!hasLiveRailTo(target)) return { ok: false, error: `back-edit not converted to live: no <a class="audience-rail" href="${target}">` };
    return { ok: true };
  }

  if (mode === 'no-leftovers') {
    if (/data-future-href/.test(html)) return { ok: false, error: 'data-future-href attribute lingers post-back-edit' };
    if (/data-rail-state/.test(html)) return { ok: false, error: 'data-rail-state attribute lingers post-back-edit' };
    if (/aria-disabled="true"/.test(html) && /audience-rail/.test(html)) return { ok: false, error: 'aria-disabled="true" lingers on audience-rail element' };
    return { ok: true };
  }

  if (mode === 'new-ship') {
    if (!sibling) return { ok: false, error: 'new-ship mode requires --sibling' };
    if (!hasLiveRailTo(sibling)) return { ok: false, error: `new pillar missing live rail to already-shipped sibling: ${sibling}` };
    return { ok: true };
  }

  if (mode === 'inverted') {
    if (!target) return { ok: false, error: 'inverted mode requires --target' };
    if (hasLiveRailTo(target)) return { ok: false, error: `rollback verification failed: live rail to ${target} still present` };
    if (!hasInertRailTo(target)) return { ok: false, error: `rollback verification failed: inert rail to ${target} not restored` };
    return { ok: true };
  }

  return { ok: false, error: `unknown mode: ${mode}` };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)(=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    if (m[2] !== undefined) {
      // --key=value (value may be empty string)
      out[key] = m[3];
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      // --key value
      out[key] = argv[++i];
    } else {
      // --key (bare flag, no value)
      out[key] = true;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath) {
    console.error('Usage: validate-cross-pillar-rails.mjs --file=dist/PILLAR/index.html --mode=MODE [--target=URL] [--sibling=URL]');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkRails(html, args);
  if (result.ok) {
    console.log(`OK: ${args.mode}${args.target ? ' target=' + args.target : ''}${args.sibling ? ' sibling=' + args.sibling : ''}`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
