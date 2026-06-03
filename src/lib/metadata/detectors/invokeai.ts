import { type FormatDetector, getChunk } from '../types';

export const invokeAiDetector: FormatDetector = {
  name: 'InvokeAI',
  detect(chunks) {
    const raw = getChunk(chunks, 'invokeai_metadata');
    if (!raw) return false;
    try { return JSON.parse(raw).positive_prompt !== undefined; } catch { return false; }
  },
  async parse(chunks) {
    const inv = JSON.parse(getChunk(chunks, 'invokeai_metadata')!);
    const ai: Record<string, any> = { workflow_type: 'InvokeAI' };
    if (inv.positive_prompt) ai.prompt = String(inv.positive_prompt);
    if (inv.negative_prompt) ai.negative_prompt = String(inv.negative_prompt);
    if (inv.seed !== undefined) ai.seed = String(inv.seed);
    if (inv.steps !== undefined) ai.steps = String(inv.steps);
    if (inv.cfg_scale !== undefined) ai.cfg_scale = String(inv.cfg_scale);
    if (inv.scheduler) ai.scheduler = String(inv.scheduler);
    if (inv.model?.name) ai.model = String(inv.model.name);
    if (inv.width && inv.height) ai.size = `${inv.width}x${inv.height}`;
    return ai;
  },
};
