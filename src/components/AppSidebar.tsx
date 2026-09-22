import {
  LayoutDashboard, Server, Users, Globe, DollarSign, Activity,
  Cloud, BookOpen, LogOut, GraduationCap, FileText,
  Loader2, X, KeyRound, Sparkles, MonitorPlay, ClipboardList, Unlock, Gauge, Settings,
  ChevronRight, Layers3, AppWindow,
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useProvisioning } from "@/hooks/use-provisioning";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, SidebarMenuSub, SidebarMenuSubButton,
  SidebarMenuSubItem, useSidebar,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const adminPrimaryItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "VMs", url: "/vms", icon: Server },
  { title: "Sessions", url: "/sessions", icon: Users },
  // Launch-event audit (platform_application_launch_events). Not the catalog.
  { title: "Workspaces", url: "/admin/workspace-launches", icon: AppWindow },
  // Workspace catalog + learner assignment. Learners open /applications.
  { title: "Applications", url: "/admin/applications", icon: Layers3 },
  { title: "Labs", url: "/labs", icon: BookOpen },
  { title: "Lab Grants", url: "/admin/manual-grants", icon: Unlock },
  { title: "Access Catalogue", url: "/admin/access-catalogue", icon: KeyRound },
  { title: "Users", url: "/users", icon: Users },
];

const cloudAndCostItems = [
  { title: "Regions", url: "/regions", icon: Globe },
  { title: "Cost Analytics", url: "/costs", icon: DollarSign },
  { title: "Cloud Quotas", url: "/admin/cloud-quotas", icon: Gauge },
  { title: "Cloud Reports", url: "/admin/cloud-reports", icon: FileText },
  { title: "Resource Providers", url: "/admin/resource-providers", icon: Cloud },
  { title: "Daily Reports", url: "/reports", icon: FileText },
];

const provisioningRoutes = [
  "/admin/provisioning-status",
  "/admin/provisioning-retries",
  "/admin/provisioning-export",
];

const auditItems = [
  { title: "Session Lifecycle", url: "/admin/session-lifecycle", icon: MonitorPlay },
];

const advancedItems = [
  { title: "Network Health", url: "/admin/network-health", icon: Activity },
  { title: "AI Status", url: "/admin/ai-status", icon: Sparkles },
  { title: "Handoff leads", url: "/admin/skilltrack-leads", icon: Users },
];

const instructorItems = [
  { title: "Dashboard", url: "/instructor", icon: GraduationCap },
  { title: "Sessions", url: "/sessions", icon: Users },
];

const studentItems = [
  { title: "Dashboard", url: "/student", icon: LayoutDashboard },
  { title: "Cloud Workspaces", url: "/applications", icon: AppWindow },
  { title: "Cloud Access", url: "/cloud-access", icon: KeyRound },
];


const SignOutButton = ({ collapsed }: { collapsed?: boolean }) => {
  const { signOut } = useAuth();
  return (
    <Button variant="ghost" size={collapsed ? "icon" : "sm"} className="w-full text-muted-foreground hover:text-foreground" onClick={signOut}>
      <LogOut className="h-4 w-4" />
      {!collapsed && <span className="ml-2">Sign Out</span>}
    </Button>
  );
};

function SidebarProvisioningIndicator({ collapsed }: { collapsed: boolean }) {
  const { isProvisioning, labName, startedAt, cancelling, cancelProvisioning } = useProvisioning();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isProvisioning || !startedAt) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isProvisioning, startedAt]);

  if (!isProvisioning) return null;

  const pct = Math.min((elapsed / 90) * 100, 95);

  if (collapsed) {
    return (
      <div className="flex justify-center py-2" title={`Provisioning: ${labName}`}>
        <div className="relative">
          <Server className="h-4 w-4 text-primary" />
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
          <span className="text-[11px] font-medium text-foreground truncate">Provisioning</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={cancelProvisioning}
          disabled={cancelling}
        >
          {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground truncate">{labName}</p>
      <Progress value={pct} className="h-1.5" />
      <p className="text-[9px] text-muted-foreground font-mono">
        {elapsed < 90 ? `~${Math.max(90 - elapsed, 0)}s remaining` : "almost there..."}
      </p>
    </div>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isAdmin, isSuperAdmin, isInstructor } = useAuth();
  const isActive = (path: string) => location.pathname === path;
  const cloudAndCostActive = cloudAndCostItems.some((item) => isActive(item.url));
  const advancedRoutes = [
    ...provisioningRoutes,
    "/admin/audit-log",
    ...auditItems.map((item) => item.url),
    ...advancedItems.map((item) => item.url),
  ];
  const advancedActive = advancedRoutes.some(isActive);
  const [cloudAndCostOpen, setCloudAndCostOpen] = useState(cloudAndCostActive);
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);

  useEffect(() => {
    if (cloudAndCostActive) setCloudAndCostOpen(true);
    if (advancedActive) setAdvancedOpen(true);
  }, [cloudAndCostActive, advancedActive]);

  const navItems = isInstructor ? instructorItems : studentItems;
  const roleLabel = isSuperAdmin ? "Super Admin" : isAdmin ? "Platform Admin" : isInstructor ? "Instructor" : "Student";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 glow-primary">
            <Cloud className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <h2 className="text-sm font-semibold text-foreground">SkillHub Labs</h2>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{isAdmin ? "Primary" : "Navigation"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(isAdmin ? adminPrimaryItems : navItems).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <NavLink to={item.url} end>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && (
          <>
            <Collapsible open={cloudAndCostOpen} onOpenChange={setCloudAndCostOpen} asChild>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip="Cloud & cost" isActive={cloudAndCostActive}>
                          <Layers3 />
                          {!collapsed && <span>Cloud &amp; cost</span>}
                          {!collapsed && <ChevronRight className="ml-auto transition-transform duration-200 data-[state=open]:rotate-90" />}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {cloudAndCostItems.map((item) => (
                            <SidebarMenuSubItem key={item.url}>
                              <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                                <NavLink to={item.url} end>
                                  <item.icon />
                                  <span>{item.title}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </Collapsible>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} asChild>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip="Advanced" isActive={advancedActive}>
                          <Settings />
                          {!collapsed && <span>Advanced</span>}
                          {!collapsed && <ChevronRight className="ml-auto transition-transform duration-200 data-[state=open]:rotate-90" />}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={provisioningRoutes.some(isActive)}>
                              <NavLink to="/admin/provisioning-status" end>
                                <Activity />
                                <span>Provisioning</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={isActive("/admin/audit-log")}>
                              <NavLink to="/admin/audit-log" end>
                                <ClipboardList />
                                <span>Audit &amp; logs</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                            <SidebarMenuSub className="mx-2">
                              {auditItems.map((item) => (
                                <SidebarMenuSubItem key={item.url}>
                                  <SidebarMenuSubButton asChild size="sm" isActive={isActive(item.url)}>
                                    <NavLink to={item.url} end>
                                      <item.icon />
                                      <span>{item.title}</span>
                                    </NavLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </SidebarMenuSubItem>
                          {advancedItems.map((item) => (
                            <SidebarMenuSubItem key={item.url}>
                              <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                                <NavLink to={item.url} end>
                                  <item.icon />
                                  <span>{item.title}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </Collapsible>
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-2">
        <SidebarProvisioningIndicator collapsed={collapsed} />
        {!collapsed && (
          <>
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs text-muted-foreground">All systems operational</span>
              </div>
            </div>
            <SignOutButton />
          </>
        )}
        {collapsed && <SignOutButton collapsed />}
      </SidebarFooter>
    </Sidebar>
  );
}
