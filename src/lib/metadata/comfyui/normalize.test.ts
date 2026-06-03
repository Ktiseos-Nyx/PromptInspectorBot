import { describe, it, expect } from 'vitest';
import { isUiWorkflow, normalizeUiWorkflow } from './normalize';

const ui = {
  last_node_id: 4, last_link_id: 2,
  nodes: [
    { id: 1, type: 'CheckpointLoaderSimple', inputs: [],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [] }, { name: 'CLIP', type: 'CLIP', links: [1, 2] }],
      widgets_values: ['model.safetensors'] },
    { id: 2, type: 'CLIPTextEncode',
      inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [10] }],
      widgets_values: ['a cat in a hat, masterpiece'] },
    { id: 4, type: 'KSampler',
      inputs: [{ name: 'positive', type: 'CONDITIONING', link: 10 }],
      outputs: [], widgets_values: [12345, 'randomize', 25, 7, 'euler', 'normal', 1] },
  ],
  // [link_id, from_node, from_slot, to_node, to_slot, type]
  links: [[1, 1, 1, 2, 0, 'CLIP'], [10, 2, 0, 4, 0, 'CONDITIONING']],
};

describe('isUiWorkflow', () => {
  it('detects the UI {nodes,links} shape', () => {
    expect(isUiWorkflow(ui)).toBe(true);
    expect(isUiWorkflow({ '1': { class_type: 'X', inputs: {} } })).toBe(false);
  });
});

describe('normalizeUiWorkflow', () => {
  it('rebuilds named inline refs from the links array', () => {
    const g = normalizeUiWorkflow(ui);
    expect(g['4'].inputs.positive).toEqual(['2', 0]);
    expect(g['4'].class_type).toBe('KSampler');
    expect(g['4'].widgets_values).toEqual([12345, 'randomize', 25, 7, 'euler', 'normal', 1]);
    expect(g['2'].inputs.clip).toEqual(['1', 1]);
  });
});
