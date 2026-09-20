import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthProvider } from "@/hooks/use-auth";
import { ProvisioningProvider } from "@/hooks/use-provisioning";
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
import OAuthConsent from "./pages/OAuthConsent";
import NotionReturn from "./pages/NotionReturn";
import Signup from "./pages/Signup";
import DailyReports from "./pages/DailyReports";
import AccessCatalogue from "./pages/AccessCatalogue";
import AccessTemplateDetail from "./pages/AccessTemplateDetail";
import UserCloudAccess from "./pages/UserCloudAccess";
import AdminResourceProviders from "./pages/AdminResourceProviders";
import AdminCloudReports from "./pages/AdminCloudReports";
import AiStatus from "./pages/AiStatus";
import AdminProvisioningExport from "./pages/AdminProvisioningExport";
import AdminAuditLog from "./pages/AdminAuditLog";
import AdminReadinessAudit from "./pages/AdminReadinessAudit";
import AdminReadinessTimeline from "./pages/AdminReadinessTimeline";
import AdminReadinessMetrics from "./pages/AdminReadinessMetrics";
import AdminAccessAudit from "./pages/AdminAccessAudit";
import AdminLabAssignmentAudit from "./pages/AdminLabAssignmentAudit";
import AdminCredentialValidation from "./pages/AdminCredentialValidation";
import AdminImpersonation from "./pages/AdminImpersonation";
import AdminWatchdogQueue from "./pages/AdminWatchdogQueue";
import AdminSessionLifecycle from "./pages/AdminSessionLifecycle";
import AdminProvisioningRetries from "./pages/AdminProvisioningRetries";
import AdminProvisioningStatus from "./pages/AdminProvisioningStatus";
import AdminProvisioningErrors from "./pages/AdminProvisioningErrors";
import AdminPlatformAudit from "./pages/AdminPlatformAudit";
import AccessRequests from "./pages/AccessRequests";
import Applications from "./pages/Applications";
import AdminApplications from "./pages/AdminApplications";
import AdminWorkspaceLaunches from "./pages/AdminWorkspaceLaunches";
import AdminSkillTrackLeads from "./pages/AdminSkillTrackLeads";
import AdminAccessGrants from "./pages/AdminAccessGrants";
import AdminManualLabGrants from "./pages/AdminManualLabGrants";
import AdminCloudQuotas from "./pages/AdminCloudQuotas";
import AdminNetworkHealth from "./pages/AdminNetworkHealth";
import { SkillTrackHandoffCapture } from "./components/SkillTrackHandoffCapture";


const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ProvisioningProvider>
              <SkillTrackHandoffCapture />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                <Route path="/oauth/notion/return" element={<NotionReturn />} />
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
                <Route path="/admin/access-catalogue" element={<RoleProtectedRoute allowedRoles={["admin"]}><AccessCatalogue /></RoleProtectedRoute>} />
                <Route path="/admin/access-templates/:id" element={<RoleProtectedRoute allowedRoles={["admin"]}><AccessTemplateDetail /></RoleProtectedRoute>} />
                <Route path="/admin/resource-providers" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminResourceProviders /></RoleProtectedRoute>} />
                <Route path="/admin/cloud-providers" element={<Navigate to="/admin/resource-providers" replace />} />
                <Route path="/admin/ai-status" element={<RoleProtectedRoute allowedRoles={["admin"]}><AiStatus /></RoleProtectedRoute>} />
                <Route path="/admin/cloud-reports" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminCloudReports /></RoleProtectedRoute>} />
                <Route path="/admin/provisioning-export" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><AdminProvisioningExport /></RoleProtectedRoute>} />
                <Route path="/admin/provisioning-status" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><AdminProvisioningStatus /></RoleProtectedRoute>} />
                <Route path="/admin/impersonation" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminImpersonation /></RoleProtectedRoute>} />
                <Route path="/admin/credential-validation" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminCredentialValidation /></RoleProtectedRoute>} />
                <Route path="/admin/access-audit" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminAccessAudit /></RoleProtectedRoute>} />
                <Route path="/admin/readiness-audit" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminReadinessAudit /></RoleProtectedRoute>} />
                <Route path="/admin/readiness-timeline" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminReadinessTimeline /></RoleProtectedRoute>} />
                <Route path="/admin/readiness-metrics" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminReadinessMetrics /></RoleProtectedRoute>} />
                <Route path="/admin/watchdog-queue" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminWatchdogQueue /></RoleProtectedRoute>} />
                <Route path="/admin/audit-log" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminAuditLog /></RoleProtectedRoute>} />
                <Route path="/admin/lab-assignment-audit" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminLabAssignmentAudit /></RoleProtectedRoute>} />
                <Route path="/admin/session-lifecycle" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><AdminSessionLifecycle /></RoleProtectedRoute>} />
                <Route path="/admin/access-requests" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><AccessRequests /></RoleProtectedRoute>} />
                <Route path="/admin/platform-audit" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminPlatformAudit /></RoleProtectedRoute>} />
                <Route path="/admin/provisioning-errors" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><AdminProvisioningErrors /></RoleProtectedRoute>} />
                <Route path="/admin/provisioning-retries" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminProvisioningRetries /></RoleProtectedRoute>} />
                <Route path="/admin/applications" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminApplications /></RoleProtectedRoute>} />
                <Route path="/admin/workspace-launches" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminWorkspaceLaunches /></RoleProtectedRoute>} />
                <Route path="/admin/skilltrack-leads" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminSkillTrackLeads /></RoleProtectedRoute>} />
                <Route path="/admin/access-grants" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminAccessGrants /></RoleProtectedRoute>} />
                <Route path="/admin/manual-grants" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminManualLabGrants /></RoleProtectedRoute>} />
                <Route path="/admin/cloud-quotas" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminCloudQuotas /></RoleProtectedRoute>} />
                <Route path="/admin/network-health" element={<RoleProtectedRoute allowedRoles={["admin"]}><AdminNetworkHealth /></RoleProtectedRoute>} />
                <Route path="/applications" element={<ProtectedRoute><Applications /></ProtectedRoute>} />
                <Route path="/cloud-access" element={<ProtectedRoute><UserCloudAccess /></ProtectedRoute>} />
                <Route path="/cloud-access/:id" element={<ProtectedRoute><UserCloudAccess /></ProtectedRoute>} />

                {/* Shared routes */}
                <Route path="/sessions" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><Sessions /></RoleProtectedRoute>} />
                <Route path="/sessions/:sessionId/playback" element={<RoleProtectedRoute allowedRoles={["admin", "instructor"]}><SessionPlayback /></RoleProtectedRoute>} />
                <Route path="/labs/session/:sessionId" element={<ProtectedRoute><LabSession /></ProtectedRoute>} />
                {/* Role-specific dashboards */}
                <Route path="/instructor" element={<RoleProtectedRoute allowedRoles={["instructor"]}><InstructorDashboard /></RoleProtectedRoute>} />
                <Route path="/student" element={<RoleProtectedRoute allowedRoles={["student"]}><StudentDashboard /></RoleProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ProvisioningProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
