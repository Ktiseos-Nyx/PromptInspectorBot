// Pure extractor for A1111 infotext fields. Used by the A1111 detector AND as a
// field-filler for ComfyUI files that ALSO carry a Parameters block.
export function parseA1111Fields(params: string): Record<string, string> {
  const ai: Record<string, string> = {};
  const splitIndex = params.indexOf('\nNegative prompt:');
  if (splitIndex !== -1) {
    ai.prompt = params.substring(0, splitIndex).trim();
    const negMatch = params.match(/Negative prompt:\s*([\s\S]+?)(?:\n|$)/);
    if (negMatch) ai.negative_prompt = negMatch[1].split('\n')[0].trim();
  } else {
    ai.prompt = params.split('\n')[0].trim();
  }
  const line = params.split('\n').pop() ?? '';
  const m = (re: RegExp) => line.match(re)?.[1];
  const steps = m(/Steps:\s*(\d+)/);          if (steps) ai.steps = steps;
  const sampler = m(/Sampler:\s*([^,]+)/);     if (sampler) ai.sampler = sampler.trim();
  const cfg = m(/CFG scale:\s*([\d.]+)/);      if (cfg) ai.cfg_scale = cfg;
  const seed = m(/Seed:\s*(\d+)/);             if (seed) ai.seed = seed;
  const size = m(/Size:\s*(\d+x\d+)/);         if (size) ai.size = size;
  const model = m(/Model:\s*([^,]+)/);         if (model) ai.model = model.trim();
  return ai;
}
