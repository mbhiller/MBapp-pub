import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm, normalizeRequired } from "../lib/permissions";

export function ProtectedRoute({
  requiredPerm,
  children,
}: {
  requiredPerm: string | string[];
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

  const requiredPerms = normalizeRequired(requiredPerm);
  let missing: string | null = null;
  for (const perm of requiredPerms) {
    if (!hasPerm(policy, perm)) {
      missing = perm;
      break;
    }
  }

  if (missing) {
    if (import.meta.env.DEV) {
      const hasSuper = Boolean(policy && policy["*"] === true);
      console.warn("ProtectedRoute: missing permission", {
        requiredPerms,
        missing,
        hasSuper,
      });
    }
    return (
      <Navigate
        to="/not-authorized"
        state={{ reason: "missing-permission", requiredPerm: requiredPerms.join(" ") }}
        replace
      />
    );
  }

  // Permission granted, render children
  return <>{children}</>;
}
