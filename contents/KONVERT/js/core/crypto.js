// Keys (file format v2, SPEC 32): made from the random kdf_salt in the chunk and, in key mode 1,
// the passphrase. They are not bound to the pixels, so a re-compressed image still opens.

import { chacha20poly1305 } from '../vendor/noble-ciphers/chacha.js';
import { hkdf } from '../vendor/noble-hashes/hkdf.js';
import { sha256 } from '../vendor/noble-hashes/sha2.js';
import { scrypt } from '../vendor/noble-hashes/scrypt.js';
import { fromHex } from './bytes.js';
import { APP_SECRET_HEX } from './secret.js';
import { usage, verify } from './errors.js';

export const KEY_MODE = { APP: 0, PASS: 1 };
// scrypt needs 128·r·(N+p+2) bytes ≈ 32.003 MiB: just over the usual 32 MiB default cap.
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32, maxmem: 64 * 2 ** 20 };
const INFO = { [KEY_MODE.APP]: 'konvert/v2/app', [KEY_MODE.PASS]: 'konvert/v2/pass' };
const enc = new TextEncoder();

export const random = (n) => crypto.getRandomValues(new Uint8Array(n));

function hexKey(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw usage('bad_secret', 'The app secret must be 64 hex digits.');
  return fromHex(hex);
}

// `secretHex` overrides the built-in APP_SECRET (tests only).
export function deriveKey({ keyMode, kdfSalt, passphrase, secretHex }) {
  let ikm;
  if (keyMode === KEY_MODE.APP) {
    ikm = hexKey(secretHex ?? APP_SECRET_HEX);
  } else if (keyMode === KEY_MODE.PASS) {
    if (!passphrase) throw usage('empty_passphrase', 'The passphrase is empty.');
    ikm = scrypt(enc.encode(passphrase.normalize('NFC')), kdfSalt, SCRYPT);
  } else {
    throw verify('bad_key_mode', `Unknown key mode ${keyMode}.`);
  }
  return hkdf(sha256, ikm, kdfSalt, enc.encode(INFO[keyMode]), 32);
}

export const seal = (key, nonce, aad, plaintext) => chacha20poly1305(key, nonce, aad).encrypt(plaintext);

export function open(key, nonce, aad, ciphertext) {
  try {
    return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    return null; // authentication failed
  }
}
