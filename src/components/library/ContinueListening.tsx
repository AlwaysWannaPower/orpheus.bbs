"use client";

// ============================================================================
// src/components/library/ContinueListening.tsx — «ПРОДОЛЖИТЬ СЛУШАТЬ».
// ----------------------------------------------------------------------------
// Плеер помнит, на какой секунде пользователь остановился (см. таблицу
// playback_state и функцию savePlaybackStateToServer в player-context).
// Здесь мы показываем это и даём вернуться к прослушиванию одним кликом.
// ============================================================================

import { usePlayerActions } from "@/components/player/player-context";
import { CoverArt } from "@/components/ui/CoverArt";
import { formatDuration } from "@/lib/format";
import type { TrackDTO } from "@/lib/types";

type ContinueListeningProps = {
  track: TrackDTO;
  /** Секунда, на которой остановились. */
  position: number;
};

export function ContinueListening({ track, position }: ContinueListeningProps) {
  const actions = usePlayerActions();

  // --------------------------------------------------------------------------
  // ЕСЛИ ПОЗИЦИЯ БЛИЗКА К КОНЦУ ИЛИ К НАЧАЛУ — сбрасываем её.
  //
  // Логика простая и человеческая:
  //   * осталось меньше 10 секунд до конца → считаем трек прослушанным,
  //     начинаем сначала;
  //   * остановились на первой секунде → тоже начинаем сначала,
  //     «продолжать» нечего.
  //
  // Если этого не делать, пользователь будет попадать в самый конец трека
  // и слышать тишину — крайне раздражающий баг.
  // --------------------------------------------------------------------------
  const remaining = track.duration - position;
  const shouldRestart = position < 3 || (track.duration > 0 && remaining < 10);
  const resumePosition = shouldRestart ? 0 : position;

  return (
    <section className="term-panel p-3 flex flex-wrap items-center gap-3">
      <h2 className="term-title whitespace-nowrap">{"// ПРОДОЛЖИТЬ СЛУШАТЬ"}</h2>

      <CoverArt trackId={track.id} hasCover={track.hasCover} size={40} alt={`Обложка: ${track.album}`} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-ink">{track.title}</div>
        <div className="truncate text-[10px] text-ink-muted">
          {track.artist}
          {resumePosition > 0 && (
            <span className="text-accent-2"> · остановились на {formatDuration(resumePosition)}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="term-btn"
        onClick={() => {
          // Третий аргумент playQueue — секунда, с которой начать.
          // Провайдер применит её в момент загрузки метаданных.
          actions.playQueue([track], 0, resumePosition);
        }}
      >
        ▶ {resumePosition > 0 ? `ПРОДОЛЖИТЬ С ${formatDuration(resumePosition)}` : "ИГРАТЬ"}
      </button>
    </section>
  );
}
