import { supabaseAdmin } from "./supabaseAdmin.ts";
import { extractStartedChats } from "./telegramUpdates.ts";

export async function findStartedChats() {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token)
    return {
      configured: false,
      chats: [] as Array<{ chatId: string; type: string }>,
    };

  try {
    const response = await fetch(
      "https://api.telegram.org/bot" +
        token +
        "/getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D",
      { signal: AbortSignal.timeout(6000) },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true)
      return { configured: true, chats: null };
    return { configured: true, chats: extractStartedChats(payload.result) };
  } catch {
    return { configured: true, chats: null };
  }
}

const publicBaseUrl = () =>
  (
    Deno.env.get("CRM_PUBLIC_URL") ??
    "https://felseeker.github.io/snowenduro-crm"
  ).replace(/\/+$/, "");

export async function sendLeadNotification(outboxId: string) {
  const { data: outbox, error: outboxError } = await supabaseAdmin
    .from("notification_outbox")
    .select("id, lead_id, state, attempt_count")
    .eq("id", outboxId)
    .maybeSingle();
  if (outboxError || !outbox)
    return { ok: false, sent: false, error: "Запись уведомления не найдена." };
  if (outbox.state === "sent") return { ok: true, sent: true, error: null };

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from("telegram_recipients")
    .select("id, chat_id")
    .eq("is_enabled", true);
  if (!token || !recipients?.length || recipientsError) {
    const reason = !token
      ? "Telegram не настроен на сервере."
      : recipientsError
        ? "Не удалось прочитать получателей."
        : "Получатели Telegram не заданы.";
    await supabaseAdmin
      .from("notification_outbox")
      .update({
        state: "failed",
        attempt_count: outbox.attempt_count + 1,
        last_error: reason,
      })
      .eq("id", outbox.id);
    return { ok: false, sent: false, error: reason };
  }

  const { data: lead, error: leadError } = await supabaseAdmin
    .from("website_leads")
    .select("id, public_code, created_at, product_interest")
    .eq("id", outbox.lead_id)
    .maybeSingle();
  if (leadError || !lead) {
    await supabaseAdmin
      .from("notification_outbox")
      .update({
        state: "failed",
        attempt_count: outbox.attempt_count + 1,
        last_error: "Не удалось прочитать заявку.",
      })
      .eq("id", outbox.id);
    return { ok: false, sent: false, error: "Не удалось прочитать заявку." };
  }

  const { data: existingDeliveries } = await supabaseAdmin
    .from("notification_deliveries")
    .select("recipient_id, state, attempt_count")
    .eq("outbox_id", outbox.id);
  const deliveryMap = new Map(
    (existingDeliveries ?? []).map((row) => [row.recipient_id, row]),
  );
  const code = String(lead.public_code).padStart(4, "0");
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Vladivostok",
  }).format(new Date(lead.created_at));
  const cardUrl = publicBaseUrl() + "/#/leads/" + lead.id;
  const { data: matchingProduct } = await supabaseAdmin
    .from("products")
    .select("name")
    .eq("name", lead.product_interest)
    .maybeSingle();
  const safeInterest =
    matchingProduct?.name ??
    (lead.product_interest === "Проверка совместимости" ||
    lead.product_interest === "Snowbike-комплект" ||
    lead.product_interest === "Снегоход под заказ" ||
    lead.product_interest === "Пока не определился"
      ? lead.product_interest
      : "Обращение с сайта");
  const text =
    "Новая заявка #" +
    code +
    "\n\nТовар: " +
    safeInterest +
    "\nИсточник: snowenduro.ru\nВремя: " +
    time +
    "\n\nОткрыть в CRM: " +
    cardUrl;
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const previous = deliveryMap.get(recipient.id);
    if (previous?.state === "sent") {
      sent += 1;
      continue;
    }
    const attempt = (previous?.attempt_count ?? 0) + 1;
    await supabaseAdmin
      .from("notification_deliveries")
      .upsert(
        {
          outbox_id: outbox.id,
          recipient_id: recipient.id,
          state: "pending",
          attempt_count: attempt,
          last_error: null,
        },
        { onConflict: "outbox_id,recipient_id" },
      );
    try {
      const response = await fetch(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: recipient.chat_id,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(6000),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true)
        throw new Error("telegram_rejected");
      await supabaseAdmin
        .from("notification_deliveries")
        .update({
          state: "sent",
          attempt_count: attempt,
          last_error: null,
          sent_at: new Date().toISOString(),
        })
        .eq("outbox_id", outbox.id)
        .eq("recipient_id", recipient.id);
      sent += 1;
    } catch {
      await supabaseAdmin
        .from("notification_deliveries")
        .update({
          state: "failed",
          attempt_count: attempt,
          last_error: "Telegram недоступен или отклонил сообщение.",
        })
        .eq("outbox_id", outbox.id)
        .eq("recipient_id", recipient.id);
      failed += 1;
    }
  }

  const allDelivered = failed === 0;
  await supabaseAdmin
    .from("notification_outbox")
    .update({
      state: allDelivered ? "sent" : "failed",
      attempt_count: outbox.attempt_count + 1,
      last_error: allDelivered ? null : "Не все уведомления удалось доставить.",
      sent_at: allDelivered ? new Date().toISOString() : null,
    })
    .eq("id", outbox.id);
  return {
    ok: allDelivered,
    sent,
    failed,
    error: allDelivered ? null : "Не все уведомления удалось доставить.",
  };
}

export async function sendTestMessage() {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const { data: recipients, error } = await supabaseAdmin
    .from("telegram_recipients")
    .select("chat_id")
    .eq("is_enabled", true);
  if (!token || error || !recipients?.length)
    return {
      sent: 0,
      failed: recipients?.length ?? 0,
      configured: Boolean(token) && !error,
    };
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      const response = await fetch(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: recipient.chat_id,
            text: "Тестовое уведомление SnowEnduro CRM. Персональные данные клиентов в Telegram не отправляются.",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(6000),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true)
        throw new Error("telegram_rejected");
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed, configured: true };
}
