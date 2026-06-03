import { type FormatDetector } from '../types';

export const davantDetector: FormatDetector = {
  name: 'A1111-webui',
  detect() { return false; },
  async parse() { return null; },
};
