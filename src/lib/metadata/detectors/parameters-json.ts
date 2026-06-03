import { type FormatDetector } from '../types';

export const parametersJsonDetector: FormatDetector = {
  name: 'Parameters-json',
  detect() { return false; },
  async parse() { return null; },
};
