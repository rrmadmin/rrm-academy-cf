/**
 * Tests for buildContactSubject() in functions/api/contact/_subject.js
 * Run with: node --test test/contact-subject.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContactSubject } from '../functions/api/contact/_subject.js';

describe('buildContactSubject', () => {
  it('builds prefix + sanitized message slice', () => {
    const s = buildContactSubject('course', 'Hello world, my course is broken');
    assert.equal(s, '[Contact][COURSE] Hello world, my course is broken');
  });

  it('uppercases the category for the prefix', () => {
    const s = buildContactSubject('stuc-billing', 'Cancel please');
    assert.equal(s, '[Contact][STUC-BILLING] Cancel please');
  });

  it('strips CR/LF from message', () => {
    const s = buildContactSubject('other', 'Hello\r\nBcc: attacker@evil.com');
    assert.equal(s, '[Contact][OTHER] Hello Bcc: attacker@evil.com');
  });

  it('strips control chars from message', () => {
    const s = buildContactSubject('other', 'Hello\x00\x01\x1f\x7fworld');
    assert.equal(s, '[Contact][OTHER] Hello world');
  });

  it('strips bidi controls from message', () => {
    const evil = '‮Hello‬';
    const s = buildContactSubject('other', evil);
    assert.equal(s.includes('‮'), false);
    assert.equal(s.includes('‬'), false);
  });

  it('collapses runs of whitespace to single space', () => {
    const s = buildContactSubject('bug', 'A    B\t\tC');
    assert.equal(s, '[Contact][BUG] A B C');
  });

  it('appends ellipsis when message exceeds 80 chars', () => {
    const long = 'x'.repeat(100);
    const s = buildContactSubject('other', long);
    assert.equal(s.endsWith('…'), true);
    // Body length: 80 chars + 1 ellipsis = 81
    const body = s.slice('[Contact][OTHER] '.length);
    assert.equal(body.length, 81);
  });

  it('does not append ellipsis when message is exactly 80 chars', () => {
    const exact = 'y'.repeat(80);
    const s = buildContactSubject('other', exact);
    assert.equal(s.endsWith('…'), false);
    assert.equal(s, `[Contact][OTHER] ${exact}`);
  });

  it('falls back to "(no preview)" when sanitized message is empty', () => {
    const s = buildContactSubject('bug', '\r\n\t   \x00');
    assert.equal(s, '[Contact][BUG] (no preview)');
  });

  it('handles unknown category by uppercasing whatever was passed', () => {
    const s = buildContactSubject('other', 'hi');
    assert.equal(s.startsWith('[Contact][OTHER]'), true);
  });
});
