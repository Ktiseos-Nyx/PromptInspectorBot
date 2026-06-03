import { type FormatDetector } from '../types';

export const splitPromptDetector: FormatDetector = {
  name: 'ComfyUI',
  detect() { return false; },
  async parse() { return null; },
};
