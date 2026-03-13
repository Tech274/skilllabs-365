import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthProvider } from "@/hooks/use-auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import VirtualMachines from "./pages/VirtualMachines";
import Sessions from "./pages/Sessions";
import Regions from "./pages/Regions";
import CostAnalytics from "./pages/CostAnalytics";
import Health from "./pages/Health";
import Security from "./pages/Security";
import VMDetail from "./pages/VMDetail";
import LabManagement from "./pages/LabManagement";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import LabSession from "./pages/LabSession";
import SessionAuditLog from "./pages/SessionAuditLog";
import InstructorDashboard from "./pages/InstructorDashboard";
import StudentDashboard from "./pages/StudentDashboard";
import SessionPlayback from "./pages/SessionPlayback";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import DailyReports from "./pages/DailyReports";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              {/* Admin-only routes */}
              <Route path="/" element={<RoleProtectedRoute allowedRoles={["admin"]}><Index /></RoleProtectedRoute>} />
              <Route path="/vms" element={<RoleProtectedRoute allowedRoles={["admin"]}><VirtualMachines /></RoleProtectedRoute>} />
              <Route path="/vms/:vmId" element={<RoleProtectedRoute allowedRoles={["admin"]}><VMDetail /></RoleProtectedRoute>} />
              <Route path="/regions" element={<RoleProtectedRoute allowedRoles={["admin"]}><Regions /></RoleProtectedRoute>} />
              <Route path="/costs" element={<RoleProtectedRoute allowedRoles={["admin"]}><CostAnalytics /></RoleProtectedRoute>} />
              <Route path="/health" element={<RoleProtectedRoute allowedRoles={["admin"]}><Health /></RoleProtectedRoute>} />
              <Route path="/security" element={<RoleProtectedRoute allowedRoles={["admin"]}><Security /></RoleProtectedRoute>} />
              <Route path="/labs" element={<RoleProtectedRoute allowedRoles={["admin"]}><LabManagement /></RoleProtectedRoute>} />
              <Route path="/audit-log" element={<RoleProtectedRoute allowedRoles={["admin"]}><SessionAuditLog /></RoleProtectedRoute>} />
              <Route path="/users" element={<RoleProtectedRoute allowedRoles={["admin"]}><UserManagement /></RoleProtectedRoute>} />
              <Route path="/settings" element={<RoleProtectedRoute allowedRoles={["admin"]}><Settings /></RoleProtectedRoute>} />
              <Route path="/reports" element={<RoleProtectedRoute allowedRoles={["admin"]}><DailyReports /></RoleProtectedRoute>} />
              {/* Shared routes */}
              <Route path="/sessions" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><Sessions /></RoleProtectedRoute>} />
              <Route path="/sessions/:sessionId/playback" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><SessionPlayback /></RoleProtectedRoute>} />
              <Route path="/labs/session/:sessionId" element={<ProtectedRoute><LabSession /></ProtectedRoute>} />
              {/* Role-specific dashboards */}
              <Route path="/instructor" element={<RoleProtectedRoute allowedRoles={["instructor"]}><InstructorDashboard /></RoleProtectedRoute>} />
              <Route path="/student" element={<RoleProtectedRoute allowedRoles={["student"]}><StudentDashboard /></RoleProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
