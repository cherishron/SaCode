import { describe, it, expect } from 'vitest';
import { toSessionSummary, toSessionDetail, toEventFrame } from '../../server/daemon/mapper.js';
import type { RawEventFrame } from '../../server/daemon/transport.js';

describe('mapper whitelist', () => {
  it('drops extra fields from summary', () => {
    const s = toSessionSummary({
      id: 'x',
      title: 't',
      status: 'a',
      createdAt: 'c',
      updatedAt: 'u',
      secret: 'leak',
      credentialRef: 'ref',
    } as never);
    expect((s as Record<string, unknown>)['secret']).toBeUndefined();
    expect((s as Record<string, unknown>)['credentialRef']).toBeUndefined();
    expect(s.id).toBe('x');
  });

  it('detail only whitelisted', () => {
    const d = toSessionDetail({
      id: 'x',
      title: 't',
      status: 'a',
      createdAt: 'c',
      updatedAt: 'u',
      workspaceId: 'w',
      hidden: 'x',
    } as never);
    expect(d.workspaceId).toBe('w');
    expect((d as Record<string, unknown>)['hidden']).toBeUndefined();
  });

  it('event frame whitelist', () => {
    const f: RawEventFrame = {
      id: 'e1',
      kind: 'message',
      at: 't',
      summary: 'hi',
      sessionId: 's',
      generation: 1,
    };
    expect(toEventFrame(f)).toEqual({ id: 'e1', kind: 'message', at: 't', summary: 'hi' });
  });
});
