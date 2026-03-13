import { DashboardLayout } from "@/components/DashboardLayout";
import { EmptyState } from "@/components/EmptyState";
import { motion } from "framer-motion";
import { UserPlus, Shield, GraduationCap, BookOpen, MoreVertical, Search, Mail, Users, History, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Role = 'admin' | 'instructor' | 'student';

interface UserRecord {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  role: Role;
  created_at: string;
}

interface ActivityLog {
  id: string;
  actor_id: string;
  target_user_id: string;
  action: string;
  details: { old_role?: string; new_role?: string };
  created_at: string;
  actor_name?: string;
  target_name?: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string;
  created_at: string;
  accepted: boolean;
}

const roleConfig = {
  admin: { icon: Shield, color: 'text-destructive', bg: 'bg-destructive/10', label: 'Admin' },
  instructor: { icon: BookOpen, color: 'text-primary', bg: 'bg-primary/10', label: 'Instructor' },
  student: { icon: GraduationCap, color: 'text-success', bg: 'bg-success/10', label: 'Student' },
};

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'student' as Role });
  const [tab, setTab] = useState('all');
  const [mainTab, setMainTab] = useState('users');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, display_name, email, created_at");

    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (profiles) {
      const roleMap = new Map(roles?.map(r => [r.user_id, r.role as Role]) ?? []);
      const merged: UserRecord[] = profiles.map(p => ({
        id: p.id,
        user_id: p.user_id,
        display_name: p.display_name,
        email: p.email,
        role: roleMap.get(p.user_id) ?? 'student',
        created_at: p.created_at,
      }));
      setUsers(merged);
    }
    setLoading(false);
  };

  const fetchActivityLogs = async () => {
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      // Enrich with user names from our local users state or fetch profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name");

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.display_name]) ?? []);

      const enriched: ActivityLog[] = data.map(log => ({
        ...log,
        details: (log.details as { old_role?: string; new_role?: string }) ?? {},
        actor_name: nameMap.get(log.actor_id) ?? 'Unknown',
        target_name: nameMap.get(log.target_user_id) ?? 'Unknown',
      }));
      setActivityLogs(enriched);
    }
  };

  const fetchPendingInvitations = async () => {
    const { data } = await supabase
      .from("pending_invitations")
      .select("*")
      .eq("accepted", false)
      .order("created_at", { ascending: false });

    if (data) {
      setPendingInvitations(data as PendingInvitation[]);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchActivityLogs();
    fetchPendingInvitations();

    const profilesChannel = supabase
      .channel('user-mgmt-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchUsers())
      .subscribe();

    const rolesChannel = supabase
      .channel('user-mgmt-roles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => fetchUsers())
      .subscribe();

    const logsChannel = supabase
      .channel('user-mgmt-logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, () => fetchActivityLogs())
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(rolesChannel);
      supabase.removeChannel(logsChannel);
    };
  }, []);

  const filtered = users.filter(u => {
    const matchSearch = u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.email?.toLowerCase().includes(search.toLowerCase()) ?? false);
    if (tab === 'all') return matchSearch;
    return matchSearch && u.role === tab;
  });

  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    instructor: users.filter(u => u.role === 'instructor').length,
    student: users.filter(u => u.role === 'student').length,
  };

  const changeRole = async (userId: string, newRole: Role) => {
    // Get old role first
    const targetUser = users.find(u => u.user_id === userId);
    const oldRole = targetUser?.role ?? 'student';

    if (oldRole === newRole) return;

    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("user_id", userId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Log the activity
    if (user) {
      await supabase.from("activity_logs").insert({
        actor_id: user.id,
        target_user_id: userId,
        action: "role_change",
        details: { old_role: oldRole, new_role: newRole },
      });
    }

    toast({ title: "Role updated", description: `User role changed from ${oldRole} to ${newRole}.` });
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim() || !user) return;

    const { error } = await supabase.from("pending_invitations").insert({
      email: inviteForm.email.trim().toLowerCase(),
      role: inviteForm.role,
      invited_by: user.id,
    });

    if (error) {
      if (error.code === '23505') {
        toast({ title: "Already invited", description: "This email already has a pending invitation.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    } else {
      toast({
        title: "Invitation saved",
        description: `When ${inviteForm.email} signs up, they'll be auto-assigned the ${inviteForm.role} role.`,
      });
      fetchPendingInvitations();
    }
    setDialogOpen(false);
    setInviteForm({ email: '', role: 'student' });
  };

  const cancelInvitation = async (id: string) => {
    const { error } = await supabase.from("pending_invitations").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invitation cancelled" });
      fetchPendingInvitations();
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">User Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? "Loading…" : `${users.length} users across ${counts.admin} admins, ${counts.instructor} instructors, ${counts.student} students`}
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Invite User
          </Button>
        </div>

        {/* Role summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(['admin', 'instructor', 'student'] as Role[]).map(role => {
            const cfg = roleConfig[role];
            const Icon = cfg.icon;
            return (
              <motion.div key={role} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", cfg.bg)}>
                  <Icon className={cn("h-5 w-5", cfg.color)} />
                </div>
                <div>
                  <p className="text-2xl font-mono font-bold text-foreground">{counts[role]}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}s</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Main tabs: Users / Activity Log / Pending Invitations */}
        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList>
            <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5"><History className="h-3.5 w-3.5" /> Activity Log</TabsTrigger>
            <TabsTrigger value="invitations" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Pending ({pendingInvitations.length})
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            {!loading && users.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No users yet"
                description="Users will appear here automatically when they sign up."
                hint="Share the login page URL with your team to get started."
              />
            ) : (
              <Tabs value={tab} onValueChange={setTab}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <TabsList>
                    <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                    <TabsTrigger value="admin">Admins</TabsTrigger>
                    <TabsTrigger value="instructor">Instructors</TabsTrigger>
                    <TabsTrigger value="student">Students</TabsTrigger>
                  </TabsList>
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="pl-9" />
                  </div>
                </div>

                <TabsContent value={tab} className="mt-4">
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="text-left p-3 font-medium text-muted-foreground">User</th>
                            <th className="text-left p-3 font-medium text-muted-foreground hidden sm:table-cell">Role</th>
                            <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Joined</th>
                            <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((u, i) => {
                            const cfg = roleConfig[u.role];
                            const initials = u.display_name.split(' ').map(n => n[0]).join('').toUpperCase();
                            return (
                              <motion.tr key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                                className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                                <td className="p-3">
                                  <div className="flex items-center gap-3">
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <p className="font-medium text-foreground">{u.display_name}</p>
                                      <p className="text-xs text-muted-foreground">{u.email}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="p-3 hidden sm:table-cell">
                                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", cfg.bg, cfg.color)}>
                                    {cfg.label}
                                  </span>
                                </td>
                                <td className="p-3 text-muted-foreground hidden md:table-cell">
                                  {new Date(u.created_at).toLocaleDateString()}
                                </td>
                                <td className="p-3 text-right">
                                  {u.user_id !== user?.id && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button className="p-1 rounded hover:bg-muted transition-colors">
                                          <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => changeRole(u.user_id, 'admin')}>Set as Admin</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => changeRole(u.user_id, 'instructor')}>Set as Instructor</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => changeRole(u.user_id, 'student')}>Set as Student</DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })}
                          {filtered.length === 0 && (
                            <tr>
                              <td colSpan={4} className="p-8 text-center text-muted-foreground">
                                No users match your search.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>

          {/* Activity Log Tab */}
          <TabsContent value="activity">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {activityLogs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="font-medium">No activity yet</p>
                  <p className="text-xs mt-1">Role changes will be logged here in real time.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {activityLogs.map((log, i) => {
                    const oldCfg = log.details.old_role ? roleConfig[log.details.old_role as Role] : null;
                    const newCfg = log.details.new_role ? roleConfig[log.details.new_role as Role] : null;
                    return (
                      <motion.div key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                        className="p-4 flex items-start gap-3">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Shield className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{log.actor_name}</span>
                            {' changed role of '}
                            <span className="font-medium">{log.target_name}</span>
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {oldCfg && (
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", oldCfg.bg, oldCfg.color)}>
                                {oldCfg.label}
                              </span>
                            )}
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            {newCfg && (
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", newCfg.bg, newCfg.color)}>
                                {newCfg.label}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(log.created_at).toLocaleString()}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Pending Invitations Tab */}
          <TabsContent value="invitations">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {pendingInvitations.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Mail className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="font-medium">No pending invitations</p>
                  <p className="text-xs mt-1">Invite users to pre-assign their role before they sign up.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Pre-assigned Role</th>
                        <th className="text-left p-3 font-medium text-muted-foreground hidden sm:table-cell">Invited</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingInvitations.map((inv) => {
                        const cfg = roleConfig[inv.role];
                        return (
                          <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="p-3 font-medium text-foreground">{inv.email}</td>
                            <td className="p-3">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", cfg.bg, cfg.color)}>
                                {cfg.label}
                              </span>
                            </td>
                            <td className="p-3 text-muted-foreground hidden sm:table-cell">
                              {new Date(inv.created_at).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-right">
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => cancelInvitation(inv.id)}>
                                Cancel
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Invite Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                    placeholder="user@example.com" className="pl-9" type="email" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteForm.role} onValueChange={v => setInviteForm({ ...inviteForm, role: v as Role })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="instructor">Instructor</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                When this user signs up with this email, they'll automatically be assigned the selected role instead of the default student role.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={!inviteForm.email.trim()}>Save Invitation</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
