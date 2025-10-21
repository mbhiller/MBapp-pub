import type { APIGatewayProxyResultV2 } from "aws-lambda";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

export async function handle(event: any): Promise<APIGatewayProxyResultV2> {
  const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const edges = Array.isArray(body?.edges) ? body.edges : [];

  const nodeIds = new Set(nodes.map((n: any) => n?.id).filter(Boolean));
  for (const e of edges) {
    if (!e?.id || !nodeIds.has(e.fromNodeId) || !nodeIds.has(e.toNodeId)) {
      return json(400, { message: `Edge ${e?.id ?? "(missing id)"} references unknown node(s)` });
    }
  }

  // MVP: validation only (no persistence yet)
  return json(200, { ok: true, nodes: nodes.length, edges: edges.length });
}
