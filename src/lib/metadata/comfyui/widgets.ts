// Known widget orders for ultra-common nodes (accelerator; heuristics are the fallback).
const KNOWN_ORDER: Record<string, string[]> = {
  KSampler: ['seed', 'control', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'],
  KSamplerAdvanced: ['add_noise', 'seed', 'control', 'steps', 'cfg', 'sampler', 'scheduler'],
};

const SAMPLER_VOCAB = new Set([
  'euler', 'euler_ancestral', 'euler a', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral', 'lms',
  'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m',
  'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc', 'uni_pc_bh2', 'lcm',
]);
const SCHEDULER_VOCAB = new Set(['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta']);

const isFilename = (s: string) => /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(s.trim());

export function longestStringWidget(widgets: any[]): string | null {
  let best: string | null = null;
  for (const w of widgets) {
    if (typeof w !== 'string') continue;
    const t = w.trim();
    if (t.length <= 15 || isFilename(t)) continue;
    if (!best || t.length > best.length) best = t;
  }
  return best;
}

export function readSamplerWidgets(classType: string, widgets: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  const order = KNOWN_ORDER[classType];
  if (order) {
    order.forEach((field, i) => {
      const v = widgets[i];
      if (v === undefined || v === null) return;
      if (field === 'seed') out.seed = String(v);
      else if (field === 'steps') out.steps = String(v);
      else if (field === 'cfg') out.cfg_scale = String(v);
      else if (field === 'sampler') out.sampler = String(v);
      else if (field === 'scheduler') out.scheduler = String(v);
    });
    if (Object.keys(out).length > 0) return out;
  }
  // Heuristic fallback — classify by type + magnitude, position-independent.
  for (const v of widgets) {
    if (typeof v === 'string') {
      const lv = v.toLowerCase();
      if (!out.sampler && SAMPLER_VOCAB.has(lv)) out.sampler = v;
      else if (!out.scheduler && SCHEDULER_VOCAB.has(lv)) out.scheduler = v;
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && String(Math.abs(v)).length >= 10 && !out.seed) out.seed = String(v);
      else if (!Number.isInteger(v) && v > 0 && v <= 30 && !out.cfg_scale) out.cfg_scale = String(v);
      else if (Number.isInteger(v) && v >= 1 && v <= 150 && !out.steps) out.steps = String(v);
    }
  }
  return out;
}
