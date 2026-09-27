// ============================================================================
// src/lib/db/history-queries.ts — ИСТОРИЯ ПРОСЛУШИВАНИЙ И СОСТОЯНИЕ ПЛЕЕРА.
// ----------------------------------------------------------------------------
// Две «мелкие» таблицы, которые делают приложение по-настоящему удобным:
//   play_history   — что и когда играло (журнал событий);
//   playback_state — на каком месте пользователь остановился.
//
// ── ЗАЧЕМ ЭТОТ ФАЙЛ МОЖЕТ ПРИГОДИТЬСЯ ТЕБЕ ОСОБО ──────────────────────────
// play_history — это таблица ФАКТОВ в миниатюре, ровно как в аналитике.
// Запрос listTopTracks() ниже — это уже почти dbt-модель:
//     «из журнала событий получить витрину "топ треков по числу включений"».
// В ClickHouse такой же запрос выглядел бы точно так же, только с
// движком MergeTree и партиционированием по месяцу.
// ============================================================================

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { toTrackDTO, toTrackDTOList } from "@/lib/db/mappers";
import { playHistory, playbackState, tracks } from "@/lib/db/schema";
import type { HistoryEntryDTO, PlaybackStateDTO, TrackDTO } from "@/lib/types";

// ============================================================================
// ИСТОРИЯ ПРОСЛУШИВАНИЙ
// ============================================================================

/**
 * Записывает факт прослушивания.
 *
 *   INSERT INTO play_history (track_id, played_at) VALUES (?, ?)
 *
 * Обрати внимание: в истории НЕТ обновлений и удалений. Журнал событий
 * только дописывается в конец (append-only). Это его главное свойство —
 * и именно поэтому такие таблицы так удобны для аналитики.
 */
export async function recordPlay(trackId: number): Promise<void> {
  await db.insert(playHistory).values({ trackId, playedAt: new Date() });
}

/**
 * Последние прослушивания, от свежих к старым.
 *
 *   SELECT ph.played_at, t.*
 *   FROM play_history ph
 *   JOIN tracks t ON t.id = ph.track_id
 *   ORDER BY ph.played_at DESC
 *   LIMIT ?
 *
 * Оператор JOIN здесь обязателен: в журнале лежит только track_id, а нам
 * нужны название и исполнитель. JOIN «приклеивает» строку трека к каждому
 * событию. Это и есть смысл реляционных баз — данные не дублируются,
 * а соединяются в момент запроса.
 */
export async function listHistory(limit = 50): Promise<HistoryEntryDTO[]> {
  const rows = await db
    .select({ playedAt: playHistory.playedAt, track: tracks })
    .from(playHistory)
    .innerJoin(tracks, eq(tracks.id, playHistory.trackId))
    .orderBy(desc(playHistory.playedAt))
    .limit(limit);

  return rows.map((row) => ({
    playedAt: row.playedAt.getTime(),
    track: toTrackDTO(row.track),
  }));
}

/**
 * «Недавно слушали» — те же данные, но БЕЗ ПОВТОРОВ: один трек показываем
 * один раз, в момент последнего включения.
 *
 *   SELECT t.*, MAX(ph.played_at) AS last_played
 *   FROM play_history ph
 *   JOIN tracks t ON t.id = ph.track_id
 *   GROUP BY t.id
 *   ORDER BY last_played DESC
 *   LIMIT ?
 *
 * GROUP BY t.id сворачивает все прослушивания одного трека в одну строку,
 * а MAX(played_at) оставляет время самого позднего из них. Дальше сортируем
 * по этому времени — и получаем честный список «недавних».
 */
export async function listRecentlyPlayedTracks(limit = 20): Promise<TrackDTO[]> {
  const rows = await db
    .select({ track: tracks, lastPlayed: sql<number>`MAX(${playHistory.playedAt})` })
    .from(playHistory)
    .innerJoin(tracks, eq(tracks.id, playHistory.trackId))
    .groupBy(tracks.id)
    .orderBy(desc(sql`MAX(${playHistory.playedAt})`))
    .limit(limit);

  return toTrackDTOList(rows.map((row) => row.track));
}

/**
 * Топ треков по количеству прослушиваний — маленькая аналитическая витрина.
 *
 *   SELECT t.*, COUNT(*) AS play_count
 *   FROM play_history ph
 *   JOIN tracks t ON t.id = ph.track_id
 *   GROUP BY t.id
 *   ORDER BY play_count DESC
 *   LIMIT ?
 *
 * ── СВЯЗЬ С ТВОИМ КУРСОМ ──────────────────────────────────────────────────
 * Готовый аналог на dbt выглядел бы так:
 *
 *   -- models/marts/fct_listens.sql
 *   SELECT track_id, COUNT(*) AS play_count, MAX(played_at) AS last_played_at
 *   FROM {{ ref('stg_play_history') }}
 *   GROUP BY track_id
 *
 * А в ClickHouse — почти то же самое, только с движком AggregatingMergeTree
 * и материализованным представлением, чтобы не считать заново каждый раз.
 */
export async function listTopTracks(limit = 10): Promise<Array<TrackDTO & { playCount: number }>> {
  const rows = await db
    .select({ track: tracks, playCount: sql<number>`COUNT(*)` })
    .from(playHistory)
    .innerJoin(tracks, eq(tracks.id, playHistory.trackId))
    .groupBy(tracks.id)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit);

  return rows.map((row) => ({ ...toTrackDTO(row.track), playCount: Number(row.playCount) }));
}

/** Очищает всю историю (кнопка «забыть историю»). */
export async function clearHistory(): Promise<void> {
  await db.delete(playHistory);
}

// ============================================================================
// СОСТОЯНИЕ ПЛЕЕРА («продолжить слушать»)
// ============================================================================
// Таблица playback_state всегда содержит максимум ОДНУ строку с id = 1.
// Такой приём называется singleton-таблица.
// ============================================================================

/**
 * Читает сохранённое состояние: какой трек играл и на какой секунде.
 *
 *   SELECT ps.position, t.*
 *   FROM playback_state ps
 *   JOIN tracks t ON t.id = ps.track_id
 *   WHERE ps.id = 1
 *
 * JOIN (а не LEFT JOIN) здесь сознательно: если трек удалили из библиотеки,
 * ON DELETE SET NULL обнулит ссылку, JOIN не найдёт пару, и мы честно
 * получим пустое состояние вместо «продолжить слушать ничего».
 */
export async function getPlaybackState(): Promise<PlaybackStateDTO> {
  const rows = await db
    .select({ position: playbackState.position, track: tracks })
    .from(playbackState)
    .innerJoin(tracks, eq(tracks.id, playbackState.trackId))
    .where(eq(playbackState.id, 1))
    .limit(1);

  const row = rows[0];
  if (!row) return { track: null, position: 0 };

  return { track: toTrackDTO(row.track), position: row.position };
}

/**
 * Сохраняет позицию.
 *
 *   INSERT INTO playback_state (id, track_id, position, updated_at)
 *   VALUES (1, ?, ?, ?)
 *   ON CONFLICT(id) DO UPDATE SET track_id = excluded.track_id,
 *                                 position = excluded.position,
 *                                 updated_at = excluded.updated_at
 *
 * Тот же приём UPSERT, что и при сканировании: не важно, есть строка или нет —
 * в конце она будет ровно одна и с нужными значениями.
 */
export async function savePlaybackState(trackId: number, position: number): Promise<void> {
  await db
    .insert(playbackState)
    .values({ id: 1, trackId, position, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: playbackState.id,
      set: { trackId, position, updatedAt: new Date() },
    });
}
