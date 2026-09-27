// ============================================================================
// src/app/playlists/page.tsx — СПИСОК ПЛЕЙЛИСТОВ И УПРАВЛЕНИЕ ИМИ.
// ----------------------------------------------------------------------------
// Серверный компонент: читает плейлисты из базы и передаёт их клиентским
// карточкам.
// ============================================================================

import type { Metadata } from "next";

import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { BRANDING } from "@/config/branding";
import { listPlaylists } from "@/lib/db/playlist-queries";

export const dynamic = "force-dynamic";

// Метаданные конкретной страницы. Они дополняют метаданные из layout
// и заменяют совпадающие поля (в данном случае title).
export const metadata: Metadata = {
  title: `Плейлисты — ${BRANDING.name}`,
};

export default async function PlaylistsPage() {
  const playlists = await listPlaylists();

  const totalTracks = playlists.reduce((sum, playlist) => sum + playlist.trackCount, 0);

  return (
    <div className="flex flex-col gap-3">
      <section className="term-panel p-3">
        <h2 className="term-title mb-2">{"// ПЛЕЙЛИСТЫ"}</h2>
        <p className="text-[11px] text-ink-muted">
          Всего плейлистов: {playlists.length} · треков в них: {totalTracks}
        </p>
        <p className="text-[10px] text-ink-faint mt-1">
          Новый плейлист создаётся в левой панели. Добавить трек можно кнопкой «＋» в списке библиотеки.
        </p>
      </section>

      {playlists.length === 0 ? (
        <section className="term-panel p-6 text-center text-xs text-ink-muted">
          <div className="text-2xl mb-2" aria-hidden="true">
            ░▒▓
          </div>
          ПЛЕЙЛИСТОВ ПОКА НЕТ
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {playlists.map((playlist) => (
            // key обязателен. id из базы — правильный ключ
            // (индекс массива тут был бы ошибкой: плейлисты можно удалять,
            // и React перепутал бы состояние карточек).
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </section>
      )}
    </div>
  );
}
