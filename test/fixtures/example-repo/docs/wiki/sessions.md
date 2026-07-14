---
veye: true
title: Session Management
type: component
covers:
  - src/sessions/**
last_verified: 2026-07-01
---

# Session Management

The session module provides a thin abstraction over the backing session
store. It is consumed by the authentication layer to persist and retrieve
session tokens after a successful login.

## Storage

Sessions are kept in an in-memory map during development and backed by Redis
in production. Each entry stores the principal, the issued-at timestamp, and
the expiry horizon. Cleanup of expired entries happens lazily on read.
