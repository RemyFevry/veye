import type { ChargeResult } from './charge.js';

export interface Invoice {
  id: string;
  amountInCents: number;
  renderedAt: string;
}

export function renderInvoice(charge: ChargeResult): Invoice {
  return {
    id: charge.invoiceId,
    amountInCents: charge.amountInCents,
    renderedAt: new Date().toISOString(),
  };
}
