import { describe, it, expect } from 'vitest';
import { normalizeChunkKeys, getChunk } from './types';

describe('normalizeChunkKeys', () => {
  it('lowercases keys so exiftool casing and real casing converge', () => {
    const n = normalizeChunkKeys({ Parameters: 'a', PNGWorkflow: 'b', prompt: 'c' } as any);
    expect(n.parameters).toBe('a');
    expect(n.prompt).toBe('c');
  });
  it('keeps the first value when keys collide after lowercasing', () => {
    const n = normalizeChunkKeys({ Parameters: 'first', parameters: 'second' } as any);
    expect(n.parameters).toBe('first');
  });
});

describe('getChunk', () => {
  it('reads a chunk case-insensitively as a string', () => {
    expect(getChunk({ prompt: 123 } as any, 'Prompt')).toBe('123');
    expect(getChunk({} as any, 'missing')).toBeUndefined();
  });
});
