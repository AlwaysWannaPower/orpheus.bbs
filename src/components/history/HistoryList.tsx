"use client";

// ============================================================================
// src/components/history/HistoryList.tsx — ЖУРНАЛ ПРОСЛУШИВАНИЙ.
// ----------------------------------------------------------------------------
// Плоский список событий «когда что играло» + кнопка очистки истории.
//
// ── ВАЖНОЕ ПРАВИЛО JSX, НА КОТОРОМ ЛЕГКО СПОТКНУТЬСЯ ─────────────────────
// Внутри ОТКРЫВАЮЩЕГО ТЕГА обычные комментарии (двойной слэш) писать нельзя —
// это синтаксическая ошибка. Комментарий в JSX оформляется фигурными
// скобками со звёздочками — ровно так, как блок выше.
//
// Вне разметки (в теле функции, между элементами, в атрибутах-выражениях)
// обычные комментарии работают как всегда.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";

import { usePlayerActions } from "@/components/player/player-context";
import { formatDateTime, formatDuration, formatRelativeTime } from "@/lib/format";
import type { HistoryEntryDTO } from "@/lib/types";

export function HistoryList({ entries }: { entries: HistoryEntryDTO[] }) {
  const actions = usePlayerActions();
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = () => {
    const confirmed = window.confirm("Очистить всю историю прослушиваний? Это действие нельзя отменить.");
    if (!confirmed) return;

    setIsClearing(true);
    void fetch("/api/history", { method: "DELETE" })
      .then(() => router.refresh())
      .catch(() => undefined)
      .finally(() => setIsClearing(false));
  };

  return (
    <section className="term-panel p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="term-title">{"// ЖУРНАЛ"}</h2>

        {entries.length > 0 && (
          <button
            type="button"
            className="term-btn term-btn-danger !text-[10px]"
            onClick={handleClear}
            disabled={isClearing}
          >
            ОЧИСТИТЬ ИСТОРИЮ
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] text-ink-muted py-4 text-center">
          ЖУРНАЛ ПУСТ. Включи любую песню — событие появится здесь.
        </p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry, index) => {
            // ------------------------------------------------------------------
            // ВЫБОР KEY — здесь он неочевидный, поэтому объясняем подробно.
            //
            // Почему не track.id? Один и тот же трек встречается в журнале
            // много раз, и ключи получились бы неуникальными. React выдаст
            // предупреждение и может перепутать строки при обновлении.
            //
            // Почему не индекс массива? Список обновляется после
            // router.refresh(). React решил бы, что элемент с индексом 0
            // остался тем же самым, хотя данные под ним уже другие.
            //
            // Комбинация «время + id» уникальна: два события с одинаковым
            // треком в одну миллисекунду практически невозможны.
            // ------------------------------------------------------------------
            const rowKey = `${entry.playedAt}-${entry.track.id}-${index}`;

            return (
              <li
                key={rowKey}
                className="flex items-center gap-3 px-2 py-1 text-[11px] hover:bg-accent/10 border-l-2 border-transparent hover:border-line-strong"
              >
                {/*
                  title — всплывающая подсказка с точным временем.
                  Относительное время («5 мин назад») удобно для беглого
                  взгляда, но иногда нужно точное — пусть будет доступно.
                */}
                <span className="shrink-0 w-28 text-ink-faint tabular-nums" title={formatDateTime(entry.playedAt)}>
                  {formatRelativeTime(entry.playedAt)}
                </span>

                <button
                  type="button"
                  className="min-w-0 flex-1 text-left truncate"
                  onClick={() => actions.playSingle(entry.track)}
                  title={`${entry.track.title} — ${entry.track.artist}`}
                >
                  <span className="text-ink">{entry.track.title}</span>
                  <span className="text-ink-muted"> — {entry.track.artist}</span>
                </button>

                <span className="shrink-0 text-[10px] text-ink-faint tabular-nums">
                  {formatDuration(entry.track.duration)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
