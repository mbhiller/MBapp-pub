import { useEffect, useState } from "react";
import { apiFetch } from "../lib/http";

export type PurchaseOrderDraft = {
  id?: string;
  vendorId?: string;
  vendorName?: string;
  lines?: Array<{
    id?: string;
    lineId?: string;
    itemId?: string;
    qty?: number;
    [key: string]: any;
  }>;
  [key: string]: any;
};

export type SuggestPoChooserModalProps = {
  open: boolean;
  drafts: PurchaseOrderDraft[];
  onClose: () => void;
  onChoose: (draft: PurchaseOrderDraft) => void;
  vendorNameById?: Record<string, string>;
  token?: string;
  tenantId: string;
};

export default function SuggestPoChooserModal({
  open,
  drafts,
  onClose,
  onChoose,
  vendorNameById: providedVendorNames,
  token,
  tenantId,
}: SuggestPoChooserModalProps) {
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>(
    providedVendorNames ?? {}
  );

  // Fetch missing vendor names
  useEffect(() => {
    if (!open) return;

    const vendorIds = Array.from(
      new Set(drafts.map((d) => d.vendorId).filter((v): v is string => Boolean(v)))
    );
    const missing = vendorIds.filter((v) => !(v in vendorNameById));
    if (missing.length === 0) return;

    (async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (vendorId) => {
          try {
            const res = await apiFetch<{ name?: string; displayName?: string }>(
              `/objects/party/${vendorId}`,
              { token, tenantId }
            );
            entries[vendorId] = res?.name ?? res?.displayName ?? vendorId;
          } catch {
            entries[vendorId] = vendorId;
          }
        })
      );
      setVendorNameById((prev) => ({ ...prev, ...entries }));
    })();
  }, [open, drafts, tenantId, token, vendorNameById]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          maxWidth: 600,
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Choose Purchase Order</h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p style={{ color: "#666", marginBottom: 16 }}>
          Multiple vendors detected. Select which purchase order to create:
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {drafts.map((draft, idx) => {
            const vendorId = draft.vendorId ?? "Unknown";
            const vendorName = vendorNameById[vendorId] ?? vendorId;
            const lineCount = draft.lines?.length ?? 0;
            const totalQty = draft.lines?.reduce((sum, line) => sum + (line.qty ?? 0), 0) ?? 0;

            return (
              <button
                key={idx}
                onClick={() => onChoose(draft)}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 16,
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  background: "#f9f9f9",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#e3f2fd")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f9f9f9")}
              >
                <div style={{ fontSize: 16, fontWeight: 600 }}>{vendorName}</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  {lineCount} line{lineCount !== 1 ? "s" : ""} · {totalQty} total qty
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
