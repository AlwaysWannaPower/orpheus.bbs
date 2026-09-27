// ============================================================================
// src/app/api/playlists/[id]/tracks/route.ts — СОСТАВ ПЛЕЙЛИСТА.
// ----------------------------------------------------------------------------
//   POST   /api/playlists/3/tracks   { "trackId": 17 }        — добавить
//   DELETE /api/playlists/3/tracks?trackId=17                 — убрать
//   PUT    /api/playlists/3/tracks   { "trackIds": [5, 2, 9] } — задать порядок
//
// ── ЗАЧЕМ ТРИ РАЗНЫХ МЕТОДА НА ОДНОМ ПУТИ ─────────────────────────────────
// Путь один и тот же (состав плейлиста), но действия разные. В REST принято
// выбирать метод по смыслу операции:
//   POST   — создать новую связь (добавить трек)
//   DELETE — удалить связь (убрать трек)
//   PUT    — заменить состояние целиком (весь порядок разом)
// Это не формальность: методы семантически разные, и промежуточные прокси,
// браузеры и инструменты (curl, Postman) опираются на эти различия.
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, readJsonBody } from "@/lib/api-helpers";
import { getPlaylist, addTrackToPlaylist, listPlaylistTracks, removeTrackFromPlaylist, reorderPlaylistTracks } from "@/lib/db/playlist-queries";
import { getTrackRowById } from "@/lib/db/track-queries";

export const dynamic = "force-dynamic";

/** Проверка id плейлиста из URL (см. подробный разбор в соседнем route.ts). */
function parseId(rawId: string): number | Response {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Некорректный идентификатор плейлиста", 400);
  }
  return id;
}

type AddTrackBody = { trackId?: number };
type ReorderBody = { trackIds?: number[] };

/**
 * POST — добавить трек в плейлист.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    if (parsed instanceof Response) return parsed;

    const body = await readJsonBody<AddTrackBody>(request);
    const trackId = body?.trackId;

    if (typeof trackId !== "number" || !Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Не указан корректный trackId", 400);
    }

    // Проверяем, что и плейлист, и трек существуют. Без этой проверки мы бы
    // получили ошибку внешнего ключа от SQLite — неинформативную для клиента.
    const playlist = await getPlaylist(parsed);
    if (!playlist) return jsonError("Плейлист не найден", 404);

    const track = await getTrackRowById(trackId);
    if (!track) return jsonError("Трек не найден", 404);

    const added = await addTrackToPlaylist(parsed, trackId);
    if (!added) {
      // Трек уже лежал в этом плейлисте — составной первичный ключ не дал
      // вставить его второй раз, а ON CONFLICT DO NOTHING промолчал.
      return jsonError("Этот трек уже есть в плейлисте", 409);
    }

    // ВАЖНО: плейлист нужно перечитать ПОСЛЕ добавления трека.
    // Если вернуть объект `playlist`, полученный выше (до вставки), в нём
    // будет старое значение trackCount, и счётчик в интерфейсе «отстанет»
    // на один трек. Это классическая ошибка работы с устаревшими данными.
    const tracks = await listPlaylistTracks(parsed);
    const updatedPlaylist = await getPlaylist(parsed);
    return json({ playlist: updatedPlaylist, tracks }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE — убрать трек из плейлиста.
 * trackId берём из query-параметра: ?trackId=17
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    if (parsed instanceof Response) return parsed;

    const url = new URL(request.url);
    const trackId = Number(url.searchParams.get("trackId"));

    if (!Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Не указан корректный trackId", 400);
    }

    await removeTrackFromPlaylist(parsed, trackId);

    const playlist = await getPlaylist(parsed);
    const tracks = await listPlaylistTracks(parsed);
    return json({ playlist, tracks }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT — задать новый порядок треков.
 * Клиент присылает ПОЛНЫЙ список id в нужном порядке.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    if (parsed instanceof Response) return parsed;

    const body = await readJsonBody<ReorderBody>(request);
    const trackIds = body?.trackIds;

    if (!Array.isArray(trackIds) || trackIds.some((id) => typeof id !== "number" || !Number.isInteger(id))) {
      return jsonError("trackIds должен быть массивом целых чисел", 400);
    }

    await reorderPlaylistTracks(parsed, trackIds);

    const playlist = await getPlaylist(parsed);
    const tracks = await listPlaylistTracks(parsed);
    return json({ playlist, tracks }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}
