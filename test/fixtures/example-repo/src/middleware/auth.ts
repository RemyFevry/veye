import { getSession } from '../sessions/store.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  user?: string;
}

export function extractBearerToken(headers: Record<string, string | undefined>): string | null {
  const header = headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

export function authMiddleware(req: AuthenticatedRequest): void {
  const token = extractBearerToken(req.headers);
  if (!token) {
    throw new Error('missing authorization token');
  }
  const entry = getSession(token);
  if (!entry) {
    throw new Error('invalid or expired session');
  }
  req.user = entry.principal;
}
