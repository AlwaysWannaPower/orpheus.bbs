// ============================================================================
// src/app/api/playback-state/route.ts — «ПРОДОЛЖИТЬ СЛУШАТЬ».
// ----------------------------------------------------------------------------
//   GET /api/playback-state         — что играло в прошлый раз
//   PUT /api/playback-state         { "trackId": 17, "position": 73.4 }
//
// ── ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО ────────────────────────────────────────────────
// Пользователь закрыл вкладку на середине подкаста, открыл сайт через день —
// и плеер предлагает «продолжить с 12:34». Мелочь, а именно такие мелочи
// отличают «свой плеер, которым приятно пользоваться» от «ещё одной демки».
//
// ── ПОЧЕМУ НЕ localStorage ────────────────────────────────────────────────
// localStorage — очевидный вариант для браузерных настроек, и громкость мы
// там и держим (см. useAudioPlayer). Но позицию лучше хранить на сервере:
// тогда «продолжить слушать» работает и с другого браузера, и с телефона.
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, readJsonBody } from "@/lib/api-helpers";
import { getPlaybackState, savePlaybackState } from "@/lib/db/history-queries";
import { getTrackRowById } from "@/lib/db/track-queries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const state = await getPlaybackState();
    return json(state, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

type SaveStateBody = {
  trackId?: number;
  position?: number;
};

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<SaveStateBody>(request);
    const trackId = body?.trackId;
    const position = body?.position;

    if (typeof trackId !== "number" || !Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Не указан корректный trackId", 400);
    }
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
      return jsonError("Некорректная позиция воспроизведения", 400);
    }

    const track = await getTrackRowById(trackId);
    if (!track) return jsonError("Трек не найден", 404);

    await savePlaybackState(trackId, position);

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
