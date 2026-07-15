---
veye: true
title: Auth Spec Conformance
type: spec
covers:
  - src/auth/**
specs:
  - openspec/specs/auth/spec.md
last_verified: 2026-06-20
---

# Auth Spec Conformance

This page tracks how the authentication implementation conforms to the
prescribed requirements in `openspec/specs/auth/spec.md`.

## Mapping

| Requirement | Implementation |
| ----------- | -------------- |
| Login returns a token | `src/auth/login.ts` |
| Logout invalidates session | `src/auth/logout.ts` |
| Middleware guards routes | `src/middleware/auth.ts` |
