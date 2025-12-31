import { useEffect, useState } from "react";
import { apiFetch } from "../lib/http";
import type { PurchaseOrderDraft } from "../lib/api";

export type SkippedReason = {
  backorderRequestId: string;
  reason: string;
};

export type SuggestPoChooserModalProps = {
  open: boolean;
  drafts: PurchaseOrderDraft[];
  onClose: () => void;
  onChoose: (draft: PurchaseOrderDraft) => void;
  onChooseMultiple?: (drafts: PurchaseOrderDraft[]) => void;
  skipped?: SkippedReason[];
  vendorNameById?: Record<string, string>;
  token?: string;
  tenantId: string;
};

export default function SuggestPoChooserModal({
  open,
  drafts,
  onClose,
  onChoose,
  onChooseMultiple,
  skipped: skippedProps,
  vendorNameById: providedVendorNames,
  token,
  tenantId,
}: SuggestPoChooserModalProps) {
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>(
    providedVendorNames ?? {}
  );
  const [selectedDrafts, setSelectedDrafts] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const humanizeReason = (reason: string): string => {
    const map: Record<string, string> = {
      no_preferred_vendor: "No preferred vendor set",
      no_vendor: "No vendor available",
      already_converted: "Already converted to PO",
      already_fulfilled: "Already fulfilled",
      invalid_backorder: "Invalid backorder request",
      unsupported_item: "Item not eligible for purchase",
    };
    if (map[reason]) return map[reason];
    return reason.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  };

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

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (!open) setSelectedDrafts(new Set());
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const isSingleVendor = drafts.length === 1;
  const skipped = skippedProps ?? [];

  // Helper to toggle draft selection
  const toggleDraftSelection = (idx: number) => {
    setSelectedDrafts((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Helper to select/deselect all
  const toggleSelectAll = () => {
    if (selectedDrafts.size === drafts.length) {
      setSelectedDrafts(new Set());
    } else {
      setSelectedDrafts(new Set(drafts.map((_, idx) => idx)));
    }
  };

  // Get selected draft objects
  const selectedDraftObjects = Array.from(selectedDrafts)
    .sort((a, b) => a - b)
    .map((idx) => drafts[idx]);

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
          maxWidth: 700,
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>
            {isSingleVendor ? "Confirm Purchase Order" : "Review Purchase Order Drafts"}
          </h2>
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

        {/* Subtitle/instructions */}
        {!isSingleVendor && (
          <p style={{ color: "#666", marginBottom: 16 }}>
            {drafts.length} vendor{drafts.length !== 1 ? "s" : ""} detected.
            {onChooseMultiple
              ? " Select which purchase orders to create:"
              : " Select one to create:"}
          </p>
        )}
        {isSingleVendor && (
          <p style={{ color: "#666", marginBottom: 16 }}>
            Click "Create" to create this purchase order.
          </p>
        )}

        {/* Drafts list */}
        <div style={{ display: "grid", gap: 12, marginBottom: skipped.length > 0 ? 24 : 0 }}>
          {/* Select all / deselect all (only for multi-vendor + multi-select) */}
          {!isSingleVendor && onChooseMultiple && drafts.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, borderBottom: "1px solid #eee" }}>
              <input
                type="checkbox"
                checked={selectedDrafts.size === drafts.length}
                onChange={toggleSelectAll}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <label style={{ fontSize: 14, color: "#666", cursor: "pointer" }}>
                Select all ({selectedDrafts.size}/{drafts.length})
              </label>
            </div>
          )}

          {drafts.map((draft, idx) => {
            const vendorId = draft.vendorId ?? "Unknown";
            const vendorName = vendorNameById[vendorId] ?? vendorId;
            const lineCount = draft.lines?.length ?? 0;
            const totalQty = draft.lines?.reduce((sum, line) => sum + (line.qty ?? 0), 0) ?? 0;
            const isSelected = selectedDrafts.has(idx);

            const draftButton = (
              <button
                key={idx}
                onClick={() => {
                  if (submitting) return;
                  if (isSingleVendor) {
                    setSubmitting(true);
                    onChoose(draft);
                  } else if (onChooseMultiple) {
                    toggleDraftSelection(idx);
                  }
                }}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 16,
                  border: isSelected && !isSingleVendor ? "2px solid #1976d2" : "1px solid #ccc",
                  borderRadius: 4,
                  background: isSelected && !isSingleVendor ? "#e3f2fd" : "#f9f9f9",
                  cursor: submitting ? "not-allowed" : "pointer",
                  textAlign: "left",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (submitting) return;
                  if (!isSelected || isSingleVendor) {
                    e.currentTarget.style.background = "#e3f2fd";
                  }
                }}
                onMouseLeave={(e) => {
                  if (isSelected && !isSingleVendor) {
                    e.currentTarget.style.background = "#e3f2fd";
                  } else {
                    e.currentTarget.style.background = "#f9f9f9";
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {!isSingleVendor && onChooseMultiple && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => { if (!submitting) toggleDraftSelection(idx); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18, marginTop: 2, cursor: "pointer" }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{vendorName}</div>
                    <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>
                      {lineCount} line{lineCount !== 1 ? "s" : ""} · {totalQty} total qty
                    </div>
                  </div>
                </div>
              </button>
            );

            return (
              <div key={`group-${idx}`} style={{ display: "grid", gap: 6 }}>
                {!isSingleVendor && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
                    Vendor: {vendorName}
                  </div>
                )}
                {draftButton}
              </div>
            );
          })}
        </div>

        {/* Skipped reasons section */}
        {skipped.length > 0 && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "#d32f2f" }}>
              Skipped ({skipped.length})
            </h3>
            <div style={{ display: "grid", gap: 8 }}>
              {skipped.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 12,
                    border: "1px solid #ffebee",
                    borderRadius: 4,
                    background: "#fff5f5",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#c62828", marginBottom: 4 }}>
                    {item.backorderRequestId}
                  </div>
                  <div style={{ color: "#666", fontSize: 12 }}>
                    {humanizeReason(item.reason)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          {isSingleVendor ? (
            <button
              onClick={() => { setSubmitting(true); onChoose(drafts[0]); }}
              disabled={submitting}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 4,
                background: submitting ? "#ccc" : "#1976d2",
                color: "#fff",
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Create
            </button>
          ) : onChooseMultiple ? (
            <button
              onClick={() => { setSubmitting(true); onChooseMultiple(selectedDraftObjects); }}
              disabled={submitting || selectedDraftObjects.length === 0}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 4,
                background: selectedDraftObjects.length > 0 && !submitting ? "#1976d2" : "#ccc",
                color: "#fff",
                cursor: selectedDraftObjects.length > 0 && !submitting ? "pointer" : "not-allowed",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Create ({selectedDraftObjects.length})
            </button>
          ) : (
            <button
              onClick={() => {
                const idx = selectedDrafts.values().next().value;
                if (idx !== undefined) {
                  setSubmitting(true);
                  onChoose(drafts[idx]);
                }
              }}
              disabled={submitting || selectedDrafts.size === 0}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 4,
                background: selectedDrafts.size > 0 && !submitting ? "#1976d2" : "#ccc",
                color: "#fff",
                cursor: selectedDrafts.size > 0 && !submitting ? "pointer" : "not-allowed",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Create
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
