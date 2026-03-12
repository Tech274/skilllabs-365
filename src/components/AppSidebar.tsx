import {
  LayoutDashboard, Server, Users, Globe, DollarSign, Activity, Shield,
  Settings, Cloud, BookOpen, History, LogOut, GraduationCap,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

const adminItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Virtual Machines", url: "/vms", icon: Server },
  { title: "Sessions", url: "/sessions", icon: Users },
  { title: "Regions", url: "/regions", icon: Globe },
  { title: "Cost Analytics", url: "/costs", icon: DollarSign },
  { title: "Lab Management", url: "/labs", icon: BookOpen },
  { title: "Audit Log", url: "/audit-log", icon: History },
  { title: "User Management", url: "/users", icon: Users },
];

const instructorItems = [
  { title: "Dashboard", url: "/instructor", icon: GraduationCap },
  { title: "Sessions", url: "/sessions", icon: Users },
];

const studentItems = [
  { title: "Dashboard", url: "/student", icon: LayoutDashboard },
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

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, isAdmin, isInstructor } = useAuth();
  const isActive = (path: string) => location.pathname === path;

  const navItems = isAdmin ? adminItems : isInstructor ? instructorItems : instructorItems;
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
