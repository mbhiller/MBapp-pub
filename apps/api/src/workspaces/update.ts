import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getWorkspaceById, writeWorkspace } from "./repo";
import { getObjectById } from "../objects/repo";

const DUALWRITE_LEGACY = process.env.MBAPP_WORKSPACES_DUALWRITE_LEGACY === "true";

/**
 * PUT /workspaces/:id — updates a saved View.
 * Mirrors /views/:id behavior: same validation, RBAC guards, updates type='view'.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Validate name (workspace spec: 1–200 chars)
    if (!body.name || typeof body.name !== "string" || body.name.length < 1 || body.name.length > 200) {
      return bad({ message: "name is required and must be 1-200 characters" });
    }

    // views must be string[] if provided; default []
    if (typeof body.views !== "undefined" && !Array.isArray(body.views)) {
      return bad({ message: "views must be an array of strings" });
    }
    if (Array.isArray(body.views) && body.views.some((v: any) => typeof v !== "string")) {
      return bad({ message: "views must be an array of strings" });
    }
    const views = Array.isArray(body.views) ? body.views : [];

    // entityType is optional for back-compat; if provided ensure string
    if (typeof body.entityType !== "undefined" && typeof body.entityType !== "string") {
      return bad({ message: "entityType must be a string if provided" });
    }

    // defaultViewId is optional; if provided ensure string
    if (typeof body.defaultViewId !== "undefined" && body.defaultViewId !== null && typeof body.defaultViewId !== "string") {
      return bad({ message: "defaultViewId must be a string if provided" });
    }

    const existing = await getWorkspaceById({ tenantId: auth.tenantId, id });
    if (!existing) return notFound();

    const merged = {
      ...existing,
      ...body,
      id,
      type: "workspace",
      views,
    };

    // Validate defaultViewId if provided
    if (merged.defaultViewId) {
      // Must be in views array
      if (!merged.views.includes(merged.defaultViewId)) {
        return bad({ message: `defaultViewId '${merged.defaultViewId}' not found in views array` });
      }

      // If entityType is set, validate view entityType compatibility
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
