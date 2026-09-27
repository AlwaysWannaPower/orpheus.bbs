// ============================================================================
// src/app/api/tracks/[id]/route.ts — ДЕЙСТВИЯ С ОДНИМ ТРЕКОМ.
// ----------------------------------------------------------------------------
// URL: PATCH /api/tracks/12   — изменить трек (пока поддерживаем «избранное»)
//
// ── ПОЧЕМУ PATCH, А НЕ PUT ────────────────────────────────────────────────
// PUT означает «замени объект целиком»: прислал только isFavorite — всё
// остальное (название, альбом) должно обнулиться. Нам это не подходит.
// PATCH означает «частичное изменение»: меняем только переданные поля,
// остальное не трогаем. Именно это нам и нужно.
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, readJsonBody } from "@/lib/api-helpers";
import { setTrackFavorite } from "@/lib/db/track-queries";

export const dynamic = "force-dynamic";

/** Форма тела запроса. Поле необязательное: без него мы просто переключаем. */
type PatchTrackBody = {
  isFavorite?: boolean;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // Параметры динамического маршрута в Next.js 15+ — это ПРОМИС.
    const { id } = await context.params;

    const trackId = Number(id);
    if (!Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Некорректный идентификатор трека", 400);
    }

    const body = await readJsonBody<PatchTrackBody>(request);

    // `body?.isFavorite` — если тело не пришло (null), обращение к свойству
    // не упадёт, а вернёт undefined. Дальше setTrackFavorite сам поймёт,
    // что значение не задано, и просто инвертирует текущее.
    const isFavorite = await setTrackFavorite(trackId, body?.isFavorite);

    return json({ id: trackId, isFavorite }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}
