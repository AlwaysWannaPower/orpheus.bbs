// ============================================================================
// src/app/api/history/route.ts — ИСТОРИЯ ПРОСЛУШИВАНИЙ.
// ----------------------------------------------------------------------------
//   GET    /api/history?limit=50   — последние прослушивания
//   POST   /api/history            { "trackId": 17 }  — записать событие
//   DELETE /api/history            — очистить историю
//
// ── КОГДА КЛИЕНТ ВЫЗЫВАЕТ POST ────────────────────────────────────────────
// Плеер отправляет событие не в момент нажатия «play», а когда трек реально
// начал играть (событие playing у <audio>). Так в истории не окажется песен,
// которые пользователь пролистал, не слушая.
// ============================================================================

import { handleApiError, json, jsonError, noStoreHeaders, parseNumberParam, readJsonBody } from "@/lib/api-helpers";
import { clearHistory, listHistory, recordPlay } from "@/lib/db/history-queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    // Ограничиваем максимум 500 записями: незачем отдавать всю историю
    // целиком, если она копится годами.
    const limit = parseNumberParam(url.searchParams.get("limit"), 50, 1, 500);

    const history = await listHistory(limit);
    return json({ history }, { headers: noStoreHeaders });
  } catch (error) {
    return handleApiError(error);
  }
}

type RecordPlayBody = { trackId?: number };

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<RecordPlayBody>(request);
    const trackId = body?.trackId;

    if (typeof trackId !== "number" || !Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Не указан корректный trackId", 400);
    }

    await recordPlay(trackId);

    // 204 No Content: запись сделана, возвращать нечего.
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await clearHistory();
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
