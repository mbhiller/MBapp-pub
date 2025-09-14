# Phase 5 — Products & Inventory Alignment (Sprint TODO)

## ✅ Done (baseline)
- Products: `kind` persisted + surfaced; `/products` alias stable.
- Create/Update: GSI keys set (`gsi1pk/gsi1sk`) so new items appear in lists.
- Mobile: Products list shows **kind** above ID; refreshes on focus.
- API typecheck clean (added tsconfig).

## 🚧 Goals
- [ ] API: `/products` list supports `order=desc` (default) by `updatedAt` for “new-first” lists.
- [ ] API: Hardening search (q/sku) + pagination (return `nextCursor` consistently).
- [ ] Mobile: Product create screen — show segmented **Kind** (good/service) & validate required fields.
- [ ] Mobile: After successful create, **optimistically append** item to list before refetch.
- [ ] Mobile: Pull-to-refresh states + error toasts standardized.
- [ ] Docs: Update Monorepo Layout (active files) in `MBapp-Combined.md`.
- [ ] CI: Add “typecheck API + mobile” GitHub Action (no build yet).

## 🧪 Smoke steps (CLI)
See `apps/api/ops/Smoke-Products.ps1` for one-command smoke.
