import { supabaseAdmin } from "./supabaseAdmin.ts";

const CRM_DEFAULT_ORIGINS = [
  "https://felseeker.github.io",
  "https://admin.snowenduro.ru",
  "http://localhost:5173",
];
const SITE_DEFAULT_ORIGINS = [
  "https://snowenduro.ru",
  "https://www.snowenduro.ru",
];

export function originList(variable: string) {
  const fallback =
    variable === "PUBLIC_SITE_ORIGINS"
      ? SITE_DEFAULT_ORIGINS
      : CRM_DEFAULT_ORIGINS;
  return (Deno.env.get(variable) ?? fallback.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function originAllowed(req: Request, variable: string) {
  const origin = req.headers.get("origin");
  return !origin || originList(variable).includes(origin);
}

export function corsHeaders(req: Request, variable = "CRM_ORIGINS") {
  const origin = req.headers.get("origin");
  const allowOrigin =
    origin && originList(variable).includes(origin)
      ? origin
      : origin
        ? "null"
        : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, idempotency-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(req: Request, variable = "CRM_ORIGINS") {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req, variable),
  });
}

export function json(
  req: Request,
  body: unknown,
  status = 200,
  variable = "CRM_ORIGINS",
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req, variable),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function requireAdmin(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { ok: false };
  const { data: sale, error: saleError } = await supabaseAdmin
    .from("sales")
    .select("administrator")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (saleError || sale?.administrator !== true) return { ok: false };
  return { ok: true, userId: data.user.id };
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
