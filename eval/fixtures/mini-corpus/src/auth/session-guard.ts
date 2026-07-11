export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 15 * 60 * 1000;

function mintToken(userId: string, now: number): string {
  return `${userId}.${String(now)}.${Math.floor(now / TOKEN_TTL_MS).toString(36)}`;
}

/**
 * Issue a fresh session token when the current one is within a minute of
 * expiry. Sole definition site of refreshSessionToken.
 */
export function refreshSessionToken(session: Session, now: number = Date.now()): Session {
  if (session.expiresAt - now > 60_000) {
    return session;
  }
  return {
    userId: session.userId,
    token: mintToken(session.userId, now),
    expiresAt: now + TOKEN_TTL_MS,
  };
}
