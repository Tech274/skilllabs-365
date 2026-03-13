

## Plan: Activity Logs for Role Changes + Invite User Flow

### 1. Database Changes

**New table: `activity_logs`**
- `id` (uuid, PK)
- `actor_id` (uuid, references the admin who performed the action)
- `target_user_id` (uuid, the user whose role changed)
- `action` (text, e.g. "role_change")
- `details` (jsonb, e.g. `{ "old_role": "student", "new_role": "admin" }`)
- `created_at` (timestamptz, default now())

RLS: Admins can SELECT/INSERT. Enable realtime.

**New table: `pending_invitations`**
- `id` (uuid, PK)
- `email` (text, unique)
- `role` (app_role)
- `invited_by` (uuid)
- `created_at` (timestamptz, default now())
- `accepted` (boolean, default false)

RLS: Admins can manage. A trigger on `profiles` insert will check `pending_invitations` for a matching email and override the default student role if found.

### 2. UserManagement.tsx Updates

**Activity Log section:**
- Add a new tab or collapsible section showing recent role change logs from `activity_logs`
- Each entry shows: timestamp, admin name (via actor_id join to profiles), target user, old role -> new role
- Real-time subscription for live updates

**Role change flow update:**
- Before calling `changeRole`, fetch the current role to populate `old_role` in the log
- After successful role update, insert an `activity_logs` record with actor_id = current user

**Invite user flow:**
- The "Send Invitation" button inserts into `pending_invitations` with the chosen email and role
- Toast confirms the invitation was saved
- When the invited user signs up, a database trigger checks `pending_invitations` for their email and assigns the pre-selected role instead of the default "student"
- Show pending invitations list in the invite dialog or a separate section

### 3. Database Trigger for Invite Auto-Role

Modify the `handle_new_user` function to check `pending_invitations`:
- If email matches a pending invitation, use that role instead of 'student'
- Mark the invitation as accepted

### 4. Files Changed

- **Migration**: Create `activity_logs` and `pending_invitations` tables, update `handle_new_user` trigger function
- **`src/pages/UserManagement.tsx`**: Add activity log section, update `changeRole` to log actions, implement real invite flow with `pending_invitations`

