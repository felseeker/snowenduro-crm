import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  json,
  originAllowed,
  preflight,
  requireAdmin,
} from "../_shared/snowenduro.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (!originAllowed(req, "CRM_ORIGINS"))
    return json(req, { error: "origin_not_allowed" }, 403);
  if (req.method !== "POST")
    return json(req, { error: "method_not_allowed" }, 405);
  const admin = await requireAdmin(req);
  if (!admin.ok) return json(req, { error: "unauthorized" }, 401);

  const { data: latest, error } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .select("status, created_at, error_message")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return json(req, { error: "status_unavailable" }, 503);
  const owner = Deno.env.get("SITE_GITHUB_OWNER") ?? "felseeker";
  const repository = Deno.env.get("SITE_GITHUB_REPO") ?? "snowenduro-site";
  const githubConfigured = Boolean(
    Deno.env.get("SITE_GITHUB_TOKEN") &&
    Deno.env.get("SITE_GITHUB_OWNER") &&
    Deno.env.get("SITE_GITHUB_REPO") &&
    Deno.env.get("SITE_CATALOG_SYNC_SECRET"),
  );
  return json(req, {
    telegramConfigured: Boolean(Deno.env.get("TELEGRAM_BOT_TOKEN")),
    githubConfigured,
    siteRepository: owner + "/" + repository,
    lastPublication: latest ?? null,
  });
});
