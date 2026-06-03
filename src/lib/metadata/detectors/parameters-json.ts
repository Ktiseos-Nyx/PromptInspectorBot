import { type FormatDetector, getChunk } from '../types';

export const parametersJsonDetector: FormatDetector = {
  name: 'Parameters-json',
  detect(chunks) {
    const raw = getChunk(chunks, 'parameters-json');
    if (!raw) return false;
    try { return JSON.parse(raw).PositivePrompt !== undefined; } catch { return false; }
  },
  async parse(chunks) {
    const j = JSON.parse(getChunk(chunks, 'parameters-json')!);
    const ai: Record<string, any> = { workflow_type: 'Civitai' };
    if (j.PositivePrompt) ai.prompt = String(j.PositivePrompt);
    if (j.NegativePrompt) ai.negative_prompt = String(j.NegativePrompt);
    if (j.Steps !== undefined) ai.steps = String(j.Steps);
    if (j.CFGScale !== undefined) ai.cfg_scale = String(j.CFGScale);
    if (j.Seed !== undefined) ai.seed = String(j.Seed);
    if (j.Sampler) ai.sampler = String(j.Sampler);
    return ai;
  },
};
