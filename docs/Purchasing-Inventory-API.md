# Purchasing & Inventory — Entities & APIs (MVP)
_Last updated: 2025-09-10 14:23 UTC_


## Entities
### Product (Catalog)
```json
{
  "id": "prod_123",
  "sku": "ELECTROLYTE-1KG",
  "name": "Electrolyte Powder 1kg",
  "type": "good",
  "uom": "kg",
  "price": 24.00,
  "taxCode": "TX_STD"
}
```

### Location
```json
{ "id":"loc_wh1", "name":"Main Warehouse", "kind":"warehouse" }
```

### StockItem (per product per location)
```json
{ "productId":"prod_123", "locationId":"loc_wh1", "onHand": 120, "reserved": 5 }
```

### Movement
```json
{
  "id":"mov_001",
  "productId":"prod_123",
  "from":"loc_wh1",
  "to":"loc_boothA",
  "qty": 20,
  "reason":"replenishment",
  "refType":"shipment",
  "refId":"ship_001",
  "at":"2025-09-11T12:00:00Z",
  "by":"u_42"
}
```

### Vendor
```json
{ "id":"ven_abc", "name":"Equine Supply Co.", "contact":{"email":"..."} }
```

### PurchaseOrder
```json
{
  "id":"po_1001",
  "vendorId":"ven_abc",
  "status":"draft",
  "lines":[
    { "productId":"prod_123", "qty": 50, "cost": 12.50 }
  ],
  "totals":{"sub":625.00, "tax":0, "ship":0, "grand":625.00},
  "createdAt":"...", "updatedAt":"..."
}
```

### Receipt
```json
{
  "id":"rcpt_1",
  "poId":"po_1001",
  "lines":[ { "productId":"prod_123", "qty": 50, "lot":"L20250911A" } ],
  "at":"2025-09-11T15:04:00Z",
  "by":"u_42"
}
```

---

## APIs
### Catalog
- `GET /products?sku=&q=&limit=&cursor=`
- `POST /products` body: Product (server sets id)
- `PUT /products/{id}`

### Inventory
- `GET /inventory/stock?locationId=&productId=`
- `POST /inventory/movements` body: Movement ({from?,to?,qty,reason,refType?,refId?})
- `GET /inventory/locations`

### Purchasing
- `GET /purchasing/po?status=&vendorId=`
- `POST /purchasing/po` body: { vendorId, lines[] }
- `PUT /purchasing/po/{id}` body: partial update (status, lines)
- `POST /purchasing/po/{id}/receive` body: Receipt
  - Updates stock and writes movements with `reason:"receive"`
  - Emits `po.received` and `inventory.received`

---

## DynamoDB sketch
- **Products**: PK=`TENANT#{tenant}#PRODUCT#{id}`, SK=`#`  
- **Locations**: PK=`TENANT#{tenant}#LOC#{id}`, SK=`#`  
- **Stock**: PK=`TENANT#{tenant}#STOCK#{productId}`, SK=`LOC#{locationId}` (onHand,reserved)  
- **Movements**: PK=`TENANT#{tenant}#MOV#{productId}`, SK=`TS#{yyyyMMddHHmmss}#{id}`  
- **POs**: PK=`TENANT#{tenant}#PO#{id}`, SK=`#`, GSI1: `status`  
- **Receipts**: PK=`TENANT#{tenant}#RCPT#{poId}`, SK=`#{id}`

---

## Transactions & consistency
- Use **DynamoDB TransactWrite** for receive: update StockItem(s) + append Movement(s) atomically.
- Idempotency keys on receive to prevent double-posting.
- Concurrency: include `version` (increment) or condition expressions on StockItem.

---

## UI slices to build first
1) **Products** (list + detail) with SKU search.  
2) **POs** (draft → sent → receive) with a **receive scan** flow (`intent:"receive-po"`).  
3) **Stock** view per Location with “Move stock” action (`intent:"inventory-move"`).
