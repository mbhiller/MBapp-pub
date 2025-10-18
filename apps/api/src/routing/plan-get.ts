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
  const id = event?.pathParameters?.id;
  // MVP: no persistence yet — return 404 (smokes do not call GET/{id})
  return json(404, { message: `RoutePlan ${id} not found (storage not wired yet)` });
}
