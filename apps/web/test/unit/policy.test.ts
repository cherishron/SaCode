import { describe, it, expect } from 'vitest';
import { isAllowedReadAction, assertResourceBinding } from '../../server/daemon/policy.js';

describe('policy', () => {
  it('readonly methods allowed', () => {
    expect(isAllowedReadAction('initialize')).toBe(true);
    expect(isAllowedReadAction('session/catalog')).toBe(true);
    expect(isAllowedReadAction('session/events')).toBe(true);
  });
  it('write/turn methods blocked', () => {
    expect(isAllowedReadAction('task/start')).toBe(false);
    expect(isAllowedReadAction('turn/poll')).toBe(false);
  });
  it('binding: no bound workspace', () => {
    const r = assertResourceBinding('w1', null);
    expect(r.isolated).toBe(false);
    expect(r.reason).toBe('no-bound-workspace');
  });
  it('binding: mismatch', () => {
    const r = assertResourceBinding('w2', 'w1');
    expect(r.isolated).toBe(false);
    expect(r.reason).toBe('workspace-mismatch');
  });
  it('binding: match', () => {
    const r = assertResourceBinding('w1', 'w1');
    expect(r.isolated).toBe(true);
  });
});
