export interface ChargeInput {
  principalId: string;
  amountInCents: number;
  period: string;
}

export interface ChargeResult {
  invoiceId: string;
  amountInCents: number;
  status: 'pending' | 'captured';
}

export async function charge(input: ChargeInput): Promise<ChargeResult> {
  if (input.amountInCents <= 0) {
    throw new Error('charge amount must be positive');
  }
  const invoiceId = `inv_${input.principalId}_${input.period}`;
  return {
    invoiceId,
    amountInCents: input.amountInCents,
    status: 'pending',
  };
}
