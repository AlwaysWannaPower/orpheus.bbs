// ============================================================================
// src/app/api/tracks/route.ts — СПИСОК ТРЕКОВ С ФИЛЬТРАМИ (JSON API).
// ----------------------------------------------------------------------------
// URL: GET /api/tracks?search=атл&sort=title_asc&favoritesOnly=true&limit=50
//
// ── ЗАЧЕМ ЭТОТ ЭНДПОИНТ, ЕСЛИ ГЛАВНАЯ СТРАНИЦА ЧИТАЕТ БАЗУ НАПРЯМУЮ ──────
// Server Component может обратиться к SQLite напрямую, без HTTP — это быстрее
// и мы так и делаем для первой отрисовки. Но API всё равно нужен:
//   * для клиентских компонентов, которые догружают данные;
//   * для отладки: удобно ткнуть curl и увидеть JSON;
//   * чтобы к библиотекой могли пользоваться другие программы.
// ============================================================================

import { handleApiError, json, noStoreHeaders, parseNumberParam } from "@/lib/api-helpers";
import { listTracks } from "@/lib/db/track-queries";
import type { TrackSortKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Набор допустимых значений сортировки.
 *
 * ── ЗАЧЕМ ПРОВЕРЯТЬ ───────────────────────────────────────────────────────
 * Пользователь может вручную написать ?sort=что_угодно. Мы не должны
 * передавать это значение дальше «как есть»: тип TrackSortKey описывает
 * только пять строк, и TypeScript справедливо не даст подсунуть произвольную.
 *
 * Приём «проверить значение из внешнего мира и сузить тип» называется
 * TYPE GUARD (защитник типа). Здесь он записан через массив + includes.
 */
const ALLOWED_SORTS: readonly TrackSortKey[] = [
  "added_desc",
  "title_asc",
  "artist_asc",
  "album_asc",
  "duration_desc",
];

function isTrackSortKey(value: string | null): value is TrackSortKey {
  // `value is TrackSortKey` в возвращаемом типе — это обещание TypeScript'у:
  // «если функция вернула true, считай value именно этим типом».
  return value !== null && (ALLOWED_SORTS as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<Response> {
  try {
    // NextRequest расширяет обычный Request свойством nextUrl,
    // но мы работаем со стандартным API: new URL(request.url).
    const url = new URL(request.url);
    const params = url.searchParams;

    const rawSort = params.get("sort");

    const tracks = await listTracks({
      search: params.get("search") ?? undefined,
      artist: params.get("artist") ?? undefined,
      album: params.get("album") ?? undefined,
      // Приводим строку "true" к настоящему boolean.
      // Осторожно: Boolean("false") === true! Поэтому сравниваем со строкой.
      favoritesOnly: params.get("favoritesOnly") === "true",
      sort: isTrackSortKey(rawSort) ? rawSort : "added_desc",
      limit: parseNumberParam(params.get("limit"), 500, 1, 5000),
      offset: parseNumberParam(params.get("offset"), 0, 0),
    });

    return json({ tracks, count: tracks.length }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}
