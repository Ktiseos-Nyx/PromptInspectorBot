/* Run with: npx ts-node src/lib/metadata/scripts/gen-fixtures.ts */
import fs from 'fs';
import path from 'path';

const DUMP_DIR = 'C:\\Users\\dusk\\Downloads\\Qwen Suggestions and Context';
const OUT_DIR = path.join(__dirname, '..', '__fixtures__');

// exiftool group-prefixed key -> canonical lowercase PNG chunk key
const KEY_MAP: Record<string, string> = {
  'PNG:Prompt': 'prompt',
  'PNG:Workflow': 'workflow',
  'PNG:Parameters': 'parameters',
  'PNG:Parameters-json': 'parameters-json',
  'PNG:Generation_data': 'generation_data',
  'PNG:Positive_prompt': 'positive_prompt',
  'PNG:Negative_prompt': 'negative_prompt',
  'PNG:DAVANT__batch_parameters': 'davant__batch_parameters',
  'PNG:Comment': 'comment',
  'PNG:Description': 'description',
  'PNG:Software': 'software',
  'PNG:Invokeai_metadata': 'invokeai_metadata',
  'PNG:AIGC': 'aigc',
};

function load(file: string): any[] {
  const raw = fs.readFileSync(path.join(DUMP_DIR, file), 'utf8').replace(/^﻿/, '');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}

function toChunks(o: Record<string, any>): Record<string, string> {
  const chunks: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const mapped = KEY_MAP[k];
    if (mapped && v != null) chunks[mapped] = String(v);
  }
  return chunks;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  for (const dump of ['chunks.json', 'chunks2.json']) {
    for (const o of load(dump)) {
      const chunks = toChunks(o);
      if (Object.keys(chunks).length === 0) continue;
      const base = String(o.SourceFile || 'unknown').split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      const name = base.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(
        path.join(OUT_DIR, `${name}.json`),
        JSON.stringify({ name, source: dump, chunks }, null, 2),
      );
      written++;
    }
  }
  console.log(`wrote ${written} fixtures to ${OUT_DIR}`);
}

main();
