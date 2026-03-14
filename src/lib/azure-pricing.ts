// Estimated Azure VM hourly rates (USD, Pay-As-You-Go, East US)
const VM_HOURLY_RATES: Record<string, number> = {
  "Standard_B1s": 0.0104,
  "Standard_B1ms": 0.0207,
  "Standard_B2s": 0.0416,
  "Standard_B2ms": 0.0832,
  "Standard_B4ms": 0.166,
  "Standard_D2s_v3": 0.096,
  "Standard_D4s_v3": 0.192,
  "Standard_D2as_v5": 0.077,
  "Standard_D4as_v5": 0.154,
  "Standard_E2s_v3": 0.126,
  "Standard_F2s_v2": 0.085,
};

/**
 * Estimate session cost based on VM size and duration in minutes.
 * Returns formatted string like "$0.14" or "~$0.14"
 */
export function estimateLabCost(vmSize: string, durationMinutes: number): string {
  const hourlyRate = VM_HOURLY_RATES[vmSize];
  if (!hourlyRate) return "—";
  const cost = (hourlyRate / 60) * durationMinutes;
  if (cost < 0.01) return "<$0.01";
  return `~$${cost.toFixed(2)}`;
}

export function getHourlyRate(vmSize: string): string {
  const rate = VM_HOURLY_RATES[vmSize];
  if (!rate) return "—";
  return `$${rate.toFixed(4)}/hr`;
}
