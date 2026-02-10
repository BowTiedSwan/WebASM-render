/**
 * WASM Runtime — Host Environment for UI Spec Generation
 *
 * Provides the imported functions that a WASM module calls to build
 * a UI Spec. When the module's `render()` export is invoked, these
 * host functions accumulate elements, props, children, and state
 * into a standard Spec object that the existing React renderer can display.
 *
 * ABI (imports provided under "env" module):
 *
 *   set_root(ptr, len)                                       — set the root element key
 *   create_element(id_ptr, id_len, type_ptr, type_len)       — create an element
 *   set_prop_str(el_ptr, el_len, k_ptr, k_len, v_ptr, v_len) — set string prop
 *   set_prop_int(el_ptr, el_len, k_ptr, k_len, value)        — set integer prop
 *   set_prop_bool(el_ptr, el_len, k_ptr, k_len, value)       — set boolean prop (0/1)
 *   set_prop_json(el_ptr, el_len, k_ptr, k_len, v_ptr, v_len) — set JSON prop (parsed)
 *   add_child(parent_ptr, parent_len, child_ptr, child_len)   — add child to element
 *   set_state_str(key_ptr, key_len, val_ptr, val_len)         — set string state
 *   set_state_int(key_ptr, key_len, value)                    — set integer state
 *   set_state_json(key_ptr, key_len, val_ptr, val_len)        — set JSON state value
 *   set_visible_path(el_ptr, el_len, path_ptr, path_len)      — set visibility condition
 *   set_event(el_ptr, el_len, ev_ptr, ev_len, act_ptr, act_len, params_ptr, params_len) — bind event
 *   set_repeat(el_ptr, el_len, path_ptr, path_len, key_ptr, key_len) — set repeat field
 *   set_state_path_prop(el_ptr, el_len, k_ptr, k_len, path_ptr, path_len) — set $path dynamic prop
 */

import type { Spec, UIElement } from "./types";

/** Result of executing a WASM UI module */
export interface WasmExecResult {
  spec: Spec;
  errors: string[];
}

/**
 * Read a UTF-8 string from WASM linear memory.
 */
function readString(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): string {
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  return new TextDecoder().decode(bytes);
}

/**
 * Ensure an element exists in the elements map, creating a stub if needed.
 */
function ensureElement(
  elements: Record<string, UIElement>,
  key: string,
): UIElement {
  if (!elements[key]) {
    elements[key] = { type: "", props: {}, children: [] };
  }
  return elements[key]!;
}

/**
 * Create the WebAssembly import object that provides UI-building host
 * functions. Returns the imports and a function to retrieve the final spec.
 */
export function createWasmImports(): {
  imports: WebAssembly.Imports;
  getResult: () => WasmExecResult;
  /** Bind the memory export after instantiation */
  bindMemory: (mem: WebAssembly.Memory) => void;
} {
  let memory: WebAssembly.Memory | null = null;
  const spec: Spec = { root: "", elements: {}, state: {} };
  const errors: string[] = [];

  function mem(): WebAssembly.Memory {
    if (!memory) throw new Error("WASM memory not bound");
    return memory;
  }

  function str(ptr: number, len: number): string {
    return readString(mem(), ptr, len);
  }

  const env: Record<string, (...args: number[]) => void> = {
    // ── Root ───────────────────────────────────────────────────────
    set_root(ptr: number, len: number) {
      spec.root = str(ptr, len);
    },

    // ── Elements ───────────────────────────────────────────────────
    create_element(
      idPtr: number,
      idLen: number,
      typePtr: number,
      typeLen: number,
    ) {
      const id = str(idPtr, idLen);
      const type = str(typePtr, typeLen);
      spec.elements[id] = { type, props: {}, children: [] };
    },

    // ── Props ──────────────────────────────────────────────────────
    set_prop_str(
      elPtr: number,
      elLen: number,
      kPtr: number,
      kLen: number,
      vPtr: number,
      vLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      (el.props as Record<string, unknown>)[str(kPtr, kLen)] = str(vPtr, vLen);
    },

    set_prop_int(
      elPtr: number,
      elLen: number,
      kPtr: number,
      kLen: number,
      value: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      (el.props as Record<string, unknown>)[str(kPtr, kLen)] = value;
    },

    set_prop_bool(
      elPtr: number,
      elLen: number,
      kPtr: number,
      kLen: number,
      value: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      (el.props as Record<string, unknown>)[str(kPtr, kLen)] = value !== 0;
    },

    set_prop_json(
      elPtr: number,
      elLen: number,
      kPtr: number,
      kLen: number,
      vPtr: number,
      vLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      const key = str(kPtr, kLen);
      const jsonStr = str(vPtr, vLen);
      try {
        (el.props as Record<string, unknown>)[key] = JSON.parse(jsonStr);
      } catch {
        errors.push(`Invalid JSON for prop "${key}": ${jsonStr}`);
      }
    },

    set_state_path_prop(
      elPtr: number,
      elLen: number,
      kPtr: number,
      kLen: number,
      pathPtr: number,
      pathLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      (el.props as Record<string, unknown>)[str(kPtr, kLen)] = {
        $path: str(pathPtr, pathLen),
      };
    },

    // ── Children ───────────────────────────────────────────────────
    add_child(
      parentPtr: number,
      parentLen: number,
      childPtr: number,
      childLen: number,
    ) {
      const el = ensureElement(spec.elements, str(parentPtr, parentLen));
      if (!el.children) el.children = [];
      el.children.push(str(childPtr, childLen));
    },

    // ── State ──────────────────────────────────────────────────────
    set_state_str(
      keyPtr: number,
      keyLen: number,
      valPtr: number,
      valLen: number,
    ) {
      if (!spec.state) spec.state = {};
      spec.state[str(keyPtr, keyLen)] = str(valPtr, valLen);
    },

    set_state_int(keyPtr: number, keyLen: number, value: number) {
      if (!spec.state) spec.state = {};
      spec.state[str(keyPtr, keyLen)] = value;
    },

    set_state_json(
      keyPtr: number,
      keyLen: number,
      valPtr: number,
      valLen: number,
    ) {
      if (!spec.state) spec.state = {};
      const key = str(keyPtr, keyLen);
      const jsonStr = str(valPtr, valLen);
      try {
        spec.state[key] = JSON.parse(jsonStr);
      } catch {
        errors.push(`Invalid JSON for state "${key}": ${jsonStr}`);
      }
    },

    // ── Visibility ─────────────────────────────────────────────────
    set_visible_path(
      elPtr: number,
      elLen: number,
      pathPtr: number,
      pathLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      el.visible = { path: str(pathPtr, pathLen) };
    },

    // ── Events ─────────────────────────────────────────────────────
    set_event(
      elPtr: number,
      elLen: number,
      evPtr: number,
      evLen: number,
      actPtr: number,
      actLen: number,
      paramsPtr: number,
      paramsLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      const eventName = str(evPtr, evLen);
      const actionName = str(actPtr, actLen);
      const paramsJson = str(paramsPtr, paramsLen);

      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(paramsJson);
      } catch {
        errors.push(`Invalid JSON for event params: ${paramsJson}`);
      }

      if (!el.on) el.on = {};
      el.on[eventName] = { action: actionName, params };
    },

    // ── Repeat ─────────────────────────────────────────────────────
    set_repeat(
      elPtr: number,
      elLen: number,
      pathPtr: number,
      pathLen: number,
      keyPtr: number,
      keyLen: number,
    ) {
      const el = ensureElement(spec.elements, str(elPtr, elLen));
      const path = str(pathPtr, pathLen);
      const key = keyLen > 0 ? str(keyPtr, keyLen) : undefined;
      el.repeat = { path, ...(key ? { key } : {}) };
    },
  };

  return {
    imports: { env },
    getResult: () => ({ spec, errors }),
    bindMemory: (mem: WebAssembly.Memory) => {
      memory = mem;
    },
  };
}

/**
 * Execute a compiled WASM module that generates a UI spec.
 *
 * The module must export:
 *   - `memory`  — WebAssembly.Memory
 *   - `render()` — the main function that calls host imports to build the spec
 *
 * @param wasmBytes - The raw WASM binary (Uint8Array or ArrayBuffer)
 * @returns The generated Spec and any errors
 */
export async function executeWasmModule(
  wasmBytes: Uint8Array | ArrayBuffer,
): Promise<WasmExecResult> {
  const { imports, getResult, bindMemory } = createWasmImports();

  const buffer: ArrayBuffer =
    wasmBytes instanceof ArrayBuffer
      ? wasmBytes
      : (new Uint8Array(wasmBytes).buffer as ArrayBuffer);
  const module = await WebAssembly.compile(buffer);
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports;

  // Bind the memory exported by the module
  const memory = exports.memory as WebAssembly.Memory;
  if (!memory) {
    return {
      spec: { root: "", elements: {} },
      errors: ["WASM module does not export memory"],
    };
  }
  bindMemory(memory);

  // Call the render function
  const render = exports.render as (() => void) | undefined;
  if (!render) {
    return {
      spec: { root: "", elements: {} },
      errors: ["WASM module does not export render()"],
    };
  }

  try {
    render();
  } catch (err) {
    const result = getResult();
    result.errors.push(`WASM render() threw: ${err}`);
    return result;
  }

  return getResult();
}
