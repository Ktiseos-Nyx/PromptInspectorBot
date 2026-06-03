import { type FormatDetector, getChunk } from '../types';
import { extractComfyUIParams } from '../comfyui/graph-trace';

export const tensorArtDetector: FormatDetector = {
  name: 'TensorArt',
  detect(chunks) {
    const gd = getChunk(chunks, 'generation_data');
    if (gd) { try { return Array.isArray(JSON.parse(gd).models); } catch { return false; } }
    const prompt = getChunk(chunks, 'prompt');
    if (prompt && /EMS-\d+|ECHOCheckpointLoaderSimple|TensorArt_/.test(prompt)) return true;
    return false;
  },
  async parse(chunks) {
    const ai: Record<string, any> = { workflow_type: 'TensorArt' };
    const gd = getChunk(chunks, 'generation_data');
    if (gd) {
      try {
        const data = JSON.parse(gd);
        if (Array.isArray(data.models)) {
          ai.resources = data.models.map((m: any) => ({
            label: m.label, type: m.type, weight: m.weight,
            fileName: m.modelFileName, baseModel: m.baseModel, hash: m.hash,
          }));
          ai.loras = data.models.filter((m: any) => m.type === 'LORA')
            .map((m: any) => `${m.label ?? m.modelFileName} (${m.weight})`);
        }
      } catch { /* leave resources unset */ }
    }
    // Mine the sibling API prompt graph for prompt/sampler/model.
    const prompt = getChunk(chunks, 'prompt');
    if (prompt) {
      try { Object.assign(ai, extractComfyUIParams(JSON.parse(prompt), {}), { workflow_type: 'TensorArt' }); }
      catch { /* not a graph */ }
    }
    return ai;
  },
};
