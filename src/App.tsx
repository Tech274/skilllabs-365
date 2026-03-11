import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import VirtualMachines from "./pages/VirtualMachines.tsx";
import Sessions from "./pages/Sessions.tsx";
import Regions from "./pages/Regions.tsx";
import CostAnalytics from "./pages/CostAnalytics.tsx";
import Health from "./pages/Health.tsx";
import Security from "./pages/Security.tsx";
import VMDetail from "./pages/VMDetail.tsx";
import LabManagement from "./pages/LabManagement.tsx";
import UserManagement from "./pages/UserManagement.tsx";
import Settings from "./pages/Settings.tsx";
import LabSession from "./pages/LabSession.tsx";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/vms" element={<VirtualMachines />} />
            <Route path="/vms/:vmId" element={<VMDetail />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/regions" element={<Regions />} />
            <Route path="/costs" element={<CostAnalytics />} />
            <Route path="/health" element={<Health />} />
            <Route path="/security" element={<Security />} />
            <Route path="/labs" element={<LabManagement />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
