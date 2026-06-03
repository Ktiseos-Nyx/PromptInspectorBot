import { type FormatDetector, getChunk } from '../types';

export const swarmUiDetector: FormatDetector = {
  name: 'SwarmUI',
  detect(chunks) {
    // Some tools (smZ CLIPTextEncode, etc.) write 'Parameters' with a capital P
    const parametersChunk = getChunk(chunks, 'parameters');
    if (!parametersChunk || getChunk(chunks, 'prompt') || getChunk(chunks, 'workflow')) return false;
    const params = String(parametersChunk);
    if (!params.trim().startsWith('{')) return false;
    try {
      const jp = JSON.parse(params);
      // SwarmUI: has comfyuisampler / autowebuisampler / cfgscale (not a raw ComfyUI node)
      if ((jp.comfyuisampler !== undefined || jp.autowebuisampler !== undefined || jp.cfgscale !== undefined) && !jp.class_type) {
        return true;
      }
      // EasyDiffusion: uses verbose field name num_inference_steps instead of steps
      if (jp.num_inference_steps !== undefined) return true;
      return false;
    } catch {
      return false;
    }
  },
  async parse(chunks) {
    const params = String(getChunk(chunks, 'parameters')!);
    const aiData: Record<string, any> = {};
    const jp = JSON.parse(params);

    // SwarmUI: has comfyuisampler / autowebuisampler / cfgscale (not a raw ComfyUI node)
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
    // EasyDiffusion: uses verbose field name num_inference_steps instead of steps
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

    return aiData;
  },
};
