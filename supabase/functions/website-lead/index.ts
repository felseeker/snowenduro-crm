import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { json, originAllowed, preflight } from "../_shared/snowenduro.ts";
import { hmacSha256Hex } from "../_shared/signatures.ts";
import { sendLeadNotification } from "../_shared/telegram.ts";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (!req.headers.get("origin") || !originAllowed(req, "PUBLIC_SITE_ORIGINS"))
    return json(
      req,
      { error: "origin_not_allowed" },
      403,
      "PUBLIC_SITE_ORIGINS",
    );
  if (req.method === "OPTIONS") return preflight(req, "PUBLIC_SITE_ORIGINS");
  if (req.method !== "POST")
    return json(
      req,
      { error: "method_not_allowed" },
      405,
      "PUBLIC_SITE_ORIGINS",
    );
  if (Deno.env.get("PUBLIC_LEAD_INTAKE_ENABLED") !== "true")
    return json(
      req,
      { error: "intake_unavailable" },
      503,
      "PUBLIC_SITE_ORIGINS",
    );
  const privacyVersion = Deno.env.get("PRIVACY_POLICY_VERSION");
  const rateSecret = Deno.env.get("LEAD_RATE_LIMIT_HMAC_SECRET");
  if (!privacyVersion || !rateSecret)
    return json(
      req,
      { error: "intake_unavailable" },
      503,
      "PUBLIC_SITE_ORIGINS",
    );
  const idempotencyKey = req.headers.get("idempotency-key") ?? "";
  if (!uuidPattern.test(idempotencyKey))
    return json(req, { error: "invalid_request" }, 400, "PUBLIC_SITE_ORIGINS");

  let body: Record<string, unknown>;
  try {
    body = await readJsonLimited(req, 16_384);
  } catch (error) {
    return json(
      req,
      {
        error:
          error instanceof RangeError ? "payload_too_large" : "invalid_request",
      },
      error instanceof RangeError ? 413 : 400,
      "PUBLIC_SITE_ORIGINS",
    );
  }
  if (body.website)
    return json(req, { accepted: true }, 202, "PUBLIC_SITE_ORIGINS");

  const { data: duplicate } = await supabaseAdmin
    .from("website_leads")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (duplicate)
    return json(
      req,
      { accepted: true, duplicate: true },
      202,
      "PUBLIC_SITE_ORIGINS",
    );

  const name = cleanText(body.customer_name, 100);
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const digits = rawPhone.replace(/\D/g, "");
  const phone =
    digits.length === 10
      ? "+7" + digits
      : digits.length === 11 && digits.startsWith("8")
        ? "+7" + digits.slice(1)
        : digits.length === 11 && digits.startsWith("7")
          ? "+" + digits
          : digits.length >= 10 && digits.length <= 15
            ? "+" + digits
            : "";
  let interest = cleanText(body.product_interest, 200);
  const sourcePage = normalizeSourcePage(
    body.source_page,
    req.headers.get("origin"),
  );
  const make = cleanText(body.compatibility_make, 100) || null;
  const model = cleanText(body.compatibility_model, 120) || null;
  const year =
    body.compatibility_year == null || body.compatibility_year === ""
      ? null
      : Number(body.compatibility_year);
  const isCompatibility = Boolean(make || model || year != null);

  if (
    name.length < 2 ||
    !phone ||
    interest.length < 2 ||
    !sourcePage ||
    body.consent !== true ||
    body.privacy_policy_version !== privacyVersion
  ) {
    return json(req, { error: "invalid_request" }, 400, "PUBLIC_SITE_ORIGINS");
  }
  const fixedInterests: Record<string, string> = {
    snowbike: "Snowbike-комплект",
    snowmobile: "Снегоход под заказ",
    undecided: "Пока не определился",
    compatibility: "Проверка совместимости",
    "Проверка совместимости": "Проверка совместимости",
  };
  if (fixedInterests[interest]) interest = fixedInterests[interest];
  else {
    const { data: productByName, error: nameError } = await supabaseAdmin
      .from("products")
      .select("name")
      .eq("name", interest)
      .eq("is_published", true)
      .maybeSingle();
    if (nameError)
      return json(
        req,
        { error: "intake_unavailable" },
        503,
        "PUBLIC_SITE_ORIGINS",
      );
    if (productByName) interest = productByName.name;
    else if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(interest)) {
      const { data: productBySlug, error: slugError } = await supabaseAdmin
        .from("products")
        .select("name")
        .eq("slug", interest)
        .eq("is_published", true)
        .maybeSingle();
      if (slugError)
        return json(
          req,
          { error: "intake_unavailable" },
          503,
          "PUBLIC_SITE_ORIGINS",
        );
      if (productBySlug) interest = productBySlug.name;
      else
        return json(
          req,
          { error: "invalid_request" },
          400,
          "PUBLIC_SITE_ORIGINS",
        );
    } else
      return json(
        req,
        { error: "invalid_request" },
        400,
        "PUBLIC_SITE_ORIGINS",
      );
  }
  if (
    isCompatibility &&
    (!make ||
      !model ||
      !Number.isInteger(year) ||
      year < 1950 ||
      year > new Date().getUTCFullYear() + 1)
  ) {
    return json(
      req,
      { error: "invalid_compatibility" },
      400,
      "PUBLIC_SITE_ORIGINS",
    );
  }

  const forwardedIp =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const ipHash = await hmacSha256Hex(forwardedIp, rateSecret);
  const phoneHash = await hmacSha256Hex(phone, rateSecret);
  const { data: allowed, error: limitError } = await supabaseAdmin.rpc(
    "reserve_website_lead_request",
    { p_ip_hash: ipHash, p_phone_hash: phoneHash },
  );
  if (limitError)
    return json(
      req,
      { error: "intake_unavailable" },
      503,
      "PUBLIC_SITE_ORIGINS",
    );
  if (!allowed)
    return json(req, { error: "rate_limited" }, 429, "PUBLIC_SITE_ORIGINS");

  const { data: lead, error: insertError } = await supabaseAdmin
    .from("website_leads")
    .insert({
      customer_name: name,
      phone,
      product_interest: interest,
      source_page: sourcePage,
      compatibility_make: make,
      compatibility_model: model,
      compatibility_year: year,
      idempotency_key: idempotencyKey,
      consent_at: new Date().toISOString(),
      consent_policy_version: privacyVersion,
    })
    .select("id")
    .single();
  if (insertError || !lead) {
    if (insertError?.code === "23505")
      return json(
        req,
        { accepted: true, duplicate: true },
        202,
        "PUBLIC_SITE_ORIGINS",
      );
    return json(
      req,
      { error: "intake_unavailable" },
      503,
      "PUBLIC_SITE_ORIGINS",
    );
  }

  const { data: outbox } = await supabaseAdmin
    .from("notification_outbox")
    .select("id")
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (outbox) {
    try {
      await sendLeadNotification(outbox.id);
    } catch {
      /* The saved request and outbox remain available for retry. */
    }
  }
  return json(req, { accepted: true }, 202, "PUBLIC_SITE_ORIGINS");
});

function cleanText(value: unknown, max: number) {
  return typeof value === "string"
    ? Array.from(value, (character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? " " : character;
      })
        .join("")
        .trim()
        .slice(0, max)
    : "";
}

async function readJsonLimited(
  req: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError("missing_body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError("payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new SyntaxError("invalid_body");
  return parsed as Record<string, unknown>;
}

function normalizeSourcePage(value: unknown, requestOrigin: string | null) {
  if (typeof value !== "string" || value.length > 1200) return "";
  try {
    const siteOrigins = (
      Deno.env.get("PUBLIC_SITE_ORIGINS") ??
      "https://snowenduro.ru,https://www.snowenduro.ru"
    )
      .split(",")
      .map((item) => item.trim());
    const parsed = new URL(value, requestOrigin ?? "https://snowenduro.ru");
    if (parsed.protocol !== "https:" || !siteOrigins.includes(parsed.origin))
      return "";
    return parsed.pathname.slice(0, 500) || "/";
  } catch {
    return "";
  }
}
