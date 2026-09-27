// ============================================================================
// src/lib/db/mappers.ts — ПРЕВРАЩЕНИЕ СТРОК БАЗЫ В DTO.
// ----------------------------------------------------------------------------
// База хранит Date, отдаёт все колонки и знает про абсолютные пути.
// Браузеру всё это не нужно и даже вредно (см. комментарии в types.ts).
// Поэтому между «миром базы» и «миром интерфейса» стоит маленькая функция-
// переводчик. Такие функции называют мапперами (от англ. map — отображать).
//
// Плюс подхода: если завтра мы решим не отдавать в браузер, скажем, genre,
// достаточно поправить ОДНУ функцию, а не искать по всему проекту места,
// где формируется ответ.
// ============================================================================

import type { TrackRow } from "@/lib/db/schema";
import type { HistoryEntryDTO, PlaylistDTO, TrackDTO } from "@/lib/types";

/**
 * Превращает строку таблицы tracks в объект для браузера.
 *
 * ── Разбор преобразований ──────────────────────────────────────────────────
 *   Date → number       : date.getTime() возвращает миллисекунды с 1970 года.
 *                         Число можно передать по сети, Date — нельзя.
 *   string | null → bool: колонка cover_file хранит имя файла обложки.
 *                         Нам достаточно знать «есть или нет».
 *   path, mtime, size   : часть полей просто не попадает в результат.
 *                         Это нормально — DTO вправе быть уже, чем строка базы.
 */
export function toTrackDTO(row: TrackRow): TrackDTO {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.albumArtist,
    genre: row.genre,
    year: row.year,
    trackNumber: row.trackNumber,
    duration: row.duration,
    size: row.size,
    isFavorite: row.isFavorite,
    // `!= null` — это сокращение, которое ловит И null, И undefined.
    // `!== null` поймал бы только null; про undefined легко забыть.
    hasCover: row.coverFile != null,
    addedAt: row.createdAt.getTime(),
  };
}

/** Массив строк → массив DTO. Пригодится почти в каждом запросе. */
export function toTrackDTOList(rows: TrackRow[]): TrackDTO[] {
  // `.map(функция)` создаёт НОВЫЙ массив, применяя функцию к каждому элементу.
  // Важно, что исходный массив не меняется — такой стиль называют
  // иммутабельным, и он очень приветствуется в React-коде.
  return rows.map(toTrackDTO);
}

/**
 * Собирает DTO плейлиста из результата SQL-запроса с агрегацией.
 *
 * Обрати внимание на тип аргумента: он описан «на месте», без отдельного
 * имени. Такие типы называются inline-типами или «структурной типизацией»:
 * TypeScript проверяет не имя типа, а НАБОР ПОЛЕЙ. Любой объект с такими
 * полями подойдёт.
 */
export function toPlaylistDTO(row: {
  id: number;
  name: string;
  description: string | null;
  trackCount: number | null;
  createdAt: Date;
}): PlaylistDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // COUNT(*) в SQL возвращает NULL, если строк не нашлось (например,
    // в плейлисте нет треков, а мы соединяем через LEFT JOIN).
    // `?? 0` превращает null/undefined в ноль.
    trackCount: row.trackCount ?? 0,
    createdAt: row.createdAt.getTime(),
  };
}

/** Собирает запись истории: время + сам трек. */
export function toHistoryEntryDTO(playedAt: Date, track: TrackRow): HistoryEntryDTO {
  return {
    playedAt: playedAt.getTime(),
    track: toTrackDTO(track),
  };
}
