// ============================================================================
// src/app/api/playlists/route.ts — СПИСОК И СОЗДАНИЕ ПЛЕЙЛИСТОВ.
// ----------------------------------------------------------------------------
//   GET  /api/playlists      — получить все плейлисты
//   POST /api/playlists      — создать новый  { "name": "Для кода" }
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, readJsonBody } from "@/lib/api-helpers";
import { createPlaylist, listPlaylists } from "@/lib/db/playlist-queries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const playlists = await listPlaylists();
    return json({ playlists }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Ожидаемая форма тела запроса. */
type CreatePlaylistBody = {
  name?: string;
  description?: string | null;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<CreatePlaylistBody>(request);

    // ------------------------------------------------------------------------
    // ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ.
    //
    // Правило: никогда не доверяй тому, что пришло снаружи. Даже если у нас
    // есть свой интерфейс — запрос можно отправить curl'ом, и туда прилетит
    // что угодно: пустая строка, 10 мегабайт текста, null, число.
    //
    // Здесь проверяем, что имя есть, это строка и после обрезки пробелов
    // в ней остались символы.
    // ------------------------------------------------------------------------
    const name = body?.name?.trim();
    if (!name) {
      return jsonError("Название плейлиста не указано", 400);
    }
    if (name.length > 100) {
      return jsonError("Название слишком длинное (максимум 100 символов)", 400);
    }

    const playlist = await createPlaylist(name, body?.description ?? null);
    // 201 Created — правильный код ответа при успешном создании ресурса.
    return json({ playlist }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}
