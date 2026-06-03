import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dataFile, writeJsonAtomic, repoFile } from './paths';

describe('dataFile', () => {
  afterEach(() => { delete process.env.DATA_DIR; });

  it('defaults to the process working directory', () => {
    expect(dataFile('guild_settings.json')).toBe(path.join(process.cwd(), 'guild_settings.json'));
  });

  it('honors DATA_DIR when set (e.g. a mounted volume)', () => {
    process.env.DATA_DIR = path.join('mnt', 'botdata');
    expect(dataFile('ban-registry.json')).toBe(path.join('mnt', 'botdata', 'ban-registry.json'));
  });
});

describe('repoFile', () => {
  afterEach(() => { delete process.env.DATA_DIR; });

  it('resolves bundled files from the repo root (cwd), ignoring DATA_DIR', () => {
    process.env.DATA_DIR = path.join('mnt', 'vol');
    expect(repoFile('wildcards.json')).toBe(path.resolve(process.cwd(), 'wildcards.json'));
  });

  // Regression guard: /qotd import, /wildcard and /interact all resolved these via
  // __dirname (-> src/ or dist/, where they aren't), so they reported "file not found".
  it('points at bundled command data files that actually exist', () => {
    for (const f of ['qotd-questions.json', 'wildcards.json', 'interactions.json']) {
      expect(fs.existsSync(repoFile(f))).toBe(true);
    }
  });
});

describe('writeJsonAtomic', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes JSON that round-trips and leaves no temp file behind', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-'));
    const target = path.join(dir, 'x.json');
    writeJsonAtomic(target, { a: 1, b: ['c'] });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ a: 1, b: ['c'] });
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('overwrites an existing file (atomic replace)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-'));
    const target = path.join(dir, 'y.json');
    writeJsonAtomic(target, { v: 1 });
    writeJsonAtomic(target, { v: 2 });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ v: 2 });
  });
});
