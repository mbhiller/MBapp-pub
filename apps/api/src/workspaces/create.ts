import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { writeWorkspace } from "./repo";

const DUALWRITE_LEGACY = process.env.MBAPP_WORKSPACES_DUALWRITE_LEGACY === "true";

/**
 * POST /workspaces — creates a saved View.
 * Mirrors /views behavior: same validation, RBAC guards, creates type='view'.
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

    const views = Array.isArray(body.views) ? body.views : [];

    const result = await writeWorkspace({
      tenantId: auth.tenantId,
      workspace: { ...body, views },
      dualWriteLegacy: DUALWRITE_LEGACY,
    });

    return ok(result, 201);
  } catch (e: any) {
    return error(e);
  }
}
