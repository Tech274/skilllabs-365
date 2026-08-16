import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { AI_FALLBACK_MESSAGE, invokeAiFunction } from "@/lib/ai-client";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface AiInsightCardProps {
  type: string;
  data: unknown;
  title?: string;
  buttonLabel?: string;
  className?: string;
  variant?: "card" | "inline";
}

export function AiInsightCard({
  type,
  data,
  title = "AI Insight",
  buttonLabel = "Ask AI",
  className,
  variant = "card",
}: AiInsightCardProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const fetchInsight = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeAiFunction<{ insight: string }>("ai-assistant", { type, data });
      setInsight(result.insight);
      setExpanded(true);
    } catch (err: any) {
      setError(err?.message || AI_FALLBACK_MESSAGE);
    } finally {
      setLoading(false);
    }
  };


  if (variant === "inline") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchInsight}
          disabled={loading}
          className="gap-2 border-primary/30 text-primary hover:bg-primary/10 w-fit"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {loading ? "Analyzing..." : buttonLabel}
        </Button>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 text-xs text-destructive"
            >
              <AlertCircle className="h-3 w-3" />
              {error}
            </motion.div>
          )}
          {insight && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-lg border border-primary/20 bg-primary/5 p-4 prose prose-sm prose-invert max-w-none text-sm text-foreground"
            >
              <ReactMarkdown>{insight}</ReactMarkdown>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent",
        className
      )}
    >
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchInsight}
            disabled={loading}
            className="gap-2 text-primary hover:bg-primary/10 h-8"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {insight ? "Refresh" : buttonLabel}
              </>
            )}
          </Button>
          {insight && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 pb-3"
          >
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              {error}
            </div>
          </motion.div>
        )}
        {insight && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 pb-5"
          >
            <div className="prose prose-sm prose-invert max-w-none text-sm text-foreground/90 [&_ul]:space-y-1 [&_li]:text-foreground/80 [&_strong]:text-foreground [&_h3]:text-foreground [&_h3]:text-sm [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:rounded">
              <ReactMarkdown>{insight}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
