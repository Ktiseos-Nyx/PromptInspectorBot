import { type FormatDetector, getChunk } from '../types';
import { coercePromptValue } from '../comfyui/graph-trace';

/** Parse the Comment/Description JSON; return null if not NovelAI-shaped JSON. */
function tryNovelAiComment(commentText: string): Record<string, any> | null {
  try {
    const novelData = JSON.parse(commentText);
    const aiData: Record<string, any> = {};
    // NovelAI v3+ can wrap prompt fields in `{ content, image, ... }` objects.
    // Coerce everything before assigning so React never sees a raw object.
    const promptStr = coercePromptValue(novelData.prompt);
    const ucStr = coercePromptValue(novelData.uc);
    if (promptStr) aiData.prompt = promptStr;
    if (ucStr) aiData.negative_prompt = ucStr;
    if (novelData.steps !== undefined) aiData.steps = String(novelData.steps);
    if (novelData.scale !== undefined) aiData.cfg_scale = String(novelData.scale);
    if (novelData.seed !== undefined) aiData.seed = String(novelData.seed);
    if (novelData.sampler !== undefined) aiData.sampler = coercePromptValue(novelData.sampler);
    // NovelAI uses 'uc' for negative prompt; Draw Things uses 'c' for positive
    if (novelData.uc !== undefined && !novelData.c) {
      aiData.workflow_type = 'NovelAI';
    }
    return aiData;
  } catch {
    return null;
  }
}

export const novelAiDetector: FormatDetector = {
  name: 'NovelAI',
  detect(chunks) {
    // Authoritative signal: Software chunk = "NovelAI"
    if (getChunk(chunks, 'Software') === 'NovelAI') return true;
    // Otherwise: a Comment/Description chunk that JSON-parses with a 'uc' field
    const commentText = getChunk(chunks, 'Comment') ?? getChunk(chunks, 'Description');
    if (!commentText) return false;
    const parsed = tryNovelAiComment(commentText);
    return parsed !== null && parsed.workflow_type === 'NovelAI';
  },
  async parse(chunks) {
    const aiData: Record<string, any> = {};

    // --- NovelAI: Software chunk = "NovelAI" is the authoritative signal ---
    if (getChunk(chunks, 'Software') === 'NovelAI') {
      aiData.workflow_type = 'NovelAI';
    }

    // NovelAI: Comment or Description PNG chunk (JSON with 'uc')
    const commentText = getChunk(chunks, 'Comment') ?? getChunk(chunks, 'Description');
    if (commentText) {
      const parsed = tryNovelAiComment(commentText);
      if (parsed) {
        // Comment JSON only sets workflow_type to NovelAI; don't clobber an
        // existing one with undefined.
        for (const [k, v] of Object.entries(parsed)) {
          if (k === 'workflow_type' && v === undefined) continue;
          aiData[k] = v;
        }
      }
    }

    return aiData;
  },
};
