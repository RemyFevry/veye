---
veye: true
title: System Architecture
type: concept
covers: []
depends_on:
  - docs/wiki/auth.md
  - docs/wiki/billing/overview.md
last_verified: 2026-04-01
---

# System Architecture

This page describes the high-level architecture of the example application.
It is intentionally free of direct code coverage so that it can evolve
without coupling to specific source files.

## Layers

The application is organised into four layers:

- **Auth** — identity verification and middleware guards.
- **Sessions** — token persistence and expiry handling.
- **Billing** — usage metering and invoicing.
- **Middleware** — cross-cutting request processing.

Refer to [Authentication Architecture](../../auth.md) and
[Billing Overview](../overview.md) for the detailed breakdowns.
