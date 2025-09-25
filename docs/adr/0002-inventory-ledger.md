# 0002 — Inventory Event Ledger
**Status:** Proposed

## Context
Purchasing, Sales, Reservations all impact stock; we need auditability and future analytics.

## Decision
Add `inventoryEvent { receive|allocate|fulfill|adjust }`; write events from POs, SOs, DevTools, etc.

## Consequences
- Predictable stock math; partials/returns become trivial
- Enables historical reporting without schema churn
