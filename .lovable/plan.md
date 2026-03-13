

# Plan: AI Enablement Across the Platform

Lovable AI (via `LOVABLE_API_KEY`, already configured) will be integrated into every major surface of the platform through a single shared edge function with branching logic.

---

## Edge Function: `supabase/functions/ai-assistant/index.ts`

A single edge function handling multiple AI use cases via a `type` parameter. Uses `google/gemini-3-flash-preview` for speed and cost efficiency. Each use case gets a tailored system prompt.

Supported types:
- `cost_insight` — Analyzes cost data, suggests optimizations
- `security_summary` — Summarizes security/audit events, flags risks
- `daily_report_summary` — Narrates a daily report in plain English
- `lab_description` — Auto-generates lab template descriptions from name/config
- `student_guidance` — Gives students contextual help about their lab
- `instructor_insight` — Summarizes student progress patterns for instructors
- `health_diagnosis` — Interprets system health data and suggests actions
- `audit_anomaly` — Flags unusual patterns in session audit logs

---

## UI Integration Points

### 1. Admin Dashboard (`Index.tsx`)
- **AI Insights Card**: A collapsible card at the top that sends current metrics (VM counts, session counts, idle VMs, quota usage) to `ai-assistant?type=cost_insight` and displays actionable recommendations like "3 VMs idle >30min — consider auto-cleanup threshold reduction."

### 2. Cost Analytics (`CostAnalytics.tsx`)
- **"AI Cost Advisor" button**: Sends cost breakdown data to `ai-assistant?type=cost_insight`. Returns optimization suggestions like "Switch Standard_B2ms labs to Standard_B2s — saves ~$X/month based on usage patterns."

### 3. Security Page (`Security.tsx`)
- **"AI Threat Summary" button**: Sends recent audit logs and WAF events to `ai-assistant?type=security_summary`. Returns a natural-language threat assessment with severity ranking and recommended actions.

### 4. Daily Reports (`DailyReports.tsx`)
- **"Summarize Report" button** on each report card: Sends report JSON to `ai-assistant?type=daily_report_summary`. Returns a readable narrative: "Today saw 12 sessions across 2 regions. 3 VMs were cleaned up. Usage peaked between 9-11 AM."

### 5. Lab Management (`LabManagement.tsx`)
- **"Generate Description" button** in the create/edit lab dialog: Sends lab name, protocol, VM size, OS image to `ai-assistant?type=lab_description`. Auto-fills the description textarea with a professional lab description.

### 6. Student Dashboard (`StudentDashboard.tsx`)
- **"Ask AI" floating button**: Opens a small chat panel. Sends lab template info + session history to `ai-assistant?type=student_guidance`. Students can ask "What should I practice next?" or "How do I connect to my lab?"

### 7. Instructor Dashboard (`InstructorDashboard.tsx`)
- **"AI Student Insights" button**: Sends aggregated student progress data to `ai-assistant?type=instructor_insight`. Returns patterns like "2 students haven't completed any labs this week. Student X has unusually high disconnect rates — possible connectivity issue."

### 8. Session Audit Log (`SessionAuditLog.tsx`)
- **"Detect Anomalies" button**: Sends recent session data to `ai-assistant?type=audit_anomaly`. Returns flagged patterns: "User launched 8 VMs in 5 minutes — possible abuse" or "Region Central India shows 3x normal disconnect rate."

### 9. Health Page (`Health.tsx`)
- **"AI Diagnosis" button**: Sends service status data to `ai-assistant?type=health_diagnosis`. Returns: "MySQL Central India latency is 42ms (7x normal). Likely cause: high query load or network congestion. Recommended: check connection pool and slow query log."

---

## New Shared Component

### `src/components/AiInsightCard.tsx`
A reusable component used across all pages:
- Takes `type`, `data` (context to send), and optional `title`
- Shows a sparkle icon button → loading state → rendered markdown response
- Collapsible card with the AI response
- Uses `supabase.functions.invoke("ai-assistant", { body: { type, data } })`

---

## Files Changed

- **New**: `supabase/functions/ai-assistant/index.ts` — Multi-purpose AI edge function
- **New**: `src/components/AiInsightCard.tsx` — Reusable AI insight component
- **Modified**: `Index.tsx`, `CostAnalytics.tsx`, `Security.tsx`, `DailyReports.tsx`, `LabManagement.tsx`, `StudentDashboard.tsx`, `InstructorDashboard.tsx`, `SessionAuditLog.tsx`, `Health.tsx` — Add AI buttons/cards
- **Modified**: `supabase/config.toml` — Add `ai-assistant` function config

No database changes required. All AI calls are stateless.

