import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_CHUNKS,
  MAX_FRAME_BYTES,
  appendOutput,
  createOutputBuffer,
  drainOutputFrame,
  snapshotOutput,
} from "./terminalBuffer";

describe("local terminal output buffer", () => {
  it("keeps only the newest output within both memory bounds", () => {
    const buffer = createOutputBuffer();

    for (let index = 0; index < MAX_OUTPUT_CHUNKS + 20; index += 1) {
      appendOutput(buffer, "chunk-" + index + "\n");
    }

    expect(buffer.chunks.length).toBeLessThanOrEqual(MAX_OUTPUT_CHUNKS);
    expect(buffer.byteLength).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(snapshotOutput(buffer)).toContain(
      "chunk-" + (MAX_OUTPUT_CHUNKS + 19),
    );
    expect(snapshotOutput(buffer)).not.toContain("chunk-0\n");
  });

  it("clips a single oversized write to the newest 10MB", () => {
    const buffer = createOutputBuffer();
    appendOutput(buffer, "x".repeat(MAX_OUTPUT_BYTES + 32));

    expect(buffer.byteLength).toBe(MAX_OUTPUT_BYTES);
    expect(snapshotOutput(buffer)).toBe("x".repeat(MAX_OUTPUT_BYTES));
  });

  it("drains at most one frame and preserves the remaining UTF-8 text", () => {
    const first = "a".repeat(MAX_FRAME_BYTES - 2);
    const second = "中".repeat(100);
    const result = drainOutputFrame([first, second]);

    expect(result.text).toBe(first);
    expect(result.remaining).toEqual([second]);
  });
});
