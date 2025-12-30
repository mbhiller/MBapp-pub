import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getWorkspaceById, writeWorkspace } from "./repo";

const DUALWRITE_LEGACY = process.env.MBAPP_WORKSPACES_DUALWRITE_LEGACY === "true";

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

    const merged: any = { ...existing, ...body, id: existing.id, type: "workspace" };

    // Normalize views default
    merged.views = Array.isArray(merged.views) ? merged.views : [];

    // If name missing after merge, fail (must be present on resulting doc)
    if (!merged.name || typeof merged.name !== "string" || merged.name.length < 1 || merged.name.length > 200) {
      return bad({ message: "name is required and must be 1-200 characters" });
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
