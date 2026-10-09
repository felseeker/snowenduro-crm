import { useEffect } from "react";
import { useStore } from "ra-core";
import { ThemeProviderContext, type Theme } from "./theme-context";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "snowenduro-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useStore<Theme>(storageKey, defaultTheme);
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme,
    );
  }, [theme]);
  return (
    <ThemeProviderContext.Provider {...props} value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
