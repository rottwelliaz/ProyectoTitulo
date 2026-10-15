// The current deployment has one backend. Before running multiple replicas this
// quota must move to a shared store; it is deliberately keyed by user, not JWT/IP.
export class PaymentAccessLimit extends Error {
  constructor(public retryAfter: number) { super('Has alcanzado el límite de consultas de pago. Inténtalo más tarde.'); }
}

export function createPaymentAccessLimiter(now = Date.now) {
  const entries = new Map<number, { expires: number; requests: number; professionals: Set<number> }>();
  const windowMs = 15 * 60_000;
  const entryFor = (userId: number) => {
    const time = now();
    for (const [id, entry] of entries) if (entry.expires <= time) entries.delete(id);
    let entry = entries.get(userId);
    if (!entry) {
      // Fail closed instead of evicting a live quota under memory pressure.
      if (entries.size >= 10_000) throw new PaymentAccessLimit(60);
      entry = { expires: time + windowMs, requests: 0, professionals: new Set() };
      entries.set(userId, entry);
    }
    return entry;
  };
  return {
    attempt(userId: number) {
      const entry = entryFor(userId);
      if (++entry.requests > 20) throw new PaymentAccessLimit(Math.ceil((entry.expires - now()) / 1000));
    },
    disclose(userId: number, barberId: number) {
      const entry = entryFor(userId);
      if (!entry.professionals.has(barberId) && entry.professionals.size >= 3) {
        throw new PaymentAccessLimit(Math.ceil((entry.expires - now()) / 1000));
      }
      entry.professionals.add(barberId);
    },
  };
}

export const paymentAccess = createPaymentAccessLimiter();
