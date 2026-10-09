import { ClipboardList, Package, Send, Settings } from "lucide-react";
import { Link, useLocation, matchPath } from "react-router";
import { UserMenu } from "@/components/admin/user-menu";

const items = [
  { href: "/leads", label: "Заявки" },
  { href: "/products", label: "Каталог" },
  { href: "/telegram", label: "Telegram" },
  { href: "/settings", label: "Настройки" },
];

const icons = [ClipboardList, Package, Send, Settings];

export default function Header() {
  const location = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/leads" className="flex shrink-0 items-center gap-3">
          <img
            className="h-9 w-auto"
            src="/snowenduro-mark.svg"
            alt="SnowEnduro"
          />
          <span className="hidden text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground lg:inline">
            CRM
          </span>
        </Link>
        <nav
          aria-label="Основная навигация"
          className="hidden items-center gap-1 md:flex"
        >
          {items.map((item, index) => {
            const active =
              Boolean(
                matchPath(
                  { path: item.href + "/*", end: false },
                  location.pathname,
                ),
              ) || location.pathname === item.href;
            const Icon = icons[index];
            return (
              <Link
                key={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
                to={item.href}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Администратор
          </span>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
