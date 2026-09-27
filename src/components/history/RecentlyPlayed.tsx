"use client";

// ============================================================================
// src/components/history/RecentlyPlayed.tsx — ПЛИТКА «НЕДАВНО СЛУШАЛИ».
// ----------------------------------------------------------------------------
// Горизонтальная прокручиваемая полоса карточек. Клик по карточке
// запускает воспроизведение.
// ============================================================================

import { usePlayerActions } from "@/components/player/player-context";
import { CoverArt } from "@/components/ui/CoverArt";
import { formatDuration } from "@/lib/format";
import type { TrackDTO } from "@/lib/types";

export function RecentlyPlayed({ tracks }: { tracks: TrackDTO[] }) {
  const actions = usePlayerActions();

  return (
    <section className="term-panel p-3">
      <h2 className="term-title mb-2">{"// НЕДАВНО СЛУШАЛИ"}</h2>

      {/* overflow-x-auto — горизонтальная прокрутка, если карточки
          не помещаются. На телефоне это свайп, на компьютере — колесо
          с зажатым Shift или полоса прокрутки. */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tracks.map((track, index) => (
          <button
            key={track.id}
            type="button"
            onClick={() => actions.playQueue(tracks, index)}
            className="shrink-0 w-32 text-left term-panel p-2 hover:border-accent transition-colors"
            title={`${track.title} — ${track.artist}`}
          >
            <CoverArt trackId={track.id} hasCover={track.hasCover} size={112} alt={`Обложка: ${track.album}`} />
            <div className="mt-2 truncate text-[11px] text-ink">{track.title}</div>
            <div className="truncate text-[10px] text-ink-muted">{track.artist}</div>
            <div className="text-[9px] text-ink-faint tabular-nums">{formatDuration(track.duration)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
