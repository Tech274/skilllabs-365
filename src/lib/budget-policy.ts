/**
 * Provider-aware budget policy.
 *
 * Stored in `platform_settings` under the key `budget_policies`. The evaluation
 * below is deliberately pure and deterministic so both the admin Settings UI and
 * the server-side launch guards reach the same verdict from the same numbers.
 */

export type CloudProviderKey = "aws" | "azure" | "gcp";

export interface BudgetPolicy {
  enabled: boolean;
  global_daily_cap: number;
  global_monthly_cap: number;
  warn_at_percent: number;
  block_at_percent: number;
  provider_caps: Record<CloudProviderKey, number>;
}

export const BUDGET_POLICY_KEY = "budget_policies";

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  enabled: false,
  global_daily_cap: 100,
  global_monthly_cap: 1000,
  warn_at_percent: 80,
  block_at_percent: 100,
  provider_caps: { aws: 300, azure: 300, gcp: 300 },
};

/** Coerce whatever is stored in platform_settings into a complete policy. */
export function normalizeBudgetPolicy(raw: unknown): BudgetPolicy {
  const v = (raw ?? {}) as Partial<BudgetPolicy> & { provider_caps?: Partial<Record<CloudProviderKey, number>> };
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    enabled: Boolean(v.enabled),
    global_daily_cap: num(v.global_daily_cap, DEFAULT_BUDGET_POLICY.global_daily_cap),
    global_monthly_cap: num(v.global_monthly_cap, DEFAULT_BUDGET_POLICY.global_monthly_cap),
    warn_at_percent: num(v.warn_at_percent, DEFAULT_BUDGET_POLICY.warn_at_percent),
    block_at_percent: num(v.block_at_percent, DEFAULT_BUDGET_POLICY.block_at_percent),
    provider_caps: {
      aws: num(v.provider_caps?.aws, DEFAULT_BUDGET_POLICY.provider_caps.aws),
      azure: num(v.provider_caps?.azure, DEFAULT_BUDGET_POLICY.provider_caps.azure),
      gcp: num(v.provider_caps?.gcp, DEFAULT_BUDGET_POLICY.provider_caps.gcp),
    },
  };
}

/** Admin-facing validation. Returns the list of problems (empty when valid). */
export function validateBudgetPolicy(policy: BudgetPolicy): string[] {
  const errors: string[] = [];
  if (policy.warn_at_percent < 0 || policy.warn_at_percent > 200) errors.push("Warning percent must be between 0 and 200.");
  if (policy.block_at_percent < 0 || policy.block_at_percent > 200) errors.push("Blocking percent must be between 0 and 200.");
  if (policy.block_at_percent < policy.warn_at_percent) errors.push("Blocking percent must be greater than or equal to the warning percent.");
  if (policy.global_daily_cap <= 0) errors.push("Daily cap must be greater than zero.");
  if (policy.global_monthly_cap <= 0) errors.push("Monthly cap must be greater than zero.");
  if (policy.global_monthly_cap < policy.global_daily_cap) errors.push("Monthly cap must be at least the daily cap.");
  for (const p of ["aws", "azure", "gcp"] as CloudProviderKey[]) {
    if (policy.provider_caps[p] < 0) errors.push(`${p.toUpperCase()} cap cannot be negative.`);
  }
  return errors;
}

export interface BudgetSpend {
  /** Estimated spend so far today, across all providers, in USD. */
  daily: number;
  /** Estimated spend so far this calendar month, across all providers, in USD. */
  monthly: number;
  /** Estimated month-to-date spend per provider, in USD. */
  perProvider: Partial<Record<CloudProviderKey, number>>;
}

export type BudgetDecisionLevel = "allow" | "warn" | "block";

/** One breached (or nearly breached) limit, rendered as a user-facing blocker. */
export interface BudgetBlocker {
  limit: string;
  label: string;
  level: Exclude<BudgetDecisionLevel, "allow">;
  cap: number;
  used: number;
  usedPercent: number;
  remaining: number;
  message: string;
}

export interface BudgetDecision {
  level: BudgetDecisionLevel;
  /** Which limit triggered the decision, e.g. "global_monthly_cap" or "provider_cap:aws". */
  limit: string | null;
  /** Percent of the triggering limit already consumed (0 when allowed by default). */
  usedPercent: number;
  message: string;
  /** Every breached limit, strictest first — surfaced to the user verbatim. */
  blockers: BudgetBlocker[];
  /** Headroom left on the triggering limit, in USD (null when nothing triggered). */
  remaining: number | null;
  /** Misconfiguration found during preflight; the policy was clamped before use. */
  policyErrors: string[];
}

const allowed: BudgetDecision = {
  level: "allow", limit: null, usedPercent: 0, message: "Within budget.",
  blockers: [], remaining: null, policyErrors: [],
};

/**
 * Preflight: clamp an unusable policy into a safe one so a misconfiguration can
 * never silently disable (or wildly over-apply) enforcement.
 */
export function clampBudgetPolicy(policy: BudgetPolicy): { policy: BudgetPolicy; errors: string[] } {
  const errors = validateBudgetPolicy(policy);
  if (errors.length === 0) return { policy, errors };
  const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);
  const warn = Math.min(Math.max(policy.warn_at_percent, 0), 200);
  const daily = clamp(policy.global_daily_cap, DEFAULT_BUDGET_POLICY.global_daily_cap);
  return {
    errors,
    policy: {
      ...policy,
      warn_at_percent: warn,
      block_at_percent: Math.min(Math.max(policy.block_at_percent, warn), 200),
      global_daily_cap: daily,
      global_monthly_cap: Math.max(clamp(policy.global_monthly_cap, DEFAULT_BUDGET_POLICY.global_monthly_cap), daily),
      provider_caps: {
        aws: Math.max(policy.provider_caps.aws, 0),
        azure: Math.max(policy.provider_caps.azure, 0),
        gcp: Math.max(policy.provider_caps.gcp, 0),
      },
    },
  };
}

/**
 * Deterministic allow / warn / block verdict for a new paid launch.
 * The strictest breached limit wins.
 */
export function evaluateBudget(
  rawPolicy: BudgetPolicy,
  spend: BudgetSpend,
  opts: { provider?: CloudProviderKey | string | null; estimatedCost?: number } = {},
): BudgetDecision {
  if (!rawPolicy.enabled) return allowed;
  const { policy, errors: policyErrors } = clampBudgetPolicy(rawPolicy);

  const add = Math.max(0, opts.estimatedCost ?? 0);
  const provider = (opts.provider ?? "") as CloudProviderKey;
  const checks: { limit: string; used: number; cap: number; label: string }[] = [
    { limit: "global_daily_cap", used: spend.daily + add, cap: policy.global_daily_cap, label: "daily platform budget" },
    { limit: "global_monthly_cap", used: spend.monthly + add, cap: policy.global_monthly_cap, label: "monthly platform budget" },
  ];
  if (provider && policy.provider_caps[provider] !== undefined) {
    checks.push({
      limit: `provider_cap:${provider}`,
      used: (spend.perProvider[provider] ?? 0) + add,
      cap: policy.provider_caps[provider],
      label: `${provider.toUpperCase()} monthly budget`,
    });
  }

  const blockers: BudgetBlocker[] = [];
  for (const c of checks) {
    if (c.cap <= 0) continue;
    const pct = (c.used / c.cap) * 100;
    const level: BudgetDecisionLevel = pct >= policy.block_at_percent
      ? "block"
      : pct >= policy.warn_at_percent
        ? "warn"
        : "allow";
    if (level === "allow") continue;
    blockers.push({
      limit: c.limit,
      label: c.label,
      level,
      cap: c.cap,
      used: Math.round(c.used * 100) / 100,
      usedPercent: Math.round(pct * 10) / 10,
      remaining: Math.round(Math.max(0, c.cap - c.used) * 100) / 100,
      message: level === "block"
        ? `Launch blocked: the ${c.label} of $${c.cap} is exhausted (estimated $${c.used.toFixed(2)} used, ${Math.round(pct)}%). Ask an administrator to raise the cap or wait for the next period.`
        : `Heads up: ${Math.round(pct)}% of the ${c.label} ($${c.cap}) is already used.`,
    });
  }

  blockers.sort((a, b) =>
    (a.level === b.level ? b.usedPercent - a.usedPercent : a.level === "block" ? -1 : 1));
  const worst = blockers[0];
  if (!worst) return { ...allowed, policyErrors };
  return {
    level: worst.level,
    limit: worst.limit,
    usedPercent: worst.usedPercent,
    message: worst.message,
    blockers,
    remaining: worst.remaining,
    policyErrors,
  };
}
