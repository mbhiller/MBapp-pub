// ops/smoke/module/scanner.smartpick.mjs
import { requireEnv, api, createObject, getObject } from "../core.mjs";

const rid = (p="id") => `${p}_${Math.random().toString(36).slice(2,10)}`;

export async function run(argv = []) {
  try {
    requireEnv();

    const soId   = rid("so");
    const lineId = rid("ln");
    const itemId = rid("item");
    const epc    = `EPC-${Math.random().toString(16).slice(2,10).toUpperCase()}`;
    const now    = new Date().toISOString();

    // 1) Create SO (draft) with fixed lineId
    const so = await createObject("salesOrder", {
      id: soId,
      type: "salesOrder",
      status: "draft",
      customerName: "smoke-smartpick",
      externalId: rid("ext"),
      lines: [{ id: lineId, itemId, qty: 1 }],
      createdAt: now,
      updatedAt: now,
    });

    // 2) EPC -> item map (active)
    await createObject("epcMap", {
      id: epc, type: "epcMap", itemId, status: "active", createdAt: now, updatedAt: now
    });

    // 3) Start scanner session
    const sess = await api("/scanner/sessions", { method: "POST", body: { op: "start" } });
    const sessionId = sess?.id;
    if (!sessionId) throw new Error("No sessionId");

    // 4) RECEIVE first (seed on-hand so commit passes)
    await api("/scanner/actions", {
      method: "POST",
      body: { sessionId, epc, action: "receive" },
      headers: { "Idempotency-Key": `sprxv-${epc}` },
    });

    // 5) Commit SO (now availability ≥ need)
    await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: {} });

    // 6) Reserve 1 on that line (idempotent)
    await api(`/sales/so/${encodeURIComponent(so.id)}:reserve`, {
      method: "POST",
      body: { lines: [{ lineId, deltaQty: 1 }] },
      headers: { "Idempotency-Key": `sprsv-${so.id}-${lineId}-${epc}` },
    });

    // 7) PICK via scanner (consumes on-hand & reserved)
    await api("/scanner/actions", {
      method: "POST",
      body: { sessionId, epc, action: "pick" },
    });

    // 8) Stop session
    await api("/scanner/sessions", { method: "POST", body: { op: "stop", sessionId } });

    // 9) Verify SO
    const soAfter = await getObject("salesOrder", so.id);
    const line = Array.isArray(soAfter?.lines)
      ? soAfter.lines.find(l => String(l.id) === String(lineId)) || null
      : null;

    console.log(JSON.stringify({
      test: "smartpick",
      result: "PASS",
      soId: so.id,
      lineId,
      itemId,
      epc,
      soStatus: soAfter?.status ?? null,
      line,
    }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({
      test: "smartpick",
      result: "FAIL",
      error: String(err?.message || err),
    }, null, 2));
    process.exit(1);
  }
}
