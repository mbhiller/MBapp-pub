// apps/mobile/src/providers/PolicyProvider.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { apiClient } from "../api/client";
import type { Policy } from "../lib/permissions";

type PolicyContextValue = {
  policy: Policy | null;
  policyLoading: boolean;
  policyError: string | null;
  refetchPolicy: () => Promise<void>;
};

const PolicyContext = createContext<PolicyContextValue | undefined>(undefined);

/**
 * PolicyProvider: Centralized policy state for mobile app.
 * Fetches /auth/policy once on mount and exposes to child screens.
 * 
 * Mirrors web's AuthProvider pattern but mobile-specific.
 */
export function PolicyProvider({ children }: { children: ReactNode }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true); // Start loading
  const [policyError, setPolicyError] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const p = await apiClient.get<Policy>("/auth/policy");
      if (p && typeof p === "object") {
        setPolicy(p);
      } else {
        // API returned null/invalid; treat as empty policy
        setPolicy({});
        setPolicyError("Policy fetch returned invalid data");
      }
    } catch (err: any) {
      console.error("PolicyProvider: failed to fetch policy", err);
      setPolicy({}); // Fail closed: empty policy
      setPolicyError(err?.message ?? "Failed to fetch policy");
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const value: PolicyContextValue = {
    policy,
    policyLoading,
    policyError,
    refetchPolicy: fetchPolicy,
  };

  return <PolicyContext.Provider value={value}>{children}</PolicyContext.Provider>;
}

/**
 * Hook to access policy state in any screen.
 * Throws if used outside PolicyProvider.
 * 
 * Usage:
 *   const { policy, policyLoading } = usePolicy();
 *   const canWrite = hasPerm(policy, "objects:write");
 */
export function usePolicy(): PolicyContextValue {
  const ctx = useContext(PolicyContext);
  if (!ctx) {
    throw new Error("usePolicy must be used within PolicyProvider");
  }
  return ctx;
}
