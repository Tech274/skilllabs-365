import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  exchangeSkillTrackToken,
  readSsoTokenFromHash,
  rememberEmailForLogin,
  type SsoSupabase,
} from "@/lib/skilltrack-sso";

/**
 * ST-54 landing page for SkillTrack single sign-on (/sso/skilltrack#token=…).
 * On success the session is stored by supabase-js and we hand off to "/",
 * where RoleProtectedRoute sends the user to their dashboard.
 */
export default function SkillTrackSso() {
  const navigate = useNavigate();
  const started = useRef(false);
  const { session } = useAuth();
  const [signedIn, setSignedIn] = useState(false);
  const [message, setMessage] = useState("Signing you in from SkillTrack…");

  useEffect(() => {
    if (started.current) return; // StrictMode double-effect: exchange once only
    started.current = true;

    const token = readSsoTokenFromHash(window.location.hash);
    // Strip the token from the address bar and history before any network call.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    void exchangeSkillTrackToken(supabase as unknown as SsoSupabase, token).then((out) => {
      if (out.ok) {
        setSignedIn(true);
        return;
      }
      setMessage("Couldn't sign you in automatically. Taking you to sign in…");
      rememberEmailForLogin(out.email);
      navigate(out.error === "no_account" ? "/signup" : "/login", { replace: true });
    });
  }, [navigate]);

  // Wait for AuthProvider to see the new session so "/" doesn't bounce to /login.
  useEffect(() => {
    if (signedIn && session) navigate("/", { replace: true });
  }, [signedIn, session, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      <p className="text-sm text-muted-foreground" role="status">{message}</p>
    </div>
  );
}
