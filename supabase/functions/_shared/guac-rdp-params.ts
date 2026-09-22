/**
 * Guacamole connection parameters for Windows RDP labs.
 * SSH sessions must not receive these — NLA and ignore-cert are RDP-only.
 *
 * Win2022 requires NLA. security=any lets FreeRDP offer a mode the server
 * refuses. Dial NLA explicitly and accept the AMI's self-signed cert.
 * This does not create the Windows user; that is first-boot user-data.
 * A wrong or missing local password still returns ERRCONNECT_LOGON_FAILURE.
 */
export function rdpGuacSecurityParameters(): Record<string, string> {
  return {
    "ignore-cert": "true",
    security: "nla",
  };
}

/** Fill RDP security defaults without overriding an explicit value. */
export function applyRdpGuacSecurityDefaults(parameters: Record<string, string>): void {
  for (const [key, value] of Object.entries(rdpGuacSecurityParameters())) {
    if (parameters[key] === undefined) parameters[key] = value;
  }
}
