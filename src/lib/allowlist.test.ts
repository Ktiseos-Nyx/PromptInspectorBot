import { describe, it, expect } from 'vitest';
import { shouldLeaveGuild } from './allowlist';

describe('shouldLeaveGuild', () => {
  it('never leaves when the allowlist is empty (open mode)', () => {
    expect(shouldLeaveGuild('any', new Set())).toBe(false);
  });
  it('leaves a guild not on a non-empty allowlist', () => {
    expect(shouldLeaveGuild('g2', new Set(['g1']))).toBe(true);
  });
  it('stays in an allowlisted guild', () => {
    expect(shouldLeaveGuild('g1', new Set(['g1']))).toBe(false);
  });
});
