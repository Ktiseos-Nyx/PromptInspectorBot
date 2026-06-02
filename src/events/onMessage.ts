import { Events, Message, DMChannel, type Client } from 'discord.js';
import { extractMetadataFromBuffer } from '../lib/metadata';
import { addToCache } from '../lib/cache';
import { SCAN_LIMIT_BYTES, DM_ALLOWED_USER_IDS, DM_RESPONSE_MESSAGE, ENV_MOD_DEFAULTS } from '../lib/config';
import { getGuildSetting, getModeration } from '../lib/guild-settings';
import { trackMessage, checkCrossPosting, isGibberish, calculateScamScore, verifyImageSafety, checkEmbedImages, algoSpeakScore, instantBan, alertAdmins, isTrusted } from '../lib/security';
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

      trackMessage(message);

      const userHasRoles = (message.member?.roles.cache.size ?? 1) > 1;
      const imageAttachments = message.attachments.filter(a => a.contentType?.startsWith('image/'));
      const hasImages = imageAttachments.size > 0;

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

      // ── Screenshot spam (4+ images + cross-posting) ────────────────────────
      if (imageAttachments.size >= 4) {
        const crossPosts = checkCrossPosting(message);
        if (crossPosts >= 2) {
          await instantBan(message, `Screenshot spam (${imageAttachments.size} images, ${crossPosts} channels)`,
            mod, [`${imageAttachments.size} images`, `${crossPosts} channels`]);
          return;
        }
        if (!userHasRoles && isGibberish(message.content, false, hasImages)) {
          await instantBan(message, `Screenshot spam + gibberish`,
            mod, [`${imageAttachments.size} images`, 'No roles', 'Gibberish text']);
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
