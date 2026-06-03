import { type FormatDetector, getChunk } from '../types';
import { parseA1111Fields } from './a1111-fields';

export const a1111Detector: FormatDetector = {
  name: 'AUTOMATIC1111',
  detect(chunks) {
    // Some tools (smZ CLIPTextEncode, etc.) write 'Parameters' with a capital P.
    // Preserve the original gate: parameters present, no prompt chunk, no workflow chunk.
    const parametersChunk = getChunk(chunks, 'parameters');
    if (!parametersChunk) return false;
    if (getChunk(chunks, 'prompt')) return false;
    if (getChunk(chunks, 'workflow')) return false;
    return true;
  },
  async parse(chunks) {
    const params = String(getChunk(chunks, 'parameters')!);
    const aiData: Record<string, any> = {};

    // JSON-format parameters: SwarmUI and EasyDiffusion are handled by the
    // swarmui detector (which runs earlier). If a JSON-format parameters chunk
    // reaches here it didn't match those formats, so fall through to A1111 text
    // parsing exactly as the original if-chain did.
    if (params.trim().startsWith('{')) {
      try {
        const jp = JSON.parse(params);
        if ((jp.comfyuisampler !== undefined || jp.autowebuisampler !== undefined || jp.cfgscale !== undefined) && !jp.class_type) {
          const sd = jp.sui_image_params ?? jp;
          aiData.workflow_type = 'SwarmUI';
          if (sd.prompt) aiData.prompt = String(sd.prompt);
          if (sd.negativeprompt) aiData.negative_prompt = String(sd.negativeprompt);
          if (sd.seed !== undefined) aiData.seed = String(sd.seed);
          if (sd.steps !== undefined) aiData.steps = String(sd.steps);
          if (sd.cfgscale !== undefined) aiData.cfg_scale = String(sd.cfgscale);
          if (sd.width && sd.height) aiData.size = `${sd.width}x${sd.height}`;
          if (sd.model) aiData.model = String(sd.model);
          const swarmSampler = sd.comfyuisampler ?? sd.autowebuisampler;
          if (swarmSampler) aiData.sampler = String(swarmSampler);
        } else if (jp.num_inference_steps !== undefined) {
          aiData.workflow_type = 'EasyDiffusion';
          const edPrompt = jp.prompt ?? jp.Prompt;
          if (edPrompt) aiData.prompt = String(edPrompt);
          const edNeg = jp.negative_prompt ?? jp['Negative Prompt'] ?? jp.negative;
          if (edNeg) aiData.negative_prompt = String(edNeg);
          aiData.steps = String(jp.num_inference_steps);
          if (jp.guidance_scale !== undefined) aiData.cfg_scale = String(jp.guidance_scale);
          if (jp.seed !== undefined) aiData.seed = String(jp.seed);
          const edSampler = jp.sampler_name ?? jp.sampler;
          if (edSampler) aiData.sampler = String(edSampler);
          if (jp.width && jp.height) aiData.size = `${jp.width}x${jp.height}`;
          if (jp.use_stable_diffusion_model) {
            const mp = String(jp.use_stable_diffusion_model);
            aiData.model = mp.split(/[/\\]/).pop()?.replace(/\.(safetensors|ckpt|pt)$/i, '') ?? mp;
          }
        }
      } catch { /* not JSON, fall through to A1111 text parsing */ }
    }

    // A1111-style text parameters (A1111, Forge, Yodayo, Civitai A1111)
    if (!aiData.workflow_type) {
      // Basic fields (prompt/negative/steps/sampler/cfg/seed/size/model) come from
      // the shared A1111 field parser; platform detection stays below.
      Object.assign(aiData, parseA1111Fields(params));

      // Version field (search all lines, not just the last — extensions add extra lines)
      const versionMatch = params.match(/Version:\s*([^,\n]+)/);
      const versionStr = versionMatch ? versionMatch[1].trim() : '';
      if (versionStr) aiData.version = versionStr;

      // Platform detection — most-specific signal wins
      if (params.includes('NGMS:')) {
        // Yodayo/Moescape: NGMS is their unique content-filter strength field
        aiData.workflow_type = 'Yodayo';
        const ngmsMatch = params.match(/NGMS:\s*([\d.]+)/);
        if (ngmsMatch) aiData.ngms = ngmsMatch[1];
      } else if (/Civitai resources:|Civitai metadata:/.test(params)) {
        // Civitai on-site generator embeds explicit resource metadata
        aiData.workflow_type = 'Civitai';
      } else if (/^neo/i.test(versionStr)) {
        // Forge Neo: version string is "NEO" or "neo-x.x"
        aiData.workflow_type = 'Forge Neo';
      } else if (/^f\d/i.test(versionStr)) {
        // Forge: version string starts with 'f' (e.g. "f0.0.17-dirty-1254-gabcdef")
        aiData.workflow_type = 'Forge';
      } else if (versionStr.toLowerCase() === 'comfyui') {
        // smZ CLIPTextEncode and similar ComfyUI nodes that emit A1111-style params
        // include "Version: ComfyUI" to signal they're ComfyUI-generated
        aiData.workflow_type = 'ComfyUI';
      } else {
        aiData.workflow_type = 'AUTOMATIC1111';
      }
    }

    return aiData;
  },
};
