// @ts-expect-error — exif-parser has no type declarations
import exifParser from 'exif-parser';
import iconv from 'iconv-lite';
import zlib from 'zlib';
import { coercePromptValue } from './metadata/comfyui/graph-trace';
import { runDetectors } from './metadata/registry';

// PNG chunk parser for AI generation parameters
function parsePNGChunks(buffer: Buffer): Record<string, any> {
  const chunks: Record<string, any> = {};

  // Check PNG signature
  if (buffer.length < 8 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    return chunks;
  }

  let offset = 8; // Skip PNG signature

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;

    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (offset + 12 + length > buffer.length) break;

    const data = buffer.slice(offset + 8, offset + 8 + length);

    // Parse text chunks
    if (type === 'tEXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const key = data.toString('latin1', 0, nullIndex);
        const value = data.toString('utf8', nullIndex + 1);
        chunks[key] = value;
      }
    } else if (type === 'iTXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const key = data.toString('latin1', 0, nullIndex);
        let textStart = nullIndex + 1;
        const compressionFlag = data[textStart++];
        const compressionMethod = data[textStart++];
        // Skip language tag (null-terminated)
        while (textStart < data.length && data[textStart] !== 0) textStart++;
        textStart++;
        // Skip translated keyword (null-terminated)
        while (textStart < data.length && data[textStart] !== 0) textStart++;
        textStart++;
        if (compressionFlag === 1 && compressionMethod === 0) {
          try {
            const decompressed = zlib.inflateSync(data.slice(textStart));
            chunks[key] = decompressed.toString('utf8');
          } catch { /* skip invalid compressed data */ }
        } else {
          chunks[key] = data.toString('utf8', textStart);
        }
      }
    } else if (type === 'zTXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1 && data[nullIndex + 1] === 0) {
        const key = data.toString('latin1', 0, nullIndex);
        try {
          const decompressed = zlib.inflateSync(data.slice(nullIndex + 2));
          chunks[key] = decompressed.toString('utf8');
        } catch { /* skip invalid compressed data */ }
      }
    } else if (type === 'eXIf') {
      // Raw TIFF data — prepend the "Exif\0\0" header the parser expects
      const withHeader = Buffer.concat([Buffer.from('Exif\0\0'), data]);
      const uc = extractUserCommentFromTIFF(withHeader);
      if (uc) chunks['_exif_usercomment'] = uc;
    }

    offset += 12 + length; // length + type + data + CRC
  }

  return chunks;
}

// Parse AI generation parameters from various formats
export async function parseAIMetadata(chunks: Record<string, any>): Promise<Record<string, any>> {
  const aiData = await runDetectors(chunks);

  // MJ author chunk (post-step, not a format)
  if (chunks.Author && aiData.workflow_type === 'Midjourney') aiData.author = chunks.Author;

  // PNG eXIf UserComment fallback — recurse through the registry
  if (!aiData.workflow_type && chunks._exif_usercomment) {
    const uc = String(chunks._exif_usercomment);
    const ucParsed = await parseAIMetadata(uc.trim().startsWith('{') ? { prompt: uc } : { parameters: uc });
    Object.assign(aiData, ucParsed);
  }
  return aiData;
}

// Decode a UserComment byte payload using iconv-lite.
// The EXIF UserComment spec: first 8 bytes = encoding ID, rest = encoded text.
// Known prefixes: "ASCII\0\0\0", "UNICODE\0" (UTF-16), "JIS\0\0\0\0\0" (Shift-JIS)
// Some tools write raw bytes with no prefix at all.
function decodeUserComment(raw: Buffer): string | null {
  if (raw.length < 8) return null;

  const prefix = raw.slice(0, 8);
  const payload = raw.slice(8);

  // UNICODE prefix → UTF-16 (Civitai, some A1111 forks)
  if (prefix.indexOf('UNICODE') === 0) {
    // Detect BOM: if first two bytes are FF FE → LE, FE FF → BE
    if (payload.length >= 2 && payload[0] === 0xFF && payload[1] === 0xFE) {
      return iconv.decode(payload.slice(2), 'utf-16le').replace(/\0+$/, '').trim();
    }
    if (payload.length >= 2 && payload[0] === 0xFE && payload[1] === 0xFF) {
      return iconv.decode(payload.slice(2), 'utf-16be').replace(/\0+$/, '').trim();
    }
    // No BOM — detect byte order by checking null byte positions.
    // In UTF-16-LE ASCII text: XX 00 XX 00 (every odd byte is 00)
    // In UTF-16-BE ASCII text: 00 XX 00 XX (every even byte is 00)
    const encoding = detectUTF16ByteOrder(payload);
    const decoded = iconv.decode(payload, encoding).replace(/\0+$/, '').trim();
    // If result still looks like mojibake (CJK where ASCII expected), try the other order
    if (hasMojibake(decoded) || looksLikeByteSwappedASCII(decoded)) {
      const altEncoding = encoding === 'utf-16le' ? 'utf-16be' : 'utf-16le';
      const altDecoded = iconv.decode(payload, altEncoding).replace(/\0+$/, '').trim();
      if (!hasMojibake(altDecoded) && !looksLikeByteSwappedASCII(altDecoded)) {
        return altDecoded;
      }
    }
    return decoded;
  }

  // ASCII prefix → UTF-8
  if (prefix.indexOf('ASCII') === 0) {
    return payload.toString('utf8').replace(/\0+$/, '').trim();
  }

  // JIS prefix → Shift-JIS (Japanese tools)
  if (prefix.indexOf('JIS') === 0) {
    return iconv.decode(payload, 'shiftjis').replace(/\0+$/, '').trim();
  }

  // No recognized prefix — try UTF-8 first, then common fallbacks
  const utf8 = raw.toString('utf8').replace(/\0+$/, '').trim();
  // Check for mojibake indicators (common in mis-encoded text)
  if (!hasMojibake(utf8) && utf8.length > 0) return utf8;

  // Try Shift-JIS
  try {
    const sjis = iconv.decode(raw, 'shiftjis').replace(/\0+$/, '').trim();
    if (sjis.length > 0 && !hasMojibake(sjis)) return sjis;
  } catch { /* skip */ }

  // Try Windows-1252 (Latin)
  try {
    const latin = iconv.decode(raw, 'windows-1252').replace(/\0+$/, '').trim();
    if (latin.length > 0) return latin;
  } catch { /* skip */ }

  // Give back the UTF-8 attempt as last resort
  return utf8.length > 0 ? utf8 : null;
}

// Quick heuristic: does the string look like mojibake?
// Looks for sequences of replacement chars or implausible byte patterns
function hasMojibake(text: string): boolean {
  // Unicode replacement characters
  if (text.includes('\uFFFD')) return true;
  // Runs of C2/C3 + high bytes (classic UTF-8-decoded-as-Latin mojibake)
  if (/[\u00C2\u00C3][\u0080-\u00BF]{2,}/.test(text)) return true;
  return false;
}

// Detect UTF-16 byte order by sampling null byte positions.
// ASCII text in UTF-16-LE: byte pairs are [char, 0x00] — odd positions are 0x00
// ASCII text in UTF-16-BE: byte pairs are [0x00, char] — even positions are 0x00
function detectUTF16ByteOrder(data: Buffer): 'utf-16le' | 'utf-16be' {
  let leScore = 0; // odd bytes are 0x00 → LE
  let beScore = 0; // even bytes are 0x00 → BE
  const sampleSize = Math.min(data.length, 64); // check first 32 code units
  for (let i = 0; i < sampleSize - 1; i += 2) {
    if (data[i] !== 0 && data[i + 1] === 0) leScore++;
    if (data[i] === 0 && data[i + 1] !== 0) beScore++;
  }
  return beScore > leScore ? 'utf-16be' : 'utf-16le';
}

// Detect byte-swapped ASCII: CJK chars in the U+6000-U+7A00 range that map to
// ASCII a-z/A-Z when byte-swapped (e.g. 瀀=U+7000 is really 'p'=U+0070 swapped)
function looksLikeByteSwappedASCII(text: string): boolean {
  if (text.length < 5) return false;
  let suspiciousCount = 0;
  const sampleLen = Math.min(text.length, 50);
  for (let i = 0; i < sampleLen; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs range that maps to ASCII when byte-swapped
    // ASCII 0x20-0x7E → swapped becomes 0x2000-0x7E00
    if (code >= 0x2000 && code <= 0x7F00 && (code & 0xFF) === 0) {
      suspiciousCount++;
    }
  }
  // If more than 40% of sampled chars look byte-swapped, it's likely wrong endianness
  return suspiciousCount / sampleLen > 0.4;
}

// Extract AI metadata from JPEG EXIF UserComment field.
// Different tools encode UserComment differently:
//   - Civitai: "UNICODE\0" prefix + UTF-16-LE text (A1111-style params)
//   - ComfyUI: "ASCII\0\0\0" prefix + UTF-8 JSON, or raw UTF-8 JSON
//   - A1111: may use ASCII prefix or raw text
//   - Japanese tools: JIS prefix + Shift-JIS
//
// Proper approach: parse the TIFF IFD structure to find the UserComment tag,
// read its offset and byte count, then decode only the exact data bytes.
function parseJPEGUserComment(buffer: Buffer): string | null {
  try {
    let offset = 2; // Skip JPEG SOI marker (FF D8)

    while (offset < buffer.length - 4) {
      if (buffer[offset] !== 0xFF) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xDA) break; // SOS — no more metadata after this

      // APP1 = 0xE1 (EXIF lives here)
      if (marker === 0xE1) {
        const segLength = (buffer[offset + 2] << 8) | buffer[offset + 3];
        const segEnd = offset + 2 + segLength;
        const segData = buffer.slice(offset + 4, segEnd);

        // Try proper TIFF-based extraction first
        const fromTIFF = extractUserCommentFromTIFF(segData);
        if (fromTIFF) return fromTIFF;

        // Fallback: scan entire segment for encoding prefixes
        const fromScan = scanForUserComment(segData);
        if (fromScan) return fromScan;

        offset = segEnd;
        continue;
      }

      // Skip other marker segments
      if ((marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE) {
        const segLength = (buffer[offset + 2] << 8) | buffer[offset + 3];
        offset += 2 + segLength;
      } else {
        offset++;
      }
    }
  } catch (e) {
    console.error('parseJPEGUserComment error:', e);
  }
  return null;
}

// Parse the TIFF structure inside an APP1 segment to find UserComment (tag 0x9286).
// This correctly handles byte order (II = little-endian, MM = big-endian).
function extractUserCommentFromTIFF(segData: Buffer): string | null {
  // APP1 starts with "Exif\0\0" (6 bytes), then TIFF header
  if (segData.length < 14) return null;
  const exifHeader = segData.toString('ascii', 0, 4);
  if (exifHeader !== 'Exif') return null;

  const tiffStart = 6; // offset within segData where TIFF header begins
  const tiffData = segData.slice(tiffStart);
  const byteOrder = tiffData.toString('ascii', 0, 2);
  const isLE = byteOrder === 'II';
  const isBE = byteOrder === 'MM';
  if (!isLE && !isBE) return null;

  // All offsets in TIFF are relative to tiffStart (the TIFF header)
  const read16 = (off: number) => {
    if (off + 2 > tiffData.length) return 0;
    return isLE ? tiffData.readUInt16LE(off) : tiffData.readUInt16BE(off);
  };
  const read32 = (off: number) => {
    if (off + 4 > tiffData.length) return 0;
    return isLE ? tiffData.readUInt32LE(off) : tiffData.readUInt32BE(off);
  };

  // Verify TIFF magic (42)
  if (read16(2) !== 42) return null;

  const ifd0Offset = read32(4);

  // Read a 4-byte value from an IFD entry's value field (used for pointers like EXIF IFD offset)
  function findIFDEntryValue(ifdOffset: number, targetTag: number): number | null {
    if (ifdOffset + 2 > tiffData.length) return null;
    const entryCount = read16(ifdOffset);
    for (let i = 0; i < entryCount; i++) {
      const entryOff = ifdOffset + 2 + i * 12;
      if (entryOff + 12 > tiffData.length) break;
      if (read16(entryOff) === targetTag) {
        return read32(entryOff + 8); // value/offset field
      }
    }
    return null;
  }

  // Find UserComment data (tag 0x9286) in an IFD — returns raw bytes
  function findUserComment(ifdOffset: number): Buffer | null {
    if (ifdOffset + 2 > tiffData.length) return null;
    const entryCount = read16(ifdOffset);
    for (let i = 0; i < entryCount; i++) {
      const entryOff = ifdOffset + 2 + i * 12;
      if (entryOff + 12 > tiffData.length) break;
      if (read16(entryOff) !== 0x9286) continue;

      // Type 7 = UNDEFINED, 1 byte per element
      const byteCount = read32(entryOff + 4);
      if (byteCount < 8) return null;

      // byteCount >= 8 guaranteed by guard above, so value is never inline
      const dataStart = read32(entryOff + 8); // offset from TIFF header

      if (dataStart + byteCount > tiffData.length) return null;
      return tiffData.slice(dataStart, dataStart + byteCount);
    }
    return null;
  }

  // Find EXIF sub-IFD pointer (tag 0x8769) in IFD0
  const exifIFDOffset = findIFDEntryValue(ifd0Offset, 0x8769);
  if (exifIFDOffset === null) return null;

  // Find UserComment in EXIF IFD
  const ucRaw = findUserComment(exifIFDOffset);
  if (!ucRaw) return null;

  const decoded = decodeUserComment(ucRaw);
  if (decoded && decoded.length > 5) return decoded;

  return null;
}

// Fallback: scan segment bytes for encoding prefixes (handles non-standard EXIF)
function scanForUserComment(segData: Buffer): string | null {
  for (const prefix of ['UNICODE', 'ASCII\0\0\0', 'JIS\0\0\0\0\0']) {
    const idx = segData.indexOf(prefix);
    if (idx === -1) continue;

    // Try to determine data length: scan for a run of null bytes after text
    // or use a reasonable max length
    let endIdx = idx + 8; // skip prefix
    const maxEnd = Math.min(segData.length, idx + 65536);

    if (prefix === 'UNICODE') {
      // UTF-16-LE: scan for 4+ consecutive null bytes (end of text region)
      endIdx = idx + 8;
      while (endIdx + 3 < maxEnd) {
        if (segData[endIdx] === 0 && segData[endIdx + 1] === 0 &&
            segData[endIdx + 2] === 0 && segData[endIdx + 3] === 0) {
          break;
        }
        endIdx += 2; // advance by UTF-16 code unit
      }
      endIdx = Math.min(endIdx + 2, maxEnd); // include last char
    } else {
      // ASCII/JIS: scan for null terminator
      while (endIdx < maxEnd && segData[endIdx] !== 0) endIdx++;
    }

    const commentRaw = segData.slice(idx, endIdx);
    const decoded = decodeUserComment(commentRaw);
    if (decoded && decoded.length > 5 && (decoded.includes('Steps:') || decoded.startsWith('{') || decoded.length > 20)) {
      return decoded;
    }
  }

  // Also try finding raw JSON or A1111 params without prefix
  const jsonStart = segData.indexOf('{'.charCodeAt(0));
  if (jsonStart !== -1) {
    // Try to find matching closing brace
    let braceDepth = 0;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < Math.min(segData.length, jsonStart + 65536); i++) {
      if (segData[i] === 0x7B) braceDepth++;
      else if (segData[i] === 0x7D) { braceDepth--; if (braceDepth === 0) { jsonEnd = i + 1; break; } }
    }
    if (jsonEnd > jsonStart) {
      const possibleJson = segData.slice(jsonStart, jsonEnd).toString('utf8').trim();
      try { JSON.parse(possibleJson); return possibleJson; } catch { /* not valid json */ }
    }
  }

  const stepsIdx = segData.indexOf('Steps:');
  if (stepsIdx !== -1) {
    let textStart = stepsIdx;
    while (textStart > 0 && segData[textStart - 1] !== 0) textStart--;
    const comment = segData.slice(textStart, Math.min(segData.length, stepsIdx + 4096)).toString('utf8').replace(/\0+$/, '').trim();
    if (comment.length > 10) return comment;
  }

  return null;
}

// ============================================================================
// XMP Extraction — XML-based metadata (Midjourney, Draw Things, Mochi, cameras)
// ============================================================================

// Extract raw XMP XML string from a file buffer (works for PNG, JPEG, WebP, TIFF)
function extractXMPString(buffer: Buffer): string | null {
  // Method 1: Search for XMP packet markers directly in the buffer.
  // This works across all formats since XMP is always valid XML text.
  const startMarker = '<x:xmpmeta';
  const endMarker = '</x:xmpmeta>';

  const startIdx = buffer.indexOf(startMarker);
  if (startIdx === -1) return null;

  const endIdx = buffer.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;

  return buffer.slice(startIdx, endIdx + endMarker.length).toString('utf8');
}

// Parse XMP XML into a flat key-value object using regex.
// No XML parser needed — XMP is structured enough for pattern matching.
function parseXMP(xmpString: string): Record<string, any> {
  const xmp: Record<string, any> = {};

  // Extract all simple property values: <ns:Key>Value</ns:Key>
  const simpleProps = xmpString.matchAll(/<([a-zA-Z_][\w]*):([a-zA-Z_][\w]*)(?:\s[^>]*)?>([^<]+)<\/\1:\2>/g);
  for (const match of simpleProps) {
    const ns = match[1];
    const key = match[2];
    const value = match[3].trim();
    if (value) {
      // Use namespace:key for clarity, but also store common ones with friendly names
      xmp[`${ns}:${key}`] = value;
    }
  }

  // Extract attribute-based values: ns:Key="value"
  const attrProps = xmpString.matchAll(/\s([a-zA-Z_][\w]*):([a-zA-Z_][\w]*)="([^"]+)"/g);
  for (const match of attrProps) {
    const ns = match[1];
    const key = match[2];
    const value = match[3].trim();
    if (value && ns !== 'xmlns' && ns !== 'x' && ns !== 'rdf') {
      xmp[`${ns}:${key}`] = value;
    }
  }

  // Extract rdf:li items (used for lists like dc:subject tags, dc:description, exif:UserComment)
  // These can contain large text blobs, JSON, or multi-line content
  const listBlocks = xmpString.matchAll(/<([a-zA-Z_][\w]*):([a-zA-Z_][\w]*)\s*>\s*<rdf:(?:Bag|Seq|Alt)\s*>([\s\S]*?)<\/rdf:(?:Bag|Seq|Alt)>/g);
  for (const block of listBlocks) {
    const ns = block[1];
    const key = block[2];
    const itemsRaw = block[3];
    // Use [\s\S]*? to match ANY content inside rdf:li, including newlines, JSON, XML entities
    const items = [...itemsRaw.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)]
      .map(m => m[1].trim().replace(/&#xA;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
      .filter(Boolean);
    if (items.length > 0) {
      xmp[`${ns}:${key}`] = items.length === 1 ? items[0] : items;
    }
  }

  return xmp;
}

// Extract AI-specific metadata from XMP data
function extractAIFromXMP(xmp: Record<string, any>): Record<string, any> {
  const ai: Record<string, any> = {};

  // --- Midjourney ---
  // MJ stores prompt in dc:description and sometimes in xmp:Description
  // Job ID, version info may be in other fields
  const description = xmp['dc:description'];
  if (typeof description === 'string' && description.length > 20) {
    // Midjourney descriptions often contain the full prompt with --parameters
    const mjParamMatch = description.match(/^([\s\S]+?)\s+--/);
    if (mjParamMatch) {
      ai.prompt = mjParamMatch[1].trim();
      ai.workflow_type = 'Midjourney';
      // Extract MJ parameters
      const arMatch = description.match(/--ar\s+([\d:]+)/);
      const vMatch = description.match(/--v\s+([\d.]+)/);
      const sMatch = description.match(/--s\s+(\d+)/);
      const cMatch = description.match(/--c\s+(\d+)/);
      const seedMatch = description.match(/--seed\s+(\d+)/);
      const noMatch = description.match(/--no\s+([^-]+)/);
      if (arMatch) ai.aspect_ratio = arMatch[1];
      if (vMatch) ai.version = `v${vMatch[1]}`;
      if (sMatch) ai.stylize = sMatch[1];
      if (cMatch) ai.chaos = cMatch[1];
      if (seedMatch) ai.seed = seedMatch[1];
      if (noMatch) ai.negative_prompt = noMatch[1].trim();
    } else if (!ai.prompt) {
      ai.prompt = description;
    }
  }

  // --- Draw Things ---
  // Draw Things stores rich JSON in exif:UserComment AND A1111-style text in dc:description
  const software = xmp['xmp:CreatorTool'] || xmp['tiff:Software'] || '';
  const isDrawThings = typeof software === 'string' && software.toLowerCase().includes('draw things');

  const userComment = xmp['exif:UserComment'] || xmp['tiff:ImageDescription'];
  if (typeof userComment === 'string' && userComment.length > 10) {
    try {
      const parsed = JSON.parse(userComment);
      // Draw Things JSON format
      if (parsed.c || parsed.model || parsed.sampler) {
        ai.workflow_type = 'Draw Things';
        const promptStr = coercePromptValue(parsed.c);
        const negStr = coercePromptValue(parsed.uc);
        if (promptStr) ai.prompt = promptStr;
        if (negStr) ai.negative_prompt = negStr;
        if (parsed.model) ai.model = coercePromptValue(parsed.model);
        if (parsed.sampler) ai.sampler = coercePromptValue(parsed.sampler);
        if (parsed.steps) ai.steps = String(parsed.steps);
        if (parsed.scale) ai.cfg_scale = String(parsed.scale);
        if (parsed.seed) ai.seed = String(parsed.seed);
        if (parsed.size) ai.size = coercePromptValue(parsed.size);
        if (parsed.seed_mode) ai.seed_mode = coercePromptValue(parsed.seed_mode);
        if (parsed.strength) ai.strength = String(parsed.strength);
        // LoRAs
        if (Array.isArray(parsed.lora) && parsed.lora.length > 0) {
          ai.loras = parsed.lora.map((l: any) => `${l.model} (${l.weight})`);
        }
      } else if (parsed.prompt) {
        // Coerce per-field rather than spreading raw JSON, which can drop
        // object-shaped fields straight into the AI tab as React children.
        const promptStr = coercePromptValue(parsed.prompt);
        if (promptStr) ai.prompt = promptStr;
        const negStr = coercePromptValue(parsed.negative_prompt ?? parsed.uc);
        if (negStr) ai.negative_prompt = negStr;
        for (const [k, v] of Object.entries(parsed)) {
          if (k === 'prompt' || k === 'negative_prompt' || k === 'uc') continue;
          if (ai[k] !== undefined) continue;
          const coerced = coercePromptValue(v);
          if (coerced !== undefined) ai[k] = coerced;
        }
      }
    } catch {
      // Not JSON — try A1111-style text
      if (userComment.includes('Steps:')) {
        ai._drawthings_params = userComment;
      }
    }
  }

  // If dc:description has A1111-style params (Draw Things also puts them there)
  if (isDrawThings && typeof description === 'string' && description.includes('Steps:') && !ai.prompt) {
    ai._drawthings_params = description;
  }

  // --- Common AI XMP fields ---
  const creator = xmp['dc:creator'];
  if (creator) ai.creator_tool = typeof creator === 'string' ? creator : Array.isArray(creator) ? creator.join(', ') : undefined;

  if (software && !ai.software) ai.software = software;

  // Photoshop/Adobe fields that may indicate AI generation
  const history = xmp['xmpMM:History'];
  if (typeof history === 'string' && (history.includes('firefly') || history.includes('generative'))) {
    ai.workflow_type = ai.workflow_type || 'Adobe Firefly';
  }

  return ai;
}

// Detect the actual image format from magic bytes, ignoring file extension.
// CDNs (Civitai, etc.) sometimes serve PNG files with a .jpeg extension.
// Returns null if the format is not recognised.
// Extract image dimensions without relying on EXIF data.
// PNG: read IHDR (always the first chunk, width/height at fixed offsets).
// JPEG: scan for the first SOF marker.
function extractImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  if (mimeType === 'image/png' && buffer.length >= 24) {
    // After the 8-byte PNG signature: 4-byte chunk length + 4-byte "IHDR" type,
    // then the IHDR data: width (4 bytes BE) at offset 16, height at offset 20.
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  } else if (mimeType === 'image/jpeg') {
    let offset = 2; // Skip SOI marker (FF D8)
    while (offset + 3 < buffer.length) {
      if (buffer[offset] !== 0xFF) break;
      const marker = buffer[offset + 1];
      const segLen = buffer.readUInt16BE(offset + 2);
      // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15 carry dimensions.
      // Exclude 0xC4 (DHT), 0xC8 (reserved), 0xCC (DAC).
      if (marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC &&
          ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
           (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF))) {
        if (offset + 8 < buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
        }
      }
      offset += 2 + segLen;
    }
  }
  return null;
}

function detectMimeFromMagic(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // WebP: RIFF????WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Parse RIFF/WebP container chunks to extract an EXIF chunk if present.
function parseWebPExif(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + chunkSize > buffer.length) break;
    const chunkData = buffer.slice(offset + 8, offset + 8 + chunkSize);

    if (tag === 'EXIF') {
      // WebP EXIF payload starts at the TIFF header — no "Exif\0\0" prefix.
      // Some encoders write it anyway, so check before prepending to avoid doubling it.
      const hasExifHeader = chunkData.length >= 4 && chunkData.toString('ascii', 0, 4) === 'Exif';
      const tiffData = hasExifHeader ? chunkData : Buffer.concat([Buffer.from('Exif\0\0'), chunkData]);
      return extractUserCommentFromTIFF(tiffData);
    }

    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to even byte boundary
  }
  return null;
}

// Shared extraction function used by both GET (path-based) and POST (file upload)
export async function extractMetadataFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  fileSize: number,
  lastModified: string,
): Promise<Record<string, any>> {
  // Trust file content over extension — CDNs can mislabel format in the filename.
  const effectiveMime = detectMimeFromMagic(buffer) ?? mimeType;

  let exifData = {};
  let iptcData = {};

  // Try to parse EXIF data (only works for JPEG/TIFF)
  try {
    const parser = exifParser.create(buffer);
    const result = parser.parse();
    exifData = result.tags || {};
    iptcData = result.iptc || {};
  } catch (e) {
    // EXIF parsing failed, that's ok for PNGs
  }

  // Parse PNG chunks for AI metadata
  let aiData: Record<string, any> = {};
  if (effectiveMime === 'image/png') {
    const chunks = parsePNGChunks(buffer);
    aiData = await parseAIMetadata(chunks);
  } else if (effectiveMime === 'image/webp') {
    const webpComment = parseWebPExif(buffer);
    if (webpComment) {
      aiData = await parseAIMetadata(
        webpComment.trim().startsWith('{') ? { prompt: webpComment } : { parameters: webpComment }
      );
    }
  } else if (effectiveMime === 'image/jpeg') {
    let userComment = parseJPEGUserComment(buffer);

    if (!userComment && (exifData as any).UserComment) {
      const epComment = String((exifData as any).UserComment).trim();
      if (epComment.length > 10 && (epComment.includes('Steps:') || epComment.startsWith('{'))) {
        userComment = epComment;
      }
    }

    if (userComment) {
      if (userComment.trim().startsWith('{')) {
        aiData = await parseAIMetadata({ prompt: userComment });
      } else {
        aiData = await parseAIMetadata({ parameters: userComment });
      }
    }
  }

  // Extract XMP metadata (works for all image formats)
  let xmpData: Record<string, any> = {};
  const xmpString = extractXMPString(buffer);
  if (xmpString) {
    xmpData = parseXMP(xmpString);

    const xmpAI = extractAIFromXMP(xmpData);
    if (Object.keys(xmpAI).length > 0) {
      if (xmpAI._drawthings_params) {
        const dtParams = xmpAI._drawthings_params;
        delete xmpAI._drawthings_params;
        const dtParsed = await parseAIMetadata({ parameters: dtParams });
        Object.assign(aiData, dtParsed);
      }
      for (const [key, value] of Object.entries(xmpAI)) {
        if (!aiData[key]) aiData[key] = value;
      }
    }
  }

  const dims = extractImageDimensions(buffer, effectiveMime);

  return {
    fileName,
    fileSize,
    fileType: effectiveMime,
    lastModified,
    ...(dims ?? {}),
    exif: exifData,
    iptc: iptcData,
    xmp: xmpData,
    ai: aiData,
  };
}
