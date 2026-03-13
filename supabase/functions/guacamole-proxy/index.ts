import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface GuacConnection {
  name: string;
  protocol: string;
  hostname: string;
  port: string;
  username?: string;
  password?: string;
  parameters?: Record<string, string>;
}

/** Normalize and build Guacamole base URL candidates */
function buildGuacBaseCandidates(rawUrl: string): string[] {
  const withoutHash = rawUrl.split("#")[0] || "";
  const withoutQuery = withoutHash.split("?")[0] || "";
  let normalized = withoutQuery.trim().replace(/\/+$/, "");

  // If user provided an /api URL, strip it because API paths are appended below
  if (normalized.endsWith("/api")) {
    normalized = normalized.slice(0, -4);
  }

  const guacamoleSuffix = "/guacamole";
  const candidates = [normalized];

  if (normalized.endsWith(guacamoleSuffix)) {
    candidates.push(normalized.slice(0, -guacamoleSuffix.length));
  } else {
    candidates.push(`${normalized}${guacamoleSuffix}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

/** Authenticate with Guacamole and get an auth token + resolved base URL */
async function getGuacToken(
  guacUrl: string,
  username: string,
  password: string
): Promise<{ token: string; baseUrl: string }> {
  const candidates = buildGuacBaseCandidates(guacUrl);

  for (const baseUrl of candidates) {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });

    if (res.status === 404) {
      await res.text(); // consume body before trying next candidate
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Guacamole auth failed [${res.status}]: ${body}`);
    }

    const data = await res.json();
    if (!data?.authToken) {
      throw new Error("Guacamole auth response missing authToken");
    }

    return { token: data.authToken, baseUrl };
  }

  throw new Error(
    `Guacamole API not found. Tried base URLs: ${candidates.join(", ")}. Check GUACAMOLE_URL secret.`
  );
}

/** Create a connection in Guacamole and return the connection ID */
async function createGuacConnection(
  guacBaseUrl: string,
  token: string,
  dataSource: string,
  conn: GuacConnection
): Promise<string> {
  const payload: Record<string, unknown> = {
    parentIdentifier: "ROOT",
    name: conn.name,
    protocol: conn.protocol.toLowerCase(),
    parameters: {
      hostname: conn.hostname,
      port: conn.port,
      "ignore-cert": "true",
      security: "any",
      ...(conn.username && { username: conn.username }),
      ...(conn.password && { password: conn.password }),
      ...(conn.parameters || {}),
    },
    attributes: {
      "max-connections": "2",
      "max-connections-per-user": "1",
    },
  };

  const res = await fetch(
    `${guacBaseUrl}/api/session/data/${dataSource}/connections?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Guacamole connection [${res.status}]: ${body}`);
  }

  const result = await res.json();
  return result.identifier;
}

/** Delete a connection in Guacamole */
async function deleteGuacConnection(
  guacBaseUrl: string,
  token: string,
  dataSource: string,
  connectionId: string
): Promise<void> {
  const res = await fetch(
    `${guacBaseUrl}/api/session/data/${dataSource}/connections/${connectionId}?token=${token}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to delete connection ${connectionId}: ${body}`);
  }
}

/** Get available data sources */
async function getDataSource(guacBaseUrl: string, token: string): Promise<string> {
  const listRes = await fetch(`${guacBaseUrl}/api/session/data?token=${token}`);

  if (listRes.ok) {
    const rawSources = await listRes.json();
    const sources: string[] = Array.isArray(rawSources)
      ? rawSources
      : Object.keys(rawSources || {});

    return sources.find((s) => s === "postgresql") || sources[0] || "postgresql";
  }

  const listBody = await listRes.text();
  if (listRes.status !== 404) {
    throw new Error(`Failed to get data sources [${listRes.status}]: ${listBody}`);
  }

  // Fallback for deployments where /api/session/data is not exposed
  const fallbackSources = ["postgresql", "mysql", "postgresql-shared"];

  for (const source of fallbackSources) {
    const checkRes = await fetch(
      `${guacBaseUrl}/api/session/data/${source}/connections?token=${token}`
    );
    await checkRes.text(); // consume body

    if (checkRes.status !== 404) {
      return source;
    }
  }

  throw new Error(
    `Failed to get data sources [404] at base URL ${guacBaseUrl}. Check GUACAMOLE_URL path and reverse-proxy routing. Original response: ${listBody}`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GUACAMOLE_URL = Deno.env.get("GUACAMOLE_URL");
    const GUACAMOLE_ADMIN_USERNAME = Deno.env.get("GUACAMOLE_ADMIN_USERNAME");
    const GUACAMOLE_ADMIN_PASSWORD = Deno.env.get("GUACAMOLE_ADMIN_PASSWORD");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GUACAMOLE_URL) throw new Error("GUACAMOLE_URL is not configured");
    if (!GUACAMOLE_ADMIN_USERNAME) throw new Error("GUACAMOLE_ADMIN_USERNAME is not configured");
    if (!GUACAMOLE_ADMIN_PASSWORD) throw new Error("GUACAMOLE_ADMIN_PASSWORD is not configured");
    if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

    // Validate JWT from request
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const jwtToken = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwtToken);
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { action } = body;

    // 1. Authenticate with Guacamole
    const { token, baseUrl: guacBaseUrl } = await getGuacToken(
      GUACAMOLE_URL,
      GUACAMOLE_ADMIN_USERNAME,
      GUACAMOLE_ADMIN_PASSWORD
    );
    const dataSource = await getDataSource(guacBaseUrl, token);

    if (action === "create-session") {
      // Create a dynamic Guacamole connection for a VM
      const { vm_id } = body;
      if (!vm_id) throw new Error("vm_id is required");

      // Fetch VM details from database
      const { data: vm, error: vmError } = await supabase
        .from("virtual_machines")
        .select("*, lab_templates(name, protocol, clipboard_enabled, file_transfer_enabled)")
        .eq("id", vm_id)
        .maybeSingle();

      if (vmError || !vm) throw new Error(`VM not found: ${vmError?.message || vm_id}`);
      if (!vm.private_ip) throw new Error("VM has no private IP assigned");

      const labTemplate = Array.isArray(vm.lab_templates) ? vm.lab_templates[0] : vm.lab_templates;
      const protocol = labTemplate?.protocol?.toUpperCase() === "SSH" ? "ssh" : "rdp";
      const port = protocol === "ssh" ? "22" : "3389";

      const connParams: Record<string, string> = {};
      if (protocol === "rdp") {
        connParams["enable-wallpaper"] = "false";
        connParams["enable-theming"] = "false";
        connParams["enable-font-smoothing"] = "true";
        connParams["create-drive-path"] = "/tmp/guac-drive";
        if (labTemplate?.clipboard_enabled) {
          connParams["disable-copy"] = "false";
          connParams["disable-paste"] = "false";
        } else {
          connParams["disable-copy"] = "true";
          connParams["disable-paste"] = "true";
        }
        if (labTemplate?.file_transfer_enabled) {
          connParams["enable-drive"] = "true";
        }
      }

      const connectionName = `session-${vm_id}-${Date.now()}`;
      const connectionId = await createGuacConnection(guacBaseUrl, token, dataSource, {
        name: connectionName,
        protocol,
        hostname: vm.private_ip,
        port,
        parameters: connParams,
      });

      // Build the iframe URL with client token
      // Guacamole client URL format: /#/client/{base64(connectionId + \0 + c + \0 + dataSource)}
      const clientId = btoa(`${connectionId}\0c\0${dataSource}`);
      const iframeUrl = `${guacBaseUrl}/#/client/${encodeURIComponent(clientId)}?token=${token}`;

      // Create session record in database
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id,
          vm_id: vm.id,
          region: vm.region,
          status: "active",
          connection_quality: "good",
          lab_template_id: vm.lab_template_id,
        })
        .select()
        .single();

      if (sessionError) {
        // Clean up Guacamole connection on failure
        await deleteGuacConnection(guacBaseUrl, token, dataSource, connectionId);
        throw new Error(`Failed to create session record: ${sessionError.message}`);
      }

      // Update VM status to running
      await supabase
        .from("virtual_machines")
        .update({ status: "running" })
        .eq("id", vm_id);

      return new Response(
        JSON.stringify({
          session_id: session.id,
          iframe_url: iframeUrl,
          connection_id: connectionId,
          guac_token: token,
          protocol: protocol.toUpperCase(),
          vm_ip: vm.private_ip,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "end-session") {
      const { session_id, connection_id } = body;
      if (!session_id) throw new Error("session_id is required");

      // End the session in DB
      await supabase
        .from("sessions")
        .update({
          ended_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", session_id);

      // Delete Guacamole connection if provided
      if (connection_id) {
        await deleteGuacConnection(guacBaseUrl, token, dataSource, connection_id);
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: unknown) {
    console.error("guacamole-proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
