import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Bell, Sun, Moon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-3 sm:px-4 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm font-mono text-muted-foreground hidden sm:inline">v2.4.1</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-success" />
                <span>483 active sessions</span>
              </div>
              <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8">
                {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
              </Button>
              <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <Badge className="absolute -top-0.5 -right-0.5 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-destructive text-destructive-foreground border-0">
                  3
                </Badge>
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-3 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
