/**
 * Registration helper functions (Sprint BN).
 * Consolidates common registration-related operations.
 */

import { getObjectById } from "../objects/repo";

/**
 * Load a registration and extract its eventId.
 *
 * @param tenantId - Tenant ID for object lookup (optional)
 * @param registrationId - ID of the registration to load
 * @returns Object with { registration, eventId }
 * @throws Error with statusCode 404 if registration not found
 * @throws Error with statusCode 400 if registration missing eventId
 */
export async function loadRegistrationWithEvent(
  tenantId: string | undefined,
  registrationId: string
): Promise<{ registration: Record<string, any>; eventId: string }> {
  const registration = await getObjectById({
    tenantId,
    type: "registration",
    id: registrationId,
    fields: ["id", "status", "eventId"],
  });

  if (!registration) {
    throw Object.assign(new Error("Registration not found"), {
      code: "registration_not_found",
      statusCode: 404,
    });
  }

  const eventId = (registration as any)?.eventId as string | undefined;
  if (!eventId) {
    throw Object.assign(new Error("Registration has no eventId"), {
      code: "missing_registration_event_id",
      statusCode: 400,
    });
  }

  return { registration, eventId };
}
