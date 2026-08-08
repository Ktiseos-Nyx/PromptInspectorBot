import { Events, Message, DMChannel, type Client } from 'discord.js';
import { extractMetadataFromBuffer } from '../lib/metadata';
import { addToCache } from '../lib/cache';
import { SCAN_LIMIT_BYTES, DM_ALLOWED_USER_IDS, DM_RESPONSE_MESSAGE, ENV_MOD_DEFAULTS, GIF_SOURCE_DOMAINS } from '../lib/config';
import { getGuildSetting, getModeration } from '../lib/guild-settings';
import { trackMessage, checkCrossPosting, isGibberish, calculateScamScore, detectDisguisedExecutable, checkEmbedImages, algoSpeakScore, instantBan, alertAdmins, isTrustedResolved, isMediaMessage, hasHoneypotRole, checkMediaVelocity, checkMentionSpam, isRecentJoin, mediaRaidThreshold, effectiveAuthor, type AuthorResolution } from '../lib/security';
import { isUserBanned, isPatternBanned, recordBan, recordPattern, checkWordPatterns } from '../lib/ban-registry';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
const processedUrls = new Set<string>();

function alertTarget(who: AuthorResolution, message: Message) {
  if (who.kind === 'proxy_webhook') return who.member;
  if (who.kind === 'user' && who.member) return who.member;
  return message.member ?? message.author;
}

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

    if (securityEnabled) {
      // Resolve once per message — both trust and ban targeting use the same
      // resolution. Resolution only occurs when security is enabled.
      const who = await effectiveAuthor(message);
      if (!isTrustedResolved(who, message, mod)) {
        const target = alertTarget(who, message);
        const canBan = who.kind === 'user';
        // ── Known banned user ────────────────────────────────────────────────
        if (canBan) {
          const knownBan = isUserBanned(who.id);
          if (knownBan) {
            await instantBan(message, `Known banned user: ${knownBan.reason}`, mod, ['In ban registry'], who);
            return;
          }
        }

        // ── Known banned message pattern ─────────────────────────────────────
        if (message.content) {
          const knownPattern = isPatternBanned(message.content);
          if (knownPattern) {
            if (canBan) recordBan(who.id, message.guildId!, `Pattern match: ${knownPattern.reason}`);
            await instantBan(message, `Known banned pattern: ${knownPattern.reason}`, mod, ['Pattern registry match'], who);
            return;
          }

          // ── Word pattern filter ────────────────────────────────────────────
          const wordMatch = checkWordPatterns(message.content);
          if (wordMatch) {
            if (wordMatch.action === 'ban') {
              if (canBan) recordBan(who.id, message.guildId!, `Word pattern: ${wordMatch.reason}`);
              await instantBan(message, `Word pattern match: ${wordMatch.reason}`, mod, [`Pattern: ${wordMatch.pattern}`], who);
              return;
            }
            if (wordMatch.action === 'delete') {
              await message.delete().catch(() => null);
              await alertAdmins(message.guild!, target,
                `Word pattern match: ${wordMatch.reason}`, [`Pattern: ${wordMatch.pattern}`], 'DELETED', mod);
              return;
            }
            if (wordMatch.action === 'warn') {
              await alertAdmins(message.guild!, target,
                `Word pattern match: ${wordMatch.reason}`, [`Pattern: ${wordMatch.pattern}`, `Message: ${message.content.slice(0, 100)}`], 'ALERT', mod);
            }
          }
        }

        trackMessage(message, GIF_SOURCE_DOMAINS);

        const userHasRoles = (message.member?.roles.cache.size ?? 1) > 1;
        const imageAttachments = message.attachments.filter(a => a.contentType?.startsWith('image/'));
        const hasImages = imageAttachments.size > 0;
        const isMedia = isMediaMessage(message, GIF_SOURCE_DOMAINS);

        // ── Magic bytes — attachments ────────────────────────────────────────
        if (hasImages) {
          for (const att of imageAttachments.values()) {
            try {
              const res = await fetch(att.url);
              const buf = Buffer.from(await res.arrayBuffer());
              const exeReason = detectDisguisedExecutable(buf);
              if (exeReason) {
                await instantBan(message, exeReason, mod, [], who);
                return;
              }
            } catch { /* skip on network error */ }
          }
        }

        // ── Magic bytes — embeds ─────────────────────────────────────────────
        if (message.embeds.length > 0) {
          const embedReason = await checkEmbedImages(message);
          if (embedReason) {
            await instantBan(message, `Malicious embed: ${embedReason}`, mod, [], who);
            return;
          }
        }

        // ── Algo speak detection ─────────────────────────────────────────────
        const algoScore = message.content ? algoSpeakScore(message.content) : 0;
        if (algoScore >= 40) {
          const crossPosts = checkCrossPosting(message);
          if (crossPosts >= 2) {
            const reason = `Algo speak + cross-posting (algo score: ${algoScore}, channels: ${crossPosts})`;
            recordPattern(message.content, reason);
            if (canBan) recordBan(who.id, message.guildId!, reason);
            await instantBan(message, reason, mod, ['Obfuscated text', `${crossPosts} channels`, `Algo score: ${algoScore}`], who);
            return;
          }
          if (algoScore >= 100) {
            await message.delete().catch(() => null);
            await alertAdmins(message.guild, target,
              `Heavy text obfuscation (score: ${algoScore})`, ['Possible evasion attempt'], 'ALERT', mod);
          }
        }

        // ── Media cross-post velocity ────────────────────────────────────────
        if (isMedia) {
          const { sameChannels, mediaChannels } = checkMediaVelocity(message, mod.mediaSpamWindowSec);

          if (hasHoneypotRole(message, mod) && mod.honeypotMode !== 'off') {
            if (mod.honeypotMode === 'strict' || mediaChannels >= 2) {
              const reason = `Honeypot role + media (${mod.honeypotMode})`;
              if (canBan) recordBan(who.id, message.guildId!, reason);
              await instantBan(message, reason, mod, ['Honeypot/catcher role', `mode: ${mod.honeypotMode}`], who);
              return;
            }
          }

          if (sameChannels >= mod.mediaSpamSameChannels) {
            const reason = `Repost spam (same media in ${sameChannels} channels / ${mod.mediaSpamWindowSec}s)`;
            if (message.content) recordPattern(message.content, reason);
            if (canBan) recordBan(who.id, message.guildId!, reason);
            await instantBan(message, reason, mod, [`${sameChannels} channels`, 'Identical media'], who);
            return;
          }

          const hasRiskyUpload = [...message.attachments.values()].some(
            a => a.contentType != null && mod.largeMediaTypes.has(a.contentType.toLowerCase()),
          );
          const recentJoin = isRecentJoin(message.member?.joinedTimestamp);
          const mediaThreshold = mediaRaidThreshold(mod.mediaSpamChannels, hasRiskyUpload, recentJoin);

          if (mediaChannels >= mediaThreshold) {
            const raid = hasRiskyUpload && recentJoin;
            const reason = `Media spam (${mediaChannels} channels / ${mod.mediaSpamWindowSec}s${raid ? ', new-member GIF upload' : ''})`;
            if (canBan) recordBan(who.id, message.guildId!, reason);
            await instantBan(message, reason, mod, [
              `${mediaChannels} channels`,
              hasRiskyUpload ? 'Direct-uploaded flagged type' : 'Mixed media',
              recentJoin ? 'Recently joined' : 'Established member',
            ], who);
            return;
          }

          if (imageAttachments.size >= 4 && !userHasRoles && isGibberish(message.content, false, hasImages)) {
            await instantBan(message, 'Screenshot spam + gibberish', mod,
              [`${imageAttachments.size} images`, 'No roles', 'Gibberish text'], who);
            return;
          }
        }

        // ── Wallet scam scoring ──────────────────────────────────────────────
        const [score, reasons] = calculateScamScore(message, mod);
        if (score >= 100) {
          recordPattern(message.content, `Wallet scam score ${score}`);
          if (canBan) recordBan(who.id, message.guildId!, `Wallet scam score ${score}`);
          await instantBan(message, `Wallet scam (score: ${score})`, mod, reasons, who);
          return;
        }
        if (score >= 75) {
          await message.delete().catch(() => null);
          await alertAdmins(message.guild, target,
            `Suspicious message (score: ${score})`, reasons, 'DELETED', mod);
          return;
        }

        // ── Mention spam detection ───────────────────────────────────────────
        if (message.mentions) {
          const [mentionScore, mentionReasons] = checkMentionSpam(message);
          if (mentionScore >= 100) {
            const r = `Mention spam (score: ${mentionScore})`;
            recordPattern(message.content, r);
            if (canBan) recordBan(who.id, message.guildId!, r);
            await instantBan(message, r, mod, mentionReasons, who);
            return;
          }
          if (mentionScore >= 50) {
            await message.delete().catch(() => null);
            await alertAdmins(message.guild, target,
              `Mention spam (score: ${mentionScore})`, mentionReasons, 'DELETED', mod);
            return;
          }
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
