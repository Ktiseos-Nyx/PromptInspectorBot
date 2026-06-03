import { describe, it, expect, vi } from 'vitest';
import {
  isTrusted, calculateScamScore, algoSpeakScore, verifyImageSafety,
  isGifLink, isMediaMessage, hasHoneypotRole, trackMessage, checkMediaVelocity,
} from './security';
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

function mediaMsg(over: any = {}): any {
  return { author: { id: 'v1' }, content: '', channelId: 'c1', attachments: new Map(), ...over };
}

describe('isGifLink', () => {
  const domains = ['tenor.com', 'giphy.com', 'media.discordapp.net'];
  it('detects a Tenor view link', () => {
    expect(isGifLink('lol https://tenor.com/view/funny-gif-123', domains)).toBe(true);
  });
  it('detects a Giphy link with a subdomain', () => {
    expect(isGifLink('https://media.giphy.com/gifs/abc.gif', domains)).toBe(true);
  });
  it('ignores plain text', () => {
    expect(isGifLink('just talking here', domains)).toBe(false);
  });
  it('ignores unknown hosts', () => {
    expect(isGifLink('https://example.com/x.gif', domains)).toBe(false);
  });
  it('returns false when no domains configured', () => {
    expect(isGifLink('https://tenor.com/view/x', [])).toBe(false);
  });
});

describe('isMediaMessage', () => {
  it('is true for an image attachment', () => {
    const m = mediaMsg({ attachments: new Map([['f', { contentType: 'image/png', name: 'a.png', size: 10 }]]) });
    expect(isMediaMessage(m, [])).toBe(true);
  });
  it('is true for a GIF link', () => {
    expect(isMediaMessage(mediaMsg({ content: 'https://tenor.com/view/x' }), ['tenor.com'])).toBe(true);
  });
  it('is false for plain text with no attachments', () => {
    expect(isMediaMessage(mediaMsg({ content: 'hello there' }), ['tenor.com'])).toBe(false);
  });
});

describe('hasHoneypotRole', () => {
  it('detects the catcher role even when other roles are present', () => {
    const m = fakeMessage({
      member: { displayName: 'x', roles: { cache: new Map([['everyone', {}], ['verified', {}], ['catch', {}]]) } },
    });
    expect(hasHoneypotRole(m, cfg({ catcherRoleId: 'catch' }))).toBe(true);
  });
  it('is false when the member lacks the catcher role', () => {
    const m = fakeMessage({ member: { displayName: 'x', roles: { cache: new Map([['everyone', {}]]) } } });
    expect(hasHoneypotRole(m, cfg({ catcherRoleId: 'catch' }))).toBe(false);
  });
  it('is false when no catcher role is configured', () => {
    const m = fakeMessage({ member: { displayName: 'x', roles: { cache: new Map([['catch', {}]]) } } });
    expect(hasHoneypotRole(m, cfg({ catcherRoleId: null }))).toBe(false);
  });
});

describe('checkMediaVelocity', () => {
  const dom = ['tenor.com'];

  it('counts distinct channels for ANY media (different GIFs)', () => {
    const mk = (ch: string, url: string) =>
      mediaMsg({ author: { id: 'gif1' }, channelId: ch, content: url });
    trackMessage(mk('a', 'https://tenor.com/view/x'), dom);
    trackMessage(mk('b', 'https://tenor.com/view/y'), dom);
    trackMessage(mk('c', 'https://tenor.com/view/z'), dom);
    const cur = mk('d', 'https://tenor.com/view/w');
    trackMessage(cur, dom);
    const v = checkMediaVelocity(cur, 120);
    expect(v.mediaChannels).toBe(4);
    expect(v.sameChannels).toBe(1); // each link is a different fingerprint
  });

  it('counts distinct channels for the SAME file reposted', () => {
    const att = new Map([['f', { name: 'pic.png', size: 1000, contentType: 'image/png' }]]);
    const mk = (ch: string) => mediaMsg({ author: { id: 'same1' }, channelId: ch, content: '', attachments: att });
    trackMessage(mk('a'), dom);
    trackMessage(mk('b'), dom);
    const cur = mk('c');
    trackMessage(cur, dom);
    const v = checkMediaVelocity(cur, 120);
    expect(v.sameChannels).toBe(3);
    expect(v.maxBytes).toBe(1000);
  });

  it('excludes entries older than the window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const att = new Map([['f', { name: 'p.png', size: 5, contentType: 'image/png' }]]);
      trackMessage(mediaMsg({ author: { id: 'win1' }, channelId: 'a', attachments: att }), dom);
      vi.setSystemTime(200_000); // 200s later
      const cur = mediaMsg({ author: { id: 'win1' }, channelId: 'b', attachments: att });
      trackMessage(cur, dom);
      const v = checkMediaVelocity(cur, 120); // 120s window excludes the 200s-old entry
      expect(v.mediaChannels).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
