"use client";

// ============================================================================
// src/components/history/TopTracks.tsx — ТОП ТРЕКОВ ПО ПРОСЛУШИВАНИЯМ.
// ----------------------------------------------------------------------------
// Маленькая аналитическая витрина. Данные приходят из SQL-запроса с
// GROUP BY + COUNT + ORDER BY (см. listTopTracks в history-queries.ts).
//
// ── СВЯЗЬ С ТВОИМ ОСНОВНЫМ КУРСОМ ─────────────────────────────────────────
// Это ровно та же логика, что и в dbt-модели витрины:
//     источник (play_history) → агрегация → витрина для показа
// Разница только в масштабе и в движке: у нас SQLite и сотни строк,
// в рабочем проекте — ClickHouse и миллиарды.
//
// Полоска под каждой строкой — это простейшая визуализация: доля от
// максимального значения. По сути мини-BI-чарт на CSS.
// ============================================================================

import { usePlayerActions } from "@/components/player/player-context";
import { formatDuration } from "@/lib/format";
import type { TrackDTO } from "@/lib/types";

type TopTrack = TrackDTO & { playCount: number };

export function TopTracks({ tracks }: { tracks: TopTrack[] }) {
  const actions = usePlayerActions();

  // Максимум нужен, чтобы посчитать относительную длину полоски.
  // reduce проходит по массиву и «сворачивает» его в одно значение.
  // Второй аргумент (1) — начальное значение: делить на ноль нельзя.
  const maxPlayCount = tracks.reduce((max, track) => Math.max(max, track.playCount), 1);

  return (
    <section className="term-panel p-3">
      <h2 className="term-title mb-2">{"// ТОП ПО ПРОСЛУШИВАНИЯМ"}</h2>

      <ol className="flex flex-col gap-1">
        {tracks.map((track, index) => {
          // Ширина полоски в процентах от самого популярного трека.
          const barWidth = (track.playCount / maxPlayCount) * 100;

          return (
            <li key={track.id}>
              <button
                type="button"
                onClick={() => actions.playQueue(tracks, index)}
                className="w-full text-left px-2 py-1 hover:bg-accent/10 border-l-2 border-transparent hover:border-line-strong"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-ink">
                    <span className="text-ink-faint tabular-nums mr-2">{String(index + 1).padStart(2, "0")}</span>
                    {track.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-accent-2 tabular-nums">
                    {track.playCount} × · {formatDuration(track.duration)}
                  </span>
                </div>

                <div className="truncate text-[10px] text-ink-muted">{track.artist}</div>

                {/* Визуальная полоска «сколько раз слушали». */}
                <div className="mt-1 h-[3px] bg-surface-2">
                  <div className="h-full bg-accent" style={{ width: `${barWidth}%` }} />
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
