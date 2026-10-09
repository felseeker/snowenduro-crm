import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { json, originAllowed, preflight } from "../_shared/snowenduro.ts";
import { verifyTimedHmac } from "../_shared/signatures.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_PREFIX = "storage://catalog-images/";

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
    typeof body.signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(body.signature)
  ) {
    return json(req, { error: "invalid_request" }, 400);
  }
  const signedMessage = `export\n${body.job_id}\n${body.issued_at}`;
  if (
    !(await verifyTimedHmac(
      secret,
      signedMessage,
      body.issued_at,
      body.signature,
    ))
  ) {
    return json(req, { error: "unauthorized" }, 401);
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .select("id,status,expires_at")
    .eq("id", body.job_id)
    .maybeSingle();
  if (
    jobError ||
    !job ||
    new Date(job.expires_at).getTime() <= Date.now() ||
    !["queued", "running"].includes(job.status)
  ) {
    return json(req, { error: "publication_job_unavailable" }, 404);
  }

  const { error: runningError } = await supabaseAdmin
    .from("catalog_publication_jobs")
    .update({
      status: "running",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (runningError)
    return json(req, { error: "publication_job_unavailable" }, 503);

  const { data: rows, error: productsError } = await supabaseAdmin
    .from("products")
    .select("slug,category,name,data,availability,sort_order")
    .eq("is_published", true)
    .order("sort_order")
    .order("name")
    .limit(500);
  if (productsError || !rows)
    return json(req, { error: "catalog_unavailable" }, 503);

  try {
    const assets = new Map<string, { path: string; url: string }>();
    const products = [];
    for (const row of rows) {
      const data = {
        ...row.data,
        slug: row.slug,
        category: row.category,
        name: row.name,
      };
      if (
        typeof data.image !== "string" ||
        !Array.isArray(data.gallery) ||
        !Array.isArray(data.specs) ||
        !Array.isArray(data.tags)
      ) {
        return json(req, { error: "invalid_catalog_product" }, 422);
      }
      data.image = await publicImagePath(data.image, row.slug, assets);
      for (const photo of data.gallery) {
        if (!photo || typeof photo.src !== "string")
          return json(req, { error: "invalid_catalog_product" }, 422);
        photo.src = await publicImagePath(photo.src, row.slug, assets);
      }
      products.push({
        ...data,
        availability: row.availability,
        sortOrder: row.sort_order,
      });
    }
    return json(req, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      products,
      assets: [...assets.values()],
    });
  } catch {
    return json(req, { error: "catalog_assets_unavailable" }, 503);
  }
});

async function publicImagePath(
  src: string,
  slug: string,
  assets: Map<string, { path: string; url: string }>,
) {
  if (!src.startsWith(STORAGE_PREFIX)) return src;
  const storagePath = src.slice(STORAGE_PREFIX.length);
  if (
    !storagePath ||
    storagePath.startsWith("/") ||
    storagePath.split("/").some((part) => part === ".." || !part)
  ) {
    throw new Error("invalid_asset_path");
  }
  const existing = assets.get(storagePath);
  if (existing) return existing.path;
  const leaf = storagePath.split("/").at(-1) ?? "photo.bin";
  const extension = leaf.includes(".")
    ? leaf.slice(leaf.lastIndexOf(".")).toLowerCase()
    : ".jpg";
  const safeExtension = /^\.(?:jpe?g|png|webp|avif)$/.test(extension)
    ? extension
    : ".jpg";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(storagePath),
  );
  const key = Array.from(new Uint8Array(digest).slice(0, 10), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const path = `/media/products/crm/${slug}/${key}${safeExtension}`;
  const { data, error } = await supabaseAdmin.storage
    .from("catalog-images")
    .createSignedUrl(storagePath, 600);
  if (error || !data?.signedUrl) throw new Error("signed_url_unavailable");
  assets.set(storagePath, { path, url: data.signedUrl });
  return path;
}

async function readBody(
  req: Request,
): Promise<{ job_id?: string; issued_at?: number; signature?: string } | null> {
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
      ? (value as { job_id?: string; issued_at?: number; signature?: string })
      : null;
  } catch {
    return null;
  }
}
