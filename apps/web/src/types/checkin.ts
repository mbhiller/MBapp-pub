// Minimal types for Check-In Console UI
// These are local to web app to avoid cross-workspace imports from apps/api

export type CheckInBlocker = {
  code?: string;
  reason?: string;
};

export type CheckInAction = {
  type?: string;
  status?: string;
  message?: string;
};

export type CheckInStatus = {
  ready?: boolean;
  blockers?: CheckInBlocker[];
  actions?: CheckInAction[];
  lastEvaluatedAt?: string;
};

export type Registration = {
  id: string;
  eventId?: string;
  partyId?: string;
  status?: string;
  checkedInAt?: string;
  checkInStatus?: CheckInStatus;
};

export type CheckInWorklistPage = {
  eventId: string;
  checkedIn: boolean;
  ready: boolean | null;
  blockerCode: string | null;
  items: Registration[];
  next: string | null;
};

// Scan resolution types (mirrors API union minimally for web usage)
export type ScanResolutionCandidate = {
  registrationId: string;
  partyId: string | null;
  status: "draft" | "submitted" | "confirmed" | "cancelled";
};

export type ScanResolutionResult =
  | {
      ok: true;
      registrationId: string;
      partyId: string | null;
      status: "draft" | "submitted" | "confirmed" | "cancelled";
      ready: boolean;
      blockers?: CheckInBlocker[];
      lastEvaluatedAt?: string | null;
      nextAction?: "checkin" | "admit" | "already_admitted" | "blocked" | null;
      nextActionLabel?: string | null;
      ticketId?: string | null;
      ticketStatus?: "valid" | "used" | null;
      ticketUsedAt?: string | null;
    }
  | {
      ok: false;
      error: "not_found" | "not_in_event" | "ambiguous" | "invalid_scan";
      reason: string;
      candidates?: ScanResolutionCandidate[];
      // Optional extra fields may be returned, tolerate them
      [k: string]: unknown;
    };
