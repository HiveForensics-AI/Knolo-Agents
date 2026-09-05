/** Canonical CBOR subset matching `@knolo/core` for maps/arrays/text/null. */

export type CanonicalCborValue = null | boolean | string | number | CanonicalCborValue[] | { readonly [key: string]: CanonicalCborValue };

export function canonicalCbor(value: unknown): Uint8Array {
  const out: number[] = [];
  encode(asCbor(value), out);
  return Uint8Array.from(out);
}

function asCbor(value: unknown): CanonicalCborValue {
  if (value === undefined) throw new Error("canonical CBOR cannot encode undefined");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical CBOR numbers must be safe integers");
    return value;
  }
  if (Array.isArray(value)) return value.map(item => asCbor(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, CanonicalCborValue> = {};
    for (const key of Object.keys(record)) {
      if (record[key] === undefined) continue;
      out[key] = asCbor(record[key]);
    }
    return out;
  }
  throw new Error(`unsupported canonical CBOR value: ${typeof value}`);
}

function encode(value: CanonicalCborValue, out: number[]): void {
  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xf5 : 0xf4);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    encodeLength(3, bytes.length, out);
    out.push(...bytes);
    return;
  }
  if (typeof value === "number") {
    if (value >= 0) encodeLength(0, value, out);
    else encodeLength(1, -1 - value, out);
    return;
  }
  if (Array.isArray(value)) {
    encodeLength(4, value.length, out);
    for (const item of value) encode(item, out);
    return;
  }
  const entries = Object.entries(value).sort(([left], [right]) => compareUtf8(left, right));
  encodeLength(5, entries.length, out);
  for (const [key, item] of entries) {
    encode(key, out);
    encode(item, out);
  }
}

function encodeLength(major: number, length: number, out: number[]): void {
  if (length < 24) out.push((major << 5) | length);
  else if (length <= 0xff) out.push((major << 5) | 24, length);
  else if (length <= 0xffff) out.push((major << 5) | 25, length >> 8, length & 0xff);
  else if (length <= 0xffffffff) out.push((major << 5) | 26, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
  else throw new Error("canonical CBOR length exceeds 32-bit encoding");
}

function compareUtf8(left: string, right: string): number {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
