import { createHmac } from 'node:crypto';

export interface TurnConfig { urls: string[]; secret: string; ttl: number }
/** Operator-only configuration. Never serialize this object or copy it into child environments. */
export function turnConfig(env: NodeJS.ProcessEnv = process.env): TurnConfig | undefined {
  const urls = (env.AGENT_OFFICE_TURN_URLS ?? '').split(/\s+/).filter(Boolean);
  const secret = env.AGENT_OFFICE_TURN_SECRET;
  if (!urls.length && !secret) return;
  if (!urls.length || !secret || secret.length < 32 || urls.some((u) => !/^turns?:(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(u))) {
    throw new Error('Expiring TURN requires credential-free TURN_URLS and a TURN_SECRET of at least 32 characters.');
  }
  const ttl = Number(env.AGENT_OFFICE_TURN_TTL ?? 3600);
  if (!Number.isInteger(ttl) || ttl < 600 || ttl > 86400) throw new Error('TURN_TTL must be 600–86400 seconds.');
  return { urls, secret, ttl };
}
export function issueTurn(config: TurnConfig, subject: string, now = Date.now()) {
  const expiresAt = (Math.floor(now / 1000) + config.ttl) * 1000;
  // Pseudonymous stable suffix: no email/name in relay logs or caller-controlled delimiters.
  const suffix = createHmac('sha256', config.secret).update(subject).digest('hex').slice(0, 24);
  const username = `${expiresAt / 1000}:${suffix}`;
  const credential = createHmac('sha1', config.secret).update(username).digest('base64');
  return { ice: [{ urls: config.urls, username, credential }], expiresAt };
}
