/**
 * WASM Bytecode Builder
 *
 * Programmatic construction of valid WebAssembly binary modules.
 * Used to define the ABI and generate reference WASM modules that
 * call host-imported functions to build UI specs.
 *
 * WASM Binary Format Reference (MVP):
 *   Header: \0asm + version (4+4 bytes)
 *   Sections (id, size, payload):
 *     1  Type     — function signatures
 *     2  Import   — imported functions/memories
 *     3  Function — function index → type index mapping
 *     5  Memory   — linear memory declarations
 *     7  Export   — exported functions/memories
 *    10  Code     — function bodies
 *    11  Data     — initial memory contents
 */

// ── LEB128 Encoding ─────────────────────────────────────────────────────────

/** Encode an unsigned integer as LEB128 bytes */
export function encodeULEB128(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

/** Encode a signed integer as LEB128 bytes */
export function encodeSLEB128(value: number): number[] {
  const bytes: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    if (
      (value === 0 && (byte & 0x40) === 0) ||
      (value === -1 && (byte & 0x40) !== 0)
    ) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

// ── WASM Value Types ────────────────────────────────────────────────────────

export const WASM_TYPE = {
  I32: 0x7f,
  I64: 0x7e,
  F32: 0x7d,
  F64: 0x7c,
  FUNC_REF: 0x70,
  EXTERN_REF: 0x6f,
} as const;

// ── WASM Opcodes ────────────────────────────────────────────────────────────

export const OP = {
  UNREACHABLE: 0x00,
  NOP: 0x01,
  BLOCK: 0x02,
  LOOP: 0x03,
  IF: 0x04,
  ELSE: 0x05,
  END: 0x0b,
  BR: 0x0c,
  BR_IF: 0x0d,
  RETURN: 0x0f,
  CALL: 0x10,
  DROP: 0x1a,
  LOCAL_GET: 0x20,
  LOCAL_SET: 0x21,
  LOCAL_TEE: 0x22,
  I32_LOAD: 0x28,
  I32_STORE: 0x36,
  I32_CONST: 0x41,
  I32_EQZ: 0x45,
  I32_EQ: 0x46,
  I32_NE: 0x47,
  I32_LT_S: 0x48,
  I32_GT_S: 0x4a,
  I32_LE_S: 0x4c,
  I32_GE_S: 0x4e,
  I32_ADD: 0x6a,
  I32_SUB: 0x6b,
  I32_MUL: 0x6c,
} as const;

// ── Section IDs ─────────────────────────────────────────────────────────────

const SECTION = {
  TYPE: 1,
  IMPORT: 2,
  FUNCTION: 3,
  MEMORY: 5,
  EXPORT: 7,
  CODE: 10,
  DATA: 11,
} as const;

// ── Helper: encode a length-prefixed byte vector ────────────────────────────

function vec(items: number[][]): number[] {
  const bytes: number[] = [...encodeULEB128(items.length)];
  for (const item of items) {
    bytes.push(...item);
  }
  return bytes;
}

function encodeString(s: string): number[] {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(s);
  return [...encodeULEB128(encoded.length), ...encoded];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...encodeULEB128(payload.length), ...payload];
}

// ── Function Signature ──────────────────────────────────────────────────────

export interface FuncType {
  params: number[]; // e.g. [WASM_TYPE.I32, WASM_TYPE.I32]
  results: number[];
}

// ── Import Definition ───────────────────────────────────────────────────────

export interface ImportFunc {
  module: string;
  name: string;
  typeIndex: number;
}

// ── Export Definition ───────────────────────────────────────────────────────

export interface ExportFunc {
  name: string;
  /** Index into the function index space (imports first, then locals) */
  funcIndex: number;
}

// ── Data Segment ────────────────────────────────────────────────────────────

export interface DataSegment {
  offset: number;
  bytes: Uint8Array;
}

// ── Function Body ───────────────────────────────────────────────────────────

export interface FuncBody {
  /** Local variable declarations: [count, type] pairs */
  locals: Array<{ count: number; type: number }>;
  /** Raw bytecode instructions (including final END) */
  code: number[];
}

// ── WASM Module Builder ─────────────────────────────────────────────────────

export interface WasmModuleOptions {
  types: FuncType[];
  imports: ImportFunc[];
  functions: Array<{ typeIndex: number; body: FuncBody }>;
  exports: ExportFunc[];
  memoryPages?: number; // initial pages (64KB each)
  dataSegments?: DataSegment[];
}

/**
 * Build a complete, valid WASM binary module from the given specification.
 * Returns a Uint8Array that can be passed to WebAssembly.compile().
 */
export function buildWasmModule(opts: WasmModuleOptions): Uint8Array {
  const parts: number[] = [];

  // ── Header ──────────────────────────────────────────────────────────
  // Magic: \0asm
  parts.push(0x00, 0x61, 0x73, 0x6d);
  // Version: 1
  parts.push(0x01, 0x00, 0x00, 0x00);

  // ── Type Section (1) ────────────────────────────────────────────────
  {
    const entries: number[][] = opts.types.map((t) => [
      0x60, // func type marker
      ...encodeULEB128(t.params.length),
      ...t.params,
      ...encodeULEB128(t.results.length),
      ...t.results,
    ]);
    parts.push(...section(SECTION.TYPE, vec(entries)));
  }

  // ── Import Section (2) ──────────────────────────────────────────────
  if (opts.imports.length > 0) {
    const entries: number[][] = opts.imports.map((imp) => [
      ...encodeString(imp.module),
      ...encodeString(imp.name),
      0x00, // import kind: function
      ...encodeULEB128(imp.typeIndex),
    ]);
    parts.push(...section(SECTION.IMPORT, vec(entries)));
  }

  // ── Function Section (3) ────────────────────────────────────────────
  {
    const entries: number[][] = opts.functions.map((f) =>
      encodeULEB128(f.typeIndex),
    );
    parts.push(...section(SECTION.FUNCTION, vec(entries)));
  }

  // ── Memory Section (5) ──────────────────────────────────────────────
  {
    const pages = opts.memoryPages ?? 1;
    // 1 memory, with limits: flags=0 (no max), initial=pages
    const payload = [
      ...encodeULEB128(1), // count
      0x00, // flags: no max
      ...encodeULEB128(pages),
    ];
    parts.push(...section(SECTION.MEMORY, payload));
  }

  // ── Export Section (7) ──────────────────────────────────────────────
  {
    // Export memory as "memory" + user exports
    const memoryExport: number[] = [
      ...encodeString("memory"),
      0x02, // export kind: memory
      ...encodeULEB128(0), // memory index 0
    ];
    const funcExports: number[][] = opts.exports.map((exp) => [
      ...encodeString(exp.name),
      0x00, // export kind: function
      ...encodeULEB128(exp.funcIndex),
    ]);
    const allExports = [memoryExport, ...funcExports];
    parts.push(...section(SECTION.EXPORT, vec(allExports)));
  }

  // ── Code Section (10) ──────────────────────────────────────────────
  {
    const bodies: number[][] = opts.functions.map((f) => {
      const localDecls: number[] = [...encodeULEB128(f.body.locals.length)];
      for (const local of f.body.locals) {
        localDecls.push(...encodeULEB128(local.count), local.type);
      }
      const bodyBytes = [...localDecls, ...f.body.code];
      return [...encodeULEB128(bodyBytes.length), ...bodyBytes];
    });
    parts.push(...section(SECTION.CODE, vec(bodies)));
  }

  // ── Data Section (11) ──────────────────────────────────────────────
  if (opts.dataSegments && opts.dataSegments.length > 0) {
    const entries: number[][] = opts.dataSegments.map((seg) => [
      0x00, // active segment, memory 0
      OP.I32_CONST,
      ...encodeSLEB128(seg.offset),
      OP.END,
      ...encodeULEB128(seg.bytes.length),
      ...seg.bytes,
    ]);
    parts.push(...section(SECTION.DATA, vec(entries)));
  }

  return new Uint8Array(parts);
}

// ── Instruction Helpers ─────────────────────────────────────────────────────

/** Push an i32 constant */
export function i32Const(value: number): number[] {
  return [OP.I32_CONST, ...encodeSLEB128(value)];
}

/** Call a function by index */
export function call(funcIndex: number): number[] {
  return [OP.CALL, ...encodeULEB128(funcIndex)];
}

/** Get a local variable */
export function localGet(index: number): number[] {
  return [OP.LOCAL_GET, ...encodeULEB128(index)];
}

/** Set a local variable */
export function localSet(index: number): number[] {
  return [OP.LOCAL_SET, ...encodeULEB128(index)];
}

// ── String Table Builder ────────────────────────────────────────────────────

export interface StringEntry {
  text: string;
  offset: number;
  length: number;
}

/**
 * Build a string table: packs strings into a data segment and returns
 * offset/length pairs for each string.
 */
export function buildStringTable(
  strings: string[],
  baseOffset: number = 0,
): { entries: StringEntry[]; segment: DataSegment } {
  const encoder = new TextEncoder();
  const entries: StringEntry[] = [];
  const buffers: Uint8Array[] = [];
  let currentOffset = baseOffset;

  for (const text of strings) {
    const encoded = encoder.encode(text);
    entries.push({ text, offset: currentOffset, length: encoded.length });
    buffers.push(encoded);
    currentOffset += encoded.length;
  }

  // Concatenate all buffers
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const bytes = new Uint8Array(totalLength);
  let pos = 0;
  for (const buf of buffers) {
    bytes.set(buf, pos);
    pos += buf.length;
  }

  return {
    entries,
    segment: { offset: baseOffset, bytes },
  };
}

// ── Hex Encoding/Decoding ───────────────────────────────────────────────────

/** Encode a Uint8Array to a hex string */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decode a hex string to a Uint8Array */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[\s\n\r]/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
