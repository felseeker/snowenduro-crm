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

  const token = Deno.env.get("SITE_GITHUB_TOKEN");
  const owner = Deno.env.get("SITE_GITHUB_OWNER");
  const repository = Deno.env.get("SITE_GITHUB_REPO");
  if (
    !token ||
    !owner ||
    !repository ||
    !Deno.env.get("SITE_CATALOG_SYNC_SECRET")
  )
    return json(
      req,
      { configured: false, error: "publication_not_configured" },
      200,
    );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (Object.keys(body).length > 0)
    return json(req, { error: "invalid_request" }, 400);

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data: job, error: insertError } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .insert({
      requested_by: admin.userId,
      expires_at: expiresAt,
      status: "queued",
    })
    .select("id")
    .single();
  if (insertError || !job)
    return json(req, { error: "publication_unavailable" }, 503);

  const workflow = Deno.env.get("SITE_GITHUB_WORKFLOW") ?? "catalog-sync.yml";
  const branch = Deno.env.get("SITE_GITHUB_BRANCH") ?? "main";
  const url =
    "https://api.github.com/repos/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repository) +
    "/actions/workflows/" +
    encodeURIComponent(workflow) +
    "/dispatches";
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: branch, inputs: { job_id: job.id } }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    await supabaseAdmin
      .from("catalog_publication_jobs")
      .update({
        status: "failed",
        error_message: "Не удалось связаться с GitHub Actions.",
      })
      .eq("id", job.id);
    return json(req, { error: "github_unavailable", jobId: job.id }, 502);
  }
  if (!response.ok) {
    await supabaseAdmin
      .from("catalog_publication_jobs")
      .update({
        status: "failed",
        error_message: "GitHub Actions вернул HTTP " + response.status + ".",
      })
      .eq("id", job.id);
    return json(req, { error: "github_dispatch_failed", jobId: job.id }, 502);
  }
  return json(req, { configured: true, jobId: job.id, status: "queued" }, 202);
});
