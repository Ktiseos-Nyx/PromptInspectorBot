import { describe, it, expect, vi } from 'vitest';
import {
  isTrusted, isTrustedResolved, calculateScamScore, algoSpeakScore,
  detectDisguisedExecutable, isGifLink, isMediaMessage, hasHoneypotRole,
  trackMessage, checkMediaVelocity, isRecentJoin, mediaRaidThreshold,
  effectiveAuthor, setClient, PLURALKIT_APP_ID,
  type AuthorResolution,
} from './security';
import { PermissionFlagsBits, Collection } from 'discord.js';
import type { ResolvedModConfig } from './settings-types';

function cfg(over: Partial<ResolvedModConfig> = {}): ResolvedModConfig {
  return {
    alertChannelIds: new Set(),
    trustedRoleIds: new Set(),
    trustedUserIds: new Set(),
    monitoredChannelIds: new Set(),
    catcherRoleId: null,
    mediaSpamChannels: 4,
    mediaSpamSameChannels: 3,
    mediaSpamWindowSec: 120,
    largeMediaTypes: new Set(['image/gif']),
    honeypotMode: 'crosspost',
    gifSourceDomains: [],
    blockedImageDomains: [],
    ...over,
  };
}

function fakeMessage(over: any = {}): any {
  return {
    author: { id: 'u1', username: 'normal', avatar: 'abc' },
    content: '',
    guild: { ownerId: 'owner', members: { cache: new Map() } },
    member: { displayName: 'normal', roles: { cache: new Map([['everyone', {}]]) }, permissions: { has: () => false } },
    attachments: new Map(),
    webhookId: undefined,
    ...over,
  };
}

function whMsg(over: any = {}): any {
  const memberCache = new Collection<string, any>();
  memberCache.set('aliceId', { id: 'aliceId', displayName: 'Alice', user: { username: 'Alice' }, permissions: { has: () => false }, roles: { cache: new Map() } });
  return fakeMessage({
    webhookId: 'wh123',
    member: null,
    author: { id: 'webhook_user', username: 'Alice', avatar: null },
    guild: {
      ownerId: 'owner',
      members: { cache: memberCache },
    },
    ...over,
  });
}

describe('isTrusted', () => {
  it('trusts a user in trustedUserIds', async () => {
    expect(await isTrusted(fakeMessage({ author: { id: 'u1' } }), cfg({ trustedUserIds: new Set(['u1']) }))).toBe(true);
  });

  it('trusts the guild owner', async () => {
    expect(await isTrusted(fakeMessage({ author: { id: 'owner' } }), cfg())).toBe(true);
  });

  it('trusts a member holding a trusted role', async () => {
    const m = fakeMessage({
      author: { id: 'u9' },
      member: { displayName: 'x', roles: { cache: new Map([['mod-role', {}]]) } },
    });
    expect(await isTrusted(m, cfg({ trustedRoleIds: new Set(['mod-role']) }))).toBe(true);
  });

  it('does not trust an unknown user with no trusted role', async () => {
    expect(await isTrusted(fakeMessage({ author: { id: 'u9' } }), cfg())).toBe(false);
  });

  it('trusts a bot via cached member roles when message.member is absent (webhook/interaction)', async () => {
    const m = fakeMessage({
      author: { id: 'carlbot' },
      member: null,
      guild: {
        ownerId: 'owner',
        members: { cache: new Map([['carlbot', { roles: { cache: new Map([['mod-role', {}]]) }, permissions: { has: () => false } }]]) },
      },
    });
    expect(await isTrusted(m, cfg({ trustedRoleIds: new Set(['mod-role']) }))).toBe(true);
  });

  it('does not trust a cached bot member lacking the trusted role', async () => {
    const m = fakeMessage({
      author: { id: 'carlbot' },
      member: null,
      guild: {
        ownerId: 'owner',
        members: { cache: new Map([['carlbot', { roles: { cache: new Map([['random', {}]]) }, permissions: { has: () => false } }]]) },
      },
    });
    expect(await isTrusted(m, cfg({ trustedRoleIds: new Set(['mod-role']) }))).toBe(false);
  });

  it('allows admin permission bypass for non-webhook messages', async () => {
    const m = fakeMessage({
      author: { id: 'admin1' },
      member: {
        displayName: 'admin',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.Administrator },
      },
    });
    expect(await isTrusted(m, cfg())).toBe(true);
  });

  it('allows ManageMessages permission bypass for non-webhook messages', async () => {
    const m = fakeMessage({
      author: { id: 'mod1' },
      member: {
        displayName: 'mod',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.ManageMessages },
      },
    });
    expect(await isTrusted(m, cfg())).toBe(true);
  });
});

describe('isTrustedResolved', () => {
  const msg = fakeMessage();

  it('trusts a user in trustedUserIds', () => {
    const who: AuthorResolution = { kind: 'user', id: 'u1', member: null };
    expect(isTrustedResolved(who, msg, cfg({ trustedUserIds: new Set(['u1']) }))).toBe(true);
  });

  it('trusts the guild owner', () => {
    const who: AuthorResolution = { kind: 'user', id: 'owner', member: null };
    expect(isTrustedResolved(who, msg, cfg())).toBe(true);
  });

  it('trusts a member with Administrator permission (direct Discord auth)', () => {
    const who: AuthorResolution = {
      kind: 'user', id: 'admin', member: {
        displayName: 'admin',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.Administrator },
      } as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(true);
  });

  it('does NOT grant permission bypass for proxy_webhook (name-based, not authenticated)', () => {
    const who: AuthorResolution = {
      kind: 'proxy_webhook', id: 'admin', member: {
        displayName: 'admin',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.Administrator },
      } as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(false);
  });

  it('does NOT grant permission bypass for proxy_webhook even with ManageGuild', () => {
    const who: AuthorResolution = {
      kind: 'proxy_webhook', id: 'mod', member: {
        displayName: 'mod',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.ManageGuild },
      } as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(false);
  });

  it('does NOT grant permission bypass for proxy_webhook even with ManageMessages', () => {
    const who: AuthorResolution = {
      kind: 'proxy_webhook', id: 'msgmod', member: {
        displayName: 'msgmod',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.ManageMessages },
      } as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(false);
  });

  it('does NOT bypass via MentionEveryone (removed from bypass list)', () => {
    const who: AuthorResolution = {
      kind: 'user', id: 'mentioner', member: {
        displayName: 'mentioner',
        roles: { cache: new Map() },
        permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.MentionEveryone },
      } as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(false);
  });

  it('checks trustedUserIds for proxy_webhook by resolved id', () => {
    const who: AuthorResolution = {
      kind: 'proxy_webhook', id: 'trustedProxy', member: {} as any,
    };
    expect(isTrustedResolved(who, msg, cfg({ trustedUserIds: new Set(['trustedProxy']) }))).toBe(true);
  });

  it('checks guild owner for proxy_webhook by resolved id', () => {
    const who: AuthorResolution = {
      kind: 'proxy_webhook', id: 'owner', member: {} as any,
    };
    expect(isTrustedResolved(who, msg, cfg())).toBe(true);
  });
});

describe('effectiveAuthor', () => {
  it('returns user kind for normal messages', async () => {
    const m = fakeMessage({ author: { id: 'u1' }, member: { displayName: 'Bob' } });
    const who = await effectiveAuthor(m);
    expect(who.kind).toBe('user');
    if (who.kind !== 'user') throw new Error('expected user kind');
    expect(who.id).toBe('u1');
  });

  it('returns unknown_webhook for non-proxy webhooks when client not set', async () => {
    const m = whMsg();
    const who = await effectiveAuthor(m);
    expect(who.kind).toBe('unknown_webhook');
  });

  it('returns user kind with null member for a message without member (e.g. partial)', async () => {
    const m = fakeMessage({ author: { id: 'u1' }, member: null });
    const who = await effectiveAuthor(m);
    expect(who.kind).toBe('user');
    if (who.kind !== 'user') throw new Error('expected user kind');
    expect(who.id).toBe('u1');
    expect(who.member).toBeNull();
  });

  it('returns proxy_webhook via PK API for verified PluralKit webhook', async () => {
    const fetchWebhook = vi.fn().mockResolvedValue({ applicationId: PLURALKIT_APP_ID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sender: 'aliceId' }),
    }));
    setClient({ fetchWebhook } as any);
    try {
      const m = whMsg();
      const who = await effectiveAuthor(m);
      expect(who.kind).toBe('proxy_webhook');
      if (who.kind !== 'proxy_webhook') throw new Error('expected proxy_webhook kind');
      expect(who.id).toBe('aliceId');
      expect(fetchWebhook).toHaveBeenCalledTimes(1);
    } finally {
      setClient(null as any);
      vi.unstubAllGlobals();
    }
  });

  it('falls back to name-matching when PK API is unreachable', async () => {
    const fetchWebhook = vi.fn().mockResolvedValue({ applicationId: PLURALKIT_APP_ID });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    setClient({ fetchWebhook } as any);
    try {
      const m = whMsg();
      const who = await effectiveAuthor(m);
      expect(who.kind).toBe('proxy_webhook');
      if (who.kind !== 'proxy_webhook') throw new Error('expected proxy_webhook kind');
      expect(who.id).toBe('aliceId');
    } finally {
      setClient(null as any);
      vi.unstubAllGlobals();
    }
  });

  it('returns unknown_webhook when PK API fails and name-matching has no match', async () => {
    const fetchWebhook = vi.fn().mockResolvedValue({ applicationId: PLURALKIT_APP_ID });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    setClient({ fetchWebhook } as any);
    try {
      const m = whMsg({ author: { id: 'wh', username: 'NoMatch' }, guild: { ownerId: 'owner', members: { cache: new Collection() } } });
      const who = await effectiveAuthor(m);
      expect(who.kind).toBe('unknown_webhook');
    } finally {
      setClient(null as any);
      vi.unstubAllGlobals();
    }
  });

  it('caches webhook verification so second call reuses fetchWebhook result', async () => {
    const fetchWebhook = vi.fn().mockResolvedValue({ applicationId: PLURALKIT_APP_ID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sender: 'aliceId' }),
    }));
    setClient({ fetchWebhook } as any);
    try {
      const m = whMsg({ webhookId: 'whCacheTest' });
      await effectiveAuthor(m);
      await effectiveAuthor(m);
      expect(fetchWebhook).toHaveBeenCalledTimes(1);
    } finally {
      setClient(null as any);
      vi.unstubAllGlobals();
    }
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
  it('algoSpeakScore flags zero-width characters', () => {
    expect(algoSpeakScore('hi​there friend')).toBeGreaterThanOrEqual(40);
  });
});

describe('detectDisguisedExecutable', () => {
  it('flags a Windows MZ executable', () => {
    expect(detectDisguisedExecutable(Buffer.from([0x4d, 0x5a, 0x00, 0x00]))).not.toBeNull();
  });
  it('flags a Linux ELF binary', () => {
    expect(detectDisguisedExecutable(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).not.toBeNull();
  });
  it('does NOT flag content that only shares the first two ELF bytes', () => {
    expect(detectDisguisedExecutable(Buffer.from([0x7f, 0x45, 0x00, 0x00]))).toBeNull();
  });
  it('does NOT flag a JSON error body (expired CDN link → {"me…)', () => {
    expect(detectDisguisedExecutable(Buffer.from('{"message":"gone"}', 'ascii'))).toBeNull();
  });
  it('does NOT flag a normal PNG', () => {
    expect(detectDisguisedExecutable(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
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
  it('is not fooled by a look-alike host (proper URL parse, not substring)', () => {
    expect(isGifLink('https://tenor.com.evil.com/x', domains)).toBe(false);
    expect(isGifLink('https://eviltenor.com/x', domains)).toBe(false);
    expect(isGifLink('https://evil.com/path?u=tenor.com/x', domains)).toBe(false);
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
  it('is true for a video attachment (e.g. a video/mp4 GIF)', () => {
    const m = mediaMsg({ attachments: new Map([['f', { contentType: 'video/mp4', name: 'a.mp4', size: 10 }]]) });
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
    expect(v.sameChannels).toBe(1);
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
  });

  it('excludes entries older than the window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const att = new Map([['f', { name: 'p.png', size: 5, contentType: 'image/png' }]]);
      trackMessage(mediaMsg({ author: { id: 'win1' }, channelId: 'a', attachments: att }), dom);
      vi.setSystemTime(200_000);
      const cur = mediaMsg({ author: { id: 'win1' }, channelId: 'b', attachments: att });
      trackMessage(cur, dom);
      const v = checkMediaVelocity(cur, 120);
      expect(v.mediaChannels).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isRecentJoin', () => {
  const now = 1_000_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  it('is false when the join time is unknown', () => {
    expect(isRecentJoin(null, now)).toBe(false);
    expect(isRecentJoin(undefined, now)).toBe(false);
  });
  it('is true for a member who joined within the window', () => {
    expect(isRecentJoin(now - 3 * day, now)).toBe(true);
  });
  it('is false for a member who joined before the window', () => {
    expect(isRecentJoin(now - 8 * day, now)).toBe(false);
  });
});

describe('mediaRaidThreshold', () => {
  it('lowers the threshold for an uploaded risky type from a recent joiner', () => {
    expect(mediaRaidThreshold(4, true, true)).toBe(2);
  });
  it('keeps the base threshold for an established member (no recent join)', () => {
    expect(mediaRaidThreshold(4, true, false)).toBe(4);
  });
  it('keeps the base threshold when there is no risky upload', () => {
    expect(mediaRaidThreshold(4, false, true)).toBe(4);
  });
  it('never produces a threshold above an already-low base', () => {
    expect(mediaRaidThreshold(2, true, true)).toBe(2);
  });
});
