import { describe, it, expect } from 'vitest';
import { DETECTORS, runDetectors } from './registry';

describe('detector registry', () => {
  it('orders ComfyUI before the A1111 text fallback', () => {
    const names = DETECTORS.map(d => d.name);
    expect(names.indexOf('ComfyUI')).toBeLessThan(names.indexOf('AUTOMATIC1111'));
  });
  it('falls through to A1111 text for a plain parameters chunk', async () => {
    const ai = await runDetectors({
      parameters: 'a photo of a dog\nNegative prompt: blurry\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 5',
    });
    expect(ai.workflow_type).toBe('AUTOMATIC1111');
    expect(ai.prompt).toContain('a photo of a dog');
    expect(ai.steps).toBe('20');
  });
});
