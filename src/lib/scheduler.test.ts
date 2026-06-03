import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { qotdQuestionsPath, loadSeedQuestions } from './scheduler';

// Regression guard for the `/qotd import` bug: the path was resolved from __dirname
// (-> src/ or dist/, where the seed file isn't), so it never found the bank committed
// at the repo root and always reported "not found". It must resolve from process.cwd().
describe('qotdQuestionsPath', () => {
  it('resolves to the bundled seed file that actually exists at the repo root', () => {
    expect(fs.existsSync(qotdQuestionsPath())).toBe(true);
  });
});

describe('loadSeedQuestions', () => {
  it('loads the bundled question bank as a non-empty string array', () => {
    const qs = loadSeedQuestions();
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.every(q => typeof q === 'string')).toBe(true);
  });
});
