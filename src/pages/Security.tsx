import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, CheckCircle2, XCircle, FileText, Globe, Users, Lock, Eye } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const auditLogs = [
  { id: 1, timestamp: '2026-03-11 14:32:01', user: 'admin@cloudlab.io', action: 'VM Provisioned', resource: 'vm-041', severity: 'info' as const, region: 'East US' },
  { id: 2, timestamp: '2026-03-11 14:28:15', user: 'admin@cloudlab.io', action: 'Connection Created', resource: 'guac-conn-128', severity: 'info' as const, region: 'East US' },
  { id: 3, timestamp: '2026-03-11 14:25:44', user: 'eve.johnson@corp.com', action: 'Failed Login Attempt', resource: 'auth-service', severity: 'warning' as const, region: 'Central India' },
  { id: 4, timestamp: '2026-03-11 14:22:30', user: 'system', action: 'VM Auto-Stopped (Idle)', resource: 'vm-018', severity: 'info' as const, region: 'East US' },
  { id: 5, timestamp: '2026-03-11 14:18:02', user: 'system', action: 'WAF Rule Triggered', resource: 'appgw-eastus', severity: 'warning' as const, region: 'East US' },
  { id: 6, timestamp: '2026-03-11 14:15:11', user: 'admin@cloudlab.io', action: 'Role Assignment Changed', resource: 'user-005', severity: 'warning' as const, region: 'Global' },
  { id: 7, timestamp: '2026-03-11 14:10:55', user: 'system', action: 'Expired VM Deleted', resource: 'vm-012', severity: 'info' as const, region: 'Central India' },
  { id: 8, timestamp: '2026-03-11 14:05:22', user: 'system', action: 'TLS Certificate Renewed', resource: 'frontdoor-ssl', severity: 'info' as const, region: 'Global' },
  { id: 9, timestamp: '2026-03-11 13:58:19', user: 'unknown', action: 'Blocked Request (SQL Injection)', resource: 'appgw-india', severity: 'critical' as const, region: 'Central India' },
  { id: 10, timestamp: '2026-03-11 13:45:01', user: 'system', action: 'Key Vault Secret Rotated', resource: 'kv-eastus', severity: 'info' as const, region: 'East US' },
];

const wafEvents = [
  { id: 1, timestamp: '2026-03-11 14:05:22', rule: 'SQL Injection', action: 'Blocked', sourceIp: '203.45.xx.xx', uri: '/api/sessions?id=1;DROP', region: 'Central India', severity: 'critical' as const },
  { id: 2, timestamp: '2026-03-11 13:42:18', rule: 'XSS Detection', action: 'Blocked', sourceIp: '198.12.xx.xx', uri: '/api/labs?q=<script>', region: 'East US', severity: 'critical' as const },
  { id: 3, timestamp: '2026-03-11 12:55:30', rule: 'Rate Limit', action: 'Throttled', sourceIp: '45.33.xx.xx', uri: '/api/vms', region: 'East US', severity: 'warning' as const },
  { id: 4, timestamp: '2026-03-11 12:10:45', rule: 'Bot Detection', action: 'Challenged', sourceIp: '91.207.xx.xx', uri: '/login', region: 'Central India', severity: 'warning' as const },
  { id: 5, timestamp: '2026-03-11 11:30:02', rule: 'Geo Restriction', action: 'Blocked', sourceIp: '176.88.xx.xx', uri: '/api/vms/provision', region: 'East US', severity: 'info' as const },
  { id: 6, timestamp: '2026-03-11 10:15:33', rule: 'Protocol Violation', action: 'Blocked', sourceIp: '103.27.xx.xx', uri: '/api/guac/connect', region: 'Central India', severity: 'warning' as const },
];

const policies = [
  { name: 'No Public RDP/SSH', status: 'enforced' as const, description: 'All VM access restricted to Guacamole proxy only', scope: 'Global' },
  { name: 'WAF Enabled', status: 'enforced' as const, description: 'Application Gateway WAF in prevention mode', scope: 'All Regions' },
  { name: 'TLS Everywhere', status: 'enforced' as const, description: 'TLS 1.2+ required for all inter-service communication', scope: 'Global' },
  { name: 'Private Endpoints', status: 'enforced' as const, description: 'Redis, MySQL, Key Vault accessible via private endpoints only', scope: 'All Regions' },
  { name: 'Managed Identity', status: 'enforced' as const, description: 'No hardcoded credentials; all services use managed identities', scope: 'Global' },
  { name: 'RBAC Enforced', status: 'enforced' as const, description: 'Role-based access control for all platform operations', scope: 'Global' },
  { name: 'Clipboard Transfer', status: 'optional' as const, description: 'Can be disabled per-lab for sensitive environments', scope: 'Per Lab' },
  { name: 'Session Timeout', status: 'enforced' as const, description: '20-minute idle timeout with auto-stop', scope: 'Global' },
  { name: 'Audit Logging', status: 'enforced' as const, description: 'All operations logged to Log Analytics workspace', scope: 'Global' },
  { name: 'File Transfer', status: 'optional' as const, description: 'Can be disabled per-lab for compliance requirements', scope: 'Per Lab' },
];

const severityStyle = {
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  critical: 'bg-destructive/10 text-destructive',
};

export default function Security() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Security</h1>
          <p className="text-sm text-muted-foreground mt-1">Audit logs, WAF events, and access control</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: Shield, label: 'Policies Enforced', value: '8/10', color: 'text-success' },
            { icon: AlertTriangle, label: 'WAF Blocks (24h)', value: '23', color: 'text-warning' },
            { icon: Eye, label: 'Audit Events (24h)', value: '1,247', color: 'text-primary' },
            { icon: Lock, label: 'Failed Logins (24h)', value: '4', color: 'text-destructive' },
          ].map(c => (
            <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-4">
              <c.icon className={cn("h-5 w-5 mb-2", c.color)} />
              <p className="text-xl font-mono font-semibold text-foreground">{c.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{c.label}</p>
            </motion.div>
          ))}
        </div>

        <Tabs defaultValue="audit" className="space-y-4">
          <TabsList className="bg-muted/50 border border-border">
            <TabsTrigger value="audit" className="gap-1.5 data-[state=active]:bg-card"><FileText className="h-3.5 w-3.5" />Audit Logs</TabsTrigger>
            <TabsTrigger value="waf" className="gap-1.5 data-[state=active]:bg-card"><Globe className="h-3.5 w-3.5" />WAF Events</TabsTrigger>
            <TabsTrigger value="policies" className="gap-1.5 data-[state=active]:bg-card"><Shield className="h-3.5 w-3.5" />Policies</TabsTrigger>
          </TabsList>

          <TabsContent value="audit">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Timestamp', 'User', 'Action', 'Resource', 'Region', 'Severity'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(log => (
                      <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{log.timestamp}</td>
                        <td className="px-4 py-3 text-foreground text-xs">{log.user}</td>
                        <td className="px-4 py-3 text-foreground text-xs">{log.action}</td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">{log.resource}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{log.region}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", severityStyle[log.severity])}>
                            {log.severity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="waf">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Timestamp', 'Rule', 'Action', 'Source IP', 'URI', 'Region', 'Severity'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wafEvents.map(evt => (
                      <tr key={evt.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{evt.timestamp}</td>
                        <td className="px-4 py-3 text-foreground text-xs">{evt.rule}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", evt.action === 'Blocked' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
                            {evt.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{evt.sourceIp}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[200px] truncate">{evt.uri}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{evt.region}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", severityStyle[evt.severity])}>
                            {evt.severity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="policies">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border bg-card divide-y divide-border">
              {policies.map(p => (
                <div key={p.name} className="flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    {p.status === 'enforced' ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-muted-foreground">{p.scope}</span>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                      p.status === 'enforced' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                    )}>
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
