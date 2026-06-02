import path from 'path';

// Root directory for the bot's persistent JSON files (ban registry, guild settings,
// schedules, reports). Defaults to the process working directory — the repo root in both
// dev (`ts-node`) and production (`node dist/bot.js`) — so the files land in one place
// regardless of build layout.
//
// On ephemeral hosts (e.g. Railway), set DATA_DIR to a MOUNTED VOLUME path so this data
// survives redeploys. Without a persistent volume, all of it resets on each deploy.
export const DATA_DIR = process.env.DATA_DIR ?? process.cwd();

// Resolve a persistent data file path. Reads DATA_DIR at call time so it stays testable.
export function dataFile(name: string): string {
  return path.join(process.env.DATA_DIR ?? process.cwd(), name);
}
