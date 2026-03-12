import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthProvider } from "@/hooks/use-auth";
import ProtectedRoute from "@/components/ProtectedRoute";
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
import Login from "./pages/Login";
import Signup from "./pages/Signup";

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
              <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/vms" element={<ProtectedRoute><VirtualMachines /></ProtectedRoute>} />
              <Route path="/vms/:vmId" element={<ProtectedRoute><VMDetail /></ProtectedRoute>} />
              <Route path="/sessions" element={<ProtectedRoute><Sessions /></ProtectedRoute>} />
              <Route path="/regions" element={<ProtectedRoute><Regions /></ProtectedRoute>} />
              <Route path="/costs" element={<ProtectedRoute><CostAnalytics /></ProtectedRoute>} />
              <Route path="/health" element={<ProtectedRoute><Health /></ProtectedRoute>} />
              <Route path="/security" element={<ProtectedRoute><Security /></ProtectedRoute>} />
              <Route path="/labs" element={<ProtectedRoute><LabManagement /></ProtectedRoute>} />
              <Route path="/labs/session/:sessionId" element={<ProtectedRoute><LabSession /></ProtectedRoute>} />
              <Route path="/audit-log" element={<ProtectedRoute><SessionAuditLog /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
