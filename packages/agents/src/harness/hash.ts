/** Deterministic JSON hashing for harness receipts. Not a Knowledge Image digest. */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestRoot(label: string, value: unknown): Promise<string> {
  return `${label}:${await sha256Hex(value)}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, canonicalize(record[key])]),
  );
}
