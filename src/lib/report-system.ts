import fs from 'fs';
import { dataFile } from './paths';

const FILE = process.env.REPORTS_PATH ?? dataFile('reports.json');

export interface Report {
  id: string;
  guildId: string;
  reporterId: string;
  reportedId: string;
  reason: string;
  details: string;
  timestamp: number;
  messageLink?: string;
}

type Store = Record<string, Report[]>; // keyed by guildId

export const REPORT_THRESHOLD = 3;           // unique reporters → auto-timeout
export const REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
export const AUTO_TIMEOUT_MS  = 60 * 60 * 1000;            // 1 hour
export const REPORTER_COOLDOWN_MS = 24 * 60 * 60 * 1000;   // 24h between reports on same target

function load(): Store {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function save(store: Store): void {
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function addReport(report: Omit<Report, 'id'>): Report {
  const store = load();
  if (!store[report.guildId]) store[report.guildId] = [];
  const full: Report = { ...report, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  store[report.guildId].push(full);
  save(store);
  return full;
}

export function getReports(guildId: string, reportedId?: string): Report[] {
  const store = load();
  const all = store[guildId] ?? [];
  return reportedId ? all.filter(r => r.reportedId === reportedId) : all;
}

export function clearReports(guildId: string, reportedId: string): number {
  const store = load();
  const before = (store[guildId] ?? []).length;
  store[guildId] = (store[guildId] ?? []).filter(r => r.reportedId !== reportedId);
  save(store);
  return before - store[guildId].length;
}

// Returns true if this reporter already filed a report against this user within the cooldown window.
export function hasRecentReport(guildId: string, reporterId: string, reportedId: string): boolean {
  const cutoff = Date.now() - REPORTER_COOLDOWN_MS;
  return getReports(guildId, reportedId).some(
    r => r.reporterId === reporterId && r.timestamp > cutoff
  );
}

// Returns the unique reporter count for a user within the rolling window.
export function uniqueReporterCount(guildId: string, reportedId: string): number {
  const cutoff = Date.now() - REPORT_WINDOW_MS;
  const recent = getReports(guildId, reportedId).filter(r => r.timestamp > cutoff);
  return new Set(recent.map(r => r.reporterId)).size;
}
