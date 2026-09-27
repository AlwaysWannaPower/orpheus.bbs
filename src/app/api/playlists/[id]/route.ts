// ============================================================================
// src/app/api/playlists/[id]/route.ts — ДЕЙСТВИЯ С ОДНИМ ПЛЕЙЛИСТОМ.
// ----------------------------------------------------------------------------
//   GET    /api/playlists/3   — получить плейлист с треками
//   PATCH  /api/playlists/3   — переименовать   { "name": "Новое имя" }
//   DELETE /api/playlists/3   — удалить
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, readJsonBody } from "@/lib/api-helpers";
import {
  deletePlaylist,
  getPlaylist,
  listPlaylistTracks,
  updatePlaylist,
} from "@/lib/db/playlist-queries";

export const dynamic = "force-dynamic";

/**
 * Достаёт id из контекста маршрута и проверяет его.
 *
 * Мы повторяем эту проверку в нескольких файлах. Вынести её в общий модуль
 * можно, но здесь важнее наглядность: видно, что КАЖДЫЙ обработчик сам
 * проверяет входные данные, а не надеется на соседа.
 *
 * Возвращает либо число, либо готовый ответ с ошибкой. Это тип-объединение
 * (union): «или одно, или другое». TypeScript заставит проверить, что именно
 * мы получили, прежде чем использовать.
 */
function parseId(rawId: string): number | Response {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Некорректный идентификатор плейлиста", 400);
  }
  return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    // Проверка "является ли значение Response" — это type guard по class.
    // Если да, значит внутри уже лежит готовый ответ с ошибкой, отдаём его.
    if (parsed instanceof Response) return parsed;

    const playlist = await getPlaylist(parsed);
    if (!playlist) return jsonError("Плейлист не найден", 404);

    const tracks = await listPlaylistTracks(parsed);

    return json({ playlist, tracks }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

type UpdatePlaylistBody = {
  name?: string;
  description?: string | null;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    if (parsed instanceof Response) return parsed;

    const body = await readJsonBody<UpdatePlaylistBody>(request);
    if (!body) return jsonError("Тело запроса пустое или не является JSON", 400);

    if (body.name !== undefined && body.name.trim() === "") {
      return jsonError("Название плейлиста не может быть пустым", 400);
    }

    const playlist = await getPlaylist(parsed);
    if (!playlist) return jsonError("Плейлист не найден", 404);

    await updatePlaylist(parsed, body);

    return json({ playlist: await getPlaylist(parsed) }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const parsed = parseId((await context.params).id);
    if (parsed instanceof Response) return parsed;

    const playlist = await getPlaylist(parsed);
    if (!playlist) return jsonError("Плейлист не найден", 404);

    // Все строки из playlist_tracks удалятся каскадом (ON DELETE CASCADE).
    await deletePlaylist(parsed);

    // 204 No Content — «всё хорошо, но тела в ответе нет».
    // Это стандартный ответ на успешное удаление.
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
