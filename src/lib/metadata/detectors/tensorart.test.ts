import { describe, it, expect } from 'vitest';
import { tensorArtDetector } from './tensorart';

const chunks = {
  generation_data: JSON.stringify({
    models: [
      { label: 'kawaii v1', type: 'LORA', weight: 0.8, modelFileName: 'kawaii_il_v1a2', baseModel: 'SDXL 1.0', hash: 'EF9B...' },
    ],
  }),
  prompt: JSON.stringify({
    '10001': { class_type: 'ECHOCheckpointLoaderSimple', inputs: { ckpt_name: 'EMS-851555-EMS.safetensors' } },
  }),
};

describe('tensorArtDetector', () => {
  it('detects a generation_data manifest', () => {
    expect(tensorArtDetector.detect(chunks)).toBe(true);
  });
  it('labels TensorArt and emits resources', async () => {
    const ai = await tensorArtDetector.parse(chunks);
    expect(ai!.workflow_type).toBe('TensorArt');
    expect(ai!.resources).toHaveLength(1);
    expect(ai!.resources[0]).toMatchObject({ label: 'kawaii v1', type: 'LORA', weight: 0.8 });
  });
});
