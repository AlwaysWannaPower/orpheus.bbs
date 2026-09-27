"use client";

// ============================================================================
// src/components/layout/MainNav.tsx — ГЛАВНАЯ НАВИГАЦИЯ С ПОДСВЕТКОЙ АКТИВНОГО.
// ----------------------------------------------------------------------------
// Показательный момент: как определить, на какой странице мы находимся.
//
// ── ПОЧЕМУ НЕ <a href> ────────────────────────────────────────────────────
// Обычная ссылка заставляет браузер загрузить страницу целиком: заново
// скачать HTML, CSS, JavaScript, заново создать React-дерево. При этом
// наш <audio> будет уничтожен — музыка остановится.
//
// Компонент <Link> из Next.js перехватывает клик и делает «мягкий» переход:
//   * подгружает только изменившуюся часть;
//   * сохраняет состояние клиентских компонентов;
//   * работает кнопка «назад»;
//   * заранее подгружает страницу при наведении (prefetch).
// ============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Пункты меню. Массив объектов — удобно расширять. */
const NAV_ITEMS = [
  { href: "/", label: "БИБЛИОТЕКА", icon: "♪" },
  { href: "/playlists", label: "ПЛЕЙЛИСТЫ", icon: "≡" },
  { href: "/history", label: "ИСТОРИЯ", icon: "⏱" },
] as const;

export function MainNav() {
  // usePathname возвращает текущий путь, например "/playlists/3".
  // Этот хук доступен только в клиентских компонентах.
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1" aria-label="Основная навигация">
      {NAV_ITEMS.map((item) => {
        // ------------------------------------------------------------------
        // ЛОГИКА АКТИВНОСТИ.
        //
        // Для главной страницы ("/") нужно ТОЧНОЕ совпадение: иначе она
        // подсвечивалась бы на всех страницах, ведь любой путь начинается
        // со слэша.
        //
        // Для остальных — проверяем, начинается ли путь с нужного:
        // "/playlists/3" должен подсветить пункт "/playlists".
        // ------------------------------------------------------------------
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            // aria-current="page" — стандартный способ сообщить скринридеру,
            // что это текущая страница.
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 px-2 py-1.5 text-[12px] tracking-wide transition-colors border-l-2 ${
              isActive
                ? "border-accent bg-accent/10 text-accent glow"
                : "border-transparent text-ink-muted hover:text-ink hover:border-line-strong"
            }`}
          >
            <span aria-hidden="true" className="w-4 text-center">
              {item.icon}
            </span>
            {item.label}
            {/* Мигающий курсор на активном пункте — та самая деталь,
                которая создаёт ощущение терминала. */}
            {isActive && <span className="cursor-blink ml-auto" aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}
