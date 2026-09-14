import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { AppError } from "@real2/domain";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

export type TokenEncryptionKey = Uint8Array;

function checkedKey(key: TokenEncryptionKey): Buffer {
  if (key.byteLength !== KEY_BYTES) {
    throw new AppError("E_CONFIG_INCOMPLETE", 500);
  }

  return Buffer.from(key);
}

export function decodeTokenEncryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64");

  if (decoded.byteLength !== KEY_BYTES || canonical !== value) {
    throw new AppError("E_CONFIG_INCOMPLETE", 500);
  }

  return decoded;
}

export function encryptToken(
  plaintext: string,
  key: TokenEncryptionKey,
): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", checkedKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([FORMAT_VERSION]),
    iv,
    tag,
    ciphertext,
  ]);
}

export function decryptToken(
  encrypted: Uint8Array,
  key: TokenEncryptionKey,
): string {
  try {
    const blob = Buffer.from(encrypted);
    const minimumLength = 1 + IV_BYTES + TAG_BYTES + 1;

    if (blob.byteLength < minimumLength || blob[0] !== FORMAT_VERSION) {
      throw new Error("invalid ciphertext");
    }

    const ivStart = 1;
    const tagStart = ivStart + IV_BYTES;
    const ciphertextStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      checkedKey(key),
      blob.subarray(ivStart, tagStart),
    );
    decipher.setAuthTag(blob.subarray(tagStart, ciphertextStart));

    return Buffer.concat([
      decipher.update(blob.subarray(ciphertextStart)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError("E_AMO_AUTH", 502);
  }
}
