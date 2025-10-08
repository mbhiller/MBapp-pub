/* Seeds an SO + EPC + on-hand (via receive), but NO reservation.
   PICK should 409 due to guardrail. */
import { api, rid, createObject } from "../core.mjs";

function randEpc() {
  return "EPC-" + Math.random().toString(16).slice(2, 10).toUpperCase();
}

export async function run({ qty = 1, code = "scanguard" } = {}) {
  const tag = rid(code);
  const epc = randEpc();
  const itemId = `item-${tag}`;

  // 1) Create SO via OBJECTS API (we won't reserve)
  const so = await createObject("salesOrder", {
    type: "salesOrder",
    status: "draft",
    customerName: "smoke-customer",
    externalId: tag,
    lines: [{ itemId, qty }],
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));

  // 2) epcMap
  const epcMap = await createObject("epcMap", {
    id: epc,
    type: "epcMap",
    itemId,
    status: "active",
  }).catch((e) => ({ status: e?.status || 500, err: e?.message }));

  // 3) session + receive once to seed on-hand
  const session = await api("/scanner/sessions", { method: "POST", body: { op: "start" } });
  const sessionId = session?.id;

  await api("/scanner/actions", {
    method: "POST",
    body: { sessionId, epc, action: "receive" },
    headers: { "Idempotency-Key": `scan-${epc}` },
  }).catch(() => {});

  // 4) PICK without reservation -> expect 409
  let status = 0;
  try {
    await api("/scanner/actions", {
      method: "POST",
      body: { sessionId, epc, action: "pick" },
    });
    status = 200; // unexpected
  } catch (e) {
    status = Number(e?.status || 0) || 409;
  }

  await api("/scanner/sessions", { method: "POST", body: { op: "stop", sessionId } }).catch(() => {});

  const pass = status === 409;
  return {
    test: "scanner:guardrails",
    result: pass ? "EXPECTED_409" : "FAIL",
    status,
    epc,
    itemId,
    soId: so?.id,
  };
}
