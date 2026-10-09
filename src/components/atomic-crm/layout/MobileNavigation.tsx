import { ClipboardList, Package, Send, Settings } from "lucide-react";
import { Link, useLocation, matchPath } from "react-router";

const items = [
  { href: "/leads", label: "Заявки", Icon: ClipboardList },
  { href: "/products", label: "Каталог", Icon: Package },
  { href: "/telegram", label: "Telegram", Icon: Send },
  { href: "/settings", label: "Настройки", Icon: Settings },
];

export const MobileNavigation = () => {
  const location = useLocation();
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {items.map(({ href, label, Icon }) => {
          const active =
            Boolean(
              matchPath({ path: href + "/*", end: false }, location.pathname),
            ) || location.pathname === href;
          return (
            <Link
              key={href}
              aria-current={active ? "page" : undefined}
              className={
                "flex min-h-16 flex-col items-center justify-center gap-1 text-[0.68rem] font-medium transition-colors " +
                (active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground")
              }
              to={href}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
