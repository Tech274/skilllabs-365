import { useAuth } from "@/hooks/use-auth";
import { Navigate } from "react-router-dom";

type AppRole = "admin" | "instructor" | "student" | "super_admin" | "content_admin";

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

  const effectiveAllowed =
    allowedRoles.includes("admin") && !allowedRoles.includes("super_admin")
      ? [...allowedRoles, "super_admin" as const]
      : allowedRoles;

  if (role && !effectiveAllowed.includes(role)) {
    const redirectPath =
      role === "admin" || role === "super_admin"
        ? "/"
        : role === "instructor"
          ? "/instructor"
          : "/student";
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
};

export default RoleProtectedRoute;
