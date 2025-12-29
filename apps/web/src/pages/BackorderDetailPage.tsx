import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { getObject } from "../lib/api";
import { track } from "../lib/telemetry";
import * as Sentry from "@sentry/browser";
import { ignoreBackorderRequest, type BackorderRequest } from "../lib/backorders";

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
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();

  const [backorder, setBackorder] = useState<BackorderRequest | null>(null);
  const [salesOrder, setSalesOrder] = useState<SalesOrder | null>(null);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [vendor, setVendor] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch backorder
      const bo = await getObject<BackorderRequest>("backorderRequest", id);
      setBackorder(bo);

      // Fetch related SO
      if (bo.soId) {
        try {
          const so = await getObject<SalesOrder>("salesOrder", bo.soId);
          setSalesOrder(so);
        } catch (err) {
          console.warn("Failed to fetch SO:", err);
        }
      }

      // Fetch related item
      if (bo.itemId) {
        try {
          const inv = await getObject<InventoryItem>("inventory", bo.itemId);
          setItem(inv);
        } catch (err) {
          console.warn("Failed to fetch item:", err);
        }
      }

      // Fetch vendor if present
      if (bo.preferredVendorId) {
        try {
          const v = await getObject<Party>("party", bo.preferredVendorId);
          setVendor(v);
        } catch (err) {
          console.warn("Failed to fetch vendor:", err);
        }
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

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
    try {
      await ignoreBackorderRequest(id, { token, tenantId });
      // UX event: ignore clicked (success)
      track("BO_Ignore_Clicked", { objectType: "backorderRequest", objectId: id, result: "success" });
      await fetchDetail(); // Refetch to get updated status
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

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div>Loading backorder detail...</div>
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

  const remainingQty = (backorder as any).remainingQty;
  const fulfilledQty = (backorder as any).fulfilledQty;
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
          {backorder.status === "open" && (
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
                {salesOrder ? (
                  <Link to={`/sales-orders/${backorder.soId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                    {backorder.soId} →
                  </Link>
                ) : (
                  backorder.soId || "—"
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
                  <div>{salesOrder.partyId || "—"}</div>
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
                {item ? (
                  <Link to={`/inventory/${backorder.itemId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                    {backorder.itemId} →
                  </Link>
                ) : (
                  backorder.itemId || "—"
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
                  {vendor ? (
                    <Link to={`/parties/${backorder.preferredVendorId}`} style={{ color: "#1976d2", textDecoration: "none" }}>
                      {backorder.preferredVendorId} →
                    </Link>
                  ) : (
                    backorder.preferredVendorId
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
