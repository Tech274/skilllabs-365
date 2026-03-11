import { DashboardLayout } from "@/components/DashboardLayout";
import { motion } from "framer-motion";
import { UserPlus, Shield, GraduationCap, BookOpen, MoreVertical, Search, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Role = 'admin' | 'instructor' | 'student';

interface MockUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'suspended' | 'invited';
  lastActive: string;
  sessionsCount: number;
}

const mockUsers: MockUser[] = [
  { id: '1', name: 'Admin User', email: 'admin@cloudlab.io', role: 'admin', status: 'active', lastActive: '2 min ago', sessionsCount: 0 },
  { id: '2', name: 'Dr. Sarah Chen', email: 'sarah.chen@university.edu', role: 'instructor', status: 'active', lastActive: '15 min ago', sessionsCount: 234 },
  { id: '3', name: 'Prof. Raj Patel', email: 'raj.patel@university.edu', role: 'instructor', status: 'active', lastActive: '1 hr ago', sessionsCount: 189 },
  { id: '4', name: 'Alice Wang', email: 'alice.w@student.edu', role: 'student', status: 'active', lastActive: '5 min ago', sessionsCount: 42 },
  { id: '5', name: 'Bob Kumar', email: 'bob.k@student.edu', role: 'student', status: 'active', lastActive: '20 min ago', sessionsCount: 38 },
  { id: '6', name: 'Carol Johnson', email: 'carol.j@student.edu', role: 'student', status: 'suspended', lastActive: '2 days ago', sessionsCount: 12 },
  { id: '7', name: 'Dave Li', email: 'dave.l@student.edu', role: 'student', status: 'active', lastActive: '1 hr ago', sessionsCount: 55 },
  { id: '8', name: 'Eve Santos', email: 'eve.s@student.edu', role: 'student', status: 'invited', lastActive: 'Never', sessionsCount: 0 },
  { id: '9', name: 'Frank Müller', email: 'frank.m@student.edu', role: 'student', status: 'active', lastActive: '30 min ago', sessionsCount: 29 },
  { id: '10', name: 'Dr. Grace Kim', email: 'grace.kim@university.edu', role: 'instructor', status: 'active', lastActive: '45 min ago', sessionsCount: 312 },
];

const roleConfig = {
  admin: { icon: Shield, color: 'text-destructive', bg: 'bg-destructive/10', label: 'Admin' },
  instructor: { icon: BookOpen, color: 'text-primary', bg: 'bg-primary/10', label: 'Instructor' },
  student: { icon: GraduationCap, color: 'text-success', bg: 'bg-success/10', label: 'Student' },
};

const statusStyle = {
  active: 'bg-success/10 text-success',
  suspended: 'bg-destructive/10 text-destructive',
  invited: 'bg-warning/10 text-warning',
};

export default function UserManagement() {
  const [users, setUsers] = useState(mockUsers);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'student' as Role });
  const [tab, setTab] = useState('all');

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    if (tab === 'all') return matchSearch;
    return matchSearch && u.role === tab;
  });

  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    instructor: users.filter(u => u.role === 'instructor').length,
    student: users.filter(u => u.role === 'student').length,
  };

  const handleInvite = () => {
    if (!inviteForm.email.trim()) return;
    const newUser: MockUser = {
      id: `u-${Date.now()}`, name: inviteForm.email.split('@')[0], email: inviteForm.email,
      role: inviteForm.role, status: 'invited', lastActive: 'Never', sessionsCount: 0,
    };
    setUsers(prev => [...prev, newUser]);
    toast({ title: "Invitation sent", description: `Invited ${inviteForm.email} as ${inviteForm.role}.` });
    setDialogOpen(false);
    setInviteForm({ email: '', role: 'student' });
  };

  const changeRole = (userId: string, newRole: Role) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    toast({ title: "Role updated", description: `User role changed to ${newRole}.` });
  };

  const toggleSuspend = (userId: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: u.status === 'suspended' ? 'active' : 'suspended' } : u));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">User Management</h1>
            <p className="text-sm text-muted-foreground mt-1">{users.length} users across {counts.admin} admins, {counts.instructor} instructors, {counts.student} students</p>
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

        {/* Tabs + Search */}
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
                      <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                      <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">Last Active</th>
                      <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">Sessions</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((user, i) => {
                      const cfg = roleConfig[user.role];
                      return (
                        <motion.tr key={user.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-xs bg-muted">{user.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-foreground">{user.name}</p>
                                <p className="text-xs text-muted-foreground">{user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 hidden sm:table-cell">
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", cfg.bg, cfg.color)}>
                              {cfg.label}
                            </span>
                          </td>
                          <td className="p-3 hidden md:table-cell">
                            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", statusStyle[user.status])}>
                              {user.status}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground hidden lg:table-cell">{user.lastActive}</td>
                          <td className="p-3 font-mono text-muted-foreground hidden lg:table-cell">{user.sessionsCount}</td>
                          <td className="p-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1 rounded hover:bg-muted transition-colors">
                                  <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => changeRole(user.id, 'admin')}>Set as Admin</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => changeRole(user.id, 'instructor')}>Set as Instructor</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => changeRole(user.id, 'student')}>Set as Student</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toggleSuspend(user.id)} className="text-destructive focus:text-destructive">
                                  {user.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={!inviteForm.email.trim()}>Send Invitation</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
