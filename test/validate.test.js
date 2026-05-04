/**
 * Tests for validateBody() from functions/api/_validate.js
 * Run with: node --test test/validate.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody } from '../functions/api/_validate.js';

const SCHEMA = {
  name:    { type: 'string',  required: true,  maxLength: 200 },
  email:   { type: 'email',   required: true },
  age:     { type: 'number',  required: false, min: 1, max: 120 },
  active:  { type: 'boolean', required: false },
  note:    { type: 'string',  required: false, maxLength: 50 },
};

describe('validateBody -- non-object body', () => {
  it('rejects null', () => {
    const result = validateBody(null, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.ok(result.error);
  });

  it('rejects array', () => {
    const result = validateBody([], SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('rejects string', () => {
    const result = validateBody('hello', SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('rejects number', () => {
    const result = validateBody(42, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });
});

describe('validateBody -- missing required fields', () => {
  it('rejects missing name', () => {
    const result = validateBody({ email: 'a@b.com' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /name/);
  });

  it('rejects missing email', () => {
    const result = validateBody({ name: 'Alice' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /email/);
  });

  it('rejects empty string for required field', () => {
    const result = validateBody({ name: '', email: 'a@b.com' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('rejects null for required field', () => {
    const result = validateBody({ name: null, email: 'a@b.com' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });
});

describe('validateBody -- maxLength enforcement', () => {
  it('rejects name over 200 chars', () => {
    const result = validateBody({ name: 'a'.repeat(201), email: 'a@b.com' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /name/);
  });

  it('accepts name exactly at 200 chars', () => {
    const result = validateBody({ name: 'a'.repeat(200), email: 'a@b.com' }, SCHEMA);
    assert.equal(result.valid, true);
  });

  it('rejects note over 50 chars', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', note: 'x'.repeat(51) }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /note/);
  });
});

describe('validateBody -- valid body (null return)', () => {
  it('returns valid:true with trimmed data for complete valid input', () => {
    const result = validateBody({ name: '  Alice  ', email: 'Alice@Example.COM' }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.name, 'Alice');
    assert.equal(result.data.email, 'alice@example.com');
  });

  it('optional fields can be omitted', () => {
    const result = validateBody({ name: 'Bob', email: 'b@c.com' }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.name, 'Bob');
    assert.equal('age' in result.data, false);
    assert.equal('active' in result.data, false);
  });

  it('optional fields are included when present and valid', () => {
    const result = validateBody({ name: 'Bob', email: 'b@c.com', age: 30, active: true }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.age, 30);
    assert.equal(result.data.active, true);
  });

  it('strips unknown fields', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', injected: 'evil' }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal('injected' in result.data, false);
  });
});

describe('validateBody -- email type checks', () => {
  it('rejects invalid email format', () => {
    const result = validateBody({ name: 'Alice', email: 'not-an-email' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /email/);
  });

  it('rejects email with spaces', () => {
    const result = validateBody({ name: 'Alice', email: 'hello world@domain.com' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('rejects email over 254 chars', () => {
    const longEmail = 'a'.repeat(250) + '@b.co';
    const result = validateBody({ name: 'Alice', email: longEmail }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('normalizes email to lowercase', () => {
    const result = validateBody({ name: 'Alice', email: 'HELLO@EXAMPLE.COM' }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.email, 'hello@example.com');
  });
});

describe('validateBody -- number type checks', () => {
  it('rejects age below min', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', age: 0 }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('rejects age above max', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', age: 121 }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('coerces numeric string to number', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', age: '42' }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.age, 42);
  });

  it('rejects non-numeric string', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', age: 'notanumber' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });
});

describe('validateBody -- boolean type checks', () => {
  it('rejects string "true" for boolean field', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', active: 'true' }, SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('accepts true', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', active: true }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.active, true);
  });

  it('accepts false', () => {
    const result = validateBody({ name: 'Alice', email: 'a@b.com', active: false }, SCHEMA);
    assert.equal(result.valid, true);
    assert.equal(result.data.active, false);
  });
});

describe('validateBody -- minLength enforcement', () => {
  const schemaWithMin = {
    code: { type: 'string', required: true, minLength: 6 },
  };

  it('rejects string shorter than minLength', () => {
    const result = validateBody({ code: 'abc' }, schemaWithMin);
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  it('accepts string meeting minLength', () => {
    const result = validateBody({ code: 'abcdef' }, schemaWithMin);
    assert.equal(result.valid, true);
  });
});

describe('validateBody -- enum type', () => {
  it('accepts a value in the allowed set', () => {
    const r = validateBody({ tier: 'gold' }, {
      tier: { type: 'enum', values: ['gold', 'silver', 'bronze'], required: true },
    });
    assert.equal(r.valid, true);
    assert.equal(r.data.tier, 'gold');
  });

  it('rejects a value not in the allowed set', () => {
    const r = validateBody({ tier: 'platinum' }, {
      tier: { type: 'enum', values: ['gold', 'silver'], required: true },
    });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /tier/);
  });

  it('rejects non-string enum values', () => {
    const r = validateBody({ tier: 1 }, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  it('treats absent enum as missing -> uses required logic', () => {
    const requiredResult = validateBody({}, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(requiredResult.valid, false);

    const optionalResult = validateBody({}, {
      tier: { type: 'enum', values: ['gold'], required: false },
    });
    assert.equal(optionalResult.valid, true);
    assert.equal(optionalResult.data.tier, undefined);
  });

  it('strips whitespace before enum check', () => {
    const r = validateBody({ tier: '  gold  ' }, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(r.valid, true);
    assert.equal(r.data.tier, 'gold');
  });
});
