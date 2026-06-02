import { describe, it, expect } from 'vitest';
import { extractComfyUIParams } from './graph-trace';

describe('extractComfyUIParams (moved intact)', () => {
  it('extracts sampler settings + prompt from an API-format graph', () => {
    const wf = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat in a hat, masterpiece' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality' } },
      '4': { class_type: 'KSampler', inputs: {
        steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', seed: 12345,
        positive: ['2', 0], negative: ['3', 0],
      } },
    };
    const out = extractComfyUIParams(wf as any, {});
    expect(out.steps).toBe('25');
    expect(out.cfg_scale).toBe('7');
    expect(out.sampler).toBe('euler');
    expect(out.model).toBe('model.safetensors');
    expect(out.prompt).toContain('a cat in a hat');
    expect(out.negative_prompt).toContain('blurry');
  });
});
