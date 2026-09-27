"use client";

// ============================================================================
// src/components/settings/ThemeSwitcher.tsx — ПЕРЕКЛЮЧАТЕЛЬ ТЕМ ОФОРМЛЕНИЯ.
// ----------------------------------------------------------------------------
// Позволяет поменять оформление одним кликом, без перезагрузки страницы.
//
// ── КАК УСТРОЕНА СМЕНА ТЕМЫ ───────────────────────────────────────────────
// Тема — это набор CSS-переменных, привязанных к атрибуту на корневом теге:
//
//     <html data-theme="aegean">   → мрамор и золото
//     <html data-theme="gibson">   → фосфорно-зелёный CRT
//
// Значит, для смены оформления достаточно поменять ОДИН атрибут. Браузер
// сам пересчитает все стили, ссылающиеся на переменные: ни React-рендера,
// ни запроса на сервер не требуется — переключение мгновенное.
//
// ── ПОЧЕМУ COOKIE, А НЕ localStorage ──────────────────────────────────────
// Страница рендерится на СЕРВЕРЕ, и сервер должен сразу вставить в HTML
// правильный data-theme. Если хранить тему в localStorage, сервер о ней
// не знает и обязан отдать тему по умолчанию. Дальше браузер выполнит
// JavaScript, прочитает localStorage и переключит тему — пользователь
// увидит ВСПЫШКУ неправильных цветов (FOUC — flash of unstyled content).
//
// Cookie приходит на сервер вместе с запросом, поэтому сервер рендерит
// нужный вариант сразу, и вспышки не происходит.
//
// ── ПОЧЕМУ РАБОТА С DOM ЖИВЁТ В useEffect, А НЕ В ОБРАБОТЧИКЕ КЛИКА ─────
// Это важный момент, на котором легко ошибиться. Соблазнительно сделать
// всё прямо в onClick:
//
//     const handleClick = () => {
//       document.documentElement.dataset.theme = id;   // ← так НЕ надо
//       document.cookie = "...";
//     };
//
// Но изменение `document` — это работа с ВНЕШНЕЙ по отношению к React
// системой. Правило React гласит: синхронизация с внешним миром живёт
// в useEffect, а обработчики событий только меняют состояние.
//
// Что это даёт конкретно здесь:
//   * есть одно место, где меняется DOM — легко найти и отладить;
//   * если тему когда-нибудь поменяет другой код (например, загрузится
//     из профиля), оформление применится автоматически;
//   * линтер React Compiler (правило react-hooks/immutability) справедливо
//     запрещает мутировать внешние объекты в теле компонента и обработчиках.
//
// Поэтому: клик → setState → эффект → DOM и cookie.
// ============================================================================

import { useEffect, useState } from "react";

import { THEME_COOKIE, THEMES, type ThemeId } from "@/themes/registry";

/**
 * Сколько живёт cookie с темой (в секундах). Один год — «практически вечно»
 * для настройки оформления.
 */
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type ThemeSwitcherProps = {
  /** Тема, которую отрисовал сервер (лежит в атрибуте <html data-theme>). */
  initialTheme: ThemeId;
};

export function ThemeSwitcher({ initialTheme }: ThemeSwitcherProps) {
  // --------------------------------------------------------------------------
  // Начальное значение приходит С СЕРВЕРА, поэтому первый рендер на клиенте
  // совпадает с серверным HTML и ошибки гидратации не возникает.
  //
  // Это тот самый принцип: состояние, влияющее на разметку, должно быть
  // известно серверу в момент рендера. Именно для этого тема читается
  // из cookie в src/app/layout.tsx.
  // --------------------------------------------------------------------------
  const [activeTheme, setActiveTheme] = useState<ThemeId>(initialTheme);

  // --------------------------------------------------------------------------
  // СИНХРОНИЗАЦИЯ С ВНЕШНИМ МИРОМ.
  //
  // Эффект срабатывает при каждом изменении activeTheme — и при монтировании
  // тоже. Действия при монтировании безвредны: атрибут уже выставлен сервером
  // (запишем то же значение), а cookie просто обновит срок жизни.
  // --------------------------------------------------------------------------
  useEffect(() => {
    // ---- 1. Применяем тему в DOM -------------------------------------------
    // documentElement — это тег <html>.
    // dataset.theme = "gibson" соответствует атрибуту data-theme="gibson".
    document.documentElement.dataset.theme = activeTheme;

    // ---- 2. Сохраняем выбор в cookie ---------------------------------------
    // Флаги cookie:
    //   path=/       — действует на всём сайте, а не только на текущей
    //                  странице (без этого «потеряется» при переходе);
    //   max-age      — срок жизни в секундах;
    //   SameSite=Lax — cookie не уйдёт на сторонние сайты (защита от CSRF),
    //                  но отправится при обычном переходе по ссылке.
    //
    // HttpOnly поставить НЕЛЬЗЯ: этот флаг выставляет только сервер,
    // а нам нужно писать из браузера. Для темы оформления это нормально —
    // в ней нет ничего секретного.
    document.cookie = `${THEME_COOKIE}=${activeTheme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
  }, [activeTheme]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Тема оформления">
        {THEMES.map((theme) => {
          const isActive = theme.id === activeTheme;

          return (
            <button
              key={theme.id}
              type="button"
              // role="radio" + aria-checked сообщают скринридеру, что это
              // группа взаимоисключающих вариантов, а не набор кнопок.
              role="radio"
              aria-checked={isActive}
              onClick={() => setActiveTheme(theme.id)}
              title={theme.description}
              className={`flex items-center gap-2 border px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {/*
                ПРЕВЬЮ ТЕМЫ — три кружка: фон, акцент, текст.
                Вместо картинок-скриншотов (которые надо рисовать и хранить)
                показываем три ключевых цвета. Этого достаточно, чтобы узнать
                тему, и не требуется ни одного изображения.
              */}
              <span className="flex shrink-0" aria-hidden="true">
                {theme.swatches.map((color, index) => (
                  <span
                    key={color}
                    className="h-3.5 w-3.5 rounded-full border border-black/40"
                    style={{
                      backgroundColor: color,
                      // Отрицательный отступ создаёт эффект наложения кружков.
                      marginLeft: index === 0 ? 0 : "-4px",
                      // Первый кружок сверху, остальные «под» ним.
                      zIndex: 3 - index,
                    }}
                  />
                ))}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] tracking-wide">{theme.label}</span>
                <span className="block truncate text-[9px] text-ink-faint">{theme.greekLabel}</span>
              </span>

              {/*
                Отметка выбранной темы — не только цветом, но и ФОРМОЙ.
                Различие только по цвету недоступно части пользователей
                (дальтонизм), поэтому дублируем символом.
              */}
              {isActive && (
                <span className="shrink-0 text-accent" aria-hidden="true">
                  ◆
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Тема хранится в cookie, поэтому применяется сразу при загрузке — без вспышки чужого оформления.
      </p>
    </div>
  );
}
