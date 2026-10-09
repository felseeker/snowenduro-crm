export async function hmacSha256Hex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifyTimedHmac(
  secret: string,
  message: string,
  issuedAt: number,
  signature: string,
  toleranceSeconds = 300,
) {
  if (
    !Number.isSafeInteger(issuedAt) ||
    Math.abs(Date.now() / 1000 - issuedAt) > toleranceSeconds
  )
    return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = await hmacSha256Hex(message, secret);
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |=
      expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  return mismatch === 0;
}
