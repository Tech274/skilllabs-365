import { useAuth } from "@/hooks/use-auth";
import { Navigate } from "react-router-dom";

type AppRole = "admin" | "instructor" | "student";

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AppRole[];
}

const RoleProtectedRoute = ({ children, allowedRoles }: RoleProtectedRouteProps) => {
  const { session, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (role && !allowedRoles.includes(role)) {
    // Redirect to appropriate dashboard based on role
    const redirectPath = role === "admin" ? "/" : role === "instructor" ? "/instructor" : "/student";
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
};

export default RoleProtectedRoute;
