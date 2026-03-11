import { useState, useRef, useEffect } from "react";
import { Bell, Shield, Server, Activity, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Notification {
  id: string;
  type: 'waf' | 'idle' | 'health' | 'info';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const initialNotifications: Notification[] = [
  { id: '1', type: 'waf', title: 'SQL Injection Blocked', message: 'WAF blocked suspicious request from 203.45.xx.xx targeting /api/sessions', time: '2m ago', read: false },
  { id: '2', type: 'idle', title: 'VM Idle Warning', message: 'vm-018 has been idle for 18 minutes. Auto-stop in 2 minutes.', time: '5m ago', read: false },
  { id: '3', type: 'health', title: 'MySQL Latency Elevated', message: 'Central India MySQL latency increased to 42ms (threshold: 30ms)', time: '12m ago', read: false },
  { id: '4', type: 'waf', title: 'XSS Attempt Blocked', message: 'WAF blocked XSS attempt from 198.12.xx.xx on /api/labs', time: '28m ago', read: true },
  { id: '5', type: 'info', title: 'TLS Certificate Renewed', message: 'Front Door SSL certificate auto-renewed successfully', time: '45m ago', read: true },
  { id: '6', type: 'idle', title: 'VM Auto-Stopped', message: 'vm-012 auto-stopped after 20 minutes idle. Resources released.', time: '1h ago', read: true },
  { id: '7', type: 'health', title: 'AKS Node Scaled Up', message: 'East US cluster auto-scaled from 11 to 12 nodes due to load', time: '1.5h ago', read: true },
];

const typeConfig = {
  waf: { icon: Shield, color: 'text-destructive', bg: 'bg-destructive/10' },
  idle: { icon: Server, color: 'text-warning', bg: 'bg-warning/10' },
  health: { icon: Activity, color: 'text-info', bg: 'bg-info/10' },
  info: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
};

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const dismiss = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
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
                  const config = typeConfig[n.type];
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
                        <p className="text-[10px] text-muted-foreground mt-1">{n.time}</p>
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
