import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ALGO = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const VERSION = 1

let cachedKey: Buffer | null = null
let cachedKeyId: string | null = null

function deriveKeyMaterial(raw: string | Buffer): Buffer {
  if (Buffer.isBuffer(raw)) {
    if (raw.length === KEY_BYTES) return raw
    return createHash('sha256').update(raw).digest()
  }
  const trimmed = raw.trim()
  // Accept base64 / hex / utf8 passphrase
  try {
    const b64 = Buffer.from(trimmed, 'base64')
    if (b64.length === KEY_BYTES) return b64
  } catch {
    // fall through
  }
  try {
    const hex = Buffer.from(trimmed, 'hex')
    if (hex.length === KEY_BYTES) return hex
  } catch {
    // fall through
  }
  return createHash('sha256').update(trimmed).digest()
}

function keyIdFromKey(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function defaultKeyPath(): string {
  const override = process.env.BASE_MASTER_KEY_FILE
  if (override) return resolve(override)
  const dataDir =
    process.env.STORAGE_PATH?.includes('uploads')
      ? resolve(process.env.STORAGE_PATH, '..')
      : resolve(process.cwd(), 'data')
  return join(dataDir, '.base-master-key')
}

/**
 * Resolve the master encryption key.
 * Precedence: BASE_MASTER_KEY env → key file → auto-generate local file (dev/single-node).
 */
export function getMasterKey(): { key: Buffer; keyId: string } {
  if (cachedKey && cachedKeyId) {
    return { key: cachedKey, keyId: cachedKeyId }
  }

  const fromEnv = process.env.BASE_MASTER_KEY
  if (fromEnv && fromEnv.trim()) {
    cachedKey = deriveKeyMaterial(fromEnv)
    cachedKeyId = keyIdFromKey(cachedKey)
    return { key: cachedKey, keyId: cachedKeyId }
  }

  // Prefer deriving from BETTER_AUTH_SECRET when present (stable across restarts)
  const authSecret = process.env.BETTER_AUTH_SECRET
  if (authSecret && authSecret.length >= 32) {
    cachedKey = deriveKeyMaterial(`base-settings-v1:${authSecret}`)
    cachedKeyId = keyIdFromKey(cachedKey)
    return { key: cachedKey, keyId: cachedKeyId }
  }

  const path = defaultKeyPath()
  if (existsSync(path)) {
    const raw = readFileSync(path)
    cachedKey = deriveKeyMaterial(raw)
    cachedKeyId = keyIdFromKey(cachedKey)
    return { key: cachedKey, keyId: cachedKeyId }
  }

  mkdirSync(dirname(path), { recursive: true })
  const generated = randomBytes(KEY_BYTES)
  writeFileSync(path, generated.toString('base64'), { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // best-effort on platforms without chmod
  }
  console.warn(
    `⚠️  Generated local master key at ${path}. Set BASE_MASTER_KEY for multi-node / production.`,
  )
  cachedKey = generated
  cachedKeyId = keyIdFromKey(cachedKey)
  return { key: cachedKey, keyId: cachedKeyId }
}

export function resetMasterKeyForTests(): void {
  cachedKey = null
  cachedKeyId = null
}

/** Encrypt plaintext → versioned envelope string */
export function encryptSecret(plaintext: string): string {
  const { key, keyId } = getMasterKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    `v${VERSION}`,
    keyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

/** Decrypt envelope produced by encryptSecret */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(':')
  if (parts.length !== 5 || !parts[0].startsWith('v')) {
    throw new Error('Invalid encrypted secret envelope')
  }
  const { key, keyId } = getMasterKey()
  const [, storedKeyId, ivB64, tagB64, ctB64] = parts
  if (storedKeyId !== keyId) {
    // Still try current key — rotation may keep same material under new id path
    // but refuse silent decrypt with mismatched key id when lengths differ
    const a = Buffer.from(storedKeyId)
    const b = Buffer.from(keyId)
    if (a.length === b.length && !timingSafeEqual(a, b)) {
      throw new Error(
        'Encrypted secret was produced with a different master key (key id mismatch)',
      )
    }
  }
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const ciphertext = Buffer.from(ctB64, 'base64url')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

export function isEncryptedEnvelope(value: string): boolean {
  return /^v\d+:[a-f0-9]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(
    value,
  )
}
