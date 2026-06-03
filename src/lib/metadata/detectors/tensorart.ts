import { type FormatDetector } from '../types';

export const tensorArtDetector: FormatDetector = {
  name: 'TensorArt',
  detect() { return false; },
  async parse() { return null; },
};
