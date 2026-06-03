import { type NodeLookupResult } from '../../comfyui-node-registry';
import { readSamplerWidgets, longestStringWidget } from './widgets';

// ============================================================================
// ComfyUI Workflow Extraction — Graph Trace Primary, Type Match Fallback
// ============================================================================

// Utility: is this value a node reference? (e.g. ["32", 0])
export function isNodeRef(value: any): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

// Utility: get a node from the workflow by ID
export function getNode(workflow: Record<string, any>, id: string): any | null {
  const node = workflow[id];
  return (node && typeof node === 'object' && node.inputs) ? node : null;
}

// Utility: follow a node ref to its source node, with cycle detection
export function followRef(workflow: Record<string, any>, ref: any, visited?: Set<string>): { nodeId: string; node: any } | null {
  if (!isNodeRef(ref)) return null;
  const seen = visited || new Set<string>();
  if (seen.has(ref[0])) return null;
  seen.add(ref[0]);
  const node = getNode(workflow, ref[0]);
  return node ? { nodeId: ref[0], node } : null;
}

// Common text input field names found across vanilla + custom ComfyUI nodes.
// Ordered roughly by frequency so the loop returns sooner on hot cases.
export const TEXT_INPUT_KEYS = [
  'text', 'string', 'prompt', 'value',
  'text_a', 'text_b', 'text_g', 'text_l', 'text_c',
  // CLIPTextEncodeFlux fields (Flux architecture)
  'clip_l', 't5xxl',
  'positive', 'negative',
  'positive_prompt', 'negative_prompt',
  'user_prompt', 'wildcard_text', 'final_text',
  'populated_text', 'output_text',
] as const;

// Field-name fragments that disqualify a value from being treated as prompt text.
export const NON_PROMPT_KEY_FRAGMENTS = ['name', 'file', 'path', 'method', 'mode', 'type', 'format'];

export function isPromptyKey(key: string): boolean {
  const lower = key.toLowerCase();
  return !NON_PROMPT_KEY_FRAGMENTS.some(f => lower.includes(f));
}

// Find a text/prompt string in a node's inputs.
// Strategy: try known keys first, then scan all string fields.
// `hint` can be "positive" or "negative" to prefer matching fields.
export function findText(workflow: Record<string, any>, node: any, visited?: Set<string>, hint?: string): string | null {
  const inputs = node.inputs || {};

  // Priority 1: if hint is given, look for fields containing that hint
  // (e.g. "POSITIVE_PROMPT", "negative_prompt", "positive", "negative")
  if (hint) {
    const hintUpper = hint.toUpperCase();
    for (const [key, val] of Object.entries(inputs)) {
      const keyUpper = key.toUpperCase();
      if (keyUpper.includes(hintUpper) &&
          (keyUpper.includes('PROMPT') || keyUpper.includes('TEXT') || keyUpper.includes('STRING'))) {
        if (typeof val === 'string' && val.trim()) return val;
        if (isNodeRef(val)) {
          const upstream = followRef(workflow, val, visited);
          if (upstream) {
            const text = findText(workflow, upstream.node, visited, hint);
            if (text) return text;
          }
        }
      }
    }
    // Also check just the hint name directly (e.g. inputs.positive, inputs.negative)
    if (typeof inputs[hint] === 'string' && inputs[hint].trim()) return inputs[hint];
    if (isNodeRef(inputs[hint])) {
      const upstream = followRef(workflow, inputs[hint], visited);
      if (upstream) {
        const text = findText(workflow, upstream.node, visited, hint);
        if (text) return text;
      }
    }
  }

  // Priority 2: known common text field names
  for (const key of TEXT_INPUT_KEYS) {
    if (typeof inputs[key] === 'string' && inputs[key].trim()) return inputs[key];
    if (isNodeRef(inputs[key])) {
      const upstream = followRef(workflow, inputs[key], visited);
      if (upstream) {
        const text = findText(workflow, upstream.node, visited, hint);
        if (text) return text;
      }
    }
  }

  // Priority 3: any NodeRef input — follow it. This catches custom routers
  // that store the prompt under a non-standard key (e.g. `wildcard`, `seed_text`).
  for (const [key, val] of Object.entries(inputs)) {
    if (!isPromptyKey(key)) continue;
    if (isNodeRef(val)) {
      const upstream = followRef(workflow, val, visited);
      if (upstream) {
        const text = findText(workflow, upstream.node, visited, hint);
        if (text) return text;
      }
    }
  }

  // Priority 4: scan all string inputs that look like prompts (longer than ~10 chars,
  // not a filename or simple config value)
  let bestText: string | null = null;
  for (const [key, val] of Object.entries(inputs)) {
    if (typeof val === 'string' && val.trim().length > 10) {
      if (!isPromptyKey(key)) continue;
      if (!bestText || val.length > bestText.length) bestText = val;
    }
  }
  if (bestText) return bestText;

  return null;
}

// Quadmoon-style recursive prompt extraction. Walks back through every
// string-typed connection and joins the text contributions with " | ", which
// preserves both branches of ConditioningCombine and similar combiner nodes.
//
// Returns null when nothing prompt-shaped is reachable. Otherwise returns the
// combined text in upstream-first order so the most-specific source ends up
// at the front (matches Python's collected_texts ordering).
export function extractPromptTextWithTrace(
  workflow: Record<string, any>,
  startNodeId: string,
  hint?: string,
  maxDepth: number = 10,
  skipNodes?: Set<string>,
): string | null {
  const seen = new Set<string>();
  const collected: string[] = [];

  function visit(nodeId: string, depth: number) {
    if (depth > maxDepth || seen.has(nodeId)) return;
    if (skipNodes?.has(nodeId)) return;
    seen.add(nodeId);

    const node = getNode(workflow, nodeId);
    if (!node) return;
    const inputs = node.inputs || {};

    // First recurse into upstream nodes via NodeRef inputs. We follow every
    // ref (not just text-shaped ones) because conditioning combiners route
    // through CONDITIONING-typed inputs that still feed text underneath.
    for (const [key, val] of Object.entries(inputs)) {
      if (!isNodeRef(val)) continue;
      // Skip clearly non-text plumbing so we don't drag in seeds/clip/vae paths.
      const lower = key.toLowerCase();
      if (
        lower === 'clip' || lower === 'vae' || lower === 'model' || lower === 'image' ||
        lower === 'latent' || lower === 'mask' || lower === 'samples' || lower === 'sigmas' ||
        lower === 'noise' || lower === 'guider' || lower === 'sampler' || lower === 'scheduler'
      ) {
        continue;
      }
      visit((val as [string, number])[0], depth + 1);
    }

    // Then collect any direct text on this node.
    const direct = findText(workflow, node, undefined, hint);
    if (direct && !collected.includes(direct)) {
      collected.push(direct);
    }
  }

  visit(startNodeId, 0);

  if (collected.length === 0) return null;
  // Upstream-first ordering reads more naturally for combiner chains.
  return collected.length === 1 ? collected[0] : collected.reverse().join(' | ');
}

// ---- Field-based node identification (no type names needed) ----
export function hasFields(inputs: any, ...fields: string[]): boolean {
  return fields.every(f => inputs[f] !== undefined);
}

export function isSamplerByFields(inputs: any): boolean {
  // Standard KSampler / FSamplerAdvanced: has steps/cfg/sampler_name/seed/positive/negative
  const samplerFields = ['steps', 'cfg', 'sampler_name', 'seed', 'positive', 'negative'];
  const matched = samplerFields.filter(f => inputs[f] !== undefined);
  if (matched.length >= 3) return true;
  // UI-format KSampler: when a workflow is normalized from {nodes,links}, the
  // numeric sampler settings (seed/steps/cfg/sampler_name/scheduler) live in
  // widgets_values, not named inputs — only the conditioning wires survive as
  // inputs. Both positive AND negative being node refs uniquely identifies a
  // conditioning-consuming sampler. (Settings are recovered via widgets later.)
  if (isNodeRef(inputs.positive) && isNodeRef(inputs.negative)) return true;
  // SamplerCustomAdvanced (Flux composite sampler) — all connections are node refs.
  // Identified by having guider + sigmas + noise all as node refs (its 3 defining wires).
  return ['guider', 'sigmas', 'noise'].every(f => isNodeRef(inputs[f]));
}

export function isCheckpointByFields(inputs: any): boolean {
  return !!inputs.ckpt_name;
}

export function isLatentByFields(inputs: any): boolean {
  return hasFields(inputs, 'width', 'height', 'batch_size');
}

export function extractComfyUIParams(
  workflow: Record<string, any>,
  classifications: Record<string, NodeLookupResult> = {},
): Record<string, any> {
  const extracted: Record<string, any> = {};

  // Type-match fallback helper (for platforms that wrap standard nodes)
  const typeMatches = (classType: string, ...patterns: string[]) =>
    patterns.some(p => classType.includes(p));

  // Classification helper: is this class_type a recognised node?
  // Anything in the registry (builtin OR custom-via-extension-map OR custom-via-github)
  // is "known" — meaning we can apply field-based heuristics with more confidence.
  const isKnownNode = (classType: string): boolean => {
    const result = classifications[classType];
    return result !== undefined && result.classification !== 'unknown';
  };

  // ========================================================================
  // PRE-PASS: Identify muted/bypassed nodes and AI prompt enhancers
  // ComfyUI mode: 0 = normal, 2 = muted, 4 = bypassed
  // ========================================================================
  const mutedNodeIds = new Set<string>();
  const aiPromptEnhancers: Array<{ nodeId: string; classType: string; reason: string }> = [];

  const AI_ENHANCER_PATTERNS = [
    'llm', 'gpt', 'claude', 'deepseek', 'ollama', 'llama', 'mistral',
    'gemini', 'qwen', 'prompt enhance', 'prompt expand', 'prompt refine',
    'prompt improve', 'prompt writer', 'prompt generator', 'ai prompt',
  ];

  for (const [nodeId, nodeData] of Object.entries(workflow)) {
    const node = nodeData as any;
    if (!node?.inputs) continue;

    // Filter muted/bypassed nodes
    if (node.mode === 2 || node.mode === 4) {
      mutedNodeIds.add(nodeId);
      continue;
    }

    // Detect AI prompt enhancement nodes
    const ct = (node.class_type || '').toLowerCase();
    for (const pattern of AI_ENHANCER_PATTERNS) {
      if (ct.includes(pattern)) {
        aiPromptEnhancers.push({ nodeId, classType: node.class_type, reason: `class_type contains '${pattern}'` });
        break;
      }
    }
  }

  if (aiPromptEnhancers.length > 0) {
    extracted.ai_prompt_enhancement = true;
    extracted.ai_prompt_enhancers = aiPromptEnhancers.map(e => `${e.classType} (node ${e.nodeId})`);
  }

  // ========================================================================
  // PHASE 1: Field-based scan (type-agnostic)
  // Identify nodes by what data they carry, not what they're called
  // ========================================================================
  const samplerNodes: { id: string; node: any }[] = [];
  const loraNodes: { id: string; node: any }[] = [];

  for (const [nodeId, nodeData] of Object.entries(workflow)) {
    const node = nodeData as any;
    if (!node?.inputs || mutedNodeIds.has(nodeId)) continue;
    const inputs = node.inputs;

    // --- Sampler: identified by having steps + cfg + positive/negative ---
    if (isSamplerByFields(inputs)) {
      samplerNodes.push({ id: nodeId, node });
    }

    // --- Checkpoint: identified by having ckpt_name ---
    if (isCheckpointByFields(inputs)) {
      extracted.model = inputs.ckpt_name;
    }

    // --- UNET loader: identified by unet_name ---
    if (inputs.unet_name && !extracted.model) {
      extracted.model = inputs.unet_name;
    }

    // --- Latent image: identified by width + height + batch_size ---
    // Also handles combo loaders with empty_latent_width/empty_latent_height
    if (isLatentByFields(inputs)) {
      const w = inputs.width, h = inputs.height;
      if (typeof w === 'number' && typeof h === 'number') {
        extracted.size = `${w}x${h}`;
      }
    }
    if (!extracted.size && inputs.empty_latent_width && inputs.empty_latent_height) {
      const w = inputs.empty_latent_width, h = inputs.empty_latent_height;
      if (typeof w === 'number' && typeof h === 'number') {
        extracted.size = `${w}x${h}`;
      }
    }

    // --- VAE: identified by vae_name ---
    if (inputs.vae_name && !extracted.vae) {
      extracted.vae = inputs.vae_name;
    }

    // --- CLIP skip: identified by stop_at_clip_layer or clip_skip ---
    if (inputs.stop_at_clip_layer) {
      extracted.clip_skip = String(Math.abs(inputs.stop_at_clip_layer));
    }
    if (inputs.clip_skip && !extracted.clip_skip) {
      extracted.clip_skip = String(Math.abs(inputs.clip_skip));
    }

    // --- LoRA: identified by lora_name, numbered lora_name_N, or <lora:...> tags ---
    if (inputs.lora_name && inputs.lora_name !== 'None') {
      loraNodes.push({ id: nodeId, node });
    }
    // LoRA Stacker nodes use numbered fields: lora_name_1, lora_name_2, etc.
    for (const [key, val] of Object.entries(inputs)) {
      if (/^lora_name_\d+$/.test(key) && typeof val === 'string' && val !== 'None') {
        loraNodes.push({ id: nodeId, node });
        break; // Only push once per node
      }
    }
    // Power Lora Loader (rgthree) uses lora_1, lora_2, ... object fields: {on, lora, strength}
    for (const [key, val] of Object.entries(inputs)) {
      if (/^lora_\d+$/.test(key) && val !== null && typeof val === 'object' && (val as any).lora) {
        loraNodes.push({ id: nodeId, node });
        break;
      }
    }
    if (typeof inputs.text === 'string' && inputs.text.includes('<lora:')) {
      loraNodes.push({ id: nodeId, node });
    }
  }

  // Extract LoRAs
  const loraSet = new Set<string>();
  for (const { node } of loraNodes) {
    const inputs = node.inputs || {};
    if (inputs.lora_name && inputs.lora_name !== 'None') {
      loraSet.add(inputs.lora_name);
    }
    // Handle numbered LoRA stacker fields (lora_name_1, lora_wt_1, model_weight_1 etc.)
    for (const [key, val] of Object.entries(inputs)) {
      const numMatch = key.match(/^lora_name_(\d+)$/);
      if (numMatch && typeof val === 'string' && val !== 'None') {
        const n = numMatch[1];
        // Skip disabled loras (CR LoRA Stack uses switch_N: "On"/"Off")
        const switchVal = inputs[`switch_${n}`];
        if (typeof switchVal === 'string' && switchVal.toLowerCase() === 'off') continue;
        // Weight may be lora_wt_N (generic stacker) or model_weight_N (CR LoRA Stack)
        const weight = inputs[`lora_wt_${n}`] ?? inputs[`model_weight_${n}`];
        if (typeof weight === 'number') {
          loraSet.add(`${val} (${weight})`);
        } else {
          loraSet.add(val);
        }
      }
    }
    // Power Lora Loader (rgthree) — lora_N object fields, only include enabled loras
    for (const [key, val] of Object.entries(inputs)) {
      if (/^lora_\d+$/.test(key) && val !== null && typeof val === 'object') {
        const loraObj = val as any;
        if (loraObj.on && typeof loraObj.lora === 'string' && loraObj.lora !== 'None') {
          const strength = typeof loraObj.strength === 'number' ? ` (${loraObj.strength})` : '';
          loraSet.add(`${loraObj.lora}${strength}`);
        }
      }
    }
    if (typeof inputs.text === 'string') {
      const matches = inputs.text.matchAll(/<lora:([^:>]+):([^>]+)>/g);
      for (const m of matches) loraSet.add(`${m[1]} (${m[2]})`);
    }
  }
  if (loraSet.size > 0) extracted.loras = [...loraSet];

  // ========================================================================
  // PHASE 2: Graph trace from sampler nodes
  // Follow positive/negative wires backwards to find prompt text
  // ========================================================================
  if (samplerNodes.length > 0) {
    // Use the first sampler that has the most complete inputs (most likely the "main" one)
    // Prefer samplers with denoise=1 or no denoise (full generation, not inpainting/refine)
    const mainSampler = samplerNodes.find(s => {
      const d = s.node.inputs.denoise;
      return d === undefined || d === 1;
    }) || samplerNodes[0];

    const inputs = mainSampler.node.inputs;

    // Extract sampler settings
    if (inputs.steps) extracted.steps = String(inputs.steps);
    if (inputs.cfg) extracted.cfg_scale = String(inputs.cfg);
    // sampler_name is the standard KSampler field; custom samplers (FSamplerAdvanced
    // etc.) use 'sampler' instead. Fall back to 'sampler' when sampler_name is absent.
    if (inputs.sampler_name) extracted.sampler = inputs.sampler_name;
    else if (typeof inputs.sampler === 'string') extracted.sampler = inputs.sampler;
    if (inputs.scheduler) extracted.scheduler = inputs.scheduler;
    if (inputs.denoise !== undefined && inputs.denoise !== 1) {
      extracted.denoise = String(inputs.denoise);
    }

    // Resolve seed (might be a ref to a seed generator node)
    for (const seedKey of ['seed', 'noise_seed']) {
      if (inputs[seedKey] !== undefined) {
        if (typeof inputs[seedKey] === 'number') {
          extracted.seed = String(inputs[seedKey]);
          break;
        }
        // Follow ref for seed — look for named seed fields, not just large numbers
        const seedSource = followRef(workflow, inputs[seedKey]);
        if (seedSource) {
          const si = seedSource.node.inputs || {};
          const seedVal = si.seed ?? si.noise_seed ?? si.value;
          if (typeof seedVal === 'number') extracted.seed = String(seedVal);
        }
        if (extracted.seed) break;
      }
    }

    // --- UI-format backfill: when this sampler came from a normalized UI
    // workflow, its settings live positionally in widgets_values rather than in
    // named inputs. Fill ONLY the fields the graph reads above left unset.
    if (Array.isArray(mainSampler.node.widgets_values) &&
        (extracted.steps === undefined || extracted.cfg_scale === undefined ||
         extracted.sampler === undefined || extracted.scheduler === undefined ||
         extracted.seed === undefined)) {
      const w = readSamplerWidgets(mainSampler.node.class_type || '', mainSampler.node.widgets_values);
      if (extracted.steps === undefined && w.steps !== undefined) extracted.steps = w.steps;
      if (extracted.cfg_scale === undefined && w.cfg_scale !== undefined) extracted.cfg_scale = w.cfg_scale;
      if (extracted.sampler === undefined && w.sampler !== undefined) extracted.sampler = w.sampler;
      if (extracted.scheduler === undefined && w.scheduler !== undefined) extracted.scheduler = w.scheduler;
      if (extracted.seed === undefined && w.seed !== undefined) extracted.seed = w.seed;
    }

    // --- SamplerCustomAdvanced: follow specialised input refs ---
    // This Flux-era node delegates to BasicScheduler (steps/scheduler),
    // KSamplerSelect (sampler_name), RandomNoise (noise_seed), and BasicGuider
    // (positive conditioning). All connections are node refs, not direct values.
    if (isNodeRef(inputs.sigmas)) {
      const schedNode = followRef(workflow, inputs.sigmas);
      if (schedNode?.node.inputs) {
        const si = schedNode.node.inputs;
        if (!extracted.steps && si.steps !== undefined) extracted.steps = String(si.steps);
        if (!extracted.scheduler && si.scheduler) extracted.scheduler = si.scheduler;
        if (!extracted.denoise && si.denoise !== undefined && si.denoise !== 1) {
          extracted.denoise = String(si.denoise);
        }
      }
    }
    if (!extracted.sampler && isNodeRef(inputs.sampler)) {
      const kselectNode = followRef(workflow, inputs.sampler);
      if (kselectNode?.node.inputs?.sampler_name) {
        extracted.sampler = kselectNode.node.inputs.sampler_name;
      }
    }
    if (!extracted.seed && isNodeRef(inputs.noise)) {
      const noiseNode = followRef(workflow, inputs.noise);
      if (noiseNode?.node.inputs) {
        const noiseSeed = noiseNode.node.inputs.noise_seed ?? noiseNode.node.inputs.seed;
        if (typeof noiseSeed === 'number') extracted.seed = String(noiseSeed);
      }
    }

    // --- Trace positive conditioning wire ---
    // Quadmoon's _extract_prompt_text_with_trace handles combiners (multiple
    // CLIPTextEncodes via ConditioningCombine) by joining all contributions.
    if (isNodeRef(inputs.positive)) {
      const startId = (inputs.positive as [string, number])[0];
      const traced = extractPromptTextWithTrace(workflow, startId, 'positive', 10, mutedNodeIds);
      if (traced) extracted.prompt = traced;
    }
    // SamplerCustomAdvanced uses a guider node instead of direct positive/negative wires
    if (!extracted.prompt && isNodeRef(inputs.guider)) {
      const guiderNode = followRef(workflow, inputs.guider);
      if (guiderNode && isNodeRef(guiderNode.node.inputs?.conditioning)) {
        const condId = (guiderNode.node.inputs.conditioning as [string, number])[0];
        const traced = extractPromptTextWithTrace(workflow, condId, 'positive', 10, mutedNodeIds);
        if (traced) extracted.prompt = traced;
      }
    }

    // --- Trace negative conditioning wire ---
    if (isNodeRef(inputs.negative)) {
      const startId = (inputs.negative as [string, number])[0];
      const traced = extractPromptTextWithTrace(workflow, startId, 'negative', 10, mutedNodeIds);
      if (traced) extracted.negative_prompt = traced;
    }
  }

  // ========================================================================
  // PHASE 3: Type-match fallback (registry-aware)
  // If graph tracing didn't find prompts, scan for text encoder candidates.
  // We use the registry classification to expand the candidate set: any node
  // that's known (builtin OR custom-via-registry) and carries a text-shaped
  // input is a plausible text encoder, even if its class_type doesn't match
  // the hardcoded CLIPTextEncode/T5/Flux patterns.
  // ========================================================================
  if (!extracted.prompt) {
    const promptTexts: { text: string; nodeId: string }[] = [];

    // Field shapes that strongly suggest a text encoder node
    const TEXT_ENCODER_FIELD_HINTS = ['text', 'text_g', 'text_l', 'prompt', 'string'];
    const looksLikeTextEncoder = (inputs: Record<string, any>, classType: string): boolean => {
      // Hardcoded patterns first (handles workflows with no registry classification)
      if (typeMatches(classType, 'CLIPTextEncode', 'T5TextEncode', 'FluxTextEncode',
                                  'TextEncode', 'PromptEncode')) {
        return true;
      }
      // Class-name heuristics on lowercased name
      const ctLower = classType.toLowerCase();
      if (ctLower.includes('encode') && (ctLower.includes('text') || ctLower.includes('prompt') || ctLower.includes('clip'))) {
        return true;
      }
      // Registry-aware: if this is a known custom node carrying a text-shaped input
      if (isKnownNode(classType)) {
        for (const field of TEXT_ENCODER_FIELD_HINTS) {
          const v = inputs[field];
          if (typeof v === 'string' && v.trim().length > 0) return true;
        }
      }
      return false;
    };

    for (const [nodeId, nodeData] of Object.entries(workflow)) {
      const node = nodeData as any;
      const classType = node.class_type || '';
      const inputs = node.inputs || {};
      if (mutedNodeIds.has(nodeId)) continue;

      if (looksLikeTextEncoder(inputs, classType)) {
        let text = findText(workflow, node);
        // UI-format backfill: text encoders from a normalized UI workflow keep
        // their prompt in widgets_values, not named inputs. Use the longest
        // prompt-shaped widget string when named-input lookup came up empty.
        if (!text && Array.isArray(node.widgets_values)) {
          text = longestStringWidget(node.widgets_values);
        }
        if (text) promptTexts.push({ text, nodeId });
      }
    }

    if (promptTexts.length > 0) {
      // Try to sort positive vs negative using sampler wiring
      const negativeNodeIds = new Set<string>();
      for (const s of samplerNodes) {
        const neg = s.node.inputs?.negative;
        if (isNodeRef(neg)) {
          negativeNodeIds.add(neg[0]);
          // Follow one more level
          const condNode = getNode(workflow, neg[0]);
          if (condNode) {
            for (const val of Object.values(condNode.inputs || {})) {
              if (isNodeRef(val)) negativeNodeIds.add(val[0]);
            }
          }
        }
      }

      for (const pt of promptTexts) {
        if (negativeNodeIds.has(pt.nodeId)) {
          if (!extracted.negative_prompt) extracted.negative_prompt = pt.text;
        } else if (!extracted.prompt || pt.text.length > extracted.prompt.length) {
          extracted.prompt = pt.text;
        }
      }

      // Last resort: longest = positive, next = negative
      if (!extracted.prompt) {
        promptTexts.sort((a, b) => b.text.length - a.text.length);
        extracted.prompt = promptTexts[0].text;
        if (promptTexts.length > 1) extracted.negative_prompt = promptTexts[1].text;
      }
    }
  }

  // ========================================================================
  // PHASE 4: ControlNet detection + model extraction
  // ========================================================================
  const controlnetModels: string[] = [];
  for (const [nodeId, nodeData] of Object.entries(workflow)) {
    const node = nodeData as any;
    if (!node?.inputs || mutedNodeIds.has(nodeId)) continue;
    const ct = (node.class_type || '').toLowerCase();
    const inputs = node.inputs;
    if (ct.includes('controlnet') || ct.includes('control_net')) {
      extracted.uses_controlnet = true;
      const modelName = inputs.control_net_name ?? inputs.controlnet_model ?? inputs.ckpt_name;
      if (typeof modelName === 'string' && modelName !== 'None') {
        const strength = typeof inputs.strength === 'number' ? ` (${inputs.strength})` : '';
        controlnetModels.push(`${modelName}${strength}`);
      }
    }
  }
  if (controlnetModels.length > 0) extracted.controlnet_models = controlnetModels;

  // ========================================================================
  // PHASE 5: Forward conditioning trace (when backward trace was ambiguous)
  // Walk from text-encoder nodes forward through the graph to see if they
  // connect to a sampler's positive or negative input.
  // ========================================================================
  if (extracted.prompt && !extracted.negative_prompt && samplerNodes.length > 0) {
    // Build a forward adjacency: for each node, track which nodes reference it
    const forwardEdges: Record<string, Array<{ targetId: string; inputName: string }>> = {};
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
      const node = nodeData as any;
      if (!node?.inputs || mutedNodeIds.has(nodeId)) continue;
      for (const [inputName, val] of Object.entries(node.inputs)) {
        if (isNodeRef(val)) {
          const sourceId = (val as [string, number])[0];
          if (!forwardEdges[sourceId]) forwardEdges[sourceId] = [];
          forwardEdges[sourceId].push({ targetId: nodeId, inputName });
        }
      }
    }

    // For each text-encoding node, trace forward to see if it eventually
    // connects to a sampler's negative input
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
      const node = nodeData as any;
      if (mutedNodeIds.has(nodeId)) continue;
      const ct = node.class_type || '';
      if (!typeMatches(ct, 'CLIPTextEncode', 'T5TextEncode', 'FluxTextEncode')) continue;

      const text = findText(workflow, node);
      if (!text || text === extracted.prompt) continue;

      // Walk forward up to 5 hops to see if we reach a sampler negative input
      const visited = new Set<string>();
      const queue: string[] = [nodeId];
      let isNegative = false;

      for (let depth = 0; depth < 5 && queue.length > 0 && !isNegative; depth++) {
        const nextQueue: string[] = [];
        for (const current of queue) {
          if (visited.has(current)) continue;
          visited.add(current);
          for (const edge of (forwardEdges[current] || [])) {
            const targetNode = workflow[edge.targetId] as any;
            if (!targetNode?.inputs) continue;
            // Check if target is a sampler and input is 'negative'
            if (isSamplerByFields(targetNode.inputs) && edge.inputName === 'negative') {
              isNegative = true;
              break;
            }
            // Check for guider nodes connecting to negative
            const targetCt = (targetNode.class_type || '').toLowerCase();
            if ((targetCt.includes('guider') || targetCt.includes('guidance')) &&
                edge.inputName.toLowerCase().includes('negative')) {
              isNegative = true;
              break;
            }
            nextQueue.push(edge.targetId);
          }
          if (isNegative) break;
        }
        queue.length = 0;
        queue.push(...nextQueue);
      }

      if (isNegative) {
        extracted.negative_prompt = text;
        break; // Found it
      }
    }
  }

  return extracted;
}

/**
 * Coerce any JSON-derived value to a plain string suitable for rendering.
 * Some metadata formats (e.g. NovelAI v3 reference images, Draw Things style
 * objects) store fields like `prompt` as `{ content, image, ... }` objects
 * instead of plain strings — passing these straight to React triggers error
 * #31. We unwrap known shapes and stringify everything else.
 */
export function coercePromptValue(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
  if (Array.isArray(val)) {
    const parts = val.map(coercePromptValue).filter((s): s is string => !!s);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // Common nested-text shapes seen in the wild
    for (const key of ['content', 'text', 'prompt', 'caption', 'value', 'description']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
    // Last resort: pretty JSON so the user at least sees something useful
    try {
      return JSON.stringify(val);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
