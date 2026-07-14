---
veye: true
title: Billing Overview
type: architecture
covers:
  - src/billing/**
depends_on:
  - docs/wiki/auth.md
last_verified: 2026-05-01
---

# Billing Overview

The billing subsystem charges customers for usage. The core charging routine
in `src/billing/charge.ts` is invoked after every completed billing cycle and
relies on the [Authentication Architecture](../auth.md) to resolve the
principal on whose behalf the charge is made.

## Charge Pipeline

1. The identity of the caller is resolved from the auth context.
2. `src/billing/charge.ts` computes the amount owed for the period.
3. The resulting invoice is materialised by `src/billing/invoice.ts` and
   dispatched to the customer.
