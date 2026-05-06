import 'dotenv/config';
import fs from 'fs';
import { RateLimiter } from './rate-limiter';

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

// ── Gemini ────────────────────────────────────────────────────────────────────
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
export const GEMINI_PRIMARY_MODEL = cfg('GEMINI_PRIMARY_MODEL', 'GEMINI_PRIMARY_MODEL', 'gemini-2.5-flash');
export const GEMINI_FALLBACK_MODELS: string[] = process.env.GEMINI_FALLBACK_MODELS
  ? process.env.GEMINI_FALLBACK_MODELS.split(',').map(s => s.trim())
  : (fileConfig['GEMINI_FALLBACK_MODELS'] as string[] | undefined) ?? ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'];
export const GEMINI_MAX_RETRIES = parseInt(cfg('GEMINI_MAX_RETRIES', 'GEMINI_MAX_RETRIES', '3'));
export const GEMINI_RETRY_DELAY = parseFloat(cfg('GEMINI_RETRY_DELAY', 'GEMINI_RETRY_DELAY', '1.0'));

// ── Claude ────────────────────────────────────────────────────────────────────
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
export const CLAUDE_PRIMARY_MODEL = cfg('CLAUDE_PRIMARY_MODEL', 'CLAUDE_PRIMARY_MODEL', 'claude-3-5-haiku-20241022');

// ── LLM provider selection ────────────────────────────────────────────────────
export const NSFW_PROVIDER_OVERRIDE = process.env.NSFW_PROVIDER_OVERRIDE ?? fileConfig['NSFW_PROVIDER_OVERRIDE'] ?? '';

const priorityEnv = process.env.LLM_PROVIDER_PRIORITY;
const rawPriority: string[] = priorityEnv
  ? priorityEnv.split(',').map(s => s.trim())
  : (fileConfig['LLM_PROVIDER_PRIORITY'] as string[] | undefined) ?? ['gemini', 'claude'];

export const AVAILABLE_PROVIDERS: string[] = [];
if (GEMINI_API_KEY) AVAILABLE_PROVIDERS.push('gemini');
if (ANTHROPIC_API_KEY) AVAILABLE_PROVIDERS.push('claude');

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

export const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
export const claudeClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ── Rate limiters ─────────────────────────────────────────────────────────────
export const rateLimiter = new RateLimiter(5, 30);
export const geminiRateLimiter = new RateLimiter(1, 10);
