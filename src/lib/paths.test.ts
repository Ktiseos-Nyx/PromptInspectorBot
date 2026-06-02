import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { dataFile } from './paths';

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
