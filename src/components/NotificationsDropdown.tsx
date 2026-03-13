import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, Shield, Server, Activity, AlertTriangle, CheckCircle2, X, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

const typeConfig: Record<string, { icon: any; color: string; bg: string }> = {
  quota_critical: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10' },
  quota_warning: { icon: Cpu, color: 'text-warning', bg: 'bg-warning/10' },
  waf: { icon: Shield, color: 'text-destructive', bg: 'bg-destructive/10' },
  idle: { icon: Server, color: 'text-warning', bg: 'bg-warning/10' },
  health: { icon: Activity, color: 'text-info', bg: 'bg-info/10' },
  info: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setNotifications(data as Notification[]);
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Poll every 30s for new notifications
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    for (const id of unreadIds) {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    }
  };

  const dismiss = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-md hover:bg-secondary transition-colors"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] p-0 flex items-center justify-center text-[10px] bg-destructive text-destructive-foreground border-0">
            {unreadCount}
          </Badge>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-[360px] sm:w-[400px] rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No notifications</div>
              ) : (
                notifications.map(n => {
                  const config = typeConfig[n.type] || typeConfig.info;
                  const Icon = config.icon;
                  return (
                    <div key={n.id} className={cn("flex gap-3 px-4 py-3 hover:bg-muted/30 transition-colors", !n.read && "bg-primary/5")}>
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", config.bg)}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-xs font-medium", n.read ? "text-muted-foreground" : "text-foreground")}>
                            {n.title}
                          </p>
                          <button onClick={() => dismiss(n.id)} className="p-0.5 rounded hover:bg-muted shrink-0">
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                      {!n.read && <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
