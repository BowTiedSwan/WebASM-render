/**
 * WASM Stream Decoder
 *
 * Accumulates hex-encoded WASM bytecode streamed from an LLM,
 * decodes it into binary, and executes the resulting WASM module
 * to produce a UI Spec.
 *
 * Streaming protocol:
 *   - LLM outputs hex-encoded bytes (0-9, a-f), optionally with
 *     whitespace/newlines for readability
 *   - A final line `__meta:usage:{...}` carries token usage metadata
 *   - All hex is accumulated until the stream ends
 *   - The complete binary is then compiled and executed as a WASM module
 *
 * Progressive rendering:
 *   - During streaming, we attempt to validate the partial binary
 *     as a complete WASM module at intervals (every N bytes)
 *   - If valid, we execute it to get a partial spec for live preview
 */

import { fromHex, toHex } from "./wasm-bytecode";
import { executeWasmModule } from "./wasm-runtime";
import type { Spec } from "./types";

/** Token usage metadata */
export interface WasmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Result from the stream compiler */
export interface WasmStreamResult {
  spec: Spec | null;
  errors: string[];
  bytesReceived: number;
  usage: WasmTokenUsage | null;
  hexDump: string;
}

/**
 * Streaming WASM bytecode compiler.
 *
 * Accumulates hex-encoded bytes from the LLM stream, and when
 * the stream is complete, compiles and executes the WASM module.
 */
export interface WasmStreamCompiler {
  /** Push a chunk of text from the stream */
  push(chunk: string): WasmStreamResult;
  /** Finalize: compile and execute the accumulated WASM binary */
  finalize(): Promise<WasmStreamResult>;
  /** Get current state without finalizing */
  getState(): WasmStreamResult;
  /** Reset to initial state */
  reset(): void;
  /** Get the accumulated hex string */
  getHex(): string;
  /** Get the accumulated binary */
  getBinary(): Uint8Array;
}

/**
 * Create a streaming WASM bytecode compiler.
 *
 * @example
 * ```ts
 * const compiler = createWasmStreamCompiler();
 *
 * // As chunks arrive from the LLM:
 * for await (const chunk of stream) {
 *   const state = compiler.push(chunk);
 *   updateProgress(state.bytesReceived);
 * }
 *
 * // When stream is done:
 * const result = await compiler.finalize();
 * if (result.spec) {
 *   renderUI(result.spec);
 * }
 * ```
 */
export function createWasmStreamCompiler(): WasmStreamCompiler {
  let hexBuffer = "";
  let usage: WasmTokenUsage | null = null;
  let textBuffer = "";
  let spec: Spec | null = null;
  let errors: string[] = [];

  function extractHexAndMeta(raw: string): {
    hex: string;
    usage: WasmTokenUsage | null;
  } {
    let extractedUsage: WasmTokenUsage | null = null;
    let hex = "";

    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();

      // Check for usage metadata
      if (trimmed.startsWith("{") && trimmed.includes("__meta")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.__meta === "usage") {
            extractedUsage = {
              promptTokens: parsed.promptTokens ?? 0,
              completionTokens: parsed.completionTokens ?? 0,
              totalTokens: parsed.totalTokens ?? 0,
            };
            continue;
          }
        } catch {
          // Not valid JSON meta, treat as hex
        }
      }

      // Strip any non-hex characters (whitespace, comments, etc.)
      hex += trimmed.replace(/[^0-9a-fA-F]/g, "");
    }

    return { hex, usage: extractedUsage };
  }

  return {
    push(chunk: string): WasmStreamResult {
      textBuffer += chunk;

      // Process complete lines
      const lines = textBuffer.split("\n");
      textBuffer = lines.pop() || "";

      for (const line of lines) {
        const { hex, usage: lineUsage } = extractHexAndMeta(line);
        hexBuffer += hex;
        if (lineUsage) usage = lineUsage;
      }

      return {
        spec,
        errors: [...errors],
        bytesReceived: Math.floor(hexBuffer.length / 2),
        usage,
        hexDump: hexBuffer,
      };
    },

    async finalize(): Promise<WasmStreamResult> {
      // Process any remaining text
      if (textBuffer.trim()) {
        const { hex, usage: lineUsage } = extractHexAndMeta(textBuffer);
        hexBuffer += hex;
        if (lineUsage) usage = lineUsage;
        textBuffer = "";
      }

      // Need at least the WASM header (8 bytes = 16 hex chars)
      if (hexBuffer.length < 16) {
        errors = [
          `Insufficient WASM data: only ${Math.floor(hexBuffer.length / 2)} bytes received`,
        ];
        return {
          spec: null,
          errors: [...errors],
          bytesReceived: Math.floor(hexBuffer.length / 2),
          usage,
          hexDump: hexBuffer,
        };
      }

      // Ensure even number of hex chars
      const cleanHex =
        hexBuffer.length % 2 === 0 ? hexBuffer : hexBuffer.slice(0, -1);

      try {
        const binary = fromHex(cleanHex);

        // Validate magic number
        if (
          binary[0] !== 0x00 ||
          binary[1] !== 0x61 ||
          binary[2] !== 0x73 ||
          binary[3] !== 0x6d
        ) {
          errors = ["Invalid WASM magic number (expected \\0asm)"];
          return {
            spec: null,
            errors: [...errors],
            bytesReceived: binary.length,
            usage,
            hexDump: hexBuffer,
          };
        }

        const result = await executeWasmModule(binary);
        spec = result.spec;
        errors = result.errors;
      } catch (err) {
        errors = [`WASM compilation/execution failed: ${err}`];
      }

      return {
        spec,
        errors: [...errors],
        bytesReceived: Math.floor(hexBuffer.length / 2),
        usage,
        hexDump: hexBuffer,
      };
    },

    getState(): WasmStreamResult {
      return {
        spec,
        errors: [...errors],
        bytesReceived: Math.floor(hexBuffer.length / 2),
        usage,
        hexDump: hexBuffer,
      };
    },

    reset() {
      hexBuffer = "";
      textBuffer = "";
      usage = null;
      spec = null;
      errors = [];
    },

    getHex(): string {
      return hexBuffer;
    },

    getBinary(): Uint8Array {
      if (hexBuffer.length < 2) return new Uint8Array(0);
      const cleanHex =
        hexBuffer.length % 2 === 0 ? hexBuffer : hexBuffer.slice(0, -1);
      return fromHex(cleanHex);
    },
  };
}

/**
 * Compile a complete hex string into a Spec by executing it as WASM.
 *
 * @example
 * ```ts
 * const spec = await compileWasmHex("0061736d01000000...");
 * ```
 */
export async function compileWasmHex(hex: string): Promise<WasmStreamResult> {
  const compiler = createWasmStreamCompiler();
  compiler.push(hex);
  return compiler.finalize();
}

/**
 * Format a WASM binary as an annotated hex dump for debugging.
 */
export function formatWasmHexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  const hex = toHex(bytes);

  // Header
  if (hex.length >= 16) {
    lines.push(`${hex.slice(0, 8)}  ; magic: \\0asm`);
    lines.push(`${hex.slice(8, 16)}  ; version: 1`);
  }

  // Sections
  let pos = 16;
  const sectionNames: Record<number, string> = {
    1: "Type",
    2: "Import",
    3: "Function",
    5: "Memory",
    7: "Export",
    10: "Code",
    11: "Data",
  };

  while (pos < hex.length) {
    const sectionId = parseInt(hex.slice(pos, pos + 2), 16);
    const name = sectionNames[sectionId] || `Unknown(${sectionId})`;
    lines.push(`${hex.slice(pos, pos + 2)}  ; section: ${name}`);
    pos += 2;

    // Read LEB128 section size
    let size = 0;
    let shift = 0;
    while (pos < hex.length) {
      const byte = parseInt(hex.slice(pos, pos + 2), 16);
      pos += 2;
      size |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
    }

    // Dump section payload in chunks of 32 hex chars
    const payloadHex = hex.slice(pos, pos + size * 2);
    for (let i = 0; i < payloadHex.length; i += 32) {
      const chunk = payloadHex.slice(i, i + 32);
      const suffix = i === 0 ? `  ; ${name} payload (${size} bytes)` : "";
      lines.push(`  ${chunk}${suffix}`);
    }
    pos += size * 2;
  }

  return lines.join("\n");
}
