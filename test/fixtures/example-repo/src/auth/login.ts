export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  expiresIn: number;
}

const TOKEN_TTL_SECONDS = 3600;

export async function login(credentials: LoginRequest): Promise<LoginResult> {
  const principal = await verifyCredentials(credentials.email, credentials.password);
  if (!principal) {
    throw new Error('invalid credentials');
  }
  return {
    token: signToken(principal),
    expiresIn: TOKEN_TTL_SECONDS,
  };
}

async function verifyCredentials(email: string, password: string): Promise<string | null> {
  if (!email || !password) {
    return null;
  }
  if (email === 'admin@example.com' && password === 'hunter2') {
    return email;
  }
  return null;
}

function signToken(principal: string): string {
  return `tok_${Buffer.from(principal).toString('base64url')}`;
}
