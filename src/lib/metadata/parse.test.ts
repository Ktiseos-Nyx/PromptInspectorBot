import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAIMetadata } from '../metadata';

const FX = path.join(__dirname, '__fixtures__');
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(FX, `${n}.json`), 'utf8')).chunks;

describe('parseAIMetadata — current behavior baseline', () => {
  it('parses a standard ComfyUI Prompt+Workflow file (rgthree power lora)', async () => {
    const ai = await parseAIMetadata(load('Anima_Lora_00001_'));
    expect(ai.workflow_type).toBe('ComfyUI');
    expect(typeof ai.prompt).toBe('string');
    expect(ai.prompt.length).toBeGreaterThan(0);
  });

  // CHARACTERIZATION OF THE KNOWN BUG — assert the ACTUAL current output for a
  // Parameters+Workflow (no `prompt` chunk) file. Observed empirically: the parser
  // extracts NOTHING — it returns an empty aiData object. The A1111 branch is gated
  // on `!chunks.workflow`, and there is no `prompt` chunk to trigger the ComfyUI
  // branch, so the file falls through every branch.
  // Task 6 will flip this so the file is recognized as 'ComfyUI'.
  it('CURRENT BUG: a Workflow+Parameters ComfyUI file (ComfyUI_00005_) — baseline', async () => {
    const ai = await parseAIMetadata(load('ComfyUI_00005_'));
    // BUG: nothing is extracted today (empty object).
    expect(Object.keys(ai)).toHaveLength(0);
    expect(ai.workflow_type).toBeUndefined();
    expect(ai.prompt).toBeUndefined();
    expect(ai.steps).toBeUndefined();
    expect(ai.seed).toBeUndefined();
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
});
