#!/usr/bin/env node
// Dev/operator utility: retrieve a simulated public magic link from message records
// Usage:
//   node ops/tools/dev-get-public-magic-link.mjs --email dev@example.com --eventId evt_abc123
//   node ops/tools/dev-get-public-magic-link.mjs --email dev@example.com --eventId evt_abc123 --limit 20
//
// Prerequisites:
//   - MBAPP_API_BASE must be set (e.g., https://...)
//   - MBAPP_BEARER must be set to an operator token with message:read permission
//   - x-tenant-id header must be available via MBAPP_TENANT_ID env var
//
// Behavior:
//   - Queries GET /messages?to=<email>&channel=email&status=sent&limit=<limit>
//   - Scans newest-first for a message body containing the magic link pattern
//   - Prints the URL only (single line) if found
//   - Exit 0 on success, 2 if no link found, 1 for errors

import process from "node:process";

function parseArgs(argv) {
  const opts = { email: null, eventId: null, limit: 10 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email" && i + 1 < argv.length) opts.email = argv[++i];
    else if (arg.startsWith("--email=")) opts.email = arg.split("=")[1];
    else if (arg === "--eventId" && i + 1 < argv.length) opts.eventId = argv[++i];
    else if (arg.startsWith("--eventId=")) opts.eventId = arg.split("=")[1];
    else if (arg === "--limit" && i + 1 < argv.length) opts.limit = Number(argv[++i]) || opts.limit;
    else if (arg.startsWith("--limit=")) opts.limit = Number(arg.split("=")[1]) || opts.limit;
  }
  return opts;
}

const argv = parseArgs(process.argv.slice(2));
const API_BASE = process.env.MBAPP_API_BASE;
const BEARER = process.env.MBAPP_BEARER;
const TENANT_ID = process.env.MBAPP_TENANT_ID || "SmokeTenant";

// Validate inputs
if (!argv.email) {
  console.error("[dev-get-public-magic-link] ERROR: --email is required");
  console.error("Usage: node ops/tools/dev-get-public-magic-link.mjs --email <email> --eventId <eventId> [--limit <n>]");
  process.exit(1);
}

if (!argv.eventId) {
  console.error("[dev-get-public-magic-link] ERROR: --eventId is required");
  console.error("Usage: node ops/tools/dev-get-public-magic-link.mjs --email <email> --eventId <eventId> [--limit <n>]");
  process.exit(1);
}

if (!API_BASE || !/^https?:\/\//.test(API_BASE)) {
  console.error("[dev-get-public-magic-link] ERROR: MBAPP_API_BASE must be set to a full URL (e.g., https://...)");
  process.exit(1);
}

if (!BEARER || BEARER.trim().length === 0) {
  console.error("[dev-get-public-magic-link] ERROR: MBAPP_BEARER must be set to an operator token with message:read permission");
  process.exit(1);
}

// Normalize API base (remove trailing slash)
const API = API_BASE.replace(/\/+$/, "");

async function fetchMessages({ email, limit }) {
  const url = new URL(`${API}/messages`);
  url.searchParams.set("to", email);
  url.searchParams.set("channel", "email");
  url.searchParams.set("status", "sent");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "x-tenant-id": TENANT_ID,
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GET /messages failed: ${res.status} ${res.statusText}\n${errText}`);
  }

  const json = await res.json();
  return json;
}

function extractMagicLink(body, eventId) {
  if (typeof body !== "string") return null;

  // Pattern 1: Full URL with protocol
  const urlPattern = new RegExp(
    `https?:\\/\\/[^\\s"]+\\/events\\/${eventId}\\/my-checkin\\?[^"\\s]+`,
    "i"
  );
  const urlMatch = body.match(urlPattern);
  if (urlMatch) return urlMatch[0];

  // Pattern 2: Relative path (fallback)
  const relPattern = new RegExp(
    `\\/events\\/${eventId}\\/my-checkin\\?[^"\\s]+`,
    "i"
  );
  const relMatch = body.match(relPattern);
  if (relMatch) return relMatch[0];

  return null;
}

async function run() {
  try {
    const messagesResp = await fetchMessages({ email: argv.email, limit: argv.limit });
    const items = Array.isArray(messagesResp?.items) ? messagesResp.items : [];

    if (items.length === 0) {
      console.error(`[dev-get-public-magic-link] No messages found for email: ${argv.email}`);
      process.exit(2);
    }

    // Scan newest-first for the magic link
    for (const msg of items) {
      const link = extractMagicLink(msg.body, argv.eventId);
      if (link) {
        // Print only the link (single line)
        console.log(link);
        console.error("[dev-get-public-magic-link] Note: Tokens rotate on each lookup request. This is the latest link for the email.");
        process.exit(0);
      }
    }

    // No link found
    console.error(`[dev-get-public-magic-link] No magic link found for eventId: ${argv.eventId} in ${items.length} messages`);
    process.exit(2);
  } catch (err) {
    console.error(`[dev-get-public-magic-link] ERROR: ${err.message}`);
    process.exit(1);
  }
}

run();
