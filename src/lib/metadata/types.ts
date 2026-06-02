export type RawChunks = Record<string, unknown>;
export type AiMetadata = Record<string, any>;

export interface FormatDetector {
  /** Human-readable format name; also the value written to ai.workflow_type by most detectors. */
  name: string;
  /** Cheap signature check against normalized (lowercased-key) chunks. */
  detect(chunks: RawChunks): boolean;
  /** Parse to AiMetadata; return null if detect() was a false positive. */
  parse(chunks: RawChunks): Promise<AiMetadata | null>;
}

/** Lowercase every chunk key so exiftool's `PNG:Prompt` and a real `prompt` converge.
 *  On collision the first-seen key wins (callers pass real files, not both casings). */
export function normalizeChunkKeys(chunks: RawChunks): RawChunks {
  const out: RawChunks = {};
  for (const [k, v] of Object.entries(chunks)) {
    const lk = k.toLowerCase();
    if (!(lk in out)) out[lk] = v;
  }
  return out;
}

/** Read a chunk case-insensitively, coerced to string. */
export function getChunk(chunks: RawChunks, name: string): string | undefined {
  const lk = name.toLowerCase();
  for (const [k, v] of Object.entries(chunks)) {
    if (k.toLowerCase() === lk && v != null) return String(v);
  }
  return undefined;
}
