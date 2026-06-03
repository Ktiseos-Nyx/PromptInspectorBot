import { type FormatDetector, getChunk } from '../types';

/** Get the Comment/Description text that is NOT valid JSON (MJ stores plain text). */
function midjourneyComment(chunks: Parameters<FormatDetector['detect']>[0]): string | null {
  const commentText = getChunk(chunks, 'Comment') ?? getChunk(chunks, 'Description');
  if (!commentText) return null;
  // The original only reaches the Midjourney branch when JSON.parse throws.
  try { JSON.parse(commentText); return null; } catch { /* not JSON — MJ candidate */ }
  return commentText.includes('Job ID:') ? commentText : null;
}

export const midjourneyDetector: FormatDetector = {
  name: 'Midjourney',
  detect(chunks) {
    return midjourneyComment(chunks) !== null;
  },
  async parse(chunks) {
    const commentText = midjourneyComment(chunks);
    if (!commentText) return null;
    const aiData: Record<string, any> = {};

    // MJ stores prompt + --params + "Job ID: uuid" in Description tEXt chunk
    aiData.workflow_type = 'Midjourney';
    const jobMatch = commentText.match(/Job ID:\s*([a-f0-9-]+)/i);
    if (jobMatch) aiData.job_id = jobMatch[1];

    // Extract prompt (everything before the first -- param)
    const paramStart = commentText.indexOf(' --');
    if (paramStart > 0) {
      aiData.prompt = commentText.substring(0, paramStart).trim();

      // Parse MJ parameters
      const paramSection = commentText.substring(paramStart);
      const arMatch = paramSection.match(/--ar\s+([\d:]+)/);
      const vMatch = paramSection.match(/--v\s+([\d.]+)/);
      const nijiMatch = paramSection.match(/--niji\s+(\d+)/);
      const sMatch = paramSection.match(/--stylize\s+(\d+)|--s\s+(\d+)/);
      const cMatch = paramSection.match(/--chaos\s+(\d+)|--c\s+(\d+)/);
      const seedMatch = paramSection.match(/--seed\s+(\d+)/);
      const noMatch = paramSection.match(/--no\s+([^-]+?)(?:\s+--|Job ID:|$)/);
      const weirdMatch = paramSection.match(/--weird\s+(\d+)/);
      const qualMatch = paramSection.match(/--quality\s+([\d.]+)|--q\s+([\d.]+)/);
      const styleMatch = paramSection.match(/--style\s+(\S+)/);
      const iwMatch = paramSection.match(/--iw\s+([\d.]+)/);
      const preferMatch = paramSection.match(/--prefer\s+(\S+)/);

      if (arMatch) aiData.aspect_ratio = arMatch[1];
      // --niji overrides --v if both present (they're mutually exclusive MJ model families)
      if (vMatch) aiData.version = `v${vMatch[1]}`;
      if (nijiMatch) aiData.version = `niji ${nijiMatch[1]}`;
      if (sMatch) aiData.stylize = sMatch[1] || sMatch[2];
      if (cMatch) aiData.chaos = cMatch[1] || cMatch[2];
      if (seedMatch) aiData.seed = seedMatch[1];
      if (noMatch) aiData.negative_prompt = noMatch[1].trim();
      if (weirdMatch) aiData.weird = weirdMatch[1];
      if (qualMatch) aiData.quality = qualMatch[1] || qualMatch[2];
      if (styleMatch) aiData.style = styleMatch[1];
      if (iwMatch) aiData.image_weight = iwMatch[1];
      if (preferMatch) aiData.prefer = preferMatch[1];
      if (/--turbo\b/.test(paramSection)) aiData.speed = 'turbo';
      else if (/--fast\b/.test(paramSection)) aiData.speed = 'fast';
      else if (/--relax\b/.test(paramSection)) aiData.speed = 'relax';
      if (/--remix\b/.test(paramSection)) aiData.remix = true;
    } else {
      // No params, whole thing is the prompt (minus Job ID)
      aiData.prompt = commentText.replace(/\s*Job ID:.*$/, '').trim();
    }

    return aiData;
  },
};
