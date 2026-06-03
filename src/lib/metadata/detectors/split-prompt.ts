import { type FormatDetector, getChunk } from '../types';

export const splitPromptDetector: FormatDetector = {
  name: 'ComfyUI',
  detect(chunks) {
    return getChunk(chunks, 'positive_prompt') !== undefined
        || getChunk(chunks, 'negative_prompt') !== undefined;
  },
  async parse(chunks) {
    const pos = getChunk(chunks, 'positive_prompt');
    const neg = getChunk(chunks, 'negative_prompt');
    if (!pos && !neg) return null;
    const ai: Record<string, any> = { workflow_type: 'ComfyUI' };
    if (pos) ai.prompt = pos;
    if (neg) ai.negative_prompt = neg;
    return ai;
  },
};
