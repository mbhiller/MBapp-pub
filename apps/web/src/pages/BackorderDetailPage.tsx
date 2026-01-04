import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { getObjectAuthed, getInventoryByEitherType } from "../lib/api";
import { track } from "../lib/telemetry";
import * as Sentry from "@sentry/browser";
import { ignoreBackorderRequest, convertBackorderRequest, type BackorderRequest } from "../lib/backorders";
import { PERM_OBJECTS_WRITE, PERM_PURCHASE_WRITE } from "../generated/permissions";

type SalesOrder = {
  id: string;
  status?: string;
  partyId?: string;
  createdAt?: string;
};

type InventoryItem = {
  id: string;
  itemId?: string;
  productId?: string;
  name?: string;
  description?: string;
};

type Party = {
  id: string;
  name?: string;
  type?: string;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

type RelatedObjectWarning = {
  type: "salesOrder" | "inventory" | "party";
  id: string;
  notFound: boolean;
  error: string | null;
};

function getStatusColor(status?: string): string {
  switch (status) {
    case "open": return "#b00020";
    case "converted": return "#1976d2";
    case "fulfilled": return "#2e7d32";
    case "ignored": return "#666";
    default: return "#999";
  }
}

function getStatusBgColor(status?: string): string {
  switch (status) {
    case "open": return "#fee";
    case "converted": return "#f0f7ff";
    case "fulfilled": return "#e8f5e9";
    case "ignored": return "#f5f5f5";
    default: return "#fafafa";
  }
}

export default function BackorderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId, policy, policyLoading } = useAuth();
  const navigate = useNavigate();

  // Auth readiness: both token and tenantId must be present
  const authReady = Boolean(token && tenantId);

  // Fail-closed permission checks (using ergonomic permission aliases)
  const canWriteBackorders = hasPerm(policy, PERM_OBJECTS_WRITE) && !policyLoading;
  const canSuggestPO = hasPerm(policy, PERM_PURCHASE_WRITE) && !policyLoading;

  const [backorder, setBackorder] = useState<BackorderRequest | null>(null);
  const [salesOrder, setSalesOrder] = useState<SalesOrder | null>(null);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [vendor, setVendor] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [warnings, setWarnings] = useState<RelatedObjectWarning[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [convertLoading, setConvertLoading] = useState(false);

  /**
   * Safe GET helper: attempts to fetch a related object.
   * Returns structured result instead of throwing on 404.
   * Assumes authReady is true before calling.
   */
  const safeGet = async <T,>(type: string, id: string): Promise<{ value: T | null; notFound: boolean; error: any | null }> => {
    try {
      const value = await getObjectAuthed<T>(type, id, { token: token!, tenantId: tenantId! });
      return { value, notFound: false, error: null };
    } catch (err) {
      const e = err as any;
      const is404 = e?.status === 404 || e?.statusCode === 404;
      return { value: null, notFound: is404, error: is404 ? null : err };
    }
  };

  /**
   * Fetch main backorder (required).
   * Throws if missing/404.
   * Assumes authReady is true before calling.
   */
  const fetchBackorder = async (boId: string) => {
    try {
      const bo = await getObjectAuthed<BackorderRequest>("backorderRequest", boId, { token: token!, tenantId: tenantId! });
      setBackorder(bo);
      return bo;
    } catch (err) {
      const e = err as any;
      if (e?.status === 404 || e?.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(formatError(err));
      }
      throw err;
    }
  };

  /**
   * Fetch related objects (best-effort).
   * Collects warnings for missing/failed objects, does not throw.
   */
  const fetchRelated = async (bo: BackorderRequest) => {
    const collectedWarnings: RelatedObjectWarning[] = [];

    // Fetch related sales order
    if (bo.soId) {
      const { value: so, notFound, error } = await safeGet<SalesOrder>("salesOrder", bo.soId);
      if (so) {
        setSalesOrder(so);
      } else if (notFound || error) {
        collectedWarnings.push({
          type: "salesOrder",
          id: bo.soId,
          notFound: notFound,
          error: error ? formatError(error) : null,
        });
      }
    }

    // Fetch related inventory item (resilient: tries inventoryItem, falls back to inventory)
    if (bo.itemId) {
      try {
        if (import.meta.env.DEV) {
          console.debug("[BackorderDetailPage] Attempting to fetch inventory for itemId:", bo.itemId);
        }
        const inv = await getInventoryByEitherType<InventoryItem>(bo.itemId, { token: token!, tenantId: tenantId! });
        if (import.meta.env.DEV) {
          console.debug("[BackorderDetailPage] Inventory fetch result:", { itemId: bo.itemId, found: !!inv });
        }
        if (inv) {
          setItem(inv);
        } else {
          // Both inventoryItem and inventory types returned 404
          collectedWarnings.push({
            type: "inventory",
            id: bo.itemId,
            notFound: true,
            error: null,
          });
        }
      } catch (err) {
        // Non-404 error (auth, network, etc.)
        if (import.meta.env.DEV) {
          console.debug("[BackorderDetailPage] Inventory fetch error:", { itemId: bo.itemId, error: (err as any)?.message });
        }
        collectedWarnings.push({
          type: "inventory",
          id: bo.itemId,
          notFound: false,
          error: formatError(err),
        });
      }
    }

    // Fetch vendor if present
    if (bo.preferredVendorId) {
      const { value: v, notFound, error } = await safeGet<Party>("party", bo.preferredVendorId);
      if (v) {
        setVendor(v);
      } else if (notFound || error) {
        collectedWarnings.push({
          type: "party",
          id: bo.preferredVendorId,
          notFound: notFound,
          error: error ? formatError(error) : null,
        });
      }
    }

    setWarnings(collectedWarnings);
  };

  /**
   * Main fetch orchestrator.
   */
  const fetchDetail = async () => {
    // Early returns
    if (!id || !id.trim()) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    if (!authReady) {
      // Wait for auth to be ready
      setLoading(true);
      return;
    }

    // Reset stale state before refetch
    setLoading(true);
    setError(null);
    setNotFound(false);
    setWarnings([]);

    try {
      // Fetch required backorder (will throw on 404)
      const bo = await fetchBackorder(id);
      
      // Fetch related objects (best-effort, collects warnings)
      await fetchRelated(bo);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id, authReady]);

  // Track screen view when backorder is loaded
  useEffect(() => {
    if (id && backorder?.id) {
      track("BackorderDetail_Viewed", { objectType: "backorderRequest", objectId: id });
    }
  }, [id, backorder?.id]);

  const handleIgnore = async () => {
    if (!id || backorder?.status !== "open" || !token) return;
    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await ignoreBackorderRequest(id, { token, tenantId });
      // UX event: ignore clicked (success)
      track("BO_Ignore_Clicked", { objectType: "backorderRequest", objectId: id, result: "success" });
      await fetchDetail(); // Refetch to get updated status
      setActionInfo("Backorder ignored and refreshed.");
    } catch (err) {
      setActionError(formatError(err));
      // UX event: ignore clicked (fail)
      const code = (err as any)?.code || (err as any)?.status || undefined;
      track("BO_Ignore_Clicked", { objectType: "backorderRequest", objectId: id, result: "fail", errorCode: code });
      // Sentry capture with tags
      try {
        Sentry.captureException(err as any, {
          tags: { tenantId, route: window.location.pathname, objectType: "backorderRequest", objectId: id },
        });
      } catch {}
    } finally {
      setActionLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!id || backorder?.status !== "open" || !token) return;
    setConvertLoading(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await convertBackorderRequest(id, { token, tenantId });
      track("BO_Convert_Clicked", { objectType: "backorderRequest", objectId: id, result: "success" });
      await fetchDetail();
      setActionInfo("Backorder converted and refreshed.");
    } catch (err) {
      setActionError(formatError(err));
      const code = (err as any)?.code || (err as any)?.status || undefined;
      track("BO_Convert_Clicked", { objectType: "backorderRequest", objectId: id, result: "fail", errorCode: code });
      try {
        Sentry.captureException(err as any, {
          tags: { tenantId, route: window.location.pathname, objectType: "backorderRequest", objectId: id },
        });
      } catch {}
    } finally {
      setConvertLoading(false);
    }
  };

  const handleSuggestPo = () => {
    if (!id) return;
    navigate(`/backorders/${encodeURIComponent(id)}/suggest-po`, {
      state: { vendorId: backorder?.preferredVendorId },
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div>{authReady ? "Loading backorder detail..." : "Loading auth..."}</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ padding: 24, maxWidth: 600 }}>
        <div style={{ backgroundColor: "#fff3cd", border: "1px solid #ffc107", borderRadius: 4, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 8px 0", fontSize: 18, color: "#856404" }}>Backorder Not Found</h2>
          <p style={{ margin: 0, color: "#856404" }}>
            The backorder <code style={{ backgroundColor: "#fff", padding: "2px 6px", borderRadius: 2 }}>{id}</code> could not be found. It may have been deleted or the ID is incorrect.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/backorders")} style={{ padding: "8px 16px", cursor: "pointer" }}>
            ← Back to Backorders List
          </button>
          <button onClick={() => fetchDetail()} style={{ padding: "8px 16px", cursor: "pointer", backgroundColor: "#f5f5f5" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: "#b00020", marginBottom: 12 }}>Error: {error}</div>
        <button onClick={() => navigate("/backorders")}>← Back to Backorders List</button>
      </div>
    );
  }

  if (!backorder) {
    return (
      <div style={{ padding: 24 }}>
        <div>Backorder not found</div>
        <button onClick={() => navigate("/backorders")}>← Back to Backorders List</button>
      </div>
    );
  }

  const { remainingQty, fulfilledQty } = backorder;
  const hasProgressFields = remainingQty != null || fulfilledQty != null;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, marginBottom: 8 }}>Backorder Detail</h1>
          <div style={{ fontSize: 14, color: "#666" }}>ID: {backorder.id}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/backorders")}>← Back to List</button>
          {canSuggestPO && backorder.status === "open" && (
            <button
              onClick={handleSuggestPo}
              style={{
                backgroundColor: "#1976d2",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                cursor: "pointer",
                borderRadius: 4,
              }}
            >
              Suggest PO
            </button>
          )}
          {canWriteBackorders && backorder.status === "open" && (
            <button
              onClick={handleConvert}
              disabled={convertLoading}
              style={{
                backgroundColor: "#2e7d32",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                cursor: convertLoading ? "not-allowed" : "pointer",
                borderRadius: 4,
              }}
            >
              {convertLoading ? "Converting..." : "Convert"}
            </button>
          )}
          {canWriteBackorders && backorder.status === "open" && (
            <button
              onClick={handleIgnore}
              disabled={actionLoading}
              style={{
                backgroundColor: "#666",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                cursor: actionLoading ? "not-allowed" : "pointer",
                borderRadius: 4,
              }}
            >
              {actionLoading ? "Ignoring..." : "Ignore Backorder"}
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fee", color: "#b00020", borderRadius: 4 }}>
          Action Error: {actionError}
        </div>
      )}

      {actionInfo && (
        <div style={{ padding: 12, marginBottom: 16, background: "#e8f5e9", color: "#1b5e20", borderRadius: 4 }}>
          {actionInfo}
        </div>
      )}

      {/* Warnings for missing related objects */}
      {warnings.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 4 }}>
          <div style={{ fontWeight: 600, color: "#856404", marginBottom: 8 }}>Related Objects Not Found</div>
          {warnings.map((warning, idx) => (
            <div key={idx} style={{ fontSize: 13, color: "#856404", marginBottom: idx < warnings.length - 1 ? 6 : 0 }}>
              <strong>{warning.type}:</strong> {warning.id}
              {warning.error && <div style={{ fontSize: 12, marginLeft: 16, marginTop: 2 }}>{warning.error}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Status Badge */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "inline-block",
            padding: "6px 12px",
            background: getStatusBgColor(backorder.status),
            color: getStatusColor(backorder.status),
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {backorder.status || "unknown"}
        </div>
      </div>

      {/* Key Fields */}
      <div style={{ display: "grid", gap: 16, marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>Quantity:</div>
          <div>{backorder.qty ?? 0} units</div>
        </div>

        {hasProgressFields && (
          <>
            {fulfilledQty != null && (
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>Fulfilled Qty:</div>
                <div style={{ color: "#2e7d32" }}>{fulfilledQty} units</div>
              </div>
            )}
            {remainingQty != null && (
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>Remaining Qty:</div>
                <div style={{ color: remainingQty > 0 ? "#b00020" : "#2e7d32" }}>{remainingQty} units</div>
              </div>
            )}
            {fulfilledQty != null && backorder.qty && (
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>Progress:</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 20, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        background: "#2e7d32",
                        width: `${Math.min(100, (fulfilledQty / backorder.qty) * 100)}%`,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 13, color: "#666", minWidth: 50 }}>
                    {Math.round((fulfilledQty / backorder.qty) * 100)}%
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>Created:</div>
          <div>{backorder.createdAt ? new Date(backorder.createdAt).toLocaleString() : "—"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>Updated:</div>
          <div>{backorder.updatedAt ? new Date(backorder.updatedAt).toLocaleString() : "—"}</div>
        </div>
      </div>

      {/* Related Context */}
      <div style={{ display: "grid", gap: 24 }}>
        {/* Sales Order */}
        <div style={{ padding: 16, background: "#f9f9f9", borderRadius: 8, border: "1px solid #ddd" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Sales Order Context</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>SO ID:</div>
              <div>
                {backorder.soId ? (
                  <Link to={`/sales-orders/${backorder.soId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                    {backorder.soId} →
                  </Link>
                ) : (
                  "—"
                )}
              </div>
            </div>
            {salesOrder && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>SO Status:</div>
                  <div>{salesOrder.status || "—"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Customer:</div>
                  <div>
                    {salesOrder.partyId ? (
                      <Link to={`/parties/${salesOrder.partyId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                        {salesOrder.partyId} →
                      </Link>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>SO Line ID:</div>
              <div>{backorder.soLineId || "—"}</div>
            </div>
          </div>
        </div>

        {/* Item/Product */}
        <div style={{ padding: 16, background: "#f9f9f9", borderRadius: 8, border: "1px solid #ddd" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Item Context</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Item ID:</div>
              <div>
                {backorder.itemId ? (
                  <Link to={`/inventory/${backorder.itemId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                    {backorder.itemId} →
                  </Link>
                ) : (
                  "—"
                )}
              </div>
            </div>
            {item && (
              <>
                {item.name && (
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>Name:</div>
                    <div>{item.name}</div>
                  </div>
                )}
                {item.description && (
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>Description:</div>
                    <div>{item.description}</div>
                  </div>
                )}
                {item.productId && (
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>Product ID:</div>
                    <div>
                      <Link to={`/products/${item.productId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                        {item.productId} →
                      </Link>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Vendor (if present) */}
        {backorder.preferredVendorId && (
          <div style={{ padding: 16, background: "#f9f9f9", borderRadius: 8, border: "1px solid #ddd" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Vendor Context</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                <div style={{ fontWeight: 600 }}>Vendor ID:</div>
                <div>
                  {backorder.preferredVendorId ? (
                    <Link to={`/parties/${backorder.preferredVendorId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                      {backorder.preferredVendorId} →
                    </Link>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
              {vendor?.name && (
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Vendor Name:</div>
                  <div>{vendor.name}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PO Linkage Note */}
      <div style={{ marginTop: 32, padding: 16, background: "#f0f7ff", borderRadius: 8, border: "1px solid #cce5ff" }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>Purchase Order Linkage</div>
        <div style={{ fontSize: 14, color: "#555" }}>
          To find which PO lines are fulfilling this backorder, navigate to{" "}
          <Link
            to={`/purchase-orders?vendorId=${backorder.preferredVendorId || ""}&itemId=${backorder.itemId || ""}`}
            style={{ color: "#1976d2" }}
          >
            Purchase Orders
          </Link>{" "}
          and filter by vendor/item, or check PO detail pages for lines with matching backorder IDs.
        </div>
      </div>
    </div>
  );
}
