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
│   │       │   ├── registration-cancel.ts
│   │       │   ├── registration-checkin.ts
│   │       │   └── registration-checkout.ts
│   │       ├── generated/
│   │       │   └── openapi-types.ts
│   │       ├── inventory/
│   │       │   ├── actions.ts
│   │       │   ├── counters.ts
│   │       │   ├── movements.ts            # updated in Sprint I (filters + pageInfo)
│   │       │   ├── onhand-batch.ts
│   │       │   ├── onhand-get.ts
│   │       │   └── search.ts
│   │       ├── objects/
│   │       │   ├── create.ts
│   │       │   ├── delete.ts
│   │       │   ├── get.ts
│   │       │   ├── list.ts                 # updated in Sprint I (pageInfo passthrough)
│   │       │   ├── repo.ts
│   │       │   ├── search.ts               # updated in Sprint I (pageInfo passthrough)
│   │       │   └── update.ts
│   │       ├── parties/
│   │       │   ├── repo.ts
│   │       │   ├── routes.ts
│   │       │   └── types.ts
│   │       ├── products/
│   │       │   └── explode.ts
│   │       ├── purchasing/
│   │       │   ├── po-approve.ts
│   │       │   ├── po-cancel.ts
│   │       │   ├── po-close.ts
│   │       │   ├── po-create-from-suggestion.ts
│   │       │   ├── po-receive.ts
│   │       │   ├── po-submit.ts
│   │       │   └── suggest-po.ts
│   │       ├── resources/
│   │       │   ├── reservation-cancel.ts
│   │       │   ├── reservation-end.ts
│   │       │   └── reservation-start.ts
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
│   │       │   ├── movement.ts
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
│   │       │   ├── create.ts
│   │       │   ├── delete.ts
│   │       │   ├── get.ts
│   │       │   ├── list.ts
│   │       │   └── update.ts
│   │       ├── workspaces/
│   │       │   ├── create.ts
│   │       │   ├── delete.ts
│   │       │   ├── get.ts
│   │       │   ├── list.ts
│   │       │   └── update.ts
│   │       ├── bootstrap.ts
│   │       ├── cors.ts
│   │       ├── db.ts
│   │       └── index.ts
│   └── mobile/
│       └── src/
│           ├── api/
│           │   ├── auth.ts
│           │   ├── client.ts               # updated in Sprint I (+getQ, pageInfo)
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
│           │   │   ├── useObjects.ts        # updated in Sprint I (hasNext/fetchNext/reset)
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
│           │   │   ├── ReceiveHistorySheet.tsx  # NEW in Sprint I
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
│           │   ├── InventoryListScreen.tsx       # updated in Sprint I (pagination)
│           │   ├── ModuleHubScreen.tsx
│           │   ├── PartyDetailScreen.tsx
│           │   ├── PartyListScreen.tsx
│           │   ├── PurchaseOrderDetailScreen.tsx # updated in Sprint I (Vendor Guard + History)
│           │   ├── PurchaseOrdersListScreen.tsx  # updated in Sprint I (pagination)
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
│   ├── MBapp-Roadmap-Master-v10.0.md
│   └── MBapp-Working.md                    # updated in Sprint I and planning Sprint II
├── ops/
│   └── smoke/
│       ├── seed/
│       │   ├── inventory.ts
│       │   ├── parties.ts
│       │   └── routing.ts
│       └── smoke.mjs                       # + objects:list-pagination, movements:filter-by-poLine
└── spec/
    └── MBapp-Modules.yaml                  # updated with refId/poLineId, pageInfo notes
