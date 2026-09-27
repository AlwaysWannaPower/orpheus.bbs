// ============================================================================
// src/lib/db/playlist-queries.ts — ЗАПРОСЫ К ПЛЕЙЛИСТАМ.
// ----------------------------------------------------------------------------
// Здесь живёт вся работа с таблицами playlists и playlist_tracks.
// Это самый «реляционный» файл проекта: тут есть JOIN, LEFT JOIN, GROUP BY,
// транзакции и UPSERT — то есть основная кухня SQL.
// ============================================================================

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { toPlaylistDTO, toTrackDTOList } from "@/lib/db/mappers";
import { playlists, playlistTracks, tracks } from "@/lib/db/schema";
import type { PlaylistDTO, TrackDTO } from "@/lib/types";

/**
 * Создаёт плейлист и возвращает его id.
 */
export async function createPlaylist(name: string, description?: string | null): Promise<PlaylistDTO> {
  // -- SQL: INSERT INTO playlists (name, description, created_at) VALUES (?, ?, ?)
  const inserted = await db
    .insert(playlists)
    .values({ name: name.trim(), description: description?.trim() || null })
    .returning();

  // returning() — возможность SQLite (и PostgreSQL) вернуть вставленную
  // строку сразу, без отдельного SELECT. Очень удобно.
  return toPlaylistDTO({ ...inserted[0], trackCount: 0 });
}

/**
 * Список всех плейлистов с количеством треков в каждом.
 *
 *   SELECT
 *     p.id, p.name, p.description, p.created_at,
 *     COUNT(pt.track_id) AS track_count
 *   FROM playlists p
 *   LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
 *   GROUP BY p.id
 *   ORDER BY p.created_at DESC
 *
 * ── ГЛАВНОЕ ЗДЕСЬ — LEFT JOIN ─────────────────────────────────────────────
 * Обычный JOIN (INNER JOIN) оставляет только те строки, для которых нашлась
 * пара в другой таблице. Пустой плейлист пар не имеет и просто ИСЧЕЗНЕТ
 * из результата — а нам он нужен!
 *
 * LEFT JOIN говорит: «возьми ВСЕ строки из левой таблицы (playlists), и если
 * пары справа нет — подставь NULL». Тогда пустой плейлист попадёт в результат,
 * а COUNT вернёт 0 (после нашей замены null → 0 в маппере).
 */
export async function listPlaylists(): Promise<PlaylistDTO[]> {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      description: playlists.description,
      createdAt: playlists.createdAt,
      // Считаем именно pt.track_id, а не * — иначе COUNT посчитал бы строку
      // плейлиста даже когда треков нет, и пустой плейлист показывал бы 1.
      trackCount: sql<number>`COUNT(${playlistTracks.trackId})`,
    })
    .from(playlists)
    .leftJoin(playlistTracks, eq(playlistTracks.playlistId, playlists.id))
    .groupBy(playlists.id)
    .orderBy(asc(playlists.createdAt));

  return rows.map(toPlaylistDTO);
}

/** Один плейлист по id (или null, если такого нет). */
export async function getPlaylist(id: number): Promise<PlaylistDTO | null> {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      description: playlists.description,
      createdAt: playlists.createdAt,
      trackCount: sql<number>`COUNT(${playlistTracks.trackId})`,
    })
    .from(playlists)
    .leftJoin(playlistTracks, eq(playlistTracks.playlistId, playlists.id))
    .where(eq(playlists.id, id))
    .groupBy(playlists.id)
    .limit(1);

  return rows[0] ? toPlaylistDTO(rows[0]) : null;
}

/** Переименование плейлиста (и/или смена описания). */
export async function updatePlaylist(
  id: number,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  // Собираем объект только из тех полей, которые реально пришли.
  // Это называется partial update: не затираем то, что не передали.
  const values: { name?: string; description?: string | null } = {};
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.description !== undefined) values.description = patch.description?.trim() || null;

  // Если менять нечего — выходим, чтобы не делать пустой UPDATE.
  if (Object.keys(values).length === 0) return;

  // -- SQL: UPDATE playlists SET name = ?, description = ? WHERE id = ?
  await db.update(playlists).set(values).where(eq(playlists.id, id));
}

/**
 * Удаляет плейлист.
 *
 * Строки из playlist_tracks удалятся САМИ благодаря ON DELETE CASCADE
 * во внешнем ключе. Это и есть смысл каскадов: не надо помнить о «мусоре»
 * в связующих таблицах.
 */
export async function deletePlaylist(id: number): Promise<void> {
  await db.delete(playlists).where(eq(playlists.id, id));
}

/**
 * Треки одного плейлиста в правильном порядке.
 *
 *   SELECT t.*
 *   FROM playlist_tracks pt
 *   JOIN tracks t ON t.id = pt.track_id
 *   WHERE pt.playlist_id = ?
 *   ORDER BY pt.position ASC
 *
 * Обрати внимание на порядок таблиц в JOIN: мы «идём» от связующей таблицы
 * к трекам. Здесь обычный (INNER) JOIN абсолютно уместен: если трек удалён
 * из библиотеки, каскад уже убрал и строку в playlist_tracks, «сирот» нет.
 */
export async function listPlaylistTracks(playlistId: number): Promise<TrackDTO[]> {
  const rows = await db
    .select({ track: tracks })
    .from(playlistTracks)
    .innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position));

  // Результат имеет форму [{ track: TrackRow }, ...] — «разворачиваем» её.
  return toTrackDTOList(rows.map((row) => row.track));
}

/**
 * Добавляет трек в конец плейлиста.
 *
 * Возвращает false, если добавить не удалось (например, трек уже в плейлисте).
 */
export async function addTrackToPlaylist(playlistId: number, trackId: number): Promise<boolean> {
  // --------------------------------------------------------------------------
  // ШАГ 1. Узнаём, какая сейчас максимальная позиция.
  //
  //   SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?
  //
  // COALESCE(..., -1) нужен для пустого плейлиста: MAX вернёт NULL, а -1 + 1 = 0,
  // то есть первый трек встанет на позицию 0.
  // --------------------------------------------------------------------------
  const maxRows = await db
    .select({ maxPosition: sql<number | null>`MAX(${playlistTracks.position})` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));

  const nextPosition = (maxRows[0]?.maxPosition ?? -1) + 1;

  // --------------------------------------------------------------------------
  // ШАГ 2. Вставляем с игнорированием конфликта.
  //
  //   INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
  //   VALUES (?, ?, ?, ?)
  //   ON CONFLICT (playlist_id, track_id) DO NOTHING
  //
  // Составной первичный ключ (playlist_id, track_id) не даст вставить трек
  // дважды. Вместо ошибки мы просим SQLite просто ничего не делать.
  // --------------------------------------------------------------------------
  const inserted = await db
    .insert(playlistTracks)
    .values({ playlistId, trackId, position: nextPosition })
    .onConflictDoNothing()
    .returning({ trackId: playlistTracks.trackId });

  // Если returning() ничего не вернул — значит конфликт был, трек уже лежал тут.
  return inserted.length > 0;
}

/** Убирает трек из плейлиста. */
export async function removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
  // -- SQL: DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
  // and() объединяет два условия логическим И.
  await db
    .delete(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)));
}

/**
 * Меняет порядок треков в плейлисте.
 *
 * На вход приходит ПОЛНЫЙ список id в новом порядке (так проще и надёжнее,
 * чем пересчитывать «перетащили с 3 на 7»).
 *
 * ── ЗАЧЕМ ЗДЕСЬ ТРАНЗАКЦИЯ ───────────────────────────────────────────────
 * Нам нужно выполнить несколько UPDATE подряд. Если между ними что-то пойдёт
 * не так (ошибка, отключение питания), плейлист останется в полу-изменённом
 * состоянии: часть треков с новыми номерами, часть со старыми — и порядок
 * превратится в кашу.
 *
 * ТРАНЗАКЦИЯ — это «всё или ничего». Все изменения внутри неё применяются
 * одной неделимой операцией: либо целиком, либо никак. Это фундаментальное
 * понятие баз данных — свойство ACID, буква «A» (Atomicity).
 *
 * В SQL это выглядит так:
 *     BEGIN;
 *     UPDATE ...; UPDATE ...; UPDATE ...;
 *     COMMIT;   -- или ROLLBACK при ошибке
 * Drizzle делает это за нас через db.transaction().
 */
export async function reorderPlaylistTracks(playlistId: number, orderedTrackIds: number[]): Promise<void> {
  // ВАЖНО: драйвер bun:sqlite синхронный, поэтому и колбэк транзакции
  // синхронный — внутри используем .run(), а не await.
  db.transaction((tx) => {
    orderedTrackIds.forEach((trackId, index) => {
      tx.update(playlistTracks)
        // Позицией становится ИНДЕКС в массиве: 0, 1, 2, ...
        .set({ position: index })
        .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
        .run();
    });
  });
}
