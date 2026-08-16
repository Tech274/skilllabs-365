import {
  LayoutDashboard, Server, Users, Globe, DollarSign, Activity, Shield,
  Settings, Cloud, BookOpen, History, LogOut, GraduationCap, FileText,
  Loader2, X, KeyRound, Sparkles,} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useProvisioning } from "@/hooks/use-provisioning";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const adminItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Virtual Machines", url: "/vms", icon: Server },
  { title: "Sessions", url: "/sessions", icon: Users },
  { title: "Regions", url: "/regions", icon: Globe },
  { title: "Cost Analytics", url: "/costs", icon: DollarSign },
  { title: "Lab Management", url: "/labs", icon: BookOpen },
  { title: "Cloud Access", url: "/admin/access-catalogue", icon: KeyRound },
  { title: "Cloud Reports", url: "/admin/cloud-reports", icon: FileText },
  { title: "Cloud Providers", url: "/admin/cloud-providers", icon: Cloud },
  { title: "AI Status", url: "/admin/ai-status", icon: Sparkles },
  { title: "Audit Log", url: "/audit-log", icon: History },
  { title: "User Management", url: "/users", icon: Users },
  { title: "Daily Reports", url: "/reports", icon: FileText },

];

const instructorItems = [
  { title: "Dashboard", url: "/instructor", icon: GraduationCap },
  { title: "Sessions", url: "/sessions", icon: Users },
];

const studentItems = [
  { title: "Dashboard", url: "/student", icon: LayoutDashboard },
  { title: "Cloud Access", url: "/cloud-access", icon: KeyRound },
];


const systemItems = [
  { title: "Health", url: "/health", icon: Activity },
  { title: "Security", url: "/security", icon: Shield },
  { title: "Settings", url: "/settings", icon: Settings },
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
  const { role, isAdmin, isInstructor } = useAuth();
  const isActive = (path: string) => location.pathname === path;

  const navItems = isAdmin ? adminItems : isInstructor ? instructorItems : studentItems;
  const roleLabel = isAdmin ? "Platform Admin" : isInstructor ? "Instructor" : "Student";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 glow-primary">
            <Cloud className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <h2 className="text-sm font-semibold text-foreground">CloudLab</h2>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{isAdmin ? "Operations" : "Navigation"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
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
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {systemItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
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
