import { describe, it, expect } from 'vitest';
import { comfyUiDetector } from './comfyui';

// ComfyUI serializes JS NaN/Infinity literally (e.g. a node's "changed": [NaN]),
// which breaks JSON.parse. The detector's sanitizer must strip those tokens in
// value position WITHOUT corrupting prompt text that contains the words.
describe('comfyUiDetector NaN/Infinity sanitization', () => {
  const promptWithNaN =
    '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"a robot in a field, masterpiece"}},' +
    '"4":{"class_type":"KSampler","inputs":{"steps":20,"cfg":7,"sampler_name":"euler","seed":1,' +
    '"positive":["6",0],"negative":["6",0],"changed":[NaN]}}}';

  it('parses a prompt graph containing a bareword NaN in an array', async () => {
    const chunks = { prompt: promptWithNaN };
    expect(comfyUiDetector.detect(chunks)).toBe(true);
    const ai = await comfyUiDetector.parse(chunks);
    expect(ai!.workflow_type).toBe('ComfyUI');
    expect(ai!.prompt).toContain('a robot in a field');
    expect(ai!.steps).toBe('20');
  });

  it('does not corrupt prompt text that contains the words Infinity/NaN', async () => {
    const chunks = {
      prompt:
        '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"to Infinity and beyond, NaN style"}},' +
        '"4":{"class_type":"KSampler","inputs":{"steps":10,"cfg":5,"sampler_name":"euler","seed":1,' +
        '"positive":["6",0],"negative":["6",0]}}}',
    };
    const ai = await comfyUiDetector.parse(chunks);
    expect(ai!.prompt).toContain('to Infinity and beyond, NaN style');
  });
});
