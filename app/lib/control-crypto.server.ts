import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error("Passwords must contain at least 12 characters");
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, keyValue] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  const expected = Buffer.from(keyValue, "base64url");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function encryptionKey() {
  const material = process.env.CONTROL_ENCRYPTION_KEY || process.env.CONTROL_SESSION_SECRET;
  if (!material) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CONTROL_ENCRYPTION_KEY is required for control-center security");
    }
    return createHash("sha256").update("subsmanager-local-encryption-key").digest();
  }
  return createHash("sha256").update(material).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted control-center secret is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpAt(secret: string, timestamp: number) {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function createTotpSetup(email: string, existingSecret?: string) {
  const secret = existingSecret || base32Encode(randomBytes(20));
  const label = encodeURIComponent(`SubsManager Manga:${email}`);
  const issuer = encodeURIComponent("SubsManager Manga");
  return {
    secret,
    uri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
  };
}

export function verifyTotp(secret: string, token: string) {
  const normalized = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = Buffer.from(totpAt(secret, Date.now() + window * 30_000));
    const actual = Buffer.from(normalized);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}
