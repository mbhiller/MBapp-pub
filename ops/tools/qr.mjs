#!/usr/bin/env node
/**
 * Terminal QR Code Generator
 * 
 * Prints a QR code to the terminal from a string argument.
 * Useful for testing mobile scanner with generated ticket/badge QR codes.
 * 
 * Usage:
 *   npm run qr -- "ticket|eventId|registrationId|ticketId"
 *   npm run qr -- "badge|eventId|registrationId|issuanceId"
 */

import qrcode from "qrcode-terminal";

const text = process.argv[2];

if (!text) {
  console.error("Usage: node ops/tools/qr.mjs <text>");
  console.error("Example: node ops/tools/qr.mjs \"ticket|evt123|reg456|tick789\"");
  process.exit(1);
}

console.log("\n─── QR Code ───\n");
qrcode.generate(text, { small: false });
console.log("\n─── Raw Text ───");
console.log(text);
console.log("\n");
