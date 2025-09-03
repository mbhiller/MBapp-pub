export const json = (statusCode: number, body: any) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const ok = (body: any) => json(200, body);
export const created = (body: any) => json(201, body);
export const bad = (message: string) => json(400, { error: message });
export const unauthorized = (message = "unauthorized") => json(401, { error: message });
export const notfound = (message = "not found") => json(404, { error: message });
export const servererr = (message = "internal error") => json(500, { error: message });