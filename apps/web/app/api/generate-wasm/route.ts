import { streamText } from "ai";
import { headers } from "next/headers";
import { buildWasmSystemPrompt, buildWasmUserPrompt } from "@json-render/core";
import { minuteRateLimit, dailyRateLimit } from "@/lib/rate-limit";
import { playgroundCatalog } from "@/lib/render/catalog";

export const maxDuration = 60;

const SYSTEM_PROMPT = buildWasmSystemPrompt(playgroundCatalog, {
  system:
    "You are a UI generator that outputs WebAssembly bytecode directly. " +
    "Instead of producing JSON or code, you generate raw WASM binary (hex-encoded) " +
    "that, when compiled and executed, calls host functions to build a complete UI spec.",
  customRules: [
    "For forms or small UIs: use Card as root with title and description props",
    "For content-heavy UIs: use Stack or Grid as root containers",
    "Include realistic content — use descriptive titles, helpful descriptions, sample data",
    "Use set_prop_json for array/object props like table rows, select options, etc.",
  ],
});

const MAX_PROMPT_LENGTH = 500;
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export async function POST(req: Request) {
  // Get client IP for rate limiting
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0] ?? "anonymous";

  // Check rate limits
  const [minuteResult, dailyResult] = await Promise.all([
    minuteRateLimit.limit(ip),
    dailyRateLimit.limit(ip),
  ]);

  if (!minuteResult.success || !dailyResult.success) {
    const isMinuteLimit = !minuteResult.success;
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: isMinuteLimit
          ? "Too many requests. Please wait a moment before trying again."
          : "Daily limit reached. Please try again tomorrow.",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { prompt } = await req.json();

  const userPrompt = buildWasmUserPrompt({
    prompt,
    maxPromptLength: MAX_PROMPT_LENGTH,
  });

  const result = streamText({
    model: process.env.AI_GATEWAY_MODEL || DEFAULT_MODEL,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.3, // Lower temperature for more precise bytecode generation
  });

  // Stream the hex bytes, then append token usage metadata at the end
  const encoder = new TextEncoder();
  const textStream = result.textStream;

  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of textStream) {
        controller.enqueue(encoder.encode(chunk));
      }
      // Append usage metadata after stream completes
      try {
        const usage = await result.usage;
        const meta = JSON.stringify({
          __meta: "usage",
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        });
        controller.enqueue(encoder.encode(`\n${meta}\n`));
      } catch {
        // Usage not available
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
