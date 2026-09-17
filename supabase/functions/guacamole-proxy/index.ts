import { corsHeadersFor } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { correlationHeaders, correlationIdFrom, ProvisioningTimeline } from "../_shared/provisioning-audit.ts";
import { claimIdempotency, completeIdempotency, idempotencyKeyFrom, releaseIdempotency } from "../_shared/idempotency.ts";
import { resolveAzureRuntime } from "../_shared/cloud-providers/azure-runtime.ts";
import { resolveAwsRuntime } from "../_shared/cloud-providers/aws-runtime.ts";
import {
  buildPublicIframeUrl,
  normalizeGuacCloudProvider,
  resolveGuacAdminEndpoint,
  type GuacCloudProvider,
} from "../_shared/guac-hosts.ts";

const SOURCE = "guacamole-proxy";

/** Protocol configured on the VM's lab template ("ssh" or "rdp"). */
// deno-lint-ignore no-explicit-any
function labTemplateProtocol(vm: any): "ssh" | "rdp" {
  const tpl = Array.isArray(vm?.lab_templates) ? vm.lab_templates[0] : vm?.lab_templates;
  return String(tpl?.protocol ?? "").toUpperCase() === "SSH" ? "ssh" : "rdp";
}



interface GuacConnection {
  name: string;
  protocol: string;
  hostname: string;
  port: string;
  username?: string;
  password?: string;
  parameters?: Record<string, string>;
}


/** Resolve aws|azure for a VM via provider account, else lab template provider. */
// deno-lint-ignore no-explicit-any
async function resolveVmCloudProvider(supabase: any, vm: any): Promise<GuacCloudProvider> {
  if (vm?.provider_account_id) {
    const { data: acct } = await supabase
      .from("cloud_provider_accounts")
      .select("provider")
      .eq("id", vm.provider_account_id)
      .maybeSingle();
    if (acct?.provider) return normalizeGuacCloudProvider(acct.provider);
  }
  const tpl = Array.isArray(vm?.lab_templates) ? vm.lab_templates[0] : vm?.lab_templates;
  if (tpl?.provider) return normalizeGuacCloudProvider(tpl.provider);
  return "aws";
}

function buildGuacBaseCandidates(rawUrl: string): string[] {
  const withoutHash = rawUrl.split("#")[0] || "";
  const withoutQuery = withoutHash.split("?")[0] || "";
  let normalized = withoutQuery.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/api")) normalized = normalized.slice(0, -4);
  const guacamoleSuffix = "/guacamole";
  const candidates = [normalized];
  if (normalized.endsWith(guacamoleSuffix)) candidates.push(normalized.slice(0, -guacamoleSuffix.length));
  else candidates.push(`${normalized}${guacamoleSuffix}`);
  return [...new Set(candidates.filter(Boolean))];
}

async function getGuacToken(guacUrl: string, username: string, password: string): Promise<{ token: string; baseUrl: string }> {
  const candidates = buildGuacBaseCandidates(guacUrl);
  for (const baseUrl of candidates) {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
    if (res.status === 404) { await res.text(); continue; }
    if (!res.ok) throw new Error(`Guacamole auth failed [${res.status}]: ${await res.text()}`);
    const data = await res.json();
    if (!data?.authToken) throw new Error("Guacamole auth response missing authToken");
    return { token: data.authToken, baseUrl };
  }
  throw new Error(`Guacamole API not found. Tried: ${candidates.join(", ")}.`);
}

async function deleteGuacToken(guacBaseUrl: string, token: string): Promise<void> {
  try {
    await fetch(`${guacBaseUrl}/api/tokens/${token}`, { method: "DELETE" });
  } catch (e) { console.warn("Failed to revoke admin guac token:", e); }
}

async function createGuacConnection(guacBaseUrl: string, token: string, dataSource: string, conn: GuacConnection): Promise<string> {
  const protocol = conn.protocol.toLowerCase();
  const parameters: Record<string, string> = {
    hostname: conn.hostname,
    port: conn.port,
    ...(conn.username ? { username: conn.username } : {}),
    ...(conn.password ? { password: conn.password } : {}),
    ...(conn.parameters || {}),
  };
  // RDP-only defaults — never apply security/ignore-cert to SSH connections.
  if (protocol === "rdp") {
    if (parameters["ignore-cert"] === undefined) parameters["ignore-cert"] = "true";
    if (parameters["security"] === undefined) parameters["security"] = "any";
  }
  const payload: Record<string, unknown> = {
    parentIdentifier: "ROOT",
    name: conn.name,
    protocol,
    parameters,
    attributes: { "max-connections": "2", "max-connections-per-user": "1" },
  };
  const res = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/connections?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to create Guacamole connection [${res.status}]: ${await res.text()}`);
  return (await res.json()).identifier;
}

async function deleteGuacConnection(guacBaseUrl: string, token: string, dataSource: string, connectionId: string): Promise<void> {
  const res = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/connections/${connectionId}?token=${token}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) console.error(`Failed to delete connection ${connectionId}: ${await res.text()}`);
}

async function createScopedGuacUser(
  guacBaseUrl: string, adminToken: string, dataSource: string,
  username: string, password: string, connectionId: string
): Promise<void> {
  // Create user
  const userRes = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/users?token=${adminToken}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, attributes: { disabled: "", expired: "", "valid-from": "", "valid-until": "", "access-window-start": "", "access-window-end": "", "timezone": null } }),
  });
  if (!userRes.ok) throw new Error(`Failed to create scoped guac user [${userRes.status}]: ${await userRes.text()}`);

  // Grant READ permission on the connection
  const permRes = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/users/${encodeURIComponent(username)}/permissions?token=${adminToken}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ op: "add", path: `/connectionPermissions/${connectionId}`, value: "READ" }]),
  });
  if (!permRes.ok) throw new Error(`Failed to grant connection permission [${permRes.status}]: ${await permRes.text()}`);
}

async function deleteScopedGuacUser(guacBaseUrl: string, adminToken: string, dataSource: string, username: string): Promise<void> {
  const res = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/users/${encodeURIComponent(username)}?token=${adminToken}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) console.error(`Failed to delete user ${username}: ${await res.text()}`);
}

async function getDataSource(guacBaseUrl: string, token: string): Promise<string> {
  const listRes = await fetch(`${guacBaseUrl}/api/session/data?token=${token}`);
  if (listRes.ok) {
    const raw = await listRes.json();
    const sources: string[] = Array.isArray(raw) ? raw : Object.keys(raw || {});
    return sources.find((s) => s === "postgresql") || sources[0] || "postgresql";
  }
  await listRes.text();
  if (listRes.status !== 404) throw new Error(`Failed to get data sources [${listRes.status}]`);
  for (const source of ["postgresql", "mysql", "postgresql-shared"]) {
    const check = await fetch(`${guacBaseUrl}/api/session/data/${source}/connections?token=${token}`);
    await check.text();
    if (check.status !== 404) return source;
  }
  throw new Error(`Failed to resolve Guacamole data source at ${guacBaseUrl}`);
}

function randomSuffix(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
}


/** Record a Guacamole session lifecycle event (start/reconnect/idle/stop). */
// deno-lint-ignore no-explicit-any -- untyped service client in the edge runtime
async function logSessionEvent(supabase: any, sessionId: string, eventType: string, data: Record<string, unknown> = {}) {
  try {
    await supabase.from("session_events").insert({
      session_id: sessionId,
      event_type: eventType,
      event_data: data,
    });
  } catch (e) {
    console.error("session event log failed:", e instanceof Error ? e.message : e);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let guacBaseUrl = "";
  let adminToken = "";
  let guacAdminUrl = "";
  let guacPublicBase = "";
  let cloudProvider: GuacCloudProvider = "aws";

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required server configuration");
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const jwtToken = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwtToken);
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { action } = body;
    const correlationId = correlationIdFrom(req);
    const traceHeaders = { ...corsHeaders, ...correlationHeaders(correlationId), "Content-Type": "application/json" };
    const timeline = new ProvisioningTimeline(supabase, { correlationId, userId: user.id });
    let pendingClaim: { key: string; action: string } | null = null;

    try {

    const isAdmin = async () => {
      const { data } = await supabase.rpc("is_platform_admin", { _user_id: user.id });
      return !!data;
    };

    /** Authenticate to the Guac admin API for this cloud (aws vs azure). */
    const bindGuacForProvider = async (provider: GuacCloudProvider) => {
      cloudProvider = provider;
      const endpoint = resolveGuacAdminEndpoint(provider);
      if (!endpoint.adminUrl || !endpoint.adminUsername || !endpoint.adminPassword) {
        throw new Error(
          provider === "azure"
            ? "Missing Guacamole Azure admin configuration (set GUACAMOLE_AZURE_URL + ADMIN_* or legacy GUACAMOLE_*)"
            : "Missing Guacamole admin configuration (GUACAMOLE_URL + GUACAMOLE_ADMIN_*)",
        );
      }
      guacAdminUrl = endpoint.adminUrl;
      guacPublicBase = endpoint.publicBase;
      const auth = await getGuacToken(endpoint.adminUrl, endpoint.adminUsername, endpoint.adminPassword);
      adminToken = auth.token;
      guacBaseUrl = auth.baseUrl;
      if (!guacBaseUrl || !adminToken || !guacPublicBase) {
        throw new Error("Guacamole admin bind incomplete");
      }
      return await getDataSource(guacBaseUrl, adminToken);
    };

    if (action === "create-session") {
      const { vm_id } = body;
      if (!vm_id) throw new Error("vm_id is required");

      timeline.attach({ vmId: vm_id });
      await timeline.start(SOURCE, "guacamole-connect", "Preparing remote desktop connection");

      const { data: vm, error: vmError } = await supabase
        .from("virtual_machines")
        .select("*, lab_templates(name, protocol, provider, clipboard_enabled, file_transfer_enabled)")
        .eq("id", vm_id).maybeSingle();
      if (vmError || !vm) throw new Error(`VM not found: ${vmError?.message || vm_id}`);
      if (!vm.private_ip) throw new Error("VM has no private IP assigned");

      if (vm.user_id !== user.id && !(await isAdmin())) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      timeline.attach({ labTemplateId: vm.lab_template_id });

      const vmCloud = await resolveVmCloudProvider(supabase, vm);
      const dataSource = await bindGuacForProvider(vmCloud);

      // Idempotency: a second click must reuse the live session instead of
      // creating another Guacamole connection + scoped user for the same VM.
      const sessionKey = idempotencyKeyFrom(req, { ...body, idempotency_key: body.idempotency_key ?? `guac-session:${vm_id}` });
      const claim = await claimIdempotency(supabase, {
        key: sessionKey,
        userId: user.id,
        action: "guac-create-session",
        correlationId,
      });
      pendingClaim = { key: sessionKey, action: "guac-create-session" };
      if (claim.outcome === "replay") {
        pendingClaim = null;
        await timeline.skipped(SOURCE, "guacamole-connect", "Duplicate connect request replayed", { key: sessionKey });
        return new Response(JSON.stringify({ ...claim.response, idempotent_replay: true }), {
          status: 200, headers: traceHeaders,
        });
      }
      if (claim.outcome === "in_progress") {
        pendingClaim = null;
        await timeline.skipped(SOURCE, "guacamole-connect", "Duplicate connect request ignored — one is already running", { key: sessionKey });
        return new Response(
          JSON.stringify({ error: "A connection request for this lab is already in progress.", idempotent_replay: true }),
          { status: 409, headers: traceHeaders },
        );
      }

      // Key-independent guard: reuse any active session for this VM.
      const { data: liveSession } = await supabase
        .from("sessions")
        .select("id, guac_connection_id, guac_username")
        .eq("vm_id", vm_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (liveSession?.guac_connection_id && liveSession.guac_username) {
        const rotated = randomSuffix(32);
        const pwRes = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/users/${encodeURIComponent(liveSession.guac_username)}/password?token=${adminToken}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword: rotated, oldPassword: "" }),
        });
        if (pwRes.ok) {
          const scoped = await getGuacToken(guacAdminUrl!, liveSession.guac_username, rotated);
          const reusedClientId = btoa(`${liveSession.guac_connection_id}\0c\0${dataSource}`);
          const reused = {
            session_id: liveSession.id,
            iframe_url: buildPublicIframeUrl(guacBaseUrl, guacPublicBase, reusedClientId, scoped.token),
            protocol: (labTemplateProtocol(vm) === "ssh" ? "SSH" : "RDP"),
            vm_ip: vm.private_ip,
            region: vm.region ?? null,
            cloud_provider: cloudProvider,
            reused_existing: true,
            correlation_id: correlationId,
          };
          timeline.attach({ sessionId: liveSession.id });
          await timeline.skipped(SOURCE, "guacamole-connect", "Reconnected to the existing session instead of creating a duplicate", {
            session_id: liveSession.id,
          });
          
          const { data: prev } = await supabase
            .from("sessions").select("reconnects").eq("id", liveSession.id).maybeSingle();
          await supabase.from("sessions")
            .update({ reconnects: (prev?.reconnects ?? 0) + 1, last_activity_at: new Date().toISOString() })
            .eq("id", liveSession.id);
          await logSessionEvent(supabase, liveSession.id, "reconnect", {
            reason: "duplicate_connect", vm_id, correlation_id: correlationId,
          });
          await completeIdempotency(supabase, { key: sessionKey, userId: user.id, action: "guac-create-session", response: reused });
          pendingClaim = null;
          return new Response(JSON.stringify(reused), { status: 200, headers: traceHeaders });
        }
        // Reuse failed (stale Guac user, etc.) — tear down before minting a replacement.
        const failTxt = await pwRes.text().catch(() => "");
        console.warn(`live session reuse password-rotate failed [${pwRes.status}]: ${failTxt.slice(0, 200)}`);
        await deleteScopedGuacUser(guacBaseUrl, adminToken, dataSource, liveSession.guac_username);
        await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, liveSession.guac_connection_id);
        await supabase.from("sessions").update({
          ended_at: new Date().toISOString(),
          status: "completed",
          disconnect_reason: "reuse_failed_superseded",
        }).eq("id", liveSession.id);
        await logSessionEvent(supabase, liveSession.id, "session_end", {
          reason: "reuse_failed_superseded", correlation_id: correlationId, http_status: pwRes.status,
        });
      }

      // Fail-closed against orphan storms: supersede any other active Hub sessions for this VM.
      const { data: activeSiblings } = await supabase
        .from("sessions")
        .select("id, guac_connection_id, guac_username")
        .eq("vm_id", vm_id)
        .eq("user_id", user.id)
        .eq("status", "active");
      for (const sibling of activeSiblings ?? []) {
        if (sibling.guac_username) await deleteScopedGuacUser(guacBaseUrl, adminToken, dataSource, sibling.guac_username);
        if (sibling.guac_connection_id) await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, sibling.guac_connection_id);
        await supabase.from("sessions").update({
          ended_at: new Date().toISOString(),
          status: "completed",
          disconnect_reason: "superseded_by_new_connect",
        }).eq("id", sibling.id);
        await logSessionEvent(supabase, sibling.id, "session_end", {
          reason: "superseded_by_new_connect", correlation_id: correlationId,
        });
      }

      const labTemplate = Array.isArray(vm.lab_templates) ? vm.lab_templates[0] : vm.lab_templates;
      const protocol = labTemplate?.protocol?.toUpperCase() === "SSH" ? "ssh" : "rdp";
      const port = protocol === "ssh" ? "22" : "3389";

      const connParams: Record<string, string> = {};
      if (protocol === "rdp") {
        connParams["width"] = "1920";
        connParams["height"] = "1080";
        connParams["dpi"] = "96";
        connParams["resize-method"] = "display-update";
        connParams["enable-wallpaper"] = "false";
        connParams["enable-theming"] = "false";
        connParams["enable-font-smoothing"] = "true";
        connParams["create-drive-path"] = "/tmp/guac-drive";
        const clipOn = !!labTemplate?.clipboard_enabled;
        connParams["disable-copy"] = clipOn ? "false" : "true";
        connParams["disable-paste"] = clipOn ? "false" : "true";
        if (labTemplate?.file_transfer_enabled) connParams["enable-drive"] = "true";
      } else {
        // SSH defaults (password auth — no passphrase/private-key). Optional SFTP from template.
        connParams["font-name"] = "monospace";
        connParams["font-size"] = "12";
        connParams["color-scheme"] = "gray-black";
        connParams["terminal-type"] = "xterm-256color";
        connParams["server-alive-interval"] = "30";
        const clipOn = !!labTemplate?.clipboard_enabled;
        connParams["disable-copy"] = clipOn ? "false" : "true";
        connParams["disable-paste"] = clipOn ? "false" : "true";
        if (labTemplate?.file_transfer_enabled) connParams["enable-sftp"] = "true";
      }

      // VM sign-in credentials belong to the Resource Provider account that created the VM.
      let VM_ADMIN_USERNAME: string;
      let VM_ADMIN_PASSWORD: string;
      if (vmCloud === "aws") {
        const aws = await resolveAwsRuntime(supabase, vm.provider_account_id ?? null);
        VM_ADMIN_USERNAME = aws.adminUsername;
        VM_ADMIN_PASSWORD = aws.adminPassword;
      } else {
        const azure = await resolveAzureRuntime(supabase, vm.provider_account_id ?? null);
        VM_ADMIN_USERNAME = azure.adminUsername;
        VM_ADMIN_PASSWORD = azure.adminPassword;
      }

      const connectionName = `session-${vm_id}-${Date.now()}`;
      const connectionId = await createGuacConnection(guacBaseUrl, adminToken, dataSource, {
        name: connectionName, protocol, hostname: vm.private_ip, port,
        username: VM_ADMIN_USERNAME, password: VM_ADMIN_PASSWORD, parameters: connParams,
      });

      // Create a scoped, per-session Guacamole user so the admin token never leaves the server
      const scopedUsername = `s-${user.id.slice(0, 8)}-${randomSuffix(10)}`;
      const scopedPassword = randomSuffix(32);
      try {
        await createScopedGuacUser(guacBaseUrl, adminToken, dataSource, scopedUsername, scopedPassword, connectionId);
      } catch (e) {
        await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, connectionId);
        throw e;
      }

      // Get a scoped token by logging in as the scoped user
      let scopedToken: string;
      try {
        const scopedAuth = await getGuacToken(guacAdminUrl!, scopedUsername, scopedPassword);
        scopedToken = scopedAuth.token;
      } catch (e) {
        await deleteScopedGuacUser(guacBaseUrl, adminToken, dataSource, scopedUsername);
        await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, connectionId);
        throw e;
      }

      const clientId = btoa(`${connectionId}\0c\0${dataSource}`);
      const iframeUrl = buildPublicIframeUrl(guacBaseUrl, guacPublicBase, clientId, scopedToken);

      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id, vm_id: vm.id, region: vm.region,
          status: "active", connection_quality: "good",
          lab_template_id: vm.lab_template_id,
          guac_connection_id: connectionId,
          guac_username: scopedUsername,
        }).select().single();

      if (sessionError) {
        await deleteScopedGuacUser(guacBaseUrl, adminToken, dataSource, scopedUsername);
        await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, connectionId);
        throw new Error(`Failed to create session record: ${sessionError.message}`);
      }

      await supabase.from("virtual_machines").update({ status: "running" }).eq("id", vm_id);
      await logSessionEvent(supabase, session.id, "session_start", {
        protocol: protocol.toUpperCase(), vm_id, region: vm.region, correlation_id: correlationId,
      });

      const created = {
        session_id: session.id,
        iframe_url: iframeUrl,
        protocol: protocol.toUpperCase(),
        vm_ip: vm.private_ip,
        region: vm.region ?? null,
        cloud_provider: cloudProvider,
        correlation_id: correlationId,
      };
      timeline.attach({ sessionId: session.id });
      await timeline.success(SOURCE, "guacamole-connect", "Remote desktop connection ready", { protocol: protocol.toUpperCase() });
      await completeIdempotency(supabase, { key: sessionKey, userId: user.id, action: "guac-create-session", response: created });
      pendingClaim = null;

      return new Response(JSON.stringify(created), { status: 200, headers: traceHeaders });
    }

    if (action === "reconnect") {
      const { session_id } = body;
      if (!session_id) throw new Error("session_id is required");

      const { data: sess } = await supabase
        .from("sessions")
        .select("user_id, status, guac_connection_id, guac_username, region, vm_id")
        .eq("id", session_id).maybeSingle();
      if (!sess) throw new Error("Session not found");
      if (sess.status !== "active") throw new Error("Session is no longer active");
      if (sess.user_id !== user.id && !(await isAdmin())) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!sess.guac_connection_id || !sess.guac_username) {
        throw new Error("Session has no Guacamole connection metadata");
      }

      let reconnectProvider: GuacCloudProvider = "aws";
      if (sess.vm_id) {
        const { data: reconnectVm } = await supabase
          .from("virtual_machines")
          .select("provider_account_id, lab_templates(provider)")
          .eq("id", sess.vm_id).maybeSingle();
        if (reconnectVm) reconnectProvider = await resolveVmCloudProvider(supabase, reconnectVm);
      }
      const dataSource = await bindGuacForProvider(reconnectProvider);

      // Rotate password and issue a fresh scoped token
      const newPassword = randomSuffix(32);
      const updRes = await fetch(`${guacBaseUrl}/api/session/data/${dataSource}/users/${encodeURIComponent(sess.guac_username)}/password?token=${adminToken}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, oldPassword: "" }),
      });
      if (!updRes.ok) {
        const txt = await updRes.text();
        throw new Error(`Failed to rotate scoped user password [${updRes.status}]: ${txt}`);
      }
      const scoped = await getGuacToken(guacAdminUrl!, sess.guac_username, newPassword);
      const clientId = btoa(`${sess.guac_connection_id}\0c\0${dataSource}`);
      const iframeUrl = buildPublicIframeUrl(guacBaseUrl, guacPublicBase, clientId, scoped.token);
      const { data: prevSess } = await supabase
        .from("sessions").select("reconnects").eq("id", session_id).maybeSingle();
      await supabase.from("sessions")
        .update({ reconnects: (prevSess?.reconnects ?? 0) + 1, last_activity_at: new Date().toISOString() })
        .eq("id", session_id);
      await logSessionEvent(supabase, session_id, "reconnect", {
        reason: String(body.reason ?? "user_reconnect"), correlation_id: correlationId,
      });

      return new Response(JSON.stringify({
        session_id, iframe_url: iframeUrl, region: sess.region ?? null, vm_id: sess.vm_id ?? null,
        cloud_provider: cloudProvider,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "end-session") {
      await timeline.start(SOURCE, "session-end", "Ending session and cleaning up gateway resources");
      const { session_id } = body;
      if (!session_id) throw new Error("session_id is required");

      const { data: sess } = await supabase
        .from("sessions")
        .select("user_id, guac_connection_id, guac_username, vm_id")
        .eq("id", session_id).maybeSingle();
      if (!sess) throw new Error("Session not found");
      if (sess.user_id !== user.id && !(await isAdmin())) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let endProvider: GuacCloudProvider = "aws";
      if (sess.vm_id) {
        const { data: endVm } = await supabase
          .from("virtual_machines")
          .select("provider_account_id, lab_templates(provider)")
          .eq("id", sess.vm_id).maybeSingle();
        if (endVm) endProvider = await resolveVmCloudProvider(supabase, endVm);
      }
      const dataSource = await bindGuacForProvider(endProvider);

      const disconnectReason = String(body.reason ?? "user_ended").slice(0, 120);
      await supabase.from("sessions")
        .update({ ended_at: new Date().toISOString(), status: "completed", disconnect_reason: disconnectReason })
        .eq("id", session_id);
      await logSessionEvent(supabase, session_id, "session_end", {
        reason: disconnectReason, correlation_id: correlationId,
      });

      if (sess.guac_username) await deleteScopedGuacUser(guacBaseUrl, adminToken, dataSource, sess.guac_username);
      if (sess.guac_connection_id) await deleteGuacConnection(guacBaseUrl, adminToken, dataSource, sess.guac_connection_id);

      timeline.attach({ sessionId: session_id });
      await timeline.success(SOURCE, "session-end", "Session ended, Guacamole user and connection removed");

      return new Response(JSON.stringify({ success: true, correlation_id: correlationId }), {
        status: 200, headers: traceHeaders,
      });
    }

    throw new Error(`Unknown action: ${action}`);
    } catch (inner) {
      // A failed attempt must never block the user's retry.
      if (pendingClaim) {
        await releaseIdempotency(supabase, { key: pendingClaim.key, userId: user.id, action: pendingClaim.action });
      }
      await timeline.failed(SOURCE, action === "end-session" ? "session-end" : "guacamole-connect",
        inner instanceof Error ? inner.message : "Guacamole request failed");
      throw inner;
    }
  } catch (error: unknown) {
    console.error("guacamole-proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    // Always revoke the admin token after the request completes
    if (guacBaseUrl && adminToken) await deleteGuacToken(guacBaseUrl, adminToken);
  }
});
