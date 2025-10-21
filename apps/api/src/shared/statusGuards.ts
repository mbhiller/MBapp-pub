// apps/api/src/shared/statusGuards.ts
import type { OrderStatus } from "../common/ddb";
import { canTransition } from "../common/ddb";

/**
 * Sales Order can be cancelled only if there are no reservations/fulfillments
 * and the current status can legally transition to 'cancelled'.
 */
export function assertSoCancelable(
  status: OrderStatus,
  hasReservations: boolean,
  hasFulfillments: boolean
) {
  if (hasReservations || hasFulfillments) {
    const e: any = new Error("Cannot cancel with reservations or fulfillments");
    e.statusCode = 409;
    e.ctx = { status, hasReservations, hasFulfillments };
    throw e;
  }
  if (!canTransition(status, "cancelled")) {
    const e: any = new Error("Cannot cancel in current status");
    e.statusCode = 409;
    e.ctx = { status };
    throw e;
  }
}

/**
 * Sales Order can be closed only from 'fulfilled' (your model’s fully-complete state)
 * and must allow the 'fulfilled' → 'closed' transition.
 */
export function assertSoClosable(status: OrderStatus) {
  if (status !== "fulfilled") {
    const e: any = new Error("Cannot close unless order is fulfilled");
    e.statusCode = 409;
    e.ctx = { status, required: "fulfilled" };
    throw e;
  }
  if (!canTransition(status, "closed")) {
    const e: any = new Error("Close transition not allowed");
    e.statusCode = 409;
    e.ctx = { status };
    throw e;
  }
}

/**
 * Purchase Order is receivable when 'approved' and may continue to be receivable
 * while in 'partially_fulfilled' until reaching 'fulfilled' (then you can close).
 */
export function assertPoReceivable(status: OrderStatus) {
  if (status !== "approved" && status !== "partially_fulfilled") {
    const e: any = new Error("PO not receivable in current status");
    e.statusCode = 409;
    e.ctx = { status };
    throw e;
  }
}
export function assertPoClosable(status: OrderStatus) {
  if (status !== "fulfilled" || !canTransition(status, "closed")) {
    const e: any = new Error("Cannot close unless PO is fulfilled");
    e.statusCode = 409;
    e.ctx = { status, required: "fulfilled" };
    throw e;
  }
}