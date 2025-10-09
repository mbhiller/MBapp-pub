
MBapp Docs

This folder contains the handoff and architecture docs for MBapp.
They’re written to be easy to copy/paste into new chats so development can continue seamlessly.

Quick Start

Handoff (paste this into new chats):
MBapp-Handoff-Quickstart.md

Architecture Guides

Backend (apps/api): router, auth, module endpoints, guardrails
MBapp-Backend-Guide.md

Frontend (apps/mobile & web): feature layout, screens, actions, hooks, UX patterns
MBapp-Frontend-Guide.md

Conventions (at a glance)

Objects vs Actions: CRUD under /objects/{type}; domain actions like /sales/so/{id}:commit.

Tenant & Auth: send both X-Tenant-Id and x-tenant-id; Bearer token; dev auto-login on 401.

Inventory math: available = onHand − reserved; fulfill reduces both onHand & reserved.

UI: header card with Edit→Save; Lines/Scanner are collapsible; badges are read-only; actions live under ⋮.

Smokes: ops/smoke.mjs covers Sales, Purchasing, Reservations, Scanner, and Reports.

How to use these docs in ChatGPT

Open MBapp-Handoff-Quickstart.md.

Copy/paste into a new chat along with: “Let’s keep developing. Here’s how we build our backend and frontend.”

Add any current context (branch, sprint, or a failing smoke) and go.

If you add or rename endpoints, update both the relevant guide and the OpenAPI spec in /spec.
