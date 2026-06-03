import { type FormatDetector, type AiMetadata, type RawChunks, normalizeChunkKeys } from './types';
import { invokeAiDetector } from './detectors/invokeai';
import { tensorArtDetector } from './detectors/tensorart';
import { comfyUiDetector } from './detectors/comfyui';
import { swarmUiDetector } from './detectors/swarmui';
import { parametersJsonDetector } from './detectors/parameters-json';
import { davantDetector } from './detectors/davant';
import { splitPromptDetector } from './detectors/split-prompt';
import { novelAiDetector } from './detectors/novelai';
import { midjourneyDetector } from './detectors/midjourney';
import { libLibAiDetector } from './detectors/liblibai';
import { a1111Detector } from './detectors/a1111';

export const DETECTORS: FormatDetector[] = [
  invokeAiDetector,
  tensorArtDetector,
  comfyUiDetector,
  swarmUiDetector,
  parametersJsonDetector,
  davantDetector,
  splitPromptDetector,
  novelAiDetector,
  midjourneyDetector,
  libLibAiDetector,
  a1111Detector,
];

export async function runDetectors(rawChunks: RawChunks): Promise<AiMetadata> {
  const chunks = normalizeChunkKeys(rawChunks);
  for (const detector of DETECTORS) {
    if (!detector.detect(chunks)) continue;
    const result = await detector.parse(chunks);
    if (result && Object.keys(result).length > 0) return result;
  }
  return {};
}
