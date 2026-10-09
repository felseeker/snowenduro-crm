import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { json, originAllowed, preflight } from "../_shared/snowenduro.ts";
import { verifyTimedHmac } from "../_shared/signatures.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_MESSAGES: Record<string, string> = {
  export_failed: "Не удалось получить каталог для публикации.",
  build_failed: "Не удалось собрать сайт.",
  deploy_failed: "GitHub Pages не завершил публикацию.",
  workflow_failed: "Публикация каталога завершилась с ошибкой.",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (!originAllowed(req, "CRM_ORIGINS"))
    return json(req, { error: "origin_not_allowed" }, 403);
  if (req.method !== "POST")
    return json(req, { error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("SITE_CATALOG_SYNC_SECRET");
  if (!secret) return json(req, { error: "catalog_sync_not_configured" }, 503);
  const body = await readBody(req);
  if (
    !body ||
    typeof body.job_id !== "string" ||
    !UUID.test(body.job_id) ||
    typeof body.issued_at !== "number" ||
    !Number.isSafeInteger(body.issued_at) ||
    typeof body.status !== "string" ||
    !["succeeded", "failed"].includes(body.status) ||
    typeof body.signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(body.signature)
  ) {
    return json(req, { error: "invalid_request" }, 400);
  }
  const errorCode = body.error_code ?? "";
  if (body.status === "failed" && !(errorCode in ERROR_MESSAGES))
    return json(req, { error: "invalid_request" }, 400);
  if (body.status === "succeeded" && errorCode)
    return json(req, { error: "invalid_request" }, 400);
  const message = `result\n${body.job_id}\n${body.issued_at}\n${body.status}\n${errorCode}`;
  if (!(await verifyTimedHmac(secret, message, body.issued_at, body.signature)))
    return json(req, { error: "unauthorized" }, 401);

  const { data: job, error: jobError } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .select("id,status,expires_at")
    .eq("id", body.job_id)
    .maybeSingle();
  if (
    jobError ||
    !job ||
    new Date(job.expires_at).getTime() <= Date.now() ||
    job.status === "succeeded"
  ) {
    return json(req, { error: "publication_job_unavailable" }, 404);
  }
  const status = body.status as "succeeded" | "failed";
  const { error } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .update({
      status,
      error_message: status === "failed" ? ERROR_MESSAGES[errorCode] : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) return json(req, { error: "publication_result_unavailable" }, 503);
  return json(req, { received: true, status });
});

async function readBody(
  req: Request,
): Promise<{
  job_id?: string;
  issued_at?: number;
  status?: string;
  error_code?: string;
  signature?: string;
} | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object"
      ? (value as {
          job_id?: string;
          issued_at?: number;
          status?: string;
          error_code?: string;
          signature?: string;
        })
      : null;
  } catch {
    return null;
  }
}
