export type LearnerLeavePayload = {
  success?: boolean;
  kept_running?: boolean;
  reason?: string;
  wallet?: {
    allocated_minutes?: number;
    used_minutes?: number;
    remaining_minutes?: number;
  };
} | null | undefined;

/** Toast copy for Leave. A protected VM is a successful leave, never "Leave failed". */
export function learnerLeaveNotice(data: LearnerLeavePayload): { title: string; description: string } {
  if (data?.success === true && data.kept_running === true && data.reason === "VM_PROTECTED") {
    return {
      title: "Left the lab",
      description: "Session closed. This machine is protected, so it was kept running.",
    };
  }
  const w = data?.wallet;
  if (w && typeof w.remaining_minutes === "number" && typeof w.allocated_minutes === "number") {
    const used = typeof w.used_minutes === "number" ? w.used_minutes : w.allocated_minutes - w.remaining_minutes;
    return {
      title: "Left the lab",
      description: `${w.allocated_minutes} − ${used} = ${w.remaining_minutes} minutes remaining. Machine soft-stopped (not deleted).`,
    };
  }
  return {
    title: "Left the lab",
    description: "Machine soft-stopped (not deleted). Start resumes the same lab when minutes remain.",
  };
}
