/** Feature guard for registrations.
 * Uses the existing FEATURE_REGISTRATIONS_ENABLED env and the dev header override
 * "X-Feature-Registrations-Enabled" (same key used elsewhere).
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { featureRegistrationsEnabled } from "../flags";
import { forbidden } from "../common/responses";

export function guardRegistrations(event: APIGatewayProxyEventV2) {
  if (!featureRegistrationsEnabled(event)) {
    return forbidden("Registrations feature is disabled");
  }
  return null;
}
