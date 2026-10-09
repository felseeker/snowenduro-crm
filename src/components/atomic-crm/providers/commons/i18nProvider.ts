import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { englishCrmMessages } from "./englishCrmMessages";

const baseMessages = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  englishCrmMessages,
);
const russianMessages = mergeTranslations(baseMessages, {
  ra: {
    action: {
      login: "Войти",
      logout: "Выйти",
      create: "Создать",
      edit: "Изменить",
      save: "Сохранить",
      cancel: "Отмена",
      delete: "Удалить",
      refresh: "Обновить",
      close: "Закрыть",
    },
    auth: {
      username: "Электронная почта",
      password: "Пароль",
      sign_in: "Войти",
      logout: "Выйти",
      auth_check_error: "Сессия завершена. Войдите снова.",
    },
    page: {
      dashboard: "Заявки",
      login: "Вход",
      not_found: "Страница не найдена",
    },
    notification: {
      logged_out: "Вы вышли из системы.",
      auth_error: "Ошибка авторизации.",
    },
    validation: { required: "Обязательное поле" },
  },
  "ra-supabase": {
    auth: {
      password_reset: "Проверьте почту: мы отправили ссылку для смены пароля.",
    },
  },
  crm: {
    navigation: { label: "Основная навигация" },
    settings: { title: "Настройки" },
  },
});

export const getInitialLocale = (): "ru" => "ru";
export const i18nProvider = polyglotI18nProvider(
  () => russianMessages,
  "ru",
  [{ locale: "ru", name: "Русский" }],
  { allowMissing: true },
);
export const testI18nProvider = i18nProvider;
