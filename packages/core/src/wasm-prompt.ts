/**
 * WASM Bytecode Generation Prompt
 *
 * Generates the system prompt that teaches an LLM to produce valid
 * WebAssembly binary bytecode (hex-encoded) that, when executed,
 * calls host-imported functions to build a UI spec.
 *
 * The prompt includes:
 *   1. WASM binary format reference (sections, LEB128 encoding)
 *   2. The host ABI (imported functions)
 *   3. Instruction set reference (opcodes)
 *   4. Complete worked example with byte-level annotations
 *   5. Available UI components and actions from the catalog
 */

import type { Catalog, SchemaDefinition, PromptOptions } from "./schema";
import {
  buildWasmModule,
  buildStringTable,
  toHex,
  i32Const,
  call,
  OP,
  WASM_TYPE,
  type FuncType,
  type ImportFunc,
  type ExportFunc,
  type FuncBody,
} from "./wasm-bytecode";

// ── ABI Definition ──────────────────────────────────────────────────────────

/**
 * The host-imported function ABI. Each entry defines a function that
 * the WASM module can call to build the UI spec.
 */
const ABI_FUNCTIONS = [
  { name: "set_root", params: 2, desc: "(ptr,len) — set root element key" },
  {
    name: "create_element",
    params: 4,
    desc: "(id_ptr,id_len, type_ptr,type_len) — create element",
  },
  {
    name: "set_prop_str",
    params: 6,
    desc: "(el_ptr,el_len, key_ptr,key_len, val_ptr,val_len) — string prop",
  },
  {
    name: "set_prop_int",
    params: 5,
    desc: "(el_ptr,el_len, key_ptr,key_len, i32_value) — integer prop",
  },
  {
    name: "set_prop_bool",
    params: 5,
    desc: "(el_ptr,el_len, key_ptr,key_len, i32_bool) — boolean prop (0=false,1=true)",
  },
  {
    name: "set_prop_json",
    params: 6,
    desc: "(el_ptr,el_len, key_ptr,key_len, json_ptr,json_len) — JSON prop",
  },
  {
    name: "set_state_path_prop",
    params: 6,
    desc: "(el_ptr,el_len, key_ptr,key_len, path_ptr,path_len) — set $path dynamic prop",
  },
  {
    name: "add_child",
    params: 4,
    desc: "(parent_ptr,parent_len, child_ptr,child_len) — add child",
  },
  {
    name: "set_state_str",
    params: 4,
    desc: "(key_ptr,key_len, val_ptr,val_len) — string state",
  },
  {
    name: "set_state_int",
    params: 3,
    desc: "(key_ptr,key_len, i32_value) — integer state",
  },
  {
    name: "set_state_json",
    params: 4,
    desc: "(key_ptr,key_len, json_ptr,json_len) — JSON state",
  },
  {
    name: "set_visible_path",
    params: 4,
    desc: "(el_ptr,el_len, path_ptr,path_len) — visibility condition",
  },
  {
    name: "set_event",
    params: 8,
    desc: "(el_ptr,el_len, ev_ptr,ev_len, act_ptr,act_len, params_ptr,params_len) — bind event",
  },
  {
    name: "set_repeat",
    params: 6,
    desc: "(el_ptr,el_len, path_ptr,path_len, key_ptr,key_len) — repeat field",
  },
] as const;

// ── Reference Example ───────────────────────────────────────────────────────

/**
 * Build a reference WASM module for a simple "Hello World" card.
 * This is included in the prompt as a worked example.
 */
function buildReferenceExample(): { hex: string; annotated: string } {
  // Strings used in the example
  const strings = [
    "main", // 0: root key / element id
    "Card", // 1: component type
    "title", // 2: prop key
    "Hello World", // 3: prop value
    "child-1", // 4: child element id
    "Text", // 5: component type
    "text", // 6: prop key
    "Welcome to WASM-rendered UI!", // 7: prop value
  ];

  const { entries, segment } = buildStringTable(strings);

  // Function type indices — matching the ABI order
  // We need these distinct signatures:
  //   Type 0: (i32, i32) -> ()                           [set_root]
  //   Type 1: (i32, i32, i32, i32) -> ()                 [create_element, add_child, set_state_str, set_visible_path]
  //   Type 2: (i32, i32, i32, i32, i32, i32) -> ()       [set_prop_str, set_prop_json, set_state_path_prop, set_state_json, set_repeat]
  //   Type 3: (i32, i32, i32, i32, i32) -> ()            [set_prop_int, set_prop_bool]
  //   Type 4: (i32, i32, i32) -> ()                      [set_state_int]
  //   Type 5: (i32, i32, i32, i32, i32, i32, i32, i32) -> () [set_event]
  //   Type 6: () -> ()                                    [render]

  const types: FuncType[] = [
    { params: [WASM_TYPE.I32, WASM_TYPE.I32], results: [] }, // 0
    {
      params: [WASM_TYPE.I32, WASM_TYPE.I32, WASM_TYPE.I32, WASM_TYPE.I32],
      results: [],
    }, // 1
    {
      params: [
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
      ],
      results: [],
    }, // 2
    {
      params: [
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
      ],
      results: [],
    }, // 3
    { params: [WASM_TYPE.I32, WASM_TYPE.I32, WASM_TYPE.I32], results: [] }, // 4
    {
      params: [
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
        WASM_TYPE.I32,
      ],
      results: [],
    }, // 5
    { params: [], results: [] }, // 6
  ];

  // Import all ABI functions
  const typeIndexMap: Record<number, number> = {
    2: 0, // (i32, i32) -> ()
    4: 1, // (i32, i32, i32, i32) -> ()
    6: 2, // (i32, i32, i32, i32, i32, i32) -> ()
    5: 3, // (i32, i32, i32, i32, i32) -> ()
    3: 4, // (i32, i32, i32) -> ()
    8: 5, // (i32, i32, i32, i32, i32, i32, i32, i32) -> ()
  };

  const imports: ImportFunc[] = ABI_FUNCTIONS.map((fn) => ({
    module: "env",
    name: fn.name,
    typeIndex: typeIndexMap[fn.params]!,
  }));

  // Import function indices (0-13), our render function is index 14
  const IMPORT_COUNT = imports.length;
  const SET_ROOT = 0;
  const CREATE_ELEMENT = 1;
  const SET_PROP_STR = 2;
  const ADD_CHILD = 7;

  // Build the render function body
  const code: number[] = [];

  // set_root("main")
  const main = entries[0]!;
  code.push(...i32Const(main.offset), ...i32Const(main.length));
  code.push(...call(SET_ROOT));

  // create_element("main", "Card")
  const card = entries[1]!;
  code.push(
    ...i32Const(main.offset),
    ...i32Const(main.length),
    ...i32Const(card.offset),
    ...i32Const(card.length),
  );
  code.push(...call(CREATE_ELEMENT));

  // set_prop_str("main", "title", "Hello World")
  const titleKey = entries[2]!;
  const titleVal = entries[3]!;
  code.push(
    ...i32Const(main.offset),
    ...i32Const(main.length),
    ...i32Const(titleKey.offset),
    ...i32Const(titleKey.length),
    ...i32Const(titleVal.offset),
    ...i32Const(titleVal.length),
  );
  code.push(...call(SET_PROP_STR));

  // create_element("child-1", "Text")
  const child1 = entries[4]!;
  const textType = entries[5]!;
  code.push(
    ...i32Const(child1.offset),
    ...i32Const(child1.length),
    ...i32Const(textType.offset),
    ...i32Const(textType.length),
  );
  code.push(...call(CREATE_ELEMENT));

  // set_prop_str("child-1", "text", "Welcome to WASM-rendered UI!")
  const textKey = entries[6]!;
  const textVal = entries[7]!;
  code.push(
    ...i32Const(child1.offset),
    ...i32Const(child1.length),
    ...i32Const(textKey.offset),
    ...i32Const(textKey.length),
    ...i32Const(textVal.offset),
    ...i32Const(textVal.length),
  );
  code.push(...call(SET_PROP_STR));

  // add_child("main", "child-1")
  code.push(
    ...i32Const(main.offset),
    ...i32Const(main.length),
    ...i32Const(child1.offset),
    ...i32Const(child1.length),
  );
  code.push(...call(ADD_CHILD));

  // end
  code.push(OP.END);

  const renderBody: FuncBody = {
    locals: [],
    code,
  };

  const wasmBytes = buildWasmModule({
    types,
    imports,
    functions: [{ typeIndex: 6, body: renderBody }], // type 6 = () -> ()
    exports: [{ name: "render", funcIndex: IMPORT_COUNT }], // first local func
    memoryPages: 1,
    dataSegments: [segment],
  });

  const hex = toHex(wasmBytes);

  // Build annotated version
  const annotated = buildAnnotatedHex(hex, strings);

  return { hex, annotated };
}

function buildAnnotatedHex(hex: string, strings: string[]): string {
  // We'll provide a simplified annotation
  const lines: string[] = [];
  lines.push(`; Complete WASM module (${hex.length / 2} bytes)`);
  lines.push(`; Strings in data section: ${JSON.stringify(strings)}`);
  lines.push(`;`);
  lines.push(`; This module, when executed, calls host functions to build:`);
  lines.push(`; - Root: "main"`);
  lines.push(
    `; - Element "main": type=Card, props={title:"Hello World"}, children=["child-1"]`,
  );
  lines.push(
    `; - Element "child-1": type=Text, props={text:"Welcome to WASM-rendered UI!"}`,
  );
  lines.push(`;`);

  // Break hex into 64-char lines for readability
  for (let i = 0; i < hex.length; i += 64) {
    lines.push(hex.slice(i, i + 64));
  }

  return lines.join("\n");
}

// ── Prompt Generation ───────────────────────────────────────────────────────

/**
 * Build the WASM bytecode generation system prompt.
 *
 * This teaches the LLM to output valid WASM binary (hex-encoded)
 * that calls host functions to build a UI spec.
 */
export function buildWasmSystemPrompt<TDef extends SchemaDefinition, TCatalog>(
  catalog: Catalog<TDef, TCatalog>,
  options: PromptOptions = {},
): string {
  const {
    system = "You are a UI generator that outputs WebAssembly bytecode.",
    customRules = [],
  } = options;

  const reference = buildReferenceExample();

  const lines: string[] = [];
  lines.push(system);
  lines.push("");

  // ── Output Format ─────────────────────────────────────────────────
  lines.push("OUTPUT FORMAT: Raw WebAssembly bytecode (hex-encoded)");
  lines.push("You generate a complete, valid WASM binary module as hex bytes.");
  lines.push("The module is compiled and executed by the host to build a UI.");
  lines.push(
    "Output ONLY hex characters (0-9, a-f). No markdown, no code fences, no commentary.",
  );
  lines.push("You may use newlines between hex chunks for readability.");
  lines.push("");

  // ── WASM Binary Format Reference ──────────────────────────────────
  lines.push("=== WASM BINARY FORMAT REFERENCE ===");
  lines.push("");
  lines.push("HEADER (8 bytes, always the same):");
  lines.push("  0061736d  ; magic: \\0asm");
  lines.push("  01000000  ; version: 1");
  lines.push("");

  lines.push("LEB128 ENCODING (used for all integers in WASM binary):");
  lines.push("  Values 0-127: single byte (e.g. 0=00, 1=01, 5=05, 127=7f)");
  lines.push(
    "  Values 128+: multi-byte with continuation bit (e.g. 128=8001, 200=c801, 256=8002)",
  );
  lines.push("  Signed (for i32.const): same but sign-extended");
  lines.push("    Negative: -1=7f, -2=7e, -64=40");
  lines.push("    Common: 0=00, 1=01, 10=0a, 100=e400, 1000=e807");
  lines.push("");

  lines.push(
    "SECTIONS (appear in order, each starts with: section_id LEB128_size payload):",
  );
  lines.push("");

  lines.push("  Section 1 (Type): Function signatures");
  lines.push("    01 <size> <count> <type_entries...>");
  lines.push(
    "    Each entry: 60 <param_count> <param_types...> <result_count> <result_types...>",
  );
  lines.push("    Type i32 = 7f");
  lines.push("");

  lines.push('  Section 2 (Import): Host functions imported from "env"');
  lines.push("    02 <size> <count> <import_entries...>");
  lines.push(
    "    Each entry: <module_name_len> <module_name_bytes> <func_name_len> <func_name_bytes> 00 <type_index>",
  );
  lines.push("");

  lines.push("  Section 3 (Function): Maps local functions to type indices");
  lines.push("    03 <size> <count> <type_indices...>");
  lines.push("");

  lines.push("  Section 5 (Memory): Linear memory declaration");
  lines.push("    05 <size> 01 00 01  ; 1 memory, no max, 1 page (64KB)");
  lines.push("");

  lines.push("  Section 7 (Export): Exported functions and memory");
  lines.push("    07 <size> <count> <export_entries...>");
  lines.push("    Each entry: <name_len> <name_bytes> <kind> <index>");
  lines.push("    Kinds: 00=function, 02=memory");
  lines.push("");

  lines.push("  Section 10 (Code): Function bodies");
  lines.push("    0a <size> <count> <func_bodies...>");
  lines.push(
    "    Each body: <body_size> <local_decl_count> [<local_decls...>] <instructions> 0b",
  );
  lines.push(
    "    Local decl: <count> <type>   (e.g. 01 7f = 1 local of type i32)",
  );
  lines.push("");

  lines.push("  Section 11 (Data): String constants in linear memory");
  lines.push("    0b <size> <count> <data_entries...>");
  lines.push(
    "    Each entry: 00 41 <offset_LEB128> 0b <byte_count> <raw_bytes>",
  );
  lines.push("    (00=active segment, 41=i32.const, 0b=end of init expr)");
  lines.push("");

  // ── Key Instructions ──────────────────────────────────────────────
  lines.push("=== KEY WASM INSTRUCTIONS ===");
  lines.push("");
  lines.push(
    "  41 <sleb128>  ; i32.const <value>  — push an integer onto the stack",
  );
  lines.push(
    "  10 <uleb128>  ; call <func_index>  — call a function (args already on stack)",
  );
  lines.push("  0b            ; end                — end of function body");
  lines.push("  20 <uleb128>  ; local.get <idx>    — get local variable");
  lines.push("  21 <uleb128>  ; local.set <idx>    — set local variable");
  lines.push("");
  lines.push(
    "  To call a function: push all arguments with i32.const, then call.",
  );
  lines.push("  Example: call set_root(ptr=0, len=4):");
  lines.push("    41 00    ; i32.const 0  (ptr)");
  lines.push("    41 04    ; i32.const 4  (len)");
  lines.push("    10 00    ; call 0       (set_root)");
  lines.push("");

  // ── Host ABI ──────────────────────────────────────────────────────
  lines.push('=== HOST ABI (imported functions from "env") ===');
  lines.push(
    "All strings are passed as (ptr, len) pairs pointing into linear memory.",
  );
  lines.push("Import index = position in this list (0-based).");
  lines.push("");

  ABI_FUNCTIONS.forEach((fn, i) => {
    lines.push(`  ${i}: ${fn.name}${fn.desc}`);
  });
  lines.push("");

  lines.push(
    "FUNCTION TYPES needed for the imports (define these in the Type section):",
  );
  lines.push(
    "  Type 0: (i32, i32) -> ()                                         ; set_root",
  );
  lines.push(
    "  Type 1: (i32, i32, i32, i32) -> ()                               ; create_element, add_child, set_state_str, set_visible_path",
  );
  lines.push(
    "  Type 2: (i32, i32, i32, i32, i32, i32) -> ()                     ; set_prop_str, set_prop_json, set_state_path_prop, set_state_json, set_repeat",
  );
  lines.push(
    "  Type 3: (i32, i32, i32, i32, i32) -> ()                           ; set_prop_int, set_prop_bool",
  );
  lines.push(
    "  Type 4: (i32, i32, i32) -> ()                                     ; set_state_int",
  );
  lines.push(
    "  Type 5: (i32, i32, i32, i32, i32, i32, i32, i32) -> ()           ; set_event",
  );
  lines.push(
    "  Type 6: () -> ()                                                   ; render (your exported function)",
  );
  lines.push("");

  lines.push("IMPORT TYPE MAPPING (each import uses one of the types above):");
  const importTypeMap = [0, 1, 2, 3, 3, 2, 2, 1, 1, 4, 1, 1, 5, 2];
  ABI_FUNCTIONS.forEach((fn, i) => {
    lines.push(`  import ${i} (${fn.name}): type ${importTypeMap[i]}`);
  });
  lines.push("");

  // ── Data Section Pattern ──────────────────────────────────────────
  lines.push("=== DATA SECTION PATTERN ===");
  lines.push(
    "All strings your UI needs (element IDs, component types, prop keys/values,",
  );
  lines.push(
    "state keys/values, action names, JSON payloads) must be placed in the",
  );
  lines.push("Data section as raw UTF-8 bytes at known offsets.");
  lines.push("");
  lines.push("Plan your string table first:");
  lines.push('  offset 0: "main" (4 bytes) — element ID / root key');
  lines.push('  offset 4: "Card" (4 bytes) — component type');
  lines.push('  offset 8: "title" (5 bytes) — prop key');
  lines.push('  offset 13: "Hello World" (11 bytes) — prop value');
  lines.push("  ... etc.");
  lines.push("");
  lines.push(
    "Then in the Code section, use i32.const <offset> and i32.const <length>",
  );
  lines.push("to reference each string when calling host functions.");
  lines.push("");

  // ── Module Structure Template ─────────────────────────────────────
  lines.push("=== MODULE STRUCTURE (always follow this order) ===");
  lines.push("");
  lines.push("0061736d 01000000                    ; header");
  lines.push(
    "01 <size> 07                         ; Type section: 7 types (types 0-6 as above)",
  );
  lines.push("  60 02 7f7f 00                      ;   type 0: (i32,i32)->()");
  lines.push(
    "  60 04 7f7f7f7f 00                  ;   type 1: (i32,i32,i32,i32)->()",
  );
  lines.push(
    "  60 06 7f7f7f7f7f7f 00              ;   type 2: (i32,i32,i32,i32,i32,i32)->()",
  );
  lines.push(
    "  60 05 7f7f7f7f7f 00                ;   type 3: (i32,i32,i32,i32,i32)->()",
  );
  lines.push(
    "  60 03 7f7f7f 00                    ;   type 4: (i32,i32,i32)->()",
  );
  lines.push(
    "  60 08 7f7f7f7f7f7f7f7f 00          ;   type 5: (i32,i32,i32,i32,i32,i32,i32,i32)->()",
  );
  lines.push("  60 00 00                            ;   type 6: ()->()");
  lines.push(
    '02 <size> 0e                         ; Import section: 14 imports from "env"',
  );
  lines.push("  03 656e76 <name_len> <name> 00 <type_idx>  ; each import");
  lines.push(
    "03 <size> 01 06                      ; Function section: 1 function, type 6",
  );
  lines.push("05 03 01 00 01                       ; Memory section: 1 page");
  lines.push(
    "07 <size> 02                         ; Export section: memory + render",
  );
  lines.push(
    '  06 6d656d6f7279 02 00              ;   export "memory" as memory 0',
  );
  lines.push(
    '  06 72656e646572 00 0e              ;   export "render" as func 14',
  );
  lines.push("0a <size> 01 <body_size> 00 <instructions> 0b  ; Code section");
  lines.push("0b <size> <count> <data_entries>     ; Data section");
  lines.push("");

  // ── Complete Reference Example ────────────────────────────────────
  lines.push("=== COMPLETE EXAMPLE: Hello World Card ===");
  lines.push("");
  lines.push('User prompt: "Create a card that says Hello World"');
  lines.push("");
  lines.push("String table plan:");
  lines.push('  @0   "main"          (4 bytes)');
  lines.push('  @4   "Card"          (4 bytes)');
  lines.push('  @8   "title"         (5 bytes)');
  lines.push('  @13  "Hello World"   (11 bytes)');
  lines.push('  @24  "child-1"       (7 bytes)');
  lines.push('  @31  "Text"          (4 bytes)');
  lines.push('  @35  "text"          (4 bytes)');
  lines.push('  @39  "Welcome to WASM-rendered UI!"  (29 bytes)');
  lines.push("");
  lines.push("render() logic:");
  lines.push('  set_root(0, 4)                           ; root = "main"');
  lines.push(
    '  create_element(0, 4, 4, 4)               ; element "main" type "Card"',
  );
  lines.push(
    '  set_prop_str(0, 4, 8, 5, 13, 11)         ; main.title = "Hello World"',
  );
  lines.push(
    '  create_element(24, 7, 31, 4)             ; element "child-1" type "Text"',
  );
  lines.push(
    '  set_prop_str(24, 7, 35, 4, 39, 29)       ; child-1.text = "Welcome to..."',
  );
  lines.push(
    '  add_child(0, 4, 24, 7)                   ; main.children += "child-1"',
  );
  lines.push("");
  lines.push("Output (hex-encoded WASM binary):");
  lines.push(reference.hex);
  lines.push("");

  // ── Available Components ──────────────────────────────────────────
  const catalogData = catalog.data as Record<string, unknown>;
  const components = catalogData.components as
    | Record<
        string,
        {
          props?: { _def?: unknown };
          description?: string;
          slots?: string[];
          events?: string[];
        }
      >
    | undefined;
  const actions = catalogData.actions as
    | Record<
        string,
        {
          params?: unknown;
          description?: string;
        }
      >
    | undefined;

  if (components) {
    lines.push(
      `=== AVAILABLE COMPONENTS (${catalog.componentNames.length}) ===`,
    );
    lines.push("ONLY use component types from this list.");
    lines.push("");
    for (const [name, def] of Object.entries(components)) {
      const hasChildren = def.slots && def.slots.length > 0;
      const childrenStr = hasChildren ? " [accepts children]" : "";
      const eventsStr =
        def.events && def.events.length > 0
          ? ` [events: ${def.events.join(", ")}]`
          : "";
      const descStr = def.description ? ` — ${def.description}` : "";
      lines.push(`  ${name}${descStr}${childrenStr}${eventsStr}`);
    }
    lines.push("");
  }

  if (actions && catalog.actionNames.length > 0) {
    lines.push("=== AVAILABLE ACTIONS ===");
    lines.push("Use set_event() to bind these. Params are JSON strings.");
    lines.push("");
    for (const [name, def] of Object.entries(actions)) {
      lines.push(`  ${name}${def.description ? `: ${def.description}` : ""}`);
    }
    lines.push("");
  }

  // ── Rules ─────────────────────────────────────────────────────────
  lines.push("=== RULES ===");
  const baseRules = [
    "Output ONLY hex bytes — no markdown, no code fences, no English text, no comments",
    "Always start with 0061736d01000000 (WASM magic + version)",
    "Include all 7 type definitions (types 0-6) in the Type section",
    'Import all 14 host functions in the correct order from "env"',
    "Your render function is always at index 14 (after 14 imports)",
    'Export memory as "memory" (kind 02, index 00) and render as "render" (kind 00, index 0e)',
    "Plan your string table carefully — every string needs a known offset and length",
    "Place ALL strings in the Data section as raw UTF-8 bytes",
    "In the Code section, push args with i32.const then call the function",
    "End every function body with 0b (end opcode)",
    "ONLY use component types from the AVAILABLE COMPONENTS list",
    "For props with complex values (arrays, objects), use set_prop_json with a JSON string in the data section",
    "For events, use set_event with action name and JSON params string",
    "Include realistic content — don't just create empty components",
  ];
  const allRules = [...baseRules, ...customRules];
  allRules.forEach((rule, i) => {
    lines.push(`${i + 1}. ${rule}`);
  });
  lines.push("");

  // ── Pro Tips ──────────────────────────────────────────────────────
  lines.push("=== TIPS ===");
  lines.push(
    "- Plan your string table FIRST, then calculate all offsets before generating hex",
  );
  lines.push(
    "- Double-check LEB128 section sizes — wrong sizes cause validation failures",
  );
  lines.push(
    "- For the Memory section, 05 03 01 00 01 is always correct (1 page, no max)",
  );
  lines.push(
    "- The Data section offset uses i32.const+end: 00 41 <offset> 0b <len> <bytes>",
  );
  lines.push(
    "- Keep element IDs short and descriptive: 'main', 'hdr', 'btn-1', 'txt-1'",
  );
  lines.push(
    "- Use set_prop_json for array/object props (e.g. table columns, select options)",
  );

  return lines.join("\n");
}

/**
 * Build a user prompt for WASM generation (refinement or fresh).
 */
export function buildWasmUserPrompt(options: {
  prompt: string;
  maxPromptLength?: number;
}): string {
  let userText = String(options.prompt || "");
  if (options.maxPromptLength && options.maxPromptLength > 0) {
    userText = userText.slice(0, options.maxPromptLength);
  }

  return `${userText}

Remember: Output ONLY hex-encoded WASM bytecode. Plan your string table first, then build the complete module. Start with 0061736d01000000.`;
}

/**
 * Get the reference WASM module hex for testing.
 */
export function getWasmReferenceExample(): { hex: string; annotated: string } {
  return buildReferenceExample();
}
