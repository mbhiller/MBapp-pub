import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { writeWorkspace } from "./repo";
import { getObjectById } from "../objects/repo";

/**
 * POST /workspaces — creates a workspace.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

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

    // entityType is optional for back-compat; if provided ensure string
    if (typeof body.entityType !== "undefined" && typeof body.entityType !== "string") {
      return bad({ message: "entityType must be a string if provided" });
    }

    // defaultViewId is optional; if provided ensure string
    if (typeof body.defaultViewId !== "undefined" && body.defaultViewId !== null && typeof body.defaultViewId !== "string") {
      return bad({ message: "defaultViewId must be a string if provided" });
    }

    const views = Array.isArray(body.views) ? body.views : [];

    // Validate defaultViewId if provided
    if (body.defaultViewId) {
      // Must be in views array
      if (!views.includes(body.defaultViewId)) {
        return bad({ message: `defaultViewId '${body.defaultViewId}' not found in views array` });
      }

      // If entityType is set, validate view entityType compatibility
      if (body.entityType) {
        const view = await getObjectById({
          tenantId: auth.tenantId,
          type: "view",
          id: body.defaultViewId,
        });

        if (!view) {
          return bad({ message: `Unknown viewId: ${body.defaultViewId}` });
        }

        if (view.entityType && view.entityType !== body.entityType) {
          return bad({
            message: `Default view has entityType '${view.entityType}' but workspace has '${body.entityType}'`,
          });
        }
      }
    }

    const result = await writeWorkspace({
      tenantId: auth.tenantId,
      workspace: { ...body, views },
    });

    return ok(result, 201);
  } catch (e: any) {
    return error(e);
  }
}
