import { describe, it, expect } from 'vitest';
import { generateCsrfToken, csrfEqual } from '../../server/auth/csrf.js';

describe('csrf', () => {
  it('generate length and uniqueness', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
  it('equal', () => {
    expect(csrfEqual('abc', 'abc')).toBe(true);
  });
  it('not equal', () => {
    expect(csrfEqual('abc', 'abd')).toBe(false);
  });
  it('empty/false', () => {
    expect(csrfEqual('', 'x')).toBe(false);
    expect(csrfEqual(undefined, 'x')).toBe(false);
  });
  it('length mismatch false', () => {
    expect(csrfEqual('ab', 'abc')).toBe(false);
  });
});
