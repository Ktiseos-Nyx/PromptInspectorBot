import { describe, it, expect } from 'vitest';
import { readSamplerWidgets, longestStringWidget } from './widgets';

describe('readSamplerWidgets', () => {
  it('maps KSampler widget order [seed,ctrl,steps,cfg,sampler,scheduler,denoise]', () => {
    const w = readSamplerWidgets('KSampler', [906516813268322, 'randomize', 30, 4, 'euler', 'karras', 1]);
    expect(w.seed).toBe('906516813268322');
    expect(w.steps).toBe('30');
    expect(w.cfg_scale).toBe('4');
    expect(w.sampler).toBe('euler');
    expect(w.scheduler).toBe('karras');
  });
  it('falls back to magnitude heuristics for an unknown sampler node', () => {
    const w = readSamplerWidgets('SomeCustomSampler', ['euler', 25, 1234567890123, 6.5, 'normal']);
    expect(w.seed).toBe('1234567890123');
    expect(w.steps).toBe('25');
    expect(w.cfg_scale).toBe('6.5');
    expect(w.sampler).toBe('euler');
  });
});

describe('longestStringWidget', () => {
  it('returns the longest prompt-shaped string', () => {
    expect(longestStringWidget(['model.safetensors', 'a long detailed prompt here, masterpiece']))
      .toBe('a long detailed prompt here, masterpiece');
  });
  it('ignores filenames and short tokens', () => {
    expect(longestStringWidget(['x.safetensors', 'normal', 'euler'])).toBeNull();
  });
});
