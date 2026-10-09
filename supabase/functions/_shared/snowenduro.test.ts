import { describe, expect, it } from "vitest";
import { hmacSha256Hex, verifyTimedHmac } from "./signatures.ts";

describe("verifyTimedHmac", () => {
  it("accepts an authentic signature within the time window", async () => {
    const secret = "local-test-secret";
    const issuedAt = Math.floor(Date.now() / 1000);
    const message = `export\n00000000-0000-4000-8000-000000000000\n${issuedAt}`;
    const signature = await hmacSha256Hex(message, secret);

    await expect(
      verifyTimedHmac(secret, message, issuedAt, signature),
    ).resolves.toBe(true);
  });

  it("rejects tampered, malformed, or stale signatures", async () => {
    const secret = "local-test-secret";
    const issuedAt = Math.floor(Date.now() / 1000);
    const message = `result\n00000000-0000-4000-8000-000000000000\n${issuedAt}\nsucceeded\n`;
    const signature = await hmacSha256Hex(message, secret);

    await expect(
      verifyTimedHmac(secret, `${message}changed`, issuedAt, signature),
    ).resolves.toBe(false);
    await expect(
      verifyTimedHmac(secret, message, issuedAt - 301, signature),
    ).resolves.toBe(false);
    await expect(
      verifyTimedHmac(secret, message, issuedAt, "invalid"),
    ).resolves.toBe(false);
  });
});
