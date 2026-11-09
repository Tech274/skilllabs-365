import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import {
  captureHandoffFromLocation,
  logHandoffEvent,
  readStoredHandoff,
  shouldLogHandoff,
} from "@/lib/skilltrack-handoff";
import { supabase } from "@/integrations/supabase/client";
import { SSO_PATH } from "@/lib/skilltrack-sso";

/**
 * Captures ?handoff=&email=&sku=&cert= on first paint, stores in sessionStorage,
 * and soft-logs. Anonymous visitors with a SkillTrack handoff are sent to /login
 * (params already persisted).
 */
export function SkillTrackHandoffCapture() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading, role } = useAuth();

  useEffect(() => {
    // The SSO landing page owns its own flow (and its URL fragment).
    if (location.pathname === SSO_PATH) return;
    const captured = captureHandoffFromLocation(location.search);
    const stored = captured || readStoredHandoff();
    if (!stored) return;

    if (loading) return;

    const userId = session?.user?.id ?? null;
    if (shouldLogHandoff(stored.capturedAt, userId)) {
      void logHandoffEvent(supabase, { ...stored, user_id: userId });
    }

    // Strip query from URL after capture so refreshes stay clean (storage keeps context).
    if (location.search && stored.handoff) {
      navigate({ pathname: location.pathname, search: "" }, { replace: true });
    }

    if (!session && stored.handoff === "skilltrack" && location.pathname === "/") {
      navigate("/login", { replace: true });
      return;
    }

    if (session && stored.handoff === "skilltrack" && location.pathname === "/") {
      const dest = role === "admin" ? "/" : role === "instructor" ? "/instructor" : "/student";
      if (dest !== "/") navigate(dest, { replace: true });
    }
  }, [location.search, location.pathname, session, loading, role, navigate]);

  return null;
}

export default SkillTrackHandoffCapture;
