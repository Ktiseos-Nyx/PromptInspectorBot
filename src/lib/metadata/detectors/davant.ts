import { type FormatDetector, getChunk } from '../types';

export const davantDetector: FormatDetector = {
  name: 'A1111-webui',
  detect(chunks) {
    const raw = getChunk(chunks, 'davant__batch_parameters');
    if (!raw) return false;
    try { const j = JSON.parse(raw); return j.prompt !== undefined || Array.isArray(j.all_prompts); }
    catch { return false; }
  },
  async parse(chunks) {
    const j = JSON.parse(getChunk(chunks, 'davant__batch_parameters')!);
    const ai: Record<string, any> = { workflow_type: 'AUTOMATIC1111' };
    const prompt = j.prompt ?? j.all_prompts?.[0];
    const neg = j.negative_prompt ?? j.all_negative_prompts?.[0];
    if (prompt) ai.prompt = String(prompt);
    if (neg) ai.negative_prompt = String(neg);
    if (typeof prompt === 'string') {
      const loras = [...prompt.matchAll(/<lora:([^:>]+):([^>]+)>/g)].map(m => `${m[1]} (${m[2]})`);
      if (loras.length) ai.loras = loras;
    }
    return ai;
  },
};
