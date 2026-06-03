import { type FormatDetector, getChunk } from '../types';

export const libLibAiDetector: FormatDetector = {
  name: 'LibLibAI',
  detect(chunks) {
    const aigc = getChunk(chunks, 'AIGC');
    return typeof aigc === 'string' && aigc.includes('liblibai.com');
  },
  async parse(chunks) {
    const aigc = getChunk(chunks, 'AIGC')!;
    const ai: Record<string, any> = { workflow_type: 'LibLibAI' };
    const cidMatch = aigc.match(/'ContentID':\s*(\d+)/);
    if (cidMatch) ai.content_id = cidMatch[1];
    return ai;
  },
};
