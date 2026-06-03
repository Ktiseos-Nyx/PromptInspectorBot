/* Run with: npx ts-node src/lib/metadata/scripts/corpus-coverage.ts
 *
 * Measures parser coverage over a large real-world corpus (exiftool -j -G1 dump).
 * Not a unit test — depends on a local dump path, so it's a tool, not CI.
 * Reports prompt/sampler/model extraction rates, the workflow_type distribution,
 * and a sample of files that extract nothing (by chunk-signature) for triage. */
import fs from 'fs';
import { parseAIMetadata } from '../../metadata';

const DUMP = 'C:\\Users\\dusk\\Downloads\\Qwen Suggestions and Context\\chunks-large.json';

const KEY_MAP: Record<string, string> = {
  'PNG:Prompt': 'prompt', 'PNG:Workflow': 'workflow', 'PNG:Parameters': 'parameters',
  'PNG:Parameters-json': 'parameters-json', 'PNG:Generation_data': 'generation_data',
  'PNG:Positive_prompt': 'positive_prompt', 'PNG:Negative_prompt': 'negative_prompt',
  'PNG:DAVANT__batch_parameters': 'davant__batch_parameters', 'PNG:Comment': 'comment',
  'PNG:Description': 'description', 'PNG:Software': 'software',
  'PNG:Invokeai_metadata': 'invokeai_metadata', 'PNG:AIGC': 'aigc',
};

const toChunks = (o: any) => {
  const c: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (KEY_MAP[k] && v != null) c[KEY_MAP[k]] = String(v);
  return c;
};

async function main() {
  const arr = JSON.parse(fs.readFileSync(DUMP, 'utf8').replace(/^﻿/, ''));
  let withMeta = 0, gotPrompt = 0, gotSampler = 0, gotModel = 0;
  const byType: Record<string, number> = {};
  const zeroExtraction: string[] = [];
  // Suspicious sampler false-positives (e.g. ControlNetApply misread as a sampler):
  // flag files whose sampler value looks like a strength/percent rather than a sampler name.
  const suspiciousSampler: string[] = [];

  for (const o of arr) {
    const chunks = toChunks(o);
    if (Object.keys(chunks).length === 0) continue;
    withMeta++;
    let ai: Record<string, any>;
    try { ai = await parseAIMetadata(chunks); } catch (e) { ai = { _error: String(e) }; }
    byType[ai.workflow_type ?? '(none)'] = (byType[ai.workflow_type ?? '(none)'] ?? 0) + 1;
    if (ai.prompt) gotPrompt++;
    if (ai.steps && ai.cfg_scale) gotSampler++;
    if (ai.model || ai.loras) gotModel++;
    const fname = String(o.SourceFile).split(/[\\/]/).pop();
    if (!ai.prompt && !ai.workflow_type) {
      zeroExtraction.push(`${fname} [${Object.keys(chunks).join(',')}]`);
    }
    // A real sampler name is non-numeric; a number-ish sampler signals a misidentified node.
    if (ai.sampler && /^[\d.]+$/.test(String(ai.sampler))) {
      suspiciousSampler.push(`${fname} sampler=${ai.sampler} type=${ai.workflow_type}`);
    }
  }

  const pct = (n: number) => `${((n / withMeta) * 100).toFixed(1)}%`;
  console.log(`Files with AI metadata: ${withMeta}`);
  console.log(`  prompt extracted:      ${gotPrompt} (${pct(gotPrompt)})`);
  console.log(`  steps+cfg extracted:   ${gotSampler} (${pct(gotSampler)})`);
  console.log(`  model/loras extracted: ${gotModel} (${pct(gotModel)})`);
  console.log('\nworkflow_type distribution:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log(`\nsuspicious numeric sampler (possible node false-positive): ${suspiciousSampler.length}`);
  suspiciousSampler.slice(0, 20).forEach(f => console.log(`  ${f}`));
  console.log(`\nzero-extraction files: ${zeroExtraction.length}`);
  zeroExtraction.slice(0, 30).forEach(f => console.log(`  ${f}`));
}

main();
