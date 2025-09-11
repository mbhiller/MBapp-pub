# Scan Intents Catalog (v1)
_Last updated: 2025-09-10 14:23 UTC_


> One Scan screen; many intents. If no intent, default is `navigate` for MBapp Object QR; otherwise treat unknown as EPC/text.

## Common payloads
- **MBapp Object QR (JSON)**: `{ "t":"mbapp/object-v1", "id":"...", "type":"...", "href":"/objects/<type>/<id>" }`  
- **Ticket QR**: `{ "t":"mbapp/ticket-v1", "id":"t_<...>", "eventId":"e_<...>" }`  
- **Badge QR**: `{ "t":"mbapp/badge-v1", "id":"b_<...>", "employeeId":"emp_<...>" }`  
- **PO QR**: `{ "t":"mbapp/po-v1", "id":"po_<...>" }`  
- **SKU/UPC**: plain barcode text; map to `Product` via `/products?upc=`.

## Intents
- `navigate` → open Object Detail for `{id,type}`  
- `attach-epc` (requires `attachTo`) → set `tags.rfidEpc` on the target  
- `link` (requires `attachTo`) → link source object to scanned object  
- `add-to-order` (optional `orderId`) → add scanned SKU to an order  
- `receive-po` (requires `poId` or PO QR) → receive items; tally progress  
- `inventory-move` (`fromId`,`toId`) → create stock movement  
- `ticket-validate` → validate ticket; show green/red result  
- `badge-clock` → clock in/out based on last state  
- `add-to-service` (`serviceOrderId?`) → add line to a work order

## UI affordances
- Top pill shows current intent (e.g., “Receiving PO #1234”)
- Multi-scan toggle for bulk actions
- Haptics + toasts on success/failure
- `navigation.replace(...)` when the flow completes
