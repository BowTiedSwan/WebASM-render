// Types
export type {
  DynamicValue,
  DynamicString,
  DynamicNumber,
  DynamicBoolean,
  UIElement,
  FlatElement,
  Spec,
  VisibilityCondition,
  LogicExpression,
  AuthState,
  StateModel,
  ComponentSchema,
  ValidationMode,
  PatchOp,
  JsonPatch,
  // SpecStream types
  SpecStreamLine,
  SpecStreamCompiler,
} from "./types";

export {
  DynamicValueSchema,
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  resolveDynamicValue,
  getByPath,
  setByPath,
  addByPath,
  removeByPath,
  findFormValue,
  // SpecStream - streaming format for building specs (RFC 6902)
  parseSpecStreamLine,
  applySpecStreamPatch,
  compileSpecStream,
  createSpecStreamCompiler,
} from "./types";

// Visibility
export type { VisibilityContext } from "./visibility";

export {
  VisibilityConditionSchema,
  LogicExpressionSchema,
  evaluateVisibility,
  evaluateLogicExpression,
  visibility,
} from "./visibility";

// Prop Expressions
export type { PropExpression } from "./props";

export { resolvePropValue, resolveElementProps } from "./props";

// Actions
export type {
  ActionBinding,
  /** @deprecated Use ActionBinding instead */
  Action,
  ActionConfirm,
  ActionOnSuccess,
  ActionOnError,
  ActionHandler,
  ActionDefinition,
  ResolvedAction,
  ActionExecutionContext,
} from "./actions";

export {
  ActionBindingSchema,
  /** @deprecated Use ActionBindingSchema instead */
  ActionSchema,
  ActionConfirmSchema,
  ActionOnSuccessSchema,
  ActionOnErrorSchema,
  resolveAction,
  executeAction,
  interpolateString,
  actionBinding,
  /** @deprecated Use actionBinding instead */
  action,
} from "./actions";

// Validation
export type {
  ValidationCheck,
  ValidationConfig,
  ValidationFunction,
  ValidationFunctionDefinition,
  ValidationCheckResult,
  ValidationResult,
  ValidationContext,
} from "./validation";

export {
  ValidationCheckSchema,
  ValidationConfigSchema,
  builtInValidationFunctions,
  runValidationCheck,
  runValidation,
  check,
} from "./validation";

// Spec Structural Validation
export type {
  SpecIssueSeverity,
  SpecIssue,
  SpecValidationIssues,
  ValidateSpecOptions,
} from "./spec-validator";

export { validateSpec, autoFixSpec, formatSpecIssues } from "./spec-validator";

// Schema (new API)
export type {
  SchemaBuilder,
  SchemaType,
  SchemaDefinition,
  Schema,
  Catalog,
  PromptOptions,
  PromptContext,
  PromptTemplate,
  SchemaOptions,
  SpecValidationResult,
  InferCatalogInput,
  InferSpec,
  // Catalog type inference
  InferCatalogComponents,
  InferCatalogActions,
  InferComponentProps,
  InferActionParams,
} from "./schema";

export { defineSchema, defineCatalog } from "./schema";

// User Prompt Builder
export type { UserPromptOptions } from "./prompt";

export { buildUserPrompt } from "./prompt";

// Legacy Catalog (for backwards compatibility during migration)
export type {
  ComponentDefinition,
  CatalogConfig,
  Catalog as LegacyCatalog,
  InferCatalogComponentProps,
  SystemPromptOptions,
} from "./catalog";

export {
  createCatalog,
  generateCatalogPrompt,
  generateSystemPrompt,
} from "./catalog";

// WASM Bytecode Generation
export type {
  FuncType,
  ImportFunc,
  ExportFunc,
  DataSegment,
  FuncBody,
  WasmModuleOptions,
  StringEntry,
} from "./wasm-bytecode";

export {
  encodeULEB128,
  encodeSLEB128,
  WASM_TYPE,
  OP,
  buildWasmModule,
  buildStringTable,
  toHex,
  fromHex,
  i32Const,
  call,
  localGet,
  localSet,
} from "./wasm-bytecode";

// WASM Runtime
export type { WasmExecResult } from "./wasm-runtime";

export { createWasmImports, executeWasmModule } from "./wasm-runtime";

// WASM Stream
export type {
  WasmTokenUsage,
  WasmStreamResult,
  WasmStreamCompiler,
} from "./wasm-stream";

export {
  createWasmStreamCompiler,
  compileWasmHex,
  formatWasmHexDump,
} from "./wasm-stream";

// WASM Prompt
export {
  buildWasmSystemPrompt,
  buildWasmUserPrompt,
  getWasmReferenceExample,
} from "./wasm-prompt";
