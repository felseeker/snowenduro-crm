import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  json,
  originAllowed,
  preflight,
  requireAdmin,
} from "../_shared/snowenduro.ts";
import {
  findStartedChats,
  sendLeadNotification,
  sendTestMessage,
} from "../_shared/telegram.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (!originAllowed(req, "CRM_ORIGINS"))
    return json(req, { error: "origin_not_allowed" }, 403);
  if (req.method !== "POST")
    return json(req, { error: "method_not_allowed" }, 405);
  const admin = await requireAdmin(req);
  if (!admin.ok) return json(req, { error: "unauthorized" }, 401);
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid_request" }, 400);
  }

  if (body.action === "test") {
    const result = await sendTestMessage();
    if (!result.configured)
      return json(
        req,
        {
          error: "telegram_not_configured",
          sent: result.sent,
          failed: result.failed,
        },
        503,
      );
    if (result.failed > 0)
      return json(
        req,
        {
          error: "telegram_delivery_failed",
          sent: result.sent,
          failed: result.failed,
        },
        502,
      );
    return json(req, { sent: result.sent, failed: 0 });
  }
  if (body.action === "discover") {
    const result = await findStartedChats();
    if (!result.configured)
      return json(req, { error: "telegram_not_configured" }, 503);
    if (result.chats === null)
      return json(req, { error: "telegram_updates_unavailable" }, 502);
    return json(req, { chats: result.chats });
  }
  if (body.action === "retry") {
    const { data: pending, error } = await supabaseAdmin
      .from("notification_outbox")
      .select("id")
      .in("state", ["pending", "failed"])
      .order("created_at")
      .limit(50);
    if (error) return json(req, { error: "retry_unavailable" }, 503);
    let sent = 0;
    let failed = 0;
    for (const item of pending ?? []) {
      const result = await sendLeadNotification(item.id);
      sent += result.sent ? 1 : 0;
      failed += result.ok ? 0 : 1;
    }
    return json(req, { sent, failed, checked: pending?.length ?? 0 });
  }
  return json(req, { error: "unknown_action" }, 400);
});
