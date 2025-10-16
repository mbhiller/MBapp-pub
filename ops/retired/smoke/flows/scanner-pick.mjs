/* Seeds an SO via /objects/salesOrder, maps an EPC, RECEIVES to seed on-hand,
   RESERVES the line, then PICK succeeds. */
import { api, rid, createObject, getObject } from "../core.mjs";

function randEpc() {
  return "EPC-" + Math.random().toString(16).slice(2, 10).toUpperCase();
}

export async function run({ qty = 1, code = "scanpick" } = {}) {
  const tag = rid(code);
  const epc = randEpc();
  const itemId = `item-${tag}`;
  const desiredLineId = `ln-${tag}`;

  // 1) Create Sales Order (OBJECTS API) with explicit line.id
  const so = await createObject("salesOrder", {
    type: "salesOrder",
    status: "draft",
    customerName: "smoke-customer",
    externalId: tag,
    lines: [{ id: desiredLineId, itemId, qty }],
  });

  // Resolve ids robustly
  let soId = so?.id;
  let line = Array.isArray(so?.lines) ? so.lines.find((l) => String(l.itemId) === itemId) : null;
  if (!line || !line.id || !soId) {
    const fetched = soId ? await getObject("salesOrder", soId) : null;
    soId = fetched?.id || soId;
    line = Array.isArray(fetched?.lines)
      ? fetched.lines.find((l) => String(l.itemId) === itemId)
      : line;
  }
  if (!soId || !line?.id) {
    return {
      test: "scanner:pick",
      result: "FAIL",
      step: "so-create",
      so,
      note: "Missing line.id; we create with explicit id. Verify objects layer keeps it.",
    };
  }

  // 2) Map EPC -> itemId (OBJECTS API; id === EPC)
  const epcMap = await createObject("epcMap", {
    id: epc,
    type: "epcMap",
    itemId,
    status: "active",
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));
  if (epcMap?.status >= 400) {
    return { test: "scanner:pick", result: "FAIL", step: "epcMap", epcMap };
  }

  // 3) Start scanner session
  const session = await api("/scanner/sessions", { method: "POST", body: { op: "start" } })
    .catch((e) => ({ status: e?.status || 500, err: e?.message }));
  const sessionId = session?.id;
  if (!sessionId) return { test: "scanner:pick", result: "FAIL", step: "session-start", session };

  // 4) RECEIVE first to seed physical on-hand (idempotent for same EPC)
  const recv = await api("/scanner/actions", {
    method: "POST",
    body: { sessionId, epc, action: "receive" },
    headers: { "Idempotency-Key": `scan-${epc}` },
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));
  if (recv?.status >= 400) {
    await api("/scanner/sessions", { method: "POST", body: { op: "stop", sessionId } }).catch(() => {});
    return { test: "scanner:pick", result: "FAIL", step: "receive", recv };
  }

  // 5) Now RESERVE the line (on-hand exists, so this should pass)
  const reserve = await api(`/sales/so/${encodeURIComponent(soId)}:reserve`, {
    method: "POST",
    body: { lines: [{ lineId: line.id, deltaQty: qty }] },
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));
  if (reserve?.status >= 400) {
    await api("/scanner/sessions", { method: "POST", body: { op: "stop", sessionId } }).catch(() => {});
    return { test: "scanner:pick", result: "FAIL", step: "reserve", reserve };
  }

  // 6) PICK (guardrails satisfied: reserved + on-hand)
  const pick = await api("/scanner/actions", {
    method: "POST",
    body: { sessionId, epc, action: "pick" },
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));

  // 7) Stop session (best effort)
  await api("/scanner/sessions", { method: "POST", body: { op: "stop", sessionId } }).catch(() => {});

  if (pick?.status >= 400) {
    return { test: "scanner:pick", result: "FAIL", step: "pick", pick };
  }

  return { test: "scanner:pick", result: "PASS", soId, lineId: line.id, itemId, epc };
}
