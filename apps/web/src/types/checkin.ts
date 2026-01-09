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
