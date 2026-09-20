# Guacamole fail-closed connection overlay

## Goal
Keep all native Guacamole loading, login, and reconnect states hidden until SkillHub Labs confirms a tokenized desktop session.

## Changes
- Cover the remote frame with a calm SkillHub Labs status overlay throughout provisioning, reminting, reconnecting, and desktop confirmation.
- Refuse to render any frame URL that is not HTTPS and tokenized with a client connection token.
- Detect accessible Guacamole login forms and failure/reconnecting text; keep the frame hidden and silently mint a fresh session up to two times.
- Treat frame load as an intermediate signal only. Reveal and mark Connected only after the tokenized client view has settled without a detected Guacamole failure state.
- Preserve persistent Leave behavior: end the gateway session, clear cached session data and frame state, navigate away, and never deallocate.

## Validation
- Check the session page at desktop size for a covered connecting state and no exposed Guacamole chrome.
- Run the existing type checks and focused tests without publishing or changing soft-expiry behavior.

## Technical details
- Limit edits to `src/pages/LabSession.tsx` unless validation exposes a directly related defect.
- Reuse existing design tokens and Button components.
- Keep the retry cap local to each connection attempt and always call fresh `create-session` after clearing the Guacamole idempotency key.
