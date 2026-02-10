"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Spec } from "@json-render/core";
import { createWasmStreamCompiler } from "@json-render/core";
import type { WasmTokenUsage } from "@json-render/core";

/**
 * Token usage metadata from WASM generation
 */
export interface WasmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Options for useWasmStream
 */
export interface UseWasmStreamOptions {
  /** API endpoint for WASM generation */
  api: string;
  /** Callback when complete */
  onComplete?: (spec: Spec) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Return type for useWasmStream
 */
export interface UseWasmStreamReturn {
  /** Current UI spec (available after WASM execution) */
  spec: Spec | null;
  /** Whether currently streaming */
  isStreaming: boolean;
  /** Error if any */
  error: Error | null;
  /** Token usage from the last generation */
  usage: WasmUsage | null;
  /** Number of bytes received so far */
  bytesReceived: number;
  /** The hex dump of the received WASM binary */
  hexDump: string;
  /** Any errors from WASM execution */
  wasmErrors: string[];
  /** Send a prompt to generate WASM UI */
  send: (prompt: string, context?: Record<string, unknown>) => Promise<void>;
  /** Clear the current spec */
  clear: () => void;
}

/**
 * React hook for streaming WASM bytecode UI generation.
 *
 * Instead of streaming JSONL patches, this hook:
 * 1. Streams hex-encoded WASM bytecode from the LLM
 * 2. Accumulates the bytes during streaming
 * 3. When the stream completes, compiles and executes the WASM module
 * 4. The WASM module calls host functions that build a UI Spec
 * 5. Returns the Spec for rendering by the existing React renderer
 *
 * @example
 * ```tsx
 * const { spec, isStreaming, send } = useWasmStream({
 *   api: "/api/generate-wasm",
 * });
 *
 * return (
 *   <>
 *     <button onClick={() => send("Create a login form")}>Generate</button>
 *     {spec && <Renderer spec={spec} />}
 *   </>
 * );
 * ```
 */
export function useWasmStream({
  api,
  onComplete,
  onError,
}: UseWasmStreamOptions): UseWasmStreamReturn {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [usage, setUsage] = useState<WasmUsage | null>(null);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [hexDump, setHexDump] = useState("");
  const [wasmErrors, setWasmErrors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setSpec(null);
    setError(null);
    setUsage(null);
    setBytesReceived(0);
    setHexDump("");
    setWasmErrors([]);
  }, []);

  const send = useCallback(
    async (prompt: string, context?: Record<string, unknown>) => {
      // Abort any existing request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setIsStreaming(true);
      setError(null);
      setUsage(null);
      setSpec(null);
      setBytesReceived(0);
      setHexDump("");
      setWasmErrors([]);

      const compiler = createWasmStreamCompiler();

      try {
        const response = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, context }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          let errorMessage = `HTTP error: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.message) errorMessage = errorData.message;
            else if (errorData.error) errorMessage = errorData.error;
          } catch {
            // Use default message
          }
          throw new Error(errorMessage);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();

        // Stream and accumulate hex bytes
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const state = compiler.push(chunk);

          setBytesReceived(state.bytesReceived);
          setHexDump(state.hexDump);
          if (state.usage) {
            setUsage(state.usage);
          }
        }

        // Stream complete — compile and execute the WASM module
        const result = await compiler.finalize();

        if (result.usage) {
          setUsage(result.usage);
        }

        setHexDump(result.hexDump);
        setBytesReceived(result.bytesReceived);

        if (result.errors.length > 0) {
          setWasmErrors(result.errors);
        }

        if (result.spec && result.spec.root) {
          setSpec(result.spec);
          onComplete?.(result.spec);
        } else if (result.errors.length > 0) {
          throw new Error(`WASM execution failed: ${result.errors.join("; ")}`);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
      } finally {
        setIsStreaming(false);
      }
    },
    [api, onComplete, onError],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    spec,
    isStreaming,
    error,
    usage,
    bytesReceived,
    hexDump,
    wasmErrors,
    send,
    clear,
  };
}
