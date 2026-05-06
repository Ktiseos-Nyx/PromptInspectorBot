import fs from 'fs';
import { Client, TextChannel } from 'discord.js';

const FILE = 'schedules.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QotdConfig {
  channelId: string;
  intervalMs: number;
  enabled: boolean;
  lastPosted: number;
  questions: string[];
  usedQuestions: string[];
}

export interface Reminder {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  message: string;
  intervalMs: number | null; // null = one-time
  nextFireAt: number;
}

interface Schedules {
  qotd: Record<string, QotdConfig>;
  reminders: Reminder[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

function load(): Schedules {
  if (!fs.existsSync(FILE)) return { qotd: {}, reminders: [] };
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { qotd: {}, reminders: [] }; }
}

function save(data: Schedules): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getQotdConfig(guildId: string): QotdConfig | null {
  return load().qotd[guildId] ?? null;
}

export function setQotdConfig(guildId: string, config: Partial<QotdConfig>): void {
  const data = load();
  data.qotd[guildId] = { ...data.qotd[guildId] ?? { questions: [], usedQuestions: [], lastPosted: 0, enabled: true }, ...config };
  save(data);
}

export function addQotdQuestion(guildId: string, question: string): boolean {
  const data = load();
  const cfg = data.qotd[guildId];
  if (!cfg) return false;
  if (cfg.questions.includes(question)) return false;
  cfg.questions.push(question);
  save(data);
  return true;
}

export function getReminders(guildId?: string): Reminder[] {
  const { reminders } = load();
  return guildId ? reminders.filter(r => r.guildId === guildId) : reminders;
}

export function addReminder(reminder: Omit<Reminder, 'id'>): Reminder {
  const data = load();
  const r: Reminder = { ...reminder, id: Math.random().toString(36).slice(2, 9) };
  data.reminders.push(r);
  save(data);
  return r;
}

export function deleteReminder(id: string, guildId: string): boolean {
  const data = load();
  const before = data.reminders.length;
  data.reminders = data.reminders.filter(r => !(r.id === id && r.guildId === guildId));
  save(data);
  return data.reminders.length < before;
}

// ── Interval parser ───────────────────────────────────────────────────────────

export function parseInterval(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|wk)s?$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  switch (match[2].toLowerCase()) {
    case 'm': case 'min': return n * 60_000;
    case 'h': case 'hr':  return n * 3_600_000;
    case 'd': case 'day': return n * 86_400_000;
    case 'w': case 'wk':  return n * 604_800_000;
    default: return null;
  }
}

export function formatInterval(ms: number): string {
  if (ms >= 604_800_000) return `${ms / 604_800_000}w`;
  if (ms >= 86_400_000)  return `${ms / 86_400_000}d`;
  if (ms >= 3_600_000)   return `${ms / 3_600_000}h`;
  return `${ms / 60_000}m`;
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

export function startScheduler(client: Client): void {
  setInterval(() => tick(client), 60_000);
  console.log('Scheduler started (60s tick)');
}

async function tick(client: Client): Promise<void> {
  const now = Date.now();
  const data = load();
  let dirty = false;

  // ── QOTD ──────────────────────────────────────────────────────────────────
  for (const [guildId, cfg] of Object.entries(data.qotd)) {
    if (!cfg.enabled || !cfg.channelId) continue;
    if (now - cfg.lastPosted < cfg.intervalMs) continue;
    if (!cfg.questions.length) continue;

    const unused = cfg.questions.filter(q => !cfg.usedQuestions.includes(q));
    const pool = unused.length ? unused : cfg.questions;
    if (unused.length === 0) cfg.usedQuestions = [];

    const question = pool[Math.floor(Math.random() * pool.length)];
    cfg.usedQuestions.push(question);
    cfg.lastPosted = now;
    dirty = true;

    const channel = client.channels.cache.get(cfg.channelId) as TextChannel | undefined;
    if (channel) {
      await channel.send(`💬 **Question of the Day**\n\n${question}`).catch(console.error);
    }
  }

  // ── Reminders ─────────────────────────────────────────────────────────────
  const toRemove: string[] = [];

  for (const reminder of data.reminders) {
    if (now < reminder.nextFireAt) continue;

    const channel = client.channels.cache.get(reminder.channelId) as TextChannel | undefined;
    if (channel) {
      await channel.send(`⏰ <@${reminder.userId}> **Reminder:** ${reminder.message}`).catch(console.error);
    }

    if (reminder.intervalMs) {
      reminder.nextFireAt = now + reminder.intervalMs;
    } else {
      toRemove.push(reminder.id);
    }
    dirty = true;
  }

  if (toRemove.length) {
    data.reminders = data.reminders.filter(r => !toRemove.includes(r.id));
  }

  if (dirty) save(data);
}
