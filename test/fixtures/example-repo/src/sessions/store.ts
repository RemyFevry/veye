interface SessionEntry {
  principal: string;
  issuedAt: number;
  expiresAt: number;
}

const store = new Map<string, SessionEntry>();
const DEFAULT_TTL_MS = 3600 * 1000;

export function createSession(token: string, principal: string): void {
  const now = Date.now();
  store.set(token, {
    principal,
    issuedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  });
}

export function getSession(token: string): SessionEntry | undefined {
  const entry = store.get(token);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return undefined;
  }
  return entry;
}

export async function invalidateSession(token: string): Promise<void> {
  store.delete(token);
}
