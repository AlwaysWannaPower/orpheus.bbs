// ============================================================================
// src/components/layout/AppHeader.tsx — ШАПКА: НАЗВАНИЕ И СТАТИСТИКА АРХИВА.
// ----------------------------------------------------------------------------
// Это СЕРВЕРНЫЙ компонент: он объявлен как async и обращается к базе напрямую.
//
// ── ПОЧЕМУ НЕ ЧЕРЕЗ API ───────────────────────────────────────────────────
// Server Component и база данных живут в одном процессе. Зачем гонять данные
// через HTTP (запрос → сериализация → сеть → парсинг), если можно просто
// вызвать функцию?
//
// Это одна из ключевых идей App Router: серверный код обращается к базе,
// файлам и любым ресурсам напрямую. API нужен там, где данные запрашивает
// БРАУЗЕР.
//
// ── ЧТО РИСУЕТ ШАПКА ──────────────────────────────────────────────────────
//   1. Полоса МЕАНДРА — греческий орнамент (реализован в globals.css
//      через mask-image, поэтому красится в цвет акцента текущей темы).
//   2. Греческое имя ΟΡΦΕΥΣ — крупно.
//   3. Латиница ORPHEUS.BBS и версия — «адрес» в терминале.
//   4. Строка-слоган.
//   5. Справа — сводка по архиву (из базы).
// ============================================================================

import { BRANDING } from "@/config/branding";
import { getLibraryStats } from "@/lib/db/track-queries";
import { albumsLabel, formatTotalDuration, tracksLabel } from "@/lib/format";

export async function AppHeader() {
  // await прямо в компоненте. Next.js умеет ждать: пока данные грузятся,
  // уже отрисованная часть страницы остаётся видимой.
  const stats = await getLibraryStats();

  return (
    <header className="border-b border-line">
      {/*
        Полоса меандра.

        Это <div> с классом .motif-meander из globals.css. Внутри нет ни
        картинок, ни SVG-файлов: орнамент вшит в CSS как mask-image, а цвет
        берётся из currentColor — то есть из класса text-*.

        aria-hidden — орнамент декоративный, скринридеру он не нужен.
      */}
      <div className="motif-meander text-accent" aria-hidden="true" />

      <div className="px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            {/*
              ГРЕЧЕСКОЕ ИМЯ.

              ── ПОЧЕМУ НЕ КАРТИНКОЙ И НЕ ASCII-АРТОМ ─────────────────────
              ASCII-рисунок (как было в первой версии) — это просто текст
              в <pre>. Он зависит от шрифта: если шрифт не загрузился,
              «картинка» разваливается, потому что символы перестают быть
              моноширинными.

              Настоящие греческие буквы надёжнее: они часть шрифта IBM Plex
              Mono (subset 'greek'), масштабируются как обычный текст,
              доступны скринридерам и выделяются мышью.

              Разрядка (tracking) нужна потому, что греческие заглавные
              без неё слипаются: ΟΡΦΕΥΣ иначе читается как одно пятно.
            */}
            <h1 className="text-[26px] leading-none tracking-[0.22em] text-accent glow select-none sm:text-[34px]">
              {BRANDING.greekName}
            </h1>

            {/*
              Латиница + версия. Разделитель «·» — типографская средняя точка,
              она визуально легче обычного дефиса.
            */}
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[13px] tracking-[0.28em] text-ink sm:text-[15px]">{BRANDING.name}</span>
              <span className="text-[10px] text-ink-faint">v{BRANDING.version}</span>
              {/* Мигающий курсор — деталь терминала. */}
              <span className="cursor-blink text-accent" aria-hidden="true" />
            </p>

            <p className="mt-1 text-[10px] tracking-[0.12em] text-ink-muted">{BRANDING.tagline}</p>
          </div>

          {/* ---------------- Сводка по архиву ---------------- */}
          <div className="text-right text-[11px] leading-relaxed text-ink-muted">
            <div className="text-ink">
              [ АРХИВ: {tracksLabel(stats.totalTracks)} · {albumsLabel(stats.totalAlbums)} ]
            </div>
            <div>
              исполнителей: {stats.totalArtists} · длительность: {formatTotalDuration(stats.totalDuration)}
            </div>
            <div>в избранном: {stats.favoriteCount}</div>
          </div>
        </div>
      </div>

      {/* Второй орнамент — нижняя граница шапки. */}
      <div className="motif-meander text-line-strong" aria-hidden="true" />
    </header>
  );
}
