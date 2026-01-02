import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getWorkspaceById, writeWorkspace } from "./repo";
import { getObjectById } from "../objects/repo";

const DUALWRITE_LEGACY = process.env.MBAPP_WORKSPACES_DUALWRITE_LEGACY === "true";

/**
 * Deduplicate views array while preserving order (first occurrence wins).
 */
function dedupeViews(views: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const viewId of views) {
    if (!seen.has(viewId)) {
      seen.add(viewId);
      result.push(viewId);
    }
  }
  return result;
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const existing = await getWorkspaceById({ tenantId: auth.tenantId, id });
    if (!existing) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Validate name if provided (spec 1-200)
    if (typeof body.name !== "undefined") {
      if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 200) {
        return bad({ message: "name is required and must be 1-200 characters" });
      }
    }

    // Validate views if provided
    if (typeof body.views !== "undefined") {
      if (!Array.isArray(body.views) || body.views.some((v: any) => typeof v !== "string")) {
        return bad({ message: "views must be an array of strings" });
      }
    }

    // entityType optional; ensure string if present
    if (typeof body.entityType !== "undefined" && typeof body.entityType !== "string") {
      return bad({ message: "entityType must be a string if provided" });
    }

    // defaultViewId is optional; if provided ensure string
    if (typeof body.defaultViewId !== "undefined" && body.defaultViewId !== null && typeof body.defaultViewId !== "string") {
      return bad({ message: "defaultViewId must be a string if provided" });
    }

    const merged: any = { ...existing, ...body, id: existing.id, type: "workspace" };

    // Normalize views default
    merged.views = Array.isArray(merged.views) ? merged.views : [];

    // If name missing after merge, fail (must be present on resulting doc)
    if (!merged.name || typeof merged.name !== "string" || merged.name.length < 1 || merged.name.length > 200) {
      return bad({ message: "name is required and must be 1-200 characters" });
    }

    // Deduplicate views (first occurrence wins)
    merged.views = dedupeViews(merged.views);

    // If workspace has entityType set (existing or new), enforce view.entityType compatibility
    if (merged.entityType) {
      for (const viewId of merged.views) {
        const view = await getObjectById({
          tenantId: auth.tenantId,
          type: "view",
          id: viewId,
        });

        if (!view) {
          return bad({ message: `Unknown viewId: ${viewId}` });
        }

        // If view has an entityType and it differs from workspace.entityType, reject
        if (view.entityType && view.entityType !== merged.entityType) {
          return bad({
            message: `View ${viewId} has entityType '${view.entityType}' but workspace has '${merged.entityType}'`,
          });
        }
      }
    }

    // Validate defaultViewId if provided
    if (merged.defaultViewId) {
      // Must be in views array
      if (!merged.views.includes(merged.defaultViewId)) {
        return bad({ message: `defaultViewId '${merged.defaultViewId}' not found in views array` });
      }

      // If entityType is set, validate view entityType compatibility (reuse existing view if already fetched)
      if (merged.entityType) {
        const view = await getObjectById({
          tenantId: auth.tenantId,
          type: "view",
          id: merged.defaultViewId,
        });

        if (!view) {
          return bad({ message: `Unknown viewId: ${merged.defaultViewId}` });
        }

        if (view.entityType && view.entityType !== merged.entityType) {
          return bad({
            message: `Default view has entityType '${view.entityType}' but workspace has '${merged.entityType}'`,
          });
        }
      }
    }

    const result = await writeWorkspace({
      tenantId: auth.tenantId,
      workspace: merged,
      dualWriteLegacy: DUALWRITE_LEGACY,
    });

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
