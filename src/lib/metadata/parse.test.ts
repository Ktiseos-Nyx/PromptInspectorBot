import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAIMetadata, routeUserComment } from '../metadata';

const FX = path.join(__dirname, '__fixtures__');
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(FX, `${n}.json`), 'utf8')).chunks;

describe('parseAIMetadata — current behavior baseline', () => {
  it('parses a standard ComfyUI Prompt+Workflow file (rgthree power lora)', async () => {
    const ai = await parseAIMetadata(load('Anima_Lora_00001_'));
    expect(ai.workflow_type).toBe('ComfyUI');
    expect(typeof ai.prompt).toBe('string');
    expect(ai.prompt.length).toBeGreaterThan(0);
  });

  it('labels a Workflow+Parameters ComfyUI file as ComfyUI (not empty / not AUTOMATIC1111)', async () => {
    const ai = await parseAIMetadata(load('ComfyUI_00005_'));
    expect(ai.workflow_type).toBe('ComfyUI');
    // Field values come through (from the Parameters block until UI graph parsing lands in Tasks 7-8)
    expect(ai.steps).toBe('30');
    expect(ai.prompt).toContain('cone hair bun');
  });

  it('parses a Parameters-only file (ComfyUI_00015_) as an A1111-family type', async () => {
    const ai = await parseAIMetadata(load('ComfyUI_00015_'));
    // Observed: classified as AUTOMATIC1111 with a full prompt/steps/seed extracted.
    expect(ai.workflow_type).toBe('AUTOMATIC1111');
    expect(typeof ai.prompt).toBe('string');
    expect(ai.prompt.length).toBeGreaterThan(0);
    expect(ai.steps).toBe('30');
    expect(typeof ai.seed).toBe('string');
  });

  it('extracts from a pure-UI Workflow-only file (no prompt/parameters)', async () => {
    const ai = await parseAIMetadata(load('txt2img-basic-sdca-wsn'));
    expect(ai.workflow_type).toBe('ComfyUI');
    expect(typeof ai.prompt).toBe('string');
    expect(ai.prompt.length).toBeGreaterThan(0);
  });

  it('labels every Workflow-bearing fixture as a ComfyUI-family type, never AUTOMATIC1111', async () => {
    const comfyFixtures = ['ComfyUI_00005_','ComfyUI_00008_','ComfyUI_00009_','ComfyUI_00011_',
      'ComfyUI_00013_','ComfyUI_00014_','ComfyUI_00016_','ComfyUI_00017_','ComfyUI_00018_','ComfyUI_00020_'];
    for (const name of comfyFixtures) {
      const ai = await parseAIMetadata(load(name));
      expect(['ComfyUI','Civitai','TensorArt','ArcEnCiel']).toContain(ai.workflow_type);
    }
  });
});

// CodeRabbit (PR #41): the EXIF/UserComment fallback must not route ALL JSON to the
// `prompt` chunk, or comfyUiDetector swallows non-ComfyUI JSON and short-circuits the
// SwarmUI/A1111 detectors. routeUserComment sends only ComfyUI graphs to `prompt`.
describe('routeUserComment', () => {
  it('routes a ComfyUI graph (has class_type) to the prompt chunk', () => {
    const uc = '{"3":{"class_type":"KSampler","inputs":{}}}';
    expect(routeUserComment(uc)).toEqual({ prompt: uc });
  });
  it('routes non-ComfyUI JSON (e.g. SwarmUI) to the parameters chunk', () => {
    const uc = '{"comfyuisampler":"euler","cfgscale":7,"prompt":"a dog"}';
    expect(routeUserComment(uc)).toEqual({ parameters: uc });
  });
  it('routes plain A1111 text to the parameters chunk', () => {
    const uc = 'a cat\nNegative prompt: blurry\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1';
    expect(routeUserComment(uc)).toEqual({ parameters: uc });
  });
});

describe('parseAIMetadata — EXIF UserComment routing (CodeRabbit #41)', () => {
  it('parses a ComfyUI graph carried in _exif_usercomment as ComfyUI', async () => {
    const uc = JSON.stringify({
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a fox in the snow, masterpiece' } },
      '4': { class_type: 'KSampler', inputs: { steps: 22, cfg: 6, sampler_name: 'euler', seed: 9, positive: ['6', 0], negative: ['6', 0] } },
    });
    const ai = await parseAIMetadata({ _exif_usercomment: uc });
    expect(ai.workflow_type).toBe('ComfyUI');
    expect(ai.prompt).toContain('a fox in the snow');
  });
  it('routes a SwarmUI JSON UserComment to SwarmUI, not ComfyUI', async () => {
    const uc = JSON.stringify({ comfyuisampler: 'euler', cfgscale: 7, prompt: 'a dog', negativeprompt: 'blurry', steps: 20 });
    const ai = await parseAIMetadata({ _exif_usercomment: uc });
    expect(ai.workflow_type).toBe('SwarmUI');
    expect(ai.prompt).toBe('a dog');
  });
});
