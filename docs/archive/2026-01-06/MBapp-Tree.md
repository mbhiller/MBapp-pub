├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── auth/
│   │       │   ├── dev-login.ts
│   │       │   ├── login.ts
│   │       │   ├── middleware.ts
│   │       │   └── policy.ts
│   │       ├── backorders/
│   │       │   ├── request-convert.ts
│   │       │   └── request-ignore.ts
│   │       ├── common/
│   │       │   ├── ddb.ts
│   │       │   ├── env.ts
│   │       │   ├── party.ts
│   │       │   ├── responses.ts
│   │       │   ├── roles.ts
│   │       │   └── validators.ts
│   │       ├── epc/
│   │       │   └── resolve.ts
│   │       ├── events/
│   │       │   ├── dispatcher.ts           # NEW (stub; safe no-op, header-sim)
│   │       │   └── types.ts                # NEW (MBEvent typings)
│   │       ├── generated/
│   │       │   └── openapi-types.ts
│   │       ├── inventory/
│   │       │   ├── actions.ts
│   │       │   ├── counters.ts
│   │       │   ├── movements.ts            # UPDATED (filters + pageInfo)
│   │       │   ├── onhand-batch.ts
│   │       │   ├── onhand-get.ts
│   │       │   └── search.ts
│   │       ├── objects/
│   │       │   ├── create.ts
│   │       │   ├── delete.ts
│   │       │   ├── get.ts
│   │       │   ├── list.ts                 # UPDATED (pageInfo passthrough)
│   │       │   ├── repo.ts
│   │       │   ├── search.ts               # UPDATED (pageInfo passthrough)
│   │       │   └── update.ts
│   │       ├── parties/
│   │       │   ├── repo.ts
│   │       │   ├── routes.ts
│   │       │   └── types.ts
│   │       ├── products/
│   │       ├── purchasing/
│   │       │   ├── po-approve.ts           # UPDATED (vendor guard)
│   │       │   ├── po-cancel.ts
│   │       │   ├── po-close.ts
│   │       │   ├── po-create-from-suggestion.ts
│   │       │   ├── po-receive.ts           # UPDATED (idempotency + guard + events)
│   │       │   ├── po-submit.ts            # UPDATED (vendor guard)
│   │       │   └── suggest-po.ts
│   │       ├── resources/
│   │       ├── routing/
│   │       │   ├── dijkstra.ts
│   │       │   ├── graph-upsert.ts
│   │       │   ├── plan-create.ts
│   │       │   ├── plan-get.ts
│   │       │   └── types.ts
│   │       ├── sales/
│   │       │   ├── so-cancel.ts
│   │       │   ├── so-close.ts
│   │       │   ├── so-commit.ts
│   │       │   ├── so-fulfill.ts
│   │       │   ├── so-release.ts
│   │       │   ├── so-reserve.ts
│   │       │   └── so-submit.ts
│   │       ├── scanner/
│   │       │   ├── actions.ts
│   │       │   ├── sessions.ts
│   │       │   └── simulate.ts
│   │       ├── shared/
│   │       │   ├── ctx.ts
│   │       │   ├── db.ts
│   │       │   ├── idempotency.ts
│   │       │   ├── reservationSummary.ts
│   │       │   └── statusGuards.ts
│   │       ├── tenants/
│   │       │   └── list.ts
│   │       ├── tools/
│   │       │   ├── gc-delete-keys.ts
│   │       │   ├── gc-delete-type.ts
│   │       │   ├── gc-list-all.ts
│   │       │   └── gc-list-type.ts
│   │       ├── views/
│   │       │   ├── list.ts
│   │       ├── workspaces/
│   │       │   ├── list.ts
│   │       ├── bootstrap.ts
│   │       ├── cors.ts
│   │       ├── db.ts
│   │       └── index.ts
│   └── mobile/
│       └── src/
│           ├── api/
│           │   ├── auth.ts
│           │   ├── client.ts               # UPDATED (+getQ, pageInfo support)
│           │   └── generated-types.ts
│           ├── features/
│           │   ├── _shared/
│           │   │   ├── ui/
│           │   │   │   └── theme.ts
│           │   │   ├── AutoCompleteField.tsx
│           │   │   ├── BackorderBanner.tsx
│           │   │   ├── DateTimeField.tsx
│           │   │   ├── epc.ts
│           │   │   ├── fields.tsx
│           │   │   ├── flags.ts
│           │   │   ├── FormScreen.tsx
│           │   │   ├── formUtils.ts
│           │   │   ├── index.ts
│           │   │   ├── ItemSelectorModal.tsx
│           │   │   ├── LineEditor.tsx
│           │   │   ├── modules.ts
│           │   │   ├── objectHooks.ts
│           │   │   ├── queryClient.ts
│           │   │   ├── RelatedLinksCard.tsx
│           │   │   ├── ScannerPanel.tsx
│           │   │   ├── searchRegistry.tsx
│           │   │   ├── Toast.tsx
│           │   │   ├── useColors.ts
│           │   │   ├── useeditableLines.ts
│           │   │   ├── useIdempotencyKey.ts
│           │   │   ├── useObjects.ts        # UPDATED (hasNext/fetchNext/reset)
│           │   │   ├── useRefetchOnFocus.ts
│           │   │   ├── useRelatedCount.ts
│           │   │   └── useScannerSession.ts
│           │   ├── accounts/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── backorders/
│           │   │   └── BackorderBadges.tsx
│           │   ├── dev/
│           │   │   ├── DevDiagnosticsScreen.tsx
│           │   │   └── SignOutButton.tsx
│           │   ├── employees/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── events/
│           │   │   ├── actions.ts
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── fulfillments/
│           │   │   ├── actions.ts
│           │   │   └── api.ts
│           │   ├── goodsReceipts/
│           │   │   └── api.ts
│           │   ├── inventory/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   ├── stock.ts
│           │   │   ├── StockCard.tsx
│           │   │   ├── types.ts
│           │   │   └── useStock.ts
│           │   ├── objects/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── organizations/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── parties/
│           │   │   ├── api.ts
│           │   │   ├── PartyPicker.tsx
│           │   │   └── PartySelectorModal.tsx
│           │   ├── products/
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── purchasing/
│           │   │   ├── api.ts
│           │   │   ├── DraftChooserModal.tsx
│           │   │   ├── poActions.ts
│           │   │   ├── ReceiveHistorySheet.tsx  # NEW (receive history UI)
│           │   │   └── types.ts
│           │   ├── registrations/
│           │   │   ├── actions.ts
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   ├── types.ts
│           │   │   └── useRegistrationsCount.ts
│           │   ├── reservations/
│           │   │   ├── actions.ts
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   ├── reservationsActions.ts
│           │   │   └── types.ts
│           │   ├── resources/
│           │   │   ├── actions.ts
│           │   │   ├── api.ts
│           │   │   ├── hooks.ts
│           │   │   └── types.ts
│           │   ├── routing/
│           │   │   └── api.ts
│           │   ├── salesOrders/
│           │   │   ├── api.ts
│           │   │   └── types.ts
│           │   ├── views/
│           │   │   └── hooks.ts
│           │   └── workspaces/
│           │       ├── api.ts
│           │       ├── hooks.ts
│           │       ├── WorkspaceContext.tsx
│           │       └── WorkspaceSwitcher.tsx
│           ├── lib/
│           │   ├── api.ts
│           │   ├── config.ts
│           │   ├── errors.ts
│           │   ├── http.ts
│           │   ├── qr.ts
│           │   └── z.ts
│           ├── navigation/
│           │   ├── RootStack.tsx
│           │   └── types.ts
│           ├── providers/
│           │   ├── DevAuthBootstrap.tsx
│           │   ├── RolesProvider.tsx
│           │   └── ThemeProvider.tsx
│           ├── screens/
│           │   ├── BackordersListScreen.tsx
│           │   ├── InventoryDetailScreen.tsx
│           │   ├── InventoryListScreen.tsx       # UPDATED (pagination)
│           │   ├── ModuleHubScreen.tsx
│           │   ├── PartyDetailScreen.tsx
│           │   ├── PartyListScreen.tsx
│           │   ├── PurchaseOrderDetailScreen.tsx # UPDATED (Vendor Guard + History)
│           │   ├── PurchaseOrdersListScreen.tsx  # UPDATED (pagination)
│           │   ├── RoutePlanDetailScreen.tsx
│           │   ├── RoutePlanListScreen.tsx
│           │   ├── SalesOrderDetailScreen.tsx
│           │   └── SalesOrdersListScreen.tsx
│           └── App.tsx
├── docs/
│   ├── Development Principles.txt
│   ├── MBapp-Backend-Guide.md
│   ├── MBapp-Development-Playbook.md
│   ├── MBapp-Feature-Routing-and-Delivery.md
│   ├── MBapp-Frontend-Guide.md
│   ├── MBapp-Relationships.md
│   ├── MBapp-Roadmap.md
│   └── MBapp-Status.md                    # UPDATED (Sprint II summary + next steps)
├── ops/
│   └── smoke/
│       ├── seed/
│       │   ├── inventory.ts
│       │   ├── parties.ts
│       │   └── routing.ts
│       └── smoke.mjs                       # UPDATED (guard toggles + PO receive idempotency)
└── spec/
    └── MBapp-Modules.yaml                  # UPDATED (refId/poLineId, pageInfo notes)
