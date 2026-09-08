// Decode a WOFF 1.0 container to the raw SFNT (TTF/OTF) bytes it wraps.
// resvg (fontdb/ttf-parser) reads only raw SFNT; a WOFF buffer is silently ignored and
// the renderer falls back to whatever the host has (DejaVu on Linux CI, the user's
// installed copy on a Mac), which is how the first share cards shipped in the wrong face.
// WOFF 1.0 = 44-byte header + table directory (20 bytes per table) + zlib-compressed tables.
import { inflateSync } from 'node:zlib';

export function woffToSfnt(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 44 || b.toString('latin1', 0, 4) !== 'wOFF') return b; // already SFNT (or unknown)
  const flavor = b.readUInt32BE(4);
  const numTables = b.readUInt16BE(12);
  const dirStart = 44;
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = dirStart + i * 20;
    tables.push({
      tag: b.subarray(o, o + 4),
      offset: b.readUInt32BE(o + 4),
      compLength: b.readUInt32BE(o + 8),
      origLength: b.readUInt32BE(o + 12),
      origChecksum: b.readUInt32BE(o + 16),
    });
  }
  // SFNT header: sfntVersion, numTables, searchRange, entrySelector, rangeShift.
  let entrySelector = 0; while ((2 << entrySelector) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;
  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor, 0); header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6); header.writeUInt16BE(entrySelector, 8); header.writeUInt16BE(rangeShift, 10);
  const dir = Buffer.alloc(numTables * 16);
  const datas = [];
  let offset = 12 + numTables * 16;
  tables.forEach((t, i) => {
    const raw = b.subarray(t.offset, t.offset + t.compLength);
    let data = t.compLength === t.origLength ? Buffer.from(raw) : inflateSync(raw);
    if (data.length !== t.origLength) throw new Error(`woff table ${t.tag.toString('latin1')} inflated to ${data.length}, expected ${t.origLength}`);
    const pad = (4 - (data.length % 4)) % 4;
    if (pad) data = Buffer.concat([data, Buffer.alloc(pad)]);
    t.tag.copy(dir, i * 16);
    dir.writeUInt32BE(t.origChecksum, i * 16 + 4);
    dir.writeUInt32BE(offset, i * 16 + 8);
    dir.writeUInt32BE(t.origLength, i * 16 + 12);
    datas.push(data); offset += data.length;
  });
  return Buffer.concat([header, dir, ...datas]);
}

// fontsource static files name each weight as its own family ("Inter SemiBold", family id 1,
// no typographic family id 16), so a font-family="Inter" font-weight="600" request never matches
// and resvg falls back to the 400 face or to nothing. Rewrite the name table so id 1 and id 16
// carry the plain family, id 2 and id 17 the style, id 4 the full name. Everything else is kept.
const STYLE_SUFFIX = /\s+(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)(\s+Italic)?$/;
export function normalizeFamily(sfnt) {
  const b = Buffer.from(sfnt);
  const numTables = b.readUInt16BE(4);
  let nameRec = null;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (b.toString('latin1', o, o + 4) === 'name') nameRec = { dirOffset: o, offset: b.readUInt32BE(o + 8), length: b.readUInt32BE(o + 12) };
  }
  if (!nameRec) return b;
  const t = b.subarray(nameRec.offset, nameRec.offset + nameRec.length);
  const count = t.readUInt16BE(2), stringOffset = t.readUInt16BE(4);
  const recs = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const r = { platformID: t.readUInt16BE(o), encodingID: t.readUInt16BE(o + 2), languageID: t.readUInt16BE(o + 4), nameID: t.readUInt16BE(o + 6), length: t.readUInt16BE(o + 8), offset: t.readUInt16BE(o + 10) };
    r.bytes = Buffer.from(t.subarray(stringOffset + r.offset, stringOffset + r.offset + r.length));
    recs.push(r);
  }
  const utf16be = (buf) => { let s = ''; for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i)); return s; };
  const text = (r) => (r.platformID === 1 ? r.bytes.toString('latin1') : utf16be(r.bytes));
  const fam1 = recs.find((r) => r.nameID === 1 && r.platformID === 3) || recs.find((r) => r.nameID === 1);
  if (!fam1) return b;
  const raw = text(fam1);
  const m = STYLE_SUFFIX.exec(raw);
  const family = m ? raw.slice(0, m.index) : raw;
  const style = m ? m[0].trim() : (text(recs.find((r) => r.nameID === 2) || { platformID: 1, bytes: Buffer.from('Regular') }) || 'Regular');
  if (!m) return b; // nothing to normalize
  const wants = { 1: family, 2: style, 4: `${family} ${style}`, 16: family, 17: style };
  const enc = (platformID, s) => platformID === 1 ? Buffer.from(s, 'latin1') : Buffer.from(Array.from(s).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]));
  const out = [];
  const seen = new Set();
  for (const r of recs) {
    if (r.nameID in wants) { out.push({ ...r, bytes: enc(r.platformID, wants[r.nameID]) }); seen.add(`${r.platformID}:${r.nameID}`); }
    else out.push(r);
  }
  // Add typographic family/style for each platform that carries a family record but lacks them.
  for (const r of recs.filter((x) => x.nameID === 1)) for (const id of [16, 17]) {
    if (!seen.has(`${r.platformID}:${id}`)) { out.push({ ...r, nameID: id, bytes: enc(r.platformID, wants[id]) }); seen.add(`${r.platformID}:${id}`); }
  }
  out.sort((a, z) => a.platformID - z.platformID || a.encodingID - z.encodingID || a.languageID - z.languageID || a.nameID - z.nameID);
  const strings = []; let so = 0;
  for (const r of out) { r.offset = so; r.length = r.bytes.length; strings.push(r.bytes); so += r.length; }
  const head = Buffer.alloc(6 + out.length * 12);
  head.writeUInt16BE(0, 0); head.writeUInt16BE(out.length, 2); head.writeUInt16BE(6 + out.length * 12, 4);
  out.forEach((r, i) => { const o = 6 + i * 12; head.writeUInt16BE(r.platformID, o); head.writeUInt16BE(r.encodingID, o + 2); head.writeUInt16BE(r.languageID, o + 4); head.writeUInt16BE(r.nameID, o + 6); head.writeUInt16BE(r.length, o + 8); head.writeUInt16BE(r.offset, o + 10); });
  let newName = Buffer.concat([head, ...strings]);
  const pad = (4 - (newName.length % 4)) % 4; if (pad) newName = Buffer.concat([newName, Buffer.alloc(pad)]);
  // Append the new table at the end and repoint the directory entry (offsets of other tables unchanged).
  let end = b.length; const endPad = (4 - (end % 4)) % 4;
  const result = Buffer.concat([b, Buffer.alloc(endPad), newName]);
  result.writeUInt32BE(end + endPad, nameRec.dirOffset + 8);
  result.writeUInt32BE(newName.length - pad, nameRec.dirOffset + 12);
  return result;
}
