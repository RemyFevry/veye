---
veye: true
title: Authentication Architecture
type: architecture
covers:
  - src/auth/**
  - src/middleware/auth.ts
depends_on:
  - docs/wiki/sessions.md
last_verified: 2026-06-15
---

# Authentication Architecture

The authentication subsystem is responsible for verifying user identity on
every inbound request. It is split across two main modules: the login flow in
`src/auth/login.ts` and the request-time guard in `src/middleware/auth.ts`.

## Login Flow

When a user submits credentials, `src/auth/login.ts` validates the payload
against the configured identity provider. On success it returns a session
token that is then handed off to the session store (see
[Sessions](./sessions.md)).

## Middleware Guard

The Express-compatible middleware in `src/middleware/auth.ts` runs before
every protected route. It extracts the bearer token, validates it, and
attaches the decoded principal to `req.user`.

## Legacy Considerations

Older code paths still reference `src/auth/legacy.ts`, which has been removed.
Consumers should migrate to the current login module before the next major
release.
