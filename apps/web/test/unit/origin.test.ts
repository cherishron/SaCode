import { describe, it, expect } from 'vitest';
import { checkOrigin, checkFetchMetadata } from '../../server/security/origin.js';

describe('checkOrigin', () => {
  it('exact match ok', () => {
    expect(checkOrigin('https://a.com', 'https://a.com').ok).toBe(true);
  });
  it('mismatch rejected', () => {
    expect(checkOrigin('https://b.com', 'https://a.com').ok).toBe(false);
  });
  it('missing rejected', () => {
    expect(checkOrigin(undefined, 'https://a.com').ok).toBe(false);
  });
  it('missing allowed for safe method (browser omits Origin on same-origin GET)', () => {
    expect(checkOrigin(undefined, 'https://a.com', true).ok).toBe(true);
  });
  it('missing origin still rejected by default (non-safe methods)', () => {
    expect(checkOrigin(undefined, 'https://a.com', false).ok).toBe(false);
  });
  it('mismatch still rejected even when missing allowed', () => {
    expect(checkOrigin('https://b.com', 'https://a.com', true).ok).toBe(false);
  });
});

describe('checkFetchMetadata', () => {
  it('same-origin ok', () => {
    expect(checkFetchMetadata({ 'sec-fetch-site': 'same-origin' }).ok).toBe(true);
  });
  it('none ok', () => {
    expect(checkFetchMetadata({ 'sec-fetch-site': 'none' }).ok).toBe(true);
  });
  it('cross-site rejected', () => {
    expect(checkFetchMetadata({ 'sec-fetch-site': 'cross-site' }).ok).toBe(false);
  });
  it('missing allowed (non-browser client)', () => {
    expect(checkFetchMetadata({}).ok).toBe(true);
  });
});
