import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies Meta's X-Hub-Signature-256 header ("sha256=<hex>") against the raw
 * request body using the app secret. Anyone could otherwise POST fake
 * comment/DM events to this public endpoint.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) {
    return false;
  }

  const [algorithm, providedDigest] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !providedDigest) {
    return false;
  }

  const expectedDigest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const expected = Buffer.from(expectedDigest, 'utf8');
  const provided = Buffer.from(providedDigest, 'utf8');

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
