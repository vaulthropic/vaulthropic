const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(size = 20): Uint8Array {
  const secret = new Uint8Array(size);
  crypto.getRandomValues(secret);
  return secret;
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("TOTP secret is not base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

export async function hotp(secret: Uint8Array, counter: bigint, digits = 6): Promise<string> {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey("raw", copyBytes(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export async function totpAt(secret: Uint8Array, unixSeconds: number, digits = 6, period = 30): Promise<string> {
  if (!Number.isInteger(unixSeconds) || unixSeconds < 0) throw new Error("TOTP time is invalid.");
  return hotp(secret, BigInt(Math.floor(unixSeconds / period)), digits);
}

/** Accepts the current step and one step of clock skew. */
export async function verifyTotp(input: {
  secret: Uint8Array;
  code: string;
  unixSeconds: number;
  digits?: number;
  period?: number;
}): Promise<boolean> {
  const digits = input.digits ?? 6;
  const period = input.period ?? 30;
  if (!new RegExp(`^\\d{${digits}}$`).test(input.code)) return false;
  const step = Math.floor(input.unixSeconds / period);
  for (const offset of [-1, 0, 1]) {
    if (step + offset < 0) continue;
    const expected = await hotp(input.secret, BigInt(step + offset), digits);
    if (safeEqual(expected, input.code)) return true;
  }
  return false;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
