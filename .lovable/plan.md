

## Plan: Real-time VM Status, Idle Warning Banner, and VM Page Improvements

### 1. Enable Realtime on `virtual_machines` Table
**Migration**: Add `virtual_machines` to the `supabase_realtime` publication so Postgres changes are broadcast to the frontend.

### 2. Rewrite Virtual Machines Page to Use Live Database Data
The current `VirtualMachines.tsx` uses **mock data** (`labVMs` from `mock-data.ts`). It needs to:
- Fetch VMs from the `virtual_machines` table (joined with `profiles` for user names and `lab_templates` for lab names)
- Subscribe to realtime changes on `virtual_machines` so status updates (e.g. `running` → `deallocated`) appear instantly without refresh
- Add `deallocated`, `terminated`, `failed` to the status filter dropdown
- Update the `VMStatus` type and `StatusBadge` to handle the new statuses

### 3. Add Idle Warning Banner to Lab Session Page
In `LabSession.tsx`:
- Track `idleMinutes` in component state (derived from `lastActivityRef`)
- When idle reaches 10 minutes, show an animated warning banner at the top: "You have been idle for X minutes. Session will auto-terminate at 15 minutes of inactivity."
- Banner dismisses on any user activity and reappears if idle resumes
- Use a 10-second interval to update the displayed idle time for responsiveness

### 4. Update StatusBadge Component
Add visual styling for `deallocated`, `terminated`, and `failed` statuses in the `StatusBadge` component.

### Files to Modify
- **Migration SQL**: Enable realtime publication for `virtual_machines`
- `src/pages/VirtualMachines.tsx` — Replace mock data with live database queries + realtime subscription
- `src/pages/LabSession.tsx` — Add idle warning banner (10+ min threshold)
- `src/components/StatusBadge.tsx` — Add new status colors
- `src/lib/mock-data.ts` — Update `VMStatus` type to include new statuses

