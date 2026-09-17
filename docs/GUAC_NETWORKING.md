# Guacamole networking RCA (AWS Guac ↔ Azure labs)

Docs-only root-cause analysis and fix options for remote-desktop black canvas after public HTTPS iframe work (PR #11). **No implementation commitment** — operators choose between the options below.

---

## 1. Current topology (verified)

```
Learner browser
    │  HTTPS iframe
    ▼
guac.skillhub365.co.in  →  3.6.228.159
    │  AWS EC2  ap-south-1 (Mumbai)
    │  Guacamole web + guacd
    │
    ✕  cannot reach Azure private IPs (no path)
    │
Azure lab VMs (e.g. 172.18.0.21)
    on vnet-centralus (and peer lab VNets)
```

| Component | Where it lives | Notes |
| --- | --- | --- |
| Public Guacamole gateway | AWS EC2 `3.6.228.159` (`guac.skillhub365.co.in`, ap-south-1 Mumbai) | Serves `/guacamole/` UI + tunnels |
| Lab VMs | Azure private IPs (example: `172.18.0.21` on `vnet-centralus`) | No public SSH/RDP required for Guac path |
| Hub `guacamole-proxy` | Supabase Edge | Sets Guacamole connection `hostname` = `vm.private_ip`; **cannot** TCP-probe those private IPs from the edge |

**Cross-cloud fact:** Azure VNet peering alone **cannot** give an AWS EC2 host a route into Azure private address space. Peering is Azure↔Azure only. While Guac stays on EC2, peering does not fix guacd↔lab connectivity.

---

## 2. Symptom (post PR #11)

| Observation | Meaning |
| --- | --- |
| HTTPS iframe loads OK | Public web path to Guacamole UI is fixed |
| Black canvas → “remote desktop closed” | Browser↔Guac OK; **guacd ↔ lab VM** fails (routing / reachability) |
| `GET /guacamole/websocket-tunnel` → **404** | WebSocket tunnel path missing or not proxied (secondary; HTTP tunnel may still work) |
| `HTTP /guacamole/tunnel` alive | Fallback tunnel endpoint present (bare probe may return 400 without query — expected) |

Primary failure mode for Lex Connect: **guacd on AWS cannot open TCP to the lab private IP:22 (SSH) or :3389 (RDP).**

Secondary: restore WebSocket tunnel proxying on the gateway for preferred transport; HTTP tunnel alone does not fix private-IP routing.

---

## 3. Verify steps (from Guac host)

Run **on the Guacamole EC2 host** (or from a shell that uses the same network path as guacd), not from a laptop or from Supabase Edge:

```bash
# Replace with the lab VM private_ip from Hub / virtual_machines.private_ip
LAB_IP=172.18.0.21

# SSH labs
nc -vz "$LAB_IP" 22

# RDP labs (if applicable)
nc -vz "$LAB_IP" 3389
```

**Pass:** `succeeded` / open within a few seconds.  
**Fail:** timeout / “No route to host” / connection refused from wrong network → confirms AWS Guac cannot reach Azure private IPs.

Also useful on the public gateway (from any HTTPS client):

```bash
# UI should be HTTPS 200
curl -sI https://guac.skillhub365.co.in/guacamole/ | head -5

# WebSocket path often 404 today (secondary)
curl -sI https://guac.skillhub365.co.in/guacamole/websocket-tunnel | head -5

# HTTP tunnel probe (400 without query string can still mean “alive”)
curl -sI https://guac.skillhub365.co.in/guacamole/tunnel | head -5
```

Hub edge **must not** be used as the reachability oracle: `guacamole-proxy` skips private-IP TCP prechecks by design.

---

## 4. Fix options (choose one — no default commitment)

Both options restore a path from **guacd** to lab **private IPs**. Present them to the operator; do not assume relocate or VPN until that choice is made.

### Option A — Relocate Guacamole (web + guacd) into Azure

Place Guacamole web and guacd in the **same Azure VNet as labs**, or in a VNet **peered** to the lab VNet(s).

Typical steps (outline only):

1. Deploy Guac stack (nginx/TLS + guacamole + guacd) on Azure (VM, Container Apps, or AKS) in/peered to lab VNet.
2. Confirm from that host: `nc -vz <lab-private-ip> 22` (and 3389 if needed).
3. Cut over DNS `guac.skillhub365.co.in` → new Azure public endpoint; renew/attach TLS cert.
4. Point Hub secret `GUACAMOLE_URL` at the new base URL; smoke Lex Connect.
5. Decommission or stop using the AWS EC2 Guac host once verified.

**Pros:** Native private routing; Azure peering *then* applies between Guac and labs.  
**Cons:** Cutover, cert/DNS work, temporary dual-run.

### Option B — AWS ↔ Azure site-to-site (S2S) VPN

Keep Guac on AWS EC2; build a routed VPN between the AWS VPC and the Azure lab VNet(s) so guacd can reach private lab IPs.

Typical steps (outline only):

1. Azure VPN Gateway on the lab VNet (or hub VNet peered to labs) + AWS Virtual Private Gateway / Transit Gateway.
2. Establish S2S tunnels; advertise Azure lab prefixes to AWS and AWS Guac subnet to Azure.
3. Security groups / NSGs: allow guacd → lab `:22` / `:3389` from Guac subnet only.
4. From Guac EC2: `nc -vz <lab-private-ip> 22` must succeed.
5. No DNS cutover required if `guac.skillhub365.co.in` stays on the same EC2; still fix WebSocket proxy if desired.

**Pros:** Keeps current public Guac host; no Guac relocate.  
**Cons:** Ongoing VPN cost/ops; cross-cloud latency; routing/NSG complexity.

### Do **not** recommend

- **Azure-only VNet peering while Guacamole remains on AWS EC2** — peering does not bridge AWS↔Azure. It will not unblock guacd↔lab private IP.

---

## 5. Unblock criteria for Lex Connect verify

Lex Connect (learner Guacamole session) may be treated as **unblocked** only when **all** of the following hold:

1. **Path:** From the host that runs **guacd**, `nc -vz <lab-private-ip> 22` (or `3389` for RDP) succeeds for a live lab VM.
2. **Topology choice:** Either Option A (Guac in/peered Azure VNet) **or** Option B (working AWS↔Azure S2S VPN) is implemented and verified — not Azure-only peering with Guac still on EC2.
3. **Hub session:** `guacamole-proxy` create-session returns a tokenized iframe URL; learner iframe loads over **HTTPS**.
4. **Desktop:** Canvas shows a live session (not immediate black canvas / “remote desktop closed”).
5. **Tunnels (secondary but preferred):** `/guacamole/websocket-tunnel` proxied with `Upgrade` / `Connection`, **or** documented reliance on HTTP `/guacamole/tunnel` with a successful live session.

Until (1)–(2) are true, Hub UI fail-closed reconnect behaviour (post PR #11) is expected: reminting tokens cannot fix missing L3/L4 reachability from guacd to the lab.

---

## Related runbook

See [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md) § Guacamole failures for day-2 ops (secrets, `clear-guacamole`, tunnel probes). This document owns the **cross-cloud networking** RCA and fix options.
