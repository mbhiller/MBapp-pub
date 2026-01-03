import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";

export function ProtectedRoute({
  requiredPerm,
  children,
}: {
  requiredPerm: string;
  children: ReactNode;
}) {
  const { token, policy, policyLoading, policyError } = useAuth();
  const location = useLocation();

  // If policy is still loading, show minimal loading UI
  if (policyLoading) {
    return <div style={{ padding: 16 }}>Loading permissions...</div>;
  }

  // If no token, redirect to not-authorized
  if (!token) {
    return <Navigate to="/not-authorized" state={{ reason: "no-token" }} replace />;
  }

  // If policy fetch failed, redirect to not-authorized
  if (policyError) {
    return <Navigate to="/not-authorized" state={{ reason: "policy-error" }} replace />;
  }

  // If permission not granted, redirect to not-authorized
  if (!hasPerm(policy, requiredPerm)) {
    return (
      <Navigate
        to="/not-authorized"
        state={{ reason: "missing-permission", requiredPerm }}
        replace
      />
    );
  }

  // Permission granted, render children
  return <>{children}</>;
}
