import { invalidateSession } from '../sessions/store.js';

export interface LogoutRequest {
  token: string;
}

export async function logout(req: LogoutRequest): Promise<void> {
  await invalidateSession(req.token);
}
