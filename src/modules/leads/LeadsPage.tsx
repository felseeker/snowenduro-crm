import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jsonBody } from "@/lib/api";
import { ErrorNotice, formatDate, PageHeading, StatusPill } from "../shared";
import { LEAD_STATUSES, type LeadStatus, type WebsiteLead } from "../types";

export function LeadsPage() {
  const [rows, setRows] = useState<WebsiteLead[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    try {
      setRows(await api<WebsiteLead[]>("/leads?" + params.toString()));
    } catch {
      setError("Не удалось загрузить заявки. Проверьте соединение с базой.");
    }
    setLoading(false);
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  async function updateStatus(id: string, nextStatus: LeadStatus) {
    try {
      await api("/leads/" + encodeURIComponent(id), {
        method: "PATCH",
        body: jsonBody({ status: nextStatus }),
      });
      setRows((current) =>
        current.map((row) =>
          row.id === id ? { ...row, status: nextStatus } : row,
        ),
      );
    } catch {
      setError("Не удалось изменить статус заявки.");
    }
  }

  return (
    <section>
      <PageHeading
        eyebrow="SnowEnduro / CRM"
        title="Заявки"
        description="Новые обращения с сайта, статус работы и контактная карточка клиента."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={15} className="mr-2" />
            Обновить
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Поиск по имени, телефону или товару"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="Фильтр по статусу"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-60"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">Все статусы</option>
          {LEAD_STATUSES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}
      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Загружаем заявки…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-14 text-center">
          <p className="text-base font-medium">Заявок пока нет</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Когда подключённая форма сайта получит обращение, оно появится
            здесь.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Заявка</th>
                    <th className="px-4 py-3">Клиент</th>
                    <th className="px-4 py-3">Интерес</th>
                    <th className="px-4 py-3">Источник</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Время</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-primary">
                        #{String(row.public_code).padStart(4, "0")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.customer_name}</div>
                        <a
                          className="mt-1 block text-xs text-muted-foreground hover:text-primary"
                          href={"tel:" + row.phone}
                        >
                          {row.phone}
                        </a>
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        {row.product_interest}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {sourceLabel(row.source_page)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label="Изменить статус"
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                          value={row.status}
                          onChange={(event) =>
                            void updateStatus(
                              row.id,
                              event.target.value as LeadStatus,
                            )
                          }
                        >
                          {LEAD_STATUSES.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          aria-label="Открыть заявку"
                          className="inline-flex items-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-primary"
                          to={"/leads/" + row.id}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <article
                key={row.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-primary">
                      #{String(row.public_code).padStart(4, "0")}
                    </p>
                    <h2 className="mt-1 font-semibold">{row.customer_name}</h2>
                    <a
                      className="mt-1 block text-sm text-muted-foreground"
                      href={"tel:" + row.phone}
                    >
                      {row.phone}
                    </a>
                  </div>
                  <Link
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                    aria-label="Открыть заявку"
                    to={"/leads/" + row.id}
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </div>
                <p className="mt-4 text-sm">{row.product_interest}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(row.created_at)}
                  </span>
                  <StatusPill status={row.status} />
                </div>
                <select
                  aria-label="Изменить статус"
                  className="mt-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={row.status}
                  onChange={(event) =>
                    void updateStatus(row.id, event.target.value as LeadStatus)
                  }
                >
                  {LEAD_STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
        </>
      )}
      {!loading && rows.length > 0 && (
        <p className="mt-3 text-right text-xs text-muted-foreground">
          Показаны последние {rows.length} заявок
        </p>
      )}
    </section>
  );
}

function sourceLabel(value: string) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value;
  }
}
