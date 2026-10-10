import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Check,
  LoaderCircle,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, jsonBody } from "@/lib/api";
import { ErrorNotice, PageHeading } from "../shared";
import type { TelegramRecipient } from "../types";

type ServiceStatus = {
  configured?: boolean;
  pending?: number;
  failed?: number;
};
type FoundChat = { chatId: string; type: "private" | "group" | "supergroup" };

export function TelegramPage() {
  const [recipients, setRecipients] = useState<TelegramRecipient[]>([]);
  const [chatIds, setChatIds] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"test" | "retry" | "discover" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [foundChats, setFoundChats] = useState<FoundChat[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rows, status] = await Promise.all([
        api<TelegramRecipient[]>("/telegram/recipients"),
        api<ServiceStatus>("/telegram/status"),
      ]);
      setRecipients(rows);
      setChatIds(
        rows
          .filter((row) => row.is_enabled)
          .map((row) => row.chat_id)
          .join("\n"),
      );
      setConfigured(Boolean(status.configured));
      setQueueCount((status.pending || 0) + (status.failed || 0));
    } catch {
      setError("Не удалось загрузить получателей Telegram.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRecipients() {
    const ids = Array.from(
      new Set(
        chatIds
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    if (ids.some((id) => !/^-?\d{1,20}$/.test(id))) {
      setError(
        "Chat ID должен содержать только цифры; для групп допустим знак минус.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const rows = await api<TelegramRecipient[]>("/telegram/recipients", {
        method: "PUT",
        body: jsonBody({ chatIds: ids }),
      });
      setRecipients(rows);
      setMessage("Список получателей сохранён.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить список получателей.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runAction(which: "test" | "retry") {
    setAction(which);
    setError("");
    setMessage("");
    try {
      const data = await api<{
        sent?: number;
        checked?: number;
        chats?: FoundChat[];
      }>("/telegram/action", {
        method: "POST",
        body: jsonBody({ action: which }),
      });
      setMessage(
        which === "test"
          ? "Тестовое сообщение отправлено получателям."
          : "Повторная отправка завершена. Отправлено: " +
              String(data.sent ?? 0) +
              ".",
      );
      if (which === "retry")
        setQueueCount(Math.max(0, (data.checked || 0) - (data.sent || 0)));
    } catch {
      setError(
        which === "test"
          ? "Не удалось отправить тестовое уведомление. Проверьте конфигурацию на сервере."
          : "Не удалось запустить повторную отправку.",
      );
    } finally {
      setAction(null);
    }
  }

  async function findChats() {
    setAction("discover");
    setError("");
    setMessage("");
    setFoundChats([]);
    try {
      const { chats } = await api<{ chats?: FoundChat[] }>("/telegram/action", {
        method: "POST",
        body: jsonBody({ action: "discover" }),
      });
      if (!Array.isArray(chats)) throw new Error("Invalid response");
      if (chats.length === 0)
        setMessage(
          "Новых чатов не найдено. Попросите получателей нажать /start у бота и обновите поиск.",
        );
      else setFoundChats(chats);
    } catch {
      setError(
        "Не удалось найти чаты. Убедитесь, что получатели нажали /start и для бота не включён webhook.",
      );
    } finally {
      setAction(null);
    }
  }

  function addFoundChat(chatId: string) {
    const ids = new Set(
      chatIds
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    );
    ids.add(chatId);
    setChatIds(Array.from(ids).join("\n"));
  }

  return (
    <section>
      <PageHeading
        eyebrow="SnowEnduro / уведомления"
        title="Telegram"
        description="Уведомления о новых обращениях не содержат имени, телефона и других персональных данных."
      />
      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}
      {message && (
        <p
          className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300"
          role="status"
        >
          {message}
        </p>
      )}
      {loading ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Загружаем настройки…
        </p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <BellRing size={19} />
              </span>
              <div>
                <h2 className="font-semibold">Получатели</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Каждому получателю нужно открыть чат с ботом и нажать /start.
                  Потом найдите чаты здесь или внесите Chat ID вручную.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm leading-6 text-muted-foreground">
              Создайте бота через{" "}
              <a
                className="text-primary underline"
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
              >
                @BotFather
              </a>
              , задайте токен в локальном файле `.env` на сервере CRM и
              отправьте получателям ссылку на бота. Для группы добавьте в неё
              бота, затем отправьте команду /start.
            </div>
            <label className="mt-5 block space-y-2 text-sm font-medium">
              Chat ID получателей
              <Textarea
                rows={6}
                inputMode="numeric"
                value={chatIds}
                onChange={(event) => setChatIds(event.target.value)}
                placeholder="Например: 123456789\n-1001234567890"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void saveRecipients()} disabled={saving}>
                <Save size={15} className="mr-2" />
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void findChats()}
                disabled={action !== null || !configured}
              >
                {action === "discover" ? (
                  <LoaderCircle size={15} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={15} className="mr-2" />
                )}
                Найти чаты с /start
              </Button>
              <Button
                variant="outline"
                onClick={() => void runAction("test")}
                disabled={
                  action !== null || !configured || recipients.length === 0
                }
              >
                {action === "test" ? (
                  <LoaderCircle size={15} className="mr-2 animate-spin" />
                ) : (
                  <Send size={15} className="mr-2" />
                )}
                Тестовое сообщение
              </Button>
            </div>
            {foundChats.length > 0 && (
              <div className="mt-5 rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium">
                  Чаты, найденные в Telegram
                </h3>
                <ul className="mt-3 space-y-2">
                  {foundChats.map((chat) => (
                    <li
                      key={chat.chatId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>
                        <span className="font-mono">{chat.chatId}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {chat.type === "private" ? "личный чат" : "группа"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addFoundChat(chat.chatId)}
                        disabled={chatIds
                          .split(/[\s,;]+/)
                          .includes(chat.chatId)}
                      >
                        Добавить
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Найденные Chat ID не сохраняются автоматически. Выберите
                  нужные и нажмите «Сохранить».
                </p>
              </div>
            )}
            {recipients.length > 0 && (
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="text-sm font-medium">Сохранённые получатели</h3>
                <ul className="mt-3 space-y-2">
                  {recipients.map((recipient) => (
                    <li
                      key={recipient.id}
                      className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"
                    >
                      <span>{recipient.chat_id}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                        <Check size={14} />
                        {recipient.is_enabled ? "Активен" : "Отключён"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <aside className="space-y-5">
            <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <h2 className="font-semibold">Подключение бота</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Токен бота хранится только на сервере CRM. Он не показывается в
                CRM и не попадает в браузер.
              </p>
              <div className="mt-4 rounded-lg border border-border bg-background px-3 py-3 text-sm">
                Состояние:{" "}
                <strong
                  className={configured ? "text-emerald-300" : "text-primary"}
                >
                  {configured ? "токен настроен" : "токен не настроен"}
                </strong>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Для включения задайте `TELEGRAM_BOT_TOKEN` в файле `.env` рядом
                с CRM, затем добавьте Chat ID получателей. Никакие данные
                клиента в Telegram не отправляются.
              </p>
            </section>
            <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <h2 className="font-semibold">Ошибки отправки</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Заявка сохраняется в базе до отправки уведомления. Если Telegram
                временно недоступен, запись останется в очереди.
              </p>
              <p className="mt-3 text-sm">
                Неотправленных уведомлений: <strong>{queueCount}</strong>
              </p>
              <Button
                className="mt-4 w-full"
                variant="outline"
                onClick={() => void runAction("retry")}
                disabled={action !== null || !configured}
              >
                {action === "retry" ? (
                  <LoaderCircle size={15} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={15} className="mr-2" />
                )}
                Повторить неотправленные
              </Button>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}
