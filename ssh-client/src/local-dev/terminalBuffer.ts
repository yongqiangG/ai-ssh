export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const MAX_OUTPUT_CHUNKS = 256;
export const MAX_FRAME_BYTES = 128 * 1024;

export interface OutputBuffer {
  chunks: string[];
  byteLength: number;
}

export interface OutputFrame {
  text: string;
  remaining: string[];
}

const encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function prefixByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(value.slice(0, middle)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let end = low;
  if (end > 0 && end < value.length) {
    const previous = value.charCodeAt(end - 1);
    if (previous >= 0xd800 && previous <= 0xdbff) end -= 1;
  }
  return value.slice(0, end);
}

function suffixByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (utf8ByteLength(value.slice(middle)) <= maxBytes) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  let start = low;
  if (start > 0 && start < value.length) {
    const first = value.charCodeAt(start);
    if (first >= 0xdc00 && first <= 0xdfff) start += 1;
  }
  return value.slice(start);
}

export function createOutputBuffer(): OutputBuffer {
  return { chunks: [], byteLength: 0 };
}

export function appendOutput(buffer: OutputBuffer, value: string): void {
  if (!value) return;

  const clipped = suffixByBytes(value, MAX_OUTPUT_BYTES);
  const clippedBytes = utf8ByteLength(clipped);
  while (
    buffer.chunks.length > 0 &&
    (buffer.byteLength + clippedBytes > MAX_OUTPUT_BYTES ||
      buffer.chunks.length >= MAX_OUTPUT_CHUNKS)
  ) {
    const removed = buffer.chunks.shift() ?? "";
    buffer.byteLength -= utf8ByteLength(removed);
  }

  buffer.chunks.push(clipped);
  buffer.byteLength += clippedBytes;
}

export function snapshotOutput(buffer: OutputBuffer): string {
  return buffer.chunks.join("");
}

export function drainOutputFrame(
  queue: readonly string[],
  maxBytes = MAX_FRAME_BYTES,
): OutputFrame {
  if (maxBytes <= 0 || queue.length === 0) {
    return { text: "", remaining: [...queue] };
  }

  const consumed: string[] = [];
  let bytes = 0;
  let index = 0;
  while (index < queue.length) {
    const chunk = queue[index];
    const chunkBytes = utf8ByteLength(chunk);
    if (chunkBytes === 0) {
      index += 1;
      continue;
    }
    if (bytes + chunkBytes <= maxBytes) {
      consumed.push(chunk);
      bytes += chunkBytes;
      index += 1;
      continue;
    }

    const prefix = prefixByBytes(chunk, maxBytes - bytes);
    if (prefix) {
      consumed.push(prefix);
      const rest = chunk.slice(prefix.length);
      return {
        text: consumed.join(""),
        remaining: [rest, ...queue.slice(index + 1)],
      };
    }
    break;
  }

  return {
    text: consumed.join(""),
    remaining: [...queue.slice(index)],
  };
}
