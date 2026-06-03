import fs from 'fs';
import crypto from 'crypto';
import { dataFile, writeJsonAtomic } from './paths';

const FILE = dataFile('ban-registry.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BannedUser {
  id: string;
  reason: string;
  bannedAt: number;
  bannedBy: 'auto' | string; // 'auto' or moderator user ID
  guildId: string;
}

export interface BannedPattern {
  fingerprint: string;
  reason: string;
  addedAt: number;
  sample?: string; // first 100 chars of the triggering message, for reference
}

export type WordPatternAction = 'warn' | 'delete' | 'ban';

export interface WordPattern {
  id: string;
  pattern: string;       // plain substring or "regex:..." prefix for regex
  action: WordPatternAction;
  reason: string;
  addedAt: number;
  addedBy: string;
}

interface Registry {
  users: BannedUser[];
  patterns: BannedPattern[];
  wordPatterns: WordPattern[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

function load(): Registry {
  if (!fs.existsSync(FILE)) return { users: [], patterns: [], wordPatterns: [] };
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!data.wordPatterns) data.wordPatterns = [];
    return data;
  }
  catch { return { users: [], patterns: [], wordPatterns: [] }; }
}

function save(data: Registry): void {
  writeJsonAtomic(FILE, data);
}

// ── Pattern fingerprinting ────────────────────────────────────────────────────
// Normalise before hashing so minor variations of the same message still match:
// - collapse whitespace
// - strip zero-width / invisible characters
// - lowercase
// - strip URLs (scam bots rotate domains)

export function messageFingerprint(text: string): string {
  const normalised = text
    .replace(/[​-‍﻿⁠­]/g, '') // invisible/zero-width
    .replace(/https?:\/\/\S+/gi, '__URL__')             // collapse URLs
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
  return crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

// ── User registry ─────────────────────────────────────────────────────────────

export function isUserBanned(userId: string): BannedUser | null {
  return load().users.find(u => u.id === userId) ?? null;
}

export function recordBan(userId: string, guildId: string, reason: string, bannedBy: string = 'auto'): void {
  const data = load();
  if (!data.users.find(u => u.id === userId)) {
    data.users.push({ id: userId, reason, bannedAt: Date.now(), bannedBy, guildId });
    save(data);
  }
}

export function removeBan(userId: string): boolean {
  const data = load();
  const before = data.users.length;
  data.users = data.users.filter(u => u.id !== userId);
  save(data);
  return data.users.length < before;
}

export function listBans(limit = 20): BannedUser[] {
  return load().users.slice(-limit).reverse();
}

// ── Pattern registry ──────────────────────────────────────────────────────────

export function isPatternBanned(text: string): BannedPattern | null {
  const fp = messageFingerprint(text);
  return load().patterns.find(p => p.fingerprint === fp) ?? null;
}

export function recordPattern(text: string, reason: string): void {
  const data = load();
  const fp = messageFingerprint(text);
  if (!data.patterns.find(p => p.fingerprint === fp)) {
    data.patterns.push({
      fingerprint: fp,
      reason,
      addedAt: Date.now(),
      sample: text.slice(0, 100),
    });
    save(data);
  }
}

export function removePattern(fingerprint: string): boolean {
  const data = load();
  const before = data.patterns.length;
  data.patterns = data.patterns.filter(p => p.fingerprint !== fingerprint);
  save(data);
  return data.patterns.length < before;
}

export function listPatterns(limit = 20): BannedPattern[] {
  return load().patterns.slice(-limit).reverse();
}

export function getStats(): { users: number; patterns: number; wordPatterns: number } {
  const data = load();
  return { users: data.users.length, patterns: data.patterns.length, wordPatterns: data.wordPatterns.length };
}

// ── Word pattern registry ─────────────────────────────────────────────────────

export function checkWordPatterns(text: string): WordPattern | null {
  const lower = text.toLowerCase();
  for (const wp of load().wordPatterns) {
    if (wp.pattern.startsWith('regex:')) {
      try {
        const rx = new RegExp(wp.pattern.slice(6), 'i');
        if (rx.test(text)) return wp;
      } catch { /* invalid regex — skip */ }
    } else {
      if (lower.includes(wp.pattern.toLowerCase())) return wp;
    }
  }
  return null;
}

export function addWordPattern(pattern: string, action: WordPatternAction, reason: string, addedBy: string): WordPattern {
  const data = load();
  const wp: WordPattern = {
    id: Math.random().toString(36).slice(2, 9),
    pattern,
    action,
    reason,
    addedAt: Date.now(),
    addedBy,
  };
  data.wordPatterns.push(wp);
  save(data);
  return wp;
}

export function removeWordPattern(id: string): boolean {
  const data = load();
  const before = data.wordPatterns.length;
  data.wordPatterns = data.wordPatterns.filter(wp => wp.id !== id);
  save(data);
  return data.wordPatterns.length < before;
}

export function listWordPatterns(): WordPattern[] {
  return load().wordPatterns;
}
