import 'dotenv/config';
import fs from 'fs';
import type { EnvModDefaults } from './settings-types';
import { RateLimiter } from './rate-limiter';
import { CROSS_POST_WINDOW } from './security';

function parseIdList(envVar: string | undefined): Set<string> {
  if (!envVar || envVar === '[]') return new Set();
  return new Set(envVar.split(',').map(s => s.trim()).filter(Boolean));
}

// ── Raw config file (optional) ───────────────────────────────────────────────
let fileConfig: Record<string, any> = {};
if (fs.existsSync('config.toml')) {
  // Minimal TOML parser — only handles key = value and key = [...] on single lines
  const raw = fs.readFileSync('config.toml', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val.startsWith('[')) {
      fileConfig[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    } else {
      fileConfig[key] = val.replace(/['"]/g, '').trim();
    }
  }
}

function cfg(envKey: string, configKey: string, fallback: string): string {
  return process.env[envKey] ?? fileConfig[configKey] ?? fallback;
}

// Integer config with NaN protection + clamping, so a malformed env var (or 0/1)
// can't silently disable or undercut a security threshold.
function cfgInt(envKey: string, configKey: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = parseInt(cfg(envKey, configKey, String(fallback)), 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
}

// List config that may arrive as a CSV string (env / inline) or an array (TOML list).
function cfgList(envKey: string, configKey: string, fallback: string): string[] {
  const raw: unknown = process.env[envKey] ?? fileConfig[configKey] ?? fallback;
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
  return parts.map(s => s.trim()).filter(Boolean);
}

// ── Discord ───────────────────────────────────────────────────────────────────
export const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
export const ALLOWED_GUILD_IDS = parseIdList(process.env.ALLOWED_GUILD_IDS);
export const MONITORED_CHANNEL_IDS = parseIdList(process.env.MONITORED_CHANNEL_IDS);
export const SCAN_LIMIT_BYTES = parseInt(cfg('SCAN_LIMIT_BYTES', 'SCAN_LIMIT_BYTES', String(10 * 1024 * 1024)));
export const REACT_ON_NO_METADATA = cfg('REACT_ON_NO_METADATA', 'REACT_ON_NO_METADATA', 'false') === 'true';

// ── Security ──────────────────────────────────────────────────────────────────
export const CATCHER_ROLE_ID = process.env.CATCHER_ROLE_ID ?? fileConfig['CATCHER_ROLE_ID'] ?? '';
export const TRUSTED_USER_IDS = parseIdList(process.env.TRUSTED_USER_IDS);
export const ADMIN_CHANNEL_IDS = parseIdList(process.env.ADMIN_CHANNEL_IDS ?? process.env.ADMIN_CHANNEL_ID);
export const DM_ALLOWED_USER_IDS = parseIdList(process.env.DM_ALLOWED_USER_IDS);
export const DM_RESPONSE_MESSAGE = process.env.DM_RESPONSE_MESSAGE ?? '👋 This bot is configured for server use only.';

export const MEDIA_SPAM_CHANNELS = cfgInt('MEDIA_SPAM_CHANNELS', 'MEDIA_SPAM_CHANNELS', 4, 2);
export const MEDIA_SPAM_SAME_CHANNELS = cfgInt('MEDIA_SPAM_SAME_CHANNELS', 'MEDIA_SPAM_SAME_CHANNELS', 3, 2);
export const MEDIA_SPAM_WINDOW_SEC = cfgInt('MEDIA_SPAM_WINDOW_SEC', 'MEDIA_SPAM_WINDOW_SEC', 120, 1, CROSS_POST_WINDOW);
// Direct-upload types treated as raid-risky (default image/gif). Size is intentionally
// not configurable — abuse GIFs match normal art sizes, so size was a false signal.
export const LARGE_MEDIA_TYPES = new Set(
  cfgList('LARGE_MEDIA_TYPES', 'LARGE_MEDIA_TYPES', 'image/gif').map(s => s.toLowerCase()),
);
const HONEYPOT_MODE_RAW = cfg('HONEYPOT_MODE', 'HONEYPOT_MODE', 'crosspost');
export const HONEYPOT_MODE: 'off' | 'crosspost' | 'strict' =
  HONEYPOT_MODE_RAW === 'off' || HONEYPOT_MODE_RAW === 'strict' ? HONEYPOT_MODE_RAW : 'crosspost';
export const GIF_SOURCE_DOMAINS = cfgList(
  'GIF_SOURCE_DOMAINS', 'GIF_SOURCE_DOMAINS',
  'tenor.com,giphy.com,gfycat.com,media.discordapp.net,cdn.discordapp.com,imgur.com',
).map(s => s.toLowerCase());

export const BLOCKED_IMAGE_DOMAINS = new Set(
  cfgList('BLOCKED_IMAGE_DOMAINS', 'BLOCKED_IMAGE_DOMAINS', '')
    .map(s => s.toLowerCase()),
);

export const ENV_MOD_DEFAULTS: EnvModDefaults = {
  alertChannelIds: ADMIN_CHANNEL_IDS,
  trustedRoleIds: new Set<string>(), // no env var for trusted roles — per-guild only
  trustedUserIds: TRUSTED_USER_IDS,
  monitoredChannelIds: MONITORED_CHANNEL_IDS,
  catcherRoleId: CATCHER_ROLE_ID || null,
  mediaSpamChannels: MEDIA_SPAM_CHANNELS,
  mediaSpamSameChannels: MEDIA_SPAM_SAME_CHANNELS,
  mediaSpamWindowSec: MEDIA_SPAM_WINDOW_SEC,
  largeMediaTypes: LARGE_MEDIA_TYPES,
  honeypotMode: HONEYPOT_MODE,
};

// ── Gemini ────────────────────────────────────────────────────────────────────
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
export const GEMINI_PRIMARY_MODEL = cfg('GEMINI_PRIMARY_MODEL', 'GEMINI_PRIMARY_MODEL', 'gemini-2.5-flash');
export const GEMINI_FALLBACK_MODELS: string[] = process.env.GEMINI_FALLBACK_MODELS
  ? process.env.GEMINI_FALLBACK_MODELS.split(',').map(s => s.trim())
  : (fileConfig['GEMINI_FALLBACK_MODELS'] as string[] | undefined) ?? ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
export const GEMINI_MAX_RETRIES = parseInt(cfg('GEMINI_MAX_RETRIES', 'GEMINI_MAX_RETRIES', '3'));
export const GEMINI_RETRY_DELAY = parseFloat(cfg('GEMINI_RETRY_DELAY', 'GEMINI_RETRY_DELAY', '1.0'));

// ── Claude ────────────────────────────────────────────────────────────────────
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
export const CLAUDE_PRIMARY_MODEL = cfg('CLAUDE_PRIMARY_MODEL', 'CLAUDE_PRIMARY_MODEL', 'claude-haiku-4-5-20251001');

// ── Groq ──────────────────────────────────────────────────────────────────────
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
export const GROQ_PRIMARY_MODEL = cfg('GROQ_PRIMARY_MODEL', 'GROQ_PRIMARY_MODEL', 'llama-3.3-70b-versatile');
export const GROQ_FALLBACK_MODEL = cfg('GROQ_FALLBACK_MODEL', 'GROQ_FALLBACK_MODEL', 'llama-3.1-8b-instant');

// ── LLM provider selection ────────────────────────────────────────────────────
export const NSFW_PROVIDER_OVERRIDE = process.env.NSFW_PROVIDER_OVERRIDE ?? fileConfig['NSFW_PROVIDER_OVERRIDE'] ?? '';

const priorityEnv = process.env.LLM_PROVIDER_PRIORITY;
const rawPriority: string[] = priorityEnv
  ? priorityEnv.split(',').map(s => s.trim())
  : (fileConfig['LLM_PROVIDER_PRIORITY'] as string[] | undefined) ?? ['groq', 'claude', 'gemini'];

export const AVAILABLE_PROVIDERS: string[] = [];
if (GROQ_API_KEY) AVAILABLE_PROVIDERS.push('groq');
if (ANTHROPIC_API_KEY) AVAILABLE_PROVIDERS.push('claude');
if (GEMINI_API_KEY) AVAILABLE_PROVIDERS.push('gemini');

export const LLM_PROVIDER_PRIORITY = rawPriority.filter(p => AVAILABLE_PROVIDERS.includes(p));

// ── R2 ────────────────────────────────────────────────────────────────────────
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? '';
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? '';
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? '';
export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? '';
export const UPLOADER_URL = process.env.UPLOADER_URL ?? '';
export const R2_ENABLED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && UPLOADER_URL);
export const SUPPORTER_ROLE_IDS = parseIdList(process.env.SUPPORTER_ROLE_IDS);

// ── Clients ───────────────────────────────────────────────────────────────────
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';

export const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
export const claudeClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
export const groqClient   = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ── Rate limiters ─────────────────────────────────────────────────────────────
export const rateLimiter = new RateLimiter(5, 30);
export const geminiRateLimiter = new RateLimiter(1, 10);
