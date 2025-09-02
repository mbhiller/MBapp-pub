'use strict';

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': '*'
};

module.exports.handler = async function (event) {
  try {
    const http  = (event && event.requestContext && event.requestContext.http) || {};
    const method = http.method || 'GET';
    const path   = ((event && event.rawPath) || '/').replace(/\/+$/, '');

    // CORS preflight
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }

    if (path === '/tenants') {
      return { statusCode: 200, headers, body: JSON.stringify([{ id: 'demo', name: 'Demo Tenant' }]) };
    }

    if (path === '/devices') {
      return { statusCode: 200, headers, body: JSON.stringify([{ id: 'dev-001', tag: 'RFID-ABC123', tenantId: 'demo' }]) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path, method }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.stack || e) }) };
  }
};
