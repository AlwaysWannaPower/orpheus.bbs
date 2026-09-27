// ============================================================================
// src/components/layout/Sidebar.tsx — ЛЕВАЯ ПАНЕЛЬ: НАВИГАЦИЯ, ПЛЕЙЛИСТЫ, ТЕМА.
// ----------------------------------------------------------------------------
// Серверный компонент: список плейлистов читается из базы напрямую.
//
// Внутри серверного компонента живут клиентские «островки» интерактивности:
// MainNav (подсветка активного пункта), PlaylistCreateForm (форма),
// ThemeSwitcher (переключатель оформления). Это нормальная и обычная
// практика: серверная оболочка + клиентские элементы.
// ============================================================================

import Link from "next/link";

import { MainNav } from "@/components/layout/MainNav";
import { PlaylistCreateForm } from "@/components/playlists/PlaylistCreateForm";
import { ThemeSwitcher } from "@/components/settings/ThemeSwitcher";
import { listPlaylists } from "@/lib/db/playlist-queries";
import type { ThemeId } from "@/themes/registry";

type SidebarProps = {
  /** Тема, которую сервер прочитал из cookie (см. src/app/layout.tsx). */
  themeId: ThemeId;
};

export async function Sidebar({ themeId }: SidebarProps) {
  const playlists = await listPlaylists();

  return (
    // На узких экранах панель уезжает наверх — раскладка адаптивная
    // без единой строчки JavaScript.
    <aside className="flex w-full shrink-0 flex-col gap-5 border-b border-line p-3 lg:w-60 lg:border-b-0 lg:border-r">
      {/* ---------------- Навигация ---------------- */}
      <section>
        <h2 className="term-title mb-2">{"// НАВИГАЦИЯ"}</h2>
        <MainNav />
      </section>

      <div className="motif-meander text-line-strong" aria-hidden="true" />

      {/* ---------------- Плейлисты ---------------- */}
      <section className="flex min-h-0 flex-col gap-2">
        <h2 className="term-title">{"// ПЛЕЙЛИСТЫ"}</h2>

        <PlaylistCreateForm />

        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {playlists.length === 0 && (
            <p className="px-2 py-1 text-[11px] leading-relaxed text-ink-muted">
              пока пусто. Создай первый плейлист выше.
            </p>
          )}

          {playlists.map((playlist) => (
            <Link
              key={playlist.id}
              href={`/playlists/${playlist.id}`}
              className="flex items-center justify-between gap-2 truncate border-l-2 border-transparent px-2 py-1 text-[12px] text-ink-muted hover:border-line-strong hover:bg-accent/10 hover:text-ink"
              title={playlist.name}
            >
              <span className="truncate">{playlist.name}</span>
              {/* tabular-nums выравнивает цифры по ширине — иначе строки
                  «дрожали» бы при изменении числа. */}
              <span className="shrink-0 text-ink-faint tabular-nums">{playlist.trackCount}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="motif-meander text-line-strong" aria-hidden="true" />

      {/* ---------------- Тема оформления ---------------- */}
      <section>
        <h2 className="term-title mb-2">{"// ΘΕΜΑ · ТЕМА"}</h2>
        <ThemeSwitcher initialTheme={themeId} />
      </section>

      <div className="motif-meander text-line-strong" aria-hidden="true" />

      {/*
        ---------------- Подсказка по горячим клавишам ----------------

        ── ЧТО ЗДЕСЬ БЫЛО ИСПРАВЛЕНО ────────────────────────────────────────
        Раньше этот блок был окрашен в САМЫЙ ТЁМНЫЙ цвет темы (в прежней
        палитре — #0a2a12 на чёрном фоне). Контраст получался около 1.4:1:
        текст практически сливался с фоном и читался только при большом
        желании.

        Теперь используется цвет роли ink-muted (контраст ≈ 10:1 к фону),
        а сами названия клавиш выделены ещё ярче — цветом ink.

        Иерархия «действие ярче пояснения» помогает сканировать список
        глазами: сначала видишь клавиши, потом читаешь, что они делают.
      */}
      <section className="mt-auto hidden lg:block">
        <h2 className="term-title mb-2">{"// ΚΛΕΙΔΕΣ · КЛАВИШИ"}</h2>
        <ul className="flex flex-col gap-1 text-[11px] leading-relaxed text-ink-muted">
          <li>
            <span className="text-ink">ПРОБЕЛ</span> — плей/пауза
          </li>
          <li>
            <span className="text-ink">← →</span> — ±5 секунд
          </li>
          <li>
            <span className="text-ink">↑ ↓</span> — громкость
          </li>
          <li>
            <span className="text-ink">N / P</span> — вперёд / назад
          </li>
        </ul>
      </section>
    </aside>
  );
}
