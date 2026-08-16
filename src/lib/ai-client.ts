import { supabase } from "@/integrations/supabase/client";

export const AI_FALLBACK_MESSAGE =
  "The AI service is temporarily unavailable. Please try again in a moment — if the problem continues, an admin can check AI status on the AI Status page.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("unavailable") ||
    m.includes("temporarily") ||
    m.includes("503") ||
    m.includes("502") ||
    m.includes("504") ||
    m.includes("500") ||
    m.includes("rate limit") ||
    m.includes("429") ||
    m.includes("failed to fetch") ||
    m.includes("network")
  );
}

/**
 * Invoke an AI edge function with exponential backoff on transient failures.
 * Throws an Error carrying a user-friendly message when all attempts fail.
 */
export async function invokeAiFunction<T = any>(
  functionName: string,
  body: unknown,
  opts: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastMessage = AI_FALLBACK_MESSAGE;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      if (error) throw new Error(error.message || "AI request failed");
      if (data?.error) throw new Error(data.error);
      return data as T;
    } catch (err: any) {
      lastMessage = err?.message || AI_FALLBACK_MESSAGE;
      const retryable = isTransient(lastMessage);
      if (!retryable || attempt === maxAttempts) break;
      await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  throw new Error(isTransient(lastMessage) ? AI_FALLBACK_MESSAGE : lastMessage);
}
