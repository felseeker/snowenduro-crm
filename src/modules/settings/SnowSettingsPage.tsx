import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ErrorNotice, PageHeading } from "../shared";

type Status = {
  telegramConfigured: boolean;
  githubConfigured: boolean;
  siteRepository: string;
  database: string;
  lastPublication?: {
    status: string;
    created_at: string;
    error_message: string | null;
  } | null;
};

export function SnowSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setStatus(await api<Status>("/settings/status"));
    } catch {
      setError("Не удалось проверить сервер CRM.");
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function retryPublication() {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await api("/catalog/publish", { method: "POST", body: "{}" });
      setMessage("Каталог отправлен на публикацию.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Автоматическая публикация каталога пока не настроена.",
      );
    }
    setWorking(false);
  }

  return (
    <section>
      <PageHeading
        eyebrow="SnowEnduro / администрирование"
        title="Настройки"
        description="Статус подключений и безопасные параметры CRM."
        action={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw size={15} className="mr-2" />
            Обновить
          </Button>
        }
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
          Проверяем подключения…
        </p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-primary" size={20} />
              <h2 className="font-semibold">Сайт и каталог</h2>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <StatusRow
                label="Хранилище CRM"
                value={status?.database || "SQLite · локальный файл"}
                ready
              />
              <StatusRow
                label="Публичный сайт"
                value="https://snowenduro.ru"
                ready
              />
              <StatusRow
                label="Статические страницы товаров"
                value={
                  status?.githubConfigured
                    ? "Обновляются через GitHub Actions после публикации"
                    : "Обновятся после подключения GitHub"
                }
                ready={Boolean(status?.githubConfigured)}
              />
              <StatusRow
                label="Серверная интеграция GitHub"
                value={
                  status?.githubConfigured
                    ? "Подключена"
                    : "Нужны серверные ключи GitHub и callback"
                }
                ready={Boolean(status?.githubConfigured)}
              />
              <StatusRow
                label="Репозиторий сайта"
                value={status?.siteRepository || "felseeker/snowenduro-site"}
                ready={Boolean(status?.githubConfigured)}
              />
            </dl>
            <Button
              className="mt-6"
              variant="outline"
              onClick={() => void retryPublication()}
              disabled={working || !status?.githubConfigured}
            >
              {working ? "Отправляем…" : "Повторить синхронизацию каталога"}
            </Button>
            <a
              className="mt-4 flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
              href="https://github.com/felseeker/snowenduro-site/actions"
              target="_blank"
              rel="noreferrer"
            >
              Открыть историю публикаций <ExternalLink size={13} />
            </a>
          </section>
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-primary" size={20} />
              <h2 className="font-semibold">Безопасность и данные</h2>
            </div>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>
                Вход и доступ проверяет сервер CRM. Данные хранятся в локальном
                SQLite-файле на этой же машине.
              </li>
              <li>
                Самостоятельная регистрация закрыта. В CRM входит только
                созданный администратор.
              </li>
              <li>
                Токен Telegram задаётся в серверном файле `.env`. Сам токен не
                передаётся в интерфейс.
              </li>
              <li>
                Телефоны, имена и комментарии клиентов не включаются в
                уведомления Telegram.
              </li>
              <li>
                Размещение сервера, резервные копии и документы обработки данных
                нужно проверить до приёма реальных обращений.
              </li>
            </ul>
            <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-6">
              <strong className="text-foreground">
                Сайт и CRM — разные части.
              </strong>
              <span className="text-muted-foreground">
                {" "}
                GitHub Pages показывает только интерфейс и не хранит заявки.
                Публичную форму нужно подключать к работающему серверу.
              </span>
            </div>
          </section>
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6 xl:col-span-2">
            <div className="flex items-center gap-3">
              <CircleAlert className="text-primary" size={20} />
              <h2 className="font-semibold">История синхронизации</h2>
            </div>
            {status?.lastPublication ? (
              <div className="mt-4 flex flex-col justify-between gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-medium">
                    {status.lastPublication.status === "succeeded"
                      ? "Публикация завершена"
                      : status.lastPublication.status === "failed"
                        ? "Публикация завершилась ошибкой"
                        : "Публикация выполняется"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Vladivostok",
                    }).format(new Date(status.lastPublication.created_at))}
                  </p>
                  {status.lastPublication.error_message && (
                    <p className="mt-2 text-sm text-destructive">
                      {status.lastPublication.error_message}
                    </p>
                  )}
                </div>
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  {status.lastPublication.status === "succeeded" && (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  )}
                  {status.lastPublication.status}
                </span>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Записей о публикации пока нет.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function StatusRow({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="flex flex-col justify-between gap-1 border-b border-border pb-3 sm:flex-row sm:items-center">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 font-medium">
        {ready ? (
          <CheckCircle2 size={15} className="text-emerald-400" />
        ) : (
          <CircleAlert size={15} className="text-primary" />
        )}
        {value}
      </dd>
    </div>
  );
}
