// ============================================================================
// src/app/api/tracks/[id]/cover/route.ts — ОТДАЧА ОБЛОЖКИ АЛЬБОМА.
// ----------------------------------------------------------------------------
// URL: GET /api/tracks/12/cover
//
// Сканер сохранил картинку в data/covers/<sha1>.<ext>, а в базе оставил
// только ИМЯ файла. Здесь мы это имя читаем и отдаём файл браузеру.
//
// ── ГЛАВНЫЙ УРОК ЭТОГО ФАЙЛА: PATH TRAVERSAL ──────────────────────────────
// Если бы мы взяли имя файла прямо из URL и сделали
//     fs.createReadStream(path.join(COVERS_DIR, userInput))
// то злоумышленник мог бы запросить
//     /api/covers/../../../../etc/passwd
// и прочитать файл с паролями системы. Эта уязвимость называется
// PATH TRAVERSAL (выход за пределы каталога).
//
// Защита: имя файла приходит из НАШЕЙ базы, а не из URL, и мы дополнительно
// проверяем, что итоговый путь действительно лежит внутри COVERS_DIR.
// ============================================================================

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { handleApiError, jsonError } from "@/lib/api-helpers";
import { COVERS_DIR } from "@/lib/config";
import { getTrackRowById } from "@/lib/db/track-queries";

export const dynamic = "force-dynamic";

/** Расширение → MIME-тип для картинок. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;

    const trackId = Number(id);
    if (!Number.isInteger(trackId) || trackId <= 0) {
      return jsonError("Некорректный идентификатор трека", 400);
    }

    const track = await getTrackRowById(trackId);
    if (!track) {
      return jsonError("Трек не найден", 404);
    }
    if (!track.coverFile) {
      // 404 — честный ответ: «обложки у этого трека нет».
      // Клиент нарисует ASCII-заглушку вместо картинки.
      return jsonError("У трека нет обложки", 404);
    }

    // ------------------------------------------------------------------------
    // ЗАЩИТА ОТ PATH TRAVERSAL.
    //
    // path.resolve склеивает пути и приводит результат к абсолютному виду,
    // «съедая» при этом "..". После этого проверяем, что итог начинается
    // с нашей папки обложек.
    // ------------------------------------------------------------------------
    const coversRoot = path.resolve(COVERS_DIR);
    const candidate = path.resolve(coversRoot, track.coverFile);

    // path.sep гарантирует, что /data/covers2 не пройдёт проверку на префикс
    // /data/covers (без разделителя строка "covers2" начинается с "covers").
    if (!candidate.startsWith(coversRoot + path.sep)) {
      return jsonError("Недопустимый путь к обложке", 400);
    }

    let size: number;
    try {
      const stats = await stat(candidate);
      size = stats.size;
    } catch {
      return jsonError("Файл обложки не найден на диске", 404);
    }

    const extension = path.extname(candidate).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[extension] ?? "application/octet-stream";

    // ------------------------------------------------------------------------
    // ГЛАВНАЯ ФИШКА КЭШИРОВАНИЯ: immutable.
    //
    // Имя файла обложки — это SHA-1 от её содержимого. Значит, если содержимое
    // изменится, изменится и имя. Файл с тем же именем НИКОГДА не поменяется.
    // Это позволяет сказать браузеру: «кэшируй навсегда, перепроверять
    // не нужно». Такой приём называется content-addressed storage, и он
    // экономит гигабайты трафика в больших системах.
    // ------------------------------------------------------------------------
    return new Response(Readable.toWeb(createReadStream(candidate)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
