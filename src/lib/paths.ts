import fs from 'fs';
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

// Resolve a BUNDLED, committed data file (question bank, wildcards, interaction templates)
// from the repo root — process.cwd() in both `ts-node` dev and `node dist/bot.js` prod.
// Distinct from dataFile(): those are mutable state under DATA_DIR (a mounted volume in
// prod); these ship with the code at the repo root and must NOT be resolved via __dirname
// (-> src/ or dist/, where the build never copies them) or DATA_DIR (which won't contain
// them). Using __dirname was the bug behind /qotd import, /wildcard, and /interact all
// reporting "file not found".
export function repoFile(name: string): string {
  return path.resolve(process.cwd(), name);
}

// Atomically write `data` as pretty JSON to `target`: write to a temp file in the same
// directory, then rename it over the target. Rename is atomic within a filesystem, so a
// crash mid-write leaves only the temp file behind — never a half-written `target` that
// a load() would parse-fail on and silently treat as empty (wiping the registry/settings).
export function writeJsonAtomic(target: string, data: unknown): void {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}
