// ============================================================================
// src/app/playlists/[id]/page.tsx — СТРАНИЦА ОДНОГО ПЛЕЙЛИСТА.
// ----------------------------------------------------------------------------
// Динамический маршрут: папка в квадратных скобках [id] означает
// «сюда подставляется любое значение». URL /playlists/7 даст id = "7".
//
// Обрати внимание: id приходит СТРОКОЙ, а в базе это число. Преобразование
// делает Number(), и мы обязательно проверяем результат.
// ============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

import { TrackList } from "@/components/library/TrackList";
import { getPlaylist, listPlaylistTracks } from "@/lib/db/playlist-queries";
import { tracksLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PlaylistPage({ params }: PageProps<"/playlists/[id]">) {
  // params — промис (Next.js 15+), обязательно await.
  const { id } = await params;

  const playlistId = Number(id);

  // --------------------------------------------------------------------------
  // ВАЛИДАЦИЯ.
  //
  // Если по адресу /playlists/abc — Number вернёт NaN.
  // Если /playlists/999999 — плейлиста нет, getPlaylist вернёт null.
  //
  // В обоих случаях правильная реакция — notFound().
  // --------------------------------------------------------------------------
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    notFound();
  }

  const playlist = await getPlaylist(playlistId);
  if (!playlist) {
    notFound();
  }

  const tracks = await listPlaylistTracks(playlistId);

  // Считаем суммарную длительность прямо в JS — здесь это уместно,
  // потому что список уже загружен целиком.
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const totalMinutes = Math.round(totalDuration / 60);

  return (
    <div className="flex flex-col gap-3">
      <section className="term-panel p-3">
        {/* Хлебные крошки — помогают не потеряться. */}
        <div className="text-[10px] text-ink-faint mb-2">
          <Link href="/playlists" className="hover:text-ink">
            ПЛЕЙЛИСТЫ
          </Link>
          <span className="mx-1">/</span>
          <span className="text-ink-muted">{playlist.name}</span>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] text-ink glow">{playlist.name}</h2>
          <div className="text-[10px] text-ink-muted">
            {tracksLabel(tracks.length)} · {totalMinutes} мин
          </div>
        </div>

        {playlist.description && <p className="mt-1 text-[11px] text-ink-muted">{playlist.description}</p>}

        <p className="mt-2 text-[10px] text-ink-faint">
          Нажми на строку, чтобы включить плейлист с этого трека. Кнопка «✕» убирает трек из плейлиста.
        </p>
      </section>

      <section className="term-panel p-2">
        <TrackList
          tracks={tracks}
          // Передаём playlistId — благодаря этому в строках появляются
          // кнопки удаления из плейлиста.
          playlistId={playlistId}
          emptyMessage="ПЛЕЙЛИСТ ПУСТ. Добавь треки из библиотеки кнопкой «＋»."
        />
      </section>
    </div>
  );
}
