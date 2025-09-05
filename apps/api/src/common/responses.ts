// backend/src/common/responses.ts
type Headers = Record<string, string>;
const baseHeaders: Headers = { 'content-type': 'application/json' };

const json = (status: number, body: any, extra: Headers = {}) => ({
  statusCode: status,
  headers: { ...baseHeaders, ...extra },
  body: JSON.stringify(body),
});

export const ok = (data: any, extra?: Headers) => json(200, data, extra);
export const bad = (msg: string, code = 'BadRequest', extra?: Headers) =>
  json(400, { error: msg, code }, extra);
export const notfound = (msg: string, code = 'NotFound', extra?: Headers) =>
  json(404, { error: msg, code }, extra);
export const error = (msg = 'Internal error', extra?: Headers) =>
  json(500, { error: msg }, extra);

export const redirect308 = (location: string) => ({
  statusCode: 308,
  headers: { Location: location },
});
