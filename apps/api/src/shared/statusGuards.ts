export type OrderStatus = 'draft' | 'submitted' | 'approved' | 'committed' | 'partially_fulfilled' | 'fulfilled' | 'cancelled' | 'closed';

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    draft: ['submitted', 'cancelled'],
    submitted: ['approved', 'cancelled'],
    approved: ['committed', 'cancelled'],
    committed: ['partially_fulfilled', 'fulfilled', 'cancelled'],
    partially_fulfilled: ['fulfilled', 'cancelled'],
    fulfilled: ['closed'],
    cancelled: [],
    closed: [],
  };
  return allowed[from]?.includes(to) ?? false;
}
