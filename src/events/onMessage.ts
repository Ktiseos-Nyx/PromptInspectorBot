import { Events, Message, DMChannel, type Client } from 'discord.js';
import { extractMetadataFromBuffer } from '../lib/metadata';
import { addToCache } from '../lib/cache';
import { SCAN_LIMIT_BYTES, DM_ALLOWED_USER_IDS, DM_RESPONSE_MESSAGE, ENV_MOD_DEFAULTS, GIF_SOURCE_DOMAINS } from '../lib/config';
import { getGuildSetting, getModeration } from '../lib/guild-settings';
import { trackMessage, checkCrossPosting, isGibberish, calculateScamScore, verifyImageSafety, checkEmbedImages, algoSpeakScore, instantBan, alertAdmins, isTrusted, isMediaMessage, hasHoneypotRole, checkMediaVelocity, checkMentionSpam } from '../lib/security';
import { isUserBanned, isPatternBanned, recordBan, recordPattern, checkWordPatterns } from '../lib/ban-registry';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
const processedUrls = new Set<string>();

export function registerMessageEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot && !message.webhookId) return;
    if (message.author.id === client.user?.id) return;

    // ── DM handling ─────────────────────────────────────────────────────────
    if (message.channel instanceof DMChannel) {
      if (!DM_ALLOWED_USER_IDS.has(message.author.id)) {
        await message.channel.send(DM_RESPONSE_MESSAGE).catch(() => null);
      }
      return;
    }

    if (!message.guild) return;

    // ── Resolve this guild's moderation config (per-guild value or env fallback) ──
    const mod = getModeration(message.guildId!, ENV_MOD_DEFAULTS);

    // ── Channel filtering (per-guild monitored channels; empty = all) ───────────
    const channelId = ('parentId' in message.channel && message.channel.parentId)
      ? message.channel.parentId
      : message.channelId;
    if (mod.monitoredChannelIds.size && !mod.monitoredChannelIds.has(channelId)) return;

    // ── Security checks (independent of the metadata toggle) ─────────────────────
    const securityEnabled = getGuildSetting(message.guildId!, 'security', true);

    if (securityEnabled && !isTrusted(message, mod)) {
      // ── Known banned user ──────────────────────────────────────────────────
      const knownBan = isUserBanned(message.author.id);
      if (knownBan) {
        await instantBan(message, `Known banned user: ${knownBan.reason}`, mod, ['In ban registry']);
        return;
      }

      // ── Known banned message pattern ───────────────────────────────────────
      if (message.content) {
        const knownPattern = isPatternBanned(message.content);
        if (knownPattern) {
          await instantBan(message, `Known banned pattern: ${knownPattern.reason}`, mod, ['Pattern registry match']);
          recordBan(message.author.id, message.guildId!, `Pattern match: ${knownPattern.reason}`);
          return;
        }

        // ── Word pattern filter ──────────────────────────────────────────────
        const wordMatch = checkWordPatterns(message.content);
        if (wordMatch) {
          if (wordMatch.action === 'ban') {
            recordBan(message.author.id, message.guildId!, `Word pattern: ${wordMatch.reason}`);
            await instantBan(message, `Word pattern match: ${wordMatch.reason}`, mod, [`Pattern: ${wordMatch.pattern}`]);
            return;
          }
          if (wordMatch.action === 'delete') {
            await message.delete().catch(() => null);
            await alertAdmins(message.guild!, message.member ?? message.author as any,
              `Word pattern match: ${wordMatch.reason}`, [`Pattern: ${wordMatch.pattern}`], 'DELETED', mod);
            return;
          }
          if (wordMatch.action === 'warn') {
            await alertAdmins(message.guild!, message.member ?? message.author as any,
              `Word pattern match: ${wordMatch.reason}`, [`Pattern: ${wordMatch.pattern}`, `Message: ${message.content.slice(0, 100)}`], 'ALERT', mod);
          }
        }
      }

      trackMessage(message, GIF_SOURCE_DOMAINS);

      const userHasRoles = (message.member?.roles.cache.size ?? 1) > 1;
      const imageAttachments = message.attachments.filter(a => a.contentType?.startsWith('image/'));
      const hasImages = imageAttachments.size > 0;
      const isMedia = isMediaMessage(message, GIF_SOURCE_DOMAINS);

      // ── Magic bytes — attachments ──────────────────────────────────────────
      if (hasImages) {
        for (const att of imageAttachments.values()) {
          try {
            const res = await fetch(att.url);
            const buf = Buffer.from(await res.arrayBuffer());
            const [safe, reason] = verifyImageSafety(buf, att.name);
            if (!safe) {
              await instantBan(message, reason, mod);
              return;
            }
          } catch { /* skip on network error */ }
        }
      }

      // ── Magic bytes — embeds ───────────────────────────────────────────────
      if (message.embeds.length > 0) {
        const embedReason = await checkEmbedImages(message);
        if (embedReason) {
          await instantBan(message, `Malicious embed: ${embedReason}`, mod);
          return;
        }
      }

      // ── Algo speak detection ───────────────────────────────────────────────
      // Only fires when combined with cross-channel posting — not on its own.
      // Targets illegal content bots that obfuscate text to evade filters.
      const algoScore = message.content ? algoSpeakScore(message.content) : 0;
      if (algoScore >= 40) {
        const crossPosts = checkCrossPosting(message);
        if (crossPosts >= 2) {
          const reason = `Algo speak + cross-posting (algo score: ${algoScore}, channels: ${crossPosts})`;
          recordPattern(message.content, reason);
          recordBan(message.author.id, message.guildId!, reason);
          await instantBan(message, reason, mod, ['Obfuscated text', `${crossPosts} channels`, `Algo score: ${algoScore}`]);
          return;
        }
        // High score alone (heavy zalgo/ZWC) — delete and alert without banning
        if (algoScore >= 100) {
          await message.delete().catch(() => null);
          await alertAdmins(message.guild, message.member ?? message.author as any,
            `Heavy text obfuscation (score: ${algoScore})`, ['Possible evasion attempt'], 'ALERT', mod);
        }
      }

      // ── Media cross-post velocity ──────────────────────────────────────────
      // Runs for ANY media (uploads OR GIF links). Two tracks: identical reposts
      // (low bar) and any-media bursts (catches different GIFs). Honeypot role
      // escalates per the configured mode.
      if (isMedia) {
        const { sameChannels, mediaChannels, maxBytes } = checkMediaVelocity(message, mod.mediaSpamWindowSec);

        // Honeypot escalation
        if (hasHoneypotRole(message, mod) && mod.honeypotMode !== 'off') {
          if (mod.honeypotMode === 'strict' || mediaChannels >= 2) {
            const reason = `Honeypot role + media (${mod.honeypotMode})`;
            recordBan(message.author.id, message.guildId!, reason);
            await instantBan(message, reason, mod, ['Honeypot/catcher role', `mode: ${mod.honeypotMode}`]);
            return;
          }
        }

        // Identity track — same file reposted across channels (low bar)
        if (sameChannels >= mod.mediaSpamSameChannels) {
          const reason = `Repost spam (same media in ${sameChannels} channels / ${mod.mediaSpamWindowSec}s)`;
          if (message.content) recordPattern(message.content, reason);
          recordBan(message.author.id, message.guildId!, reason);
          await instantBan(message, reason, mod, [`${sameChannels} channels`, 'Identical media']);
          return;
        }

        // Large-media fast path — a heavy payload of a flagged type lowers the bar.
        // Checks ALL attachments (not just images) so configured types like
        // video/mp4 are honoured; MIME is lowercased to match stored values.
        const hasLargeMedia = [...message.attachments.values()].some(
          a => a.contentType != null && mod.largeMediaTypes.has(a.contentType.toLowerCase()) && a.size >= mod.largeMediaBytes,
        );
        const mediaThreshold = hasLargeMedia ? Math.min(2, mod.mediaSpamChannels) : mod.mediaSpamChannels;

        // Media-type track — any media across channels (catches different GIFs)
        if (mediaChannels >= mediaThreshold) {
          const payloadDetail = maxBytes > 0 ? `Max ${Math.round(maxBytes / 1024)}KB` : 'GIF link(s)';
          const reason = `Media spam (${mediaChannels} channels / ${mod.mediaSpamWindowSec}s${hasLargeMedia ? ', large payload' : ''})`;
          recordBan(message.author.id, message.guildId!, reason);
          await instantBan(message, reason, mod, [`${mediaChannels} channels`, payloadDetail]);
          return;
        }

        // Standalone single-message case: 4+ images + no roles + gibberish. Lower-
        // confidence heuristic, so intentionally NOT written to the cross-server ban
        // registry (no recordBan) — unlike the velocity tracks above.
        if (imageAttachments.size >= 4 && !userHasRoles && isGibberish(message.content, false, hasImages)) {
          await instantBan(message, 'Screenshot spam + gibberish', mod,
            [`${imageAttachments.size} images`, 'No roles', 'Gibberish text']);
          return;
        }
      }

      // ── Wallet scam scoring ────────────────────────────────────────────────
      const [score, reasons] = calculateScamScore(message, mod);
      if (score >= 100) {
        recordPattern(message.content, `Wallet scam score ${score}`);
        recordBan(message.author.id, message.guildId!, `Wallet scam score ${score}`);
        await instantBan(message, `Wallet scam (score: ${score})`, mod, reasons);
        return;
      }
      if (score >= 75) {
        await message.delete().catch(() => null);
        await alertAdmins(message.guild, message.member ?? message.author as any,
          `Suspicious message (score: ${score})`, reasons, 'DELETED', mod);
        return;
      }

      // ── Mention spam detection ─────────────────────────────────────────────
      if (message.mentions) {
        const [mentionScore, mentionReasons] = checkMentionSpam(message);
        if (mentionScore >= 100) {
          const r = `Mention spam (score: ${mentionScore})`;
          recordPattern(message.content, r);
          recordBan(message.author.id, message.guildId!, r);
          await instantBan(message, r, mod, mentionReasons);
          return;
        }
        if (mentionScore >= 50) {
          await message.delete().catch(() => null);
          await alertAdmins(message.guild, message.member ?? message.author as any,
            `Mention spam (score: ${mentionScore})`, mentionReasons, 'DELETED', mod);
          return;
        }
      }
    }

    // ── PNG metadata processing (independent of security) ───────────────────────
    if (!getGuildSetting(message.guildId!, 'metadata', true)) return;
    const pngAttachments = message.attachments.filter(
      a => a.name.toLowerCase().endsWith('.png') && a.size < SCAN_LIMIT_BYTES
    );
    if (pngAttachments.size === 0) return;

    const first = pngAttachments.first()!;

    // PluralKit: wait briefly then confirm message still exists
    if (!message.webhookId) {
      await new Promise(r => setTimeout(r, 500));
      const stillThere = await message.channel.messages.fetch(message.id).catch(() => null);
      if (!stillThere) return;
    }

    if (processedUrls.has(first.url)) return;
    processedUrls.add(first.url);
    if (processedUrls.size > 500) processedUrls.clear();

    try {
      const imagesWithMeta: Array<{ name: string; url: string; meta: Record<string, any> }> = [];

      for (const att of pngAttachments.values()) {
        const res = await fetch(att.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const result = await extractMetadataFromBuffer(buf, 'image/png', att.name, att.size, new Date().toISOString());
        if (result.ai && Object.keys(result.ai).length > 0) {
          imagesWithMeta.push({ name: att.name, url: att.url, meta: result });
        }
      }

      if (imagesWithMeta.length === 0) return;

      addToCache(message.id, imagesWithMeta);

      if (imagesWithMeta.length <= 5) {
        for (let i = 0; i < imagesWithMeta.length; i++) await message.react(NUMBER_EMOJIS[i]);
      } else {
        await message.react('📦');
      }
    } catch (err) {
      console.error('onMessage error:', err);
    }
  });
}
