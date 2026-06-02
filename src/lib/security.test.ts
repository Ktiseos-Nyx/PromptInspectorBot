import { describe, it, expect } from 'vitest';
import { isTrusted, calculateScamScore, algoSpeakScore, verifyImageSafety } from './security';
import type { ResolvedModConfig } from './settings-types';

function cfg(over: Partial<ResolvedModConfig> = {}): ResolvedModConfig {
  return {
    alertChannelIds: new Set(),
    trustedRoleIds: new Set(),
    trustedUserIds: new Set(),
    monitoredChannelIds: new Set(),
    catcherRoleId: null,
    ...over,
  };
}

function fakeMessage(over: any = {}): any {
  return {
    author: { id: 'u1', username: 'normal', avatar: 'abc' },
    content: '',
    guild: { ownerId: 'owner' },
    member: { displayName: 'normal', roles: { cache: new Map([['everyone', {}]]) } },
    attachments: new Map(),
    ...over,
  };
}

describe('isTrusted', () => {
  it('trusts a user in trustedUserIds', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'u1' } }), cfg({ trustedUserIds: new Set(['u1']) }))).toBe(true);
  });

  it('trusts the guild owner', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'owner' } }), cfg())).toBe(true);
  });

  it('trusts a member holding a trusted role (NEW capability)', () => {
    const m = fakeMessage({
      author: { id: 'u9' },
      member: { displayName: 'x', roles: { cache: new Map([['mod-role', {}]]) } },
    });
    expect(isTrusted(m, cfg({ trustedRoleIds: new Set(['mod-role']) }))).toBe(true);
  });

  it('does not trust an unknown user with no trusted role', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'u9' } }), cfg())).toBe(false);
  });
});

describe('calculateScamScore', () => {
  it('flags the only-catcher-role case using the per-guild catcher role', () => {
    const m = fakeMessage({
      content: '',
      member: { displayName: 'n', roles: { cache: new Map([['everyone', {}], ['catch', {}]]) } },
    });
    const [score, reasons] = calculateScamScore(m, cfg({ catcherRoleId: 'catch' }));
    expect(reasons.some(r => /CATCHER/i.test(r))).toBe(true);
    expect(score).toBeGreaterThanOrEqual(30);
  });
});

describe('pure scorers still work', () => {
  it('verifyImageSafety rejects an MZ executable', () => {
    expect(verifyImageSafety(Buffer.from([0x4d, 0x5a, 0x00, 0x00]), 'x.png')[0]).toBe(false);
  });
  it('algoSpeakScore flags zero-width characters', () => {
    expect(algoSpeakScore('hi​there friend')).toBeGreaterThanOrEqual(40);
  });
});
