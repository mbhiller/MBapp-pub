import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { apiFetch } from "../lib/http";
import {
  searchBackorderRequests,
  ignoreBackorderRequest,
  convertBackorderRequest,
  type BackorderRequest,
} from "../lib/backorders";
import {
  suggestPo,
  createPurchaseOrderFromSuggestion,
  type SuggestPoResponse,
} from "../lib/purchasing";
import SuggestPoChooserModal, {
  type PurchaseOrderDraft,
} from "../components/SuggestPoChooserModal";
import VendorPicker from "../components/VendorPicker";

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function BackordersListPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Read filter values from URL params
  const status = (searchParams.get("status") || "open") as "open" | "ignored" | "converted";
  // Prefer vendorId query param; fall back to preferredVendorId for compatibility
  const vendorFilter = searchParams.get("vendorId") || searchParams.get("preferredVendorId") || "";
  const soIdFilter = searchParams.get("soId") || "";
  const itemIdFilter = searchParams.get("itemId") || "";
  // Track next page cursor internally for stable append behavior
  const [pageNext, setPageNext] = useState<string | null>(null);
  
  const [items, setItems] = useState<BackorderRequest[]>([]);
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | React.ReactNode | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestResult, setSuggestResult] = useState<SuggestPoResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDrafts, setModalDrafts] = useState<PurchaseOrderDraft[]>([]);
  const [modalSkipped, setModalSkipped] = useState<Array<{ backorderRequestId: string; reason: string }> | undefined>();
  const [groupedView, setGroupedView] = useState(false);

  // Helper to update URL search params
  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      const newParams = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          newParams.delete(key);
        } else {
          newParams.set(key, value);
        }
      }
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  // Handlers for filter changes (update URL and reset pagination)
  const handleStatusChange = (newStatus: "open" | "ignored" | "converted") => {
    updateSearchParams({ status: newStatus });
    // Reset paging and UI selection/banners
    setItems([]);
    setSelected({});
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    setPageNext(null);
  };

  const handleVendorFilterChange = (newVendor: string) => {
    // Use vendorId in URL; remove legacy preferredVendorId param
    updateSearchParams({ vendorId: newVendor, preferredVendorId: null });
    setItems([]);
    setSelected({});
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    setPageNext(null);
  };

  const handleSoIdFilterChange = (newSoId: string) => {
    updateSearchParams({ soId: newSoId });
    setItems([]);
    setSelected({});
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    setPageNext(null);
  };

  const handleItemIdFilterChange = (newItemId: string) => {
    updateSearchParams({ itemId: newItemId });
    setItems([]);
    setSelected({});
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    setPageNext(null);
  };

  const handleLoadMore = () => {
    if (pageNext) fetchPage(pageNext);
  };

  const handleClearFilters = () => {
    updateSearchParams({
      status: "open",
      vendorId: null,
      preferredVendorId: null,
      soId: null,
      itemId: null,
    });
    setItems([]);
    setSelected({});
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    setPageNext(null);
  };

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const filter: any = { status };
        if (vendorFilter.trim()) filter.preferredVendorId = vendorFilter.trim();
        if (soIdFilter.trim()) filter.soId = soIdFilter.trim();
        if (itemIdFilter.trim()) filter.itemId = itemIdFilter.trim();

        const res = await searchBackorderRequests(filter, {
          token: token || undefined,
          tenantId,
          limit: 50,
          next: cursor || undefined,
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setPageNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [status, vendorFilter, soIdFilter, itemIdFilter, tenantId, token]
  );

  // Refetch when filters change; replace list
  useEffect(() => {
    fetchPage(undefined);
  }, [fetchPage, status, vendorFilter, soIdFilter, itemIdFilter]);

  // Fetch vendor names for display
  useEffect(() => {
    const preferredVendorIds = Array.from(
      new Set(items.map((bo) => bo.preferredVendorId).filter((v): v is string => Boolean(v)))
    );

    const missing = preferredVendorIds.filter((v) => !(v in vendorNameById));
    if (missing.length === 0) return;

    (async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (vendorId) => {
          try {
            const res = await apiFetch<{ name?: string; displayName?: string }>(`/objects/party/${vendorId}`, {
              token: token || undefined,
              tenantId,
            });
            const name = res?.name ?? res?.displayName ?? vendorId;
            entries[vendorId] = name;
          } catch {
            entries[vendorId] = vendorId;
          }
        })
      );
      setVendorNameById((prev) => ({ ...prev, ...entries }));
    })();
  }, [items, tenantId, token, vendorNameById]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSelectAll = () => {
    const allSelected = items.every((bo) => selected[bo.id]);
    if (allSelected) {
      setSelected({});
    } else {
      const newSelected: Record<string, boolean> = {};
      items.forEach((bo) => (newSelected[bo.id] = true));
      setSelected(newSelected);
    }
  };

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const handleIgnore = async (id: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await ignoreBackorderRequest(id, { token: token || undefined, tenantId });
      updateSearchParams({ next: null });
      setItems([]);
      await fetchPage();
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkIgnore = async () => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);

    // Optimistically remove selected items from the list
    const itemsBeforeAction = items;
    setItems((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
    setSelected({});

    try {
      // Call ignore for all selected items in parallel
      await Promise.all(
        selectedIds.map((id) => ignoreBackorderRequest(id, { token: token || undefined, tenantId }))
      );
      setActionInfo(`Ignored ${selectedIds.length} backorder request(s).`);
    } catch (err) {
      // Restore items on error
      setItems(itemsBeforeAction);
      setActionError(`Failed to ignore: ${formatError(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuggestPo = async () => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);
    setSuggestResult(null);
    try {
      // Step 1: Convert backorders
      await Promise.all(
        selectedIds.map((id) => convertBackorderRequest(id, { token: token || undefined, tenantId }))
      );

      // Step 2: Suggest PO
      const res = await suggestPo(
        { backorderRequestIds: selectedIds, vendorId: vendorFilter.trim() || undefined },
        { token: token || undefined, tenantId }
      );

      setSuggestResult(res);

      // Step 3: Handle response
      const drafts = res.drafts ?? (res.draft ? [res.draft] : []);
      if (drafts.length === 0) {
        if (res.skipped && res.skipped.length > 0) {
          setActionError(
            `No PO drafts created: all ${res.skipped.length} backorder(s) were skipped (see details below)`
          );
        } else {
          setActionError("No drafts returned from suggest-po");
        }
        // Do NOT clear selection here - let user retry after reviewing skipped reasons
        updateSearchParams({ next: null });
        setItems([]);
        await fetchPage();
        return;
      }

      // For single draft: create and navigate immediately
      if (drafts.length === 1) {
        const createRes = await createPurchaseOrderFromSuggestion(
          { draft: drafts[0] },
          { token: token || undefined, tenantId }
        );
        const ids = Array.isArray(createRes.ids) ? createRes.ids : (createRes.id ? [createRes.id] : []);
        const createdId = ids[0];
        if (createdId) {
          if (ids.length > 1) setActionInfo(`Created ${ids.length} purchase orders; opening the first.`);
          setSelected({});
          updateSearchParams({ next: null });
          setItems([]);
          await fetchPage();
          navigate(`/purchase-orders/${createdId}`);
        } else {
          setActionError("PO created but no ID returned");
        }
        return;
      }

      // For multiple drafts: show chooser modal
      setModalDrafts(drafts);
      setModalSkipped(res.skipped);
      setModalOpen(true);
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const allSelected = items.length > 0 && items.every((bo) => selected[bo.id]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Backorders</h1>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            Status:
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as "open" | "ignored" | "converted")}
              style={{ minWidth: 120 }}
            >
              <option value="open">open</option>
              <option value="ignored">ignored</option>
              <option value="converted">converted</option>
            </select>
          </label>
          <div style={{ flex: 1 }}>
            <VendorPicker
              value={vendorFilter}
              onChange={handleVendorFilterChange}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            SO ID:
            <input
              value={soIdFilter}
              onChange={(e) => handleSoIdFilterChange(e.target.value)}
              placeholder="Optional: filter by SO ID"
              style={{ minWidth: 160 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            Item ID:
            <input
              value={itemIdFilter}
              onChange={(e) => handleItemIdFilterChange(e.target.value)}
              placeholder="Optional: filter by item ID"
              style={{ minWidth: 160 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={groupedView}
              onChange={(e) => setGroupedView(e.target.checked)}
            />
            Grouped view
          </label>
          <button onClick={() => fetchPage(undefined)} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button onClick={handleClearFilters} disabled={loading}>
            Clear filters
          </button>
        </div>

        {selectedIds.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: 8, background: "#e3f2fd", borderRadius: 4 }}>
            <span style={{ fontWeight: 600 }}>{selectedIds.length} selected</span>
            <button onClick={handleBulkIgnore} disabled={actionLoading || selectedIds.length === 0}>
              {actionLoading ? "Ignoring..." : "Bulk Ignore"}
            </button>
            <button onClick={handleSuggestPo} disabled={actionLoading || selectedIds.length === 0}>
              {actionLoading ? "Processing..." : "Suggest PO"}
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div>
      ) : null}

      {actionError ? (
        <div style={{ padding: 12, background: "#fff4e5", color: "#8a3c00", borderRadius: 4 }}>{actionError}</div>
      ) : null}

      {actionInfo ? (
        <div style={{ padding: 12, background: "#e8f5e9", color: "#1b5e20", borderRadius: 4 }}>{actionInfo}</div>
      ) : null}

      {suggestResult?.skipped && suggestResult.skipped.length > 0 && (
        <div style={{ padding: 12, background: "#fff9c4", color: "#6d4c00", borderRadius: 4 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>⚠ Skipped {suggestResult.skipped.length} backorder request(s)</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12, fontStyle: "italic" }}>
              These could not be converted to PO draft. Review reasons below and retry if needed.
            </p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#ffe082" }}>
                  <th style={{ padding: 6, border: "1px solid #fbc02d", textAlign: "left" }}>Backorder ID</th>
                  <th style={{ padding: 6, border: "1px solid #fbc02d", textAlign: "left" }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {suggestResult.skipped.map((s, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: 6, border: "1px solid #fbc02d" }}>{s.backorderRequestId}</td>
                    <td style={{ padding: 6, border: "1px solid #fbc02d" }}>
                      {(() => {
                        const map: Record<string, string> = {
                          no_preferred_vendor: "No preferred vendor set",
                          no_vendor: "No vendor available",
                          already_converted: "Already converted to PO",
                          already_fulfilled: "Already fulfilled",
                          invalid_backorder: "Invalid backorder request",
                          unsupported_item: "Item not eligible for purchase",
                        };
                        const r = s.reason || "unknown";
                        return map[r] || r.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? <div>Loading...</div> : null}
      {!loading && items.length === 0 ? <div>No backorders found.</div> : null}

      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#eee" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Item</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>SO</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Vendor</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupedView
              ? Object.entries(
                  items.reduce<Record<string, BackorderRequest[]>>((acc, bo) => {
                    const key = bo.preferredVendorId || "__UNASSIGNED__";
                    (acc[key] ||= []).push(bo);
                    return acc;
                  }, {})
                ).map(([vendorId, rows]) => {
                  const headerName = vendorId === "__UNASSIGNED__" ? "Unassigned" : (vendorNameById[vendorId] ?? vendorId);
                  const totalQty = rows.reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
                  return (
                    <>
                      <tr key={`h-${vendorId}`} style={{ background: "#f5f5f5" }}>
                        <td colSpan={7} style={{ padding: 8, border: "1px solid #ccc", fontWeight: 600 }}>
                          {headerName} — {rows.length} backorder(s), total qty {totalQty}
                        </td>
                      </tr>
                      {rows.map((bo) => (
                        <tr key={bo.id}>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>
                            <input
                              type="checkbox"
                              checked={!!selected[bo.id]}
                              onChange={() => toggleSelect(bo.id)}
                            />
                          </td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>
                            {bo.itemId ? (
                              <Link to={`/inventory/${bo.itemId}`}>{bo.itemId}</Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.qty ?? 0}</td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>
                            {bo.soId ? (
                              <Link to={`/sales-orders/${bo.soId}`}>{bo.soId}</Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.status ?? "—"}</td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>
                            {bo.preferredVendorId
                              ? vendorNameById[bo.preferredVendorId] ?? bo.preferredVendorId
                              : "Unassigned"}
                          </td>
                          <td style={{ padding: 8, border: "1px solid #ccc" }}>
                            {bo.status === "open" && (
                              <button
                                onClick={() => handleIgnore(bo.id)}
                                disabled={actionLoading}
                                style={{ fontSize: 12, padding: "4px 8px" }}
                              >
                                Ignore
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })
              : items.map((bo) => (
                  <tr key={bo.id}>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>
                      <input
                        type="checkbox"
                        checked={!!selected[bo.id]}
                        onChange={() => toggleSelect(bo.id)}
                      />
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>
                      {bo.itemId ? (
                        <Link to={`/inventory/${bo.itemId}`}>{bo.itemId}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.qty ?? 0}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>
                      {bo.soId ? (
                        <Link to={`/sales-orders/${bo.soId}`}>{bo.soId}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.status ?? "—"}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>
                      {bo.preferredVendorId
                        ? vendorNameById[bo.preferredVendorId] ?? bo.preferredVendorId
                        : "Unassigned"}
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>
                      {bo.status === "open" && (
                        <button
                          onClick={() => handleIgnore(bo.id)}
                          disabled={actionLoading}
                          style={{ fontSize: 12, padding: "4px 8px" }}
                        >
                          Ignore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      ) : null}

      {pageNext ? (
        <button onClick={handleLoadMore} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}

      <SuggestPoChooserModal
        open={modalOpen}
        drafts={modalDrafts}
        skipped={modalSkipped}
        onClose={() => {
          setModalOpen(false);
          setModalDrafts([]);
          setModalSkipped(undefined);
        }}
        onChoose={async (draft) => {
          setModalOpen(false);
          setActionLoading(true);
          setActionError(null);
          setActionInfo(null);
          try {
            const createRes = await createPurchaseOrderFromSuggestion(
              { draft },
              { token: token || undefined, tenantId }
            );
            const ids = Array.isArray(createRes.ids) ? createRes.ids : (createRes.id ? [createRes.id] : []);
            const createdId = ids[0];
            if (createdId) {
              if (ids.length > 1) setActionInfo(`Created ${ids.length} purchase orders; opening the first.`);
              setSelected({});
              setModalDrafts([]);
              setModalSkipped(undefined);
              updateSearchParams({ next: null });
              setItems([]);
              await fetchPage();
              navigate(`/purchase-orders/${createdId}`);
            } else {
              setActionError("PO created but no ID returned");
            }
          } catch (err) {
            setActionError(formatError(err));
          } finally {
            setActionLoading(false);
          }
        }}
        onChooseMultiple={async (drafts) => {
          setModalOpen(false);
          setActionLoading(true);
          setActionError(null);
          setActionInfo(null);
          try {
            // Create all selected POs in parallel
            const createResPromises = drafts.map((draft) =>
              createPurchaseOrderFromSuggestion(
                { draft },
                { token: token || undefined, tenantId }
              )
            );
            const createResults = await Promise.all(createResPromises);

            // Collect all created IDs
            const allIds: string[] = [];
            for (const res of createResults) {
              const ids = Array.isArray(res.ids) ? res.ids : (res.id ? [res.id] : []);
              allIds.push(...ids);
            }

            if (allIds.length === 0) {
              setActionError("No POs created");
              return;
            }

            // Clean up and refetch
            setSelected({});
            setModalDrafts([]);
            setModalSkipped(undefined);
            updateSearchParams({ next: null });
            setItems([]);
            await fetchPage();

            // Show info message with navigation
            if (allIds.length === 1) {
              navigate(`/purchase-orders/${allIds[0]}`);
            } else {
              setActionInfo(
                <div>
                  <p>Created {allIds.length} purchase orders:</p>
                  <div style={{ marginTop: 8 }}>
                    {allIds.map((id) => (
                      <div key={id} style={{ marginBottom: 4 }}>
                        <button
                          onClick={() => navigate(`/purchase-orders/${id}`)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#1976d2",
                            cursor: "pointer",
                            textDecoration: "underline",
                            padding: 0,
                          }}
                        >
                          {id}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
          } catch (err) {
            setActionError(formatError(err));
          } finally {
            setActionLoading(false);
          }
        }}
        vendorNameById={vendorNameById}
        token={token || undefined}
        tenantId={tenantId}
      />
    </div>
  );
}
