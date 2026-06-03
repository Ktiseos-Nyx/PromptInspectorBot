import { describe, it, expect } from 'vitest';
import { parametersJsonDetector } from './parameters-json';
import { davantDetector } from './davant';
import { splitPromptDetector } from './split-prompt';

describe('parametersJsonDetector', () => {
  const chunks = { 'parameters-json': JSON.stringify({ PositivePrompt: 'a girl', NegativePrompt: 'bad', Steps: 28 }) };
  it('detects + parses capitalized-key JSON', async () => {
    expect(parametersJsonDetector.detect(chunks)).toBe(true);
    const ai = await parametersJsonDetector.parse(chunks);
    expect(ai!.prompt).toBe('a girl');
    expect(ai!.negative_prompt).toBe('bad');
    expect(ai!.steps).toBe('28');
  });
});

describe('davantDetector', () => {
  const chunks = { davant__batch_parameters: JSON.stringify({
    prompt: 'robot <lora:GummyMorph:0.7>', all_prompts: ['robot'], negative_prompt: 'cgi, 3d' }) };
  it('detects + parses A1111-webui batch JSON with lora tags', async () => {
    expect(davantDetector.detect(chunks)).toBe(true);
    const ai = await davantDetector.parse(chunks);
    expect(ai!.prompt).toContain('robot');
    expect(ai!.negative_prompt).toBe('cgi, 3d');
    expect(ai!.loras).toContain('GummyMorph (0.7)');
  });
});

describe('splitPromptDetector', () => {
  const chunks = { positive_prompt: 'a woman in a meat dress', negative_prompt: 'low resolution' };
  it('reads split plain-text chunks', async () => {
    expect(splitPromptDetector.detect(chunks)).toBe(true);
    const ai = await splitPromptDetector.parse(chunks);
    expect(ai!.prompt).toBe('a woman in a meat dress');
    expect(ai!.negative_prompt).toBe('low resolution');
  });
});
