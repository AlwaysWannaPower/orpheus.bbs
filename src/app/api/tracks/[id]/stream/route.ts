// ============================================================================
// src/app/api/tracks/[id]/stream/route.ts
// ----------------------------------------------------------------------------
// ЭТАП 3 ТЕХНИЧЕСКОГО ЗАДАНИЯ: НАСТОЯЩИЙ HTTP-СТРИМИНГ С ПОДДЕРЖКОЙ RANGE.
//
// ── ЧТО ЗДЕСЬ ПРОИСХОДИТ И ПОЧЕМУ ЭТО ВАЖНО ───────────────────────────────
// Можно было бы просто отдать файл целиком:
//     return new Response(Bun.file(path));
// Это работает... до первого большого flac-файла на 60 МБ и до первой попытки
// перемотать трек в середину.
//
// Правильный способ — протокол HTTP Range Requests (RFC 7233):
//
//   1. Браузер запрашивает файл.
//   2. Сервер отвечает: «Файл весит 5 000 000 байт, я умею отдавать кусками»
//      (заголовок Accept-Ranges: bytes).
//   3. Браузер просит: «дай байты 0–200 000» (заголовок Range).
//   4. Сервер отдаёт ровно эти байты со статусом 206 Partial Content.
//   5. Пользователь тянет ползунок в середину — браузер просит другой кусок.
//
// Благодаря этому:
//   * воспроизведение начинается мгновенно, не дожидаясь полной загрузки;
//   * перемотка не требует качать весь файл заново;
//   * большие файлы не съедают память сервера.
//
// ── КОДЫ ОТВЕТА, КОТОРЫЕ МЫ ИСПОЛЬЗУЕМ ─────────────────────────────────────
//   200 OK                — отдаём файл целиком (Range не запрошен)
//   206 Partial Content   — отдаём кусок (Range запрошен и корректен)
//   416 Range Not Satisfiable — запрошен кусок за пределами файла
//   404 Not Found         — трека нет в базе или файл пропал с диска
//   401 Unauthorized      — не указан токен доступа
//
// ── ПРО ЗАЩИТУ ДОСТУПА ─────────────────────────────────────────────────────
// Смотри функцию checkAccessToken ниже. Плеер локальный, но если ты откроешь
// его в домашней сети, любой сосед по Wi-Fi сможет качать твою музыку.
// Простой токен в URL решает проблему без сложной авторизации.
// ============================================================================

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { handleApiError, jsonError } from "@/lib/api-helpers";
import { resolveMusicPath } from "@/lib/config";
import { getTrackRowById } from "@/lib/db/track-queries";

/**
 * ПЕРВОЕ ВАЖНОЕ ОБЪЯВЛЕНИЕ: динамический рендеринг.
 *
 * В Next.js 16 GET-обработчики по умолчанию не кэшируются, но мы фиксируем
 * это явно — чтобы никто (включая будущего себя) не попытался случайно
 * включить кэш и не получил баг «браузер отдаёт старый файл».
 */
export const dynamic = "force-dynamic";

/**
 * Отдаём ответ сразу, не дожидаясь ничего.
 */
export const runtime = "nodejs";

/**
 * Таблица MIME-типов: расширение файла → Content-Type.
 *
 * ── ЗАЧЕМ ЭТО НУЖНО ───────────────────────────────────────────────────────
 * Заголовок Content-Type говорит браузеру, ЧТО за данные он получил.
 * Если соврать (например, всегда писать application/octet-stream),
 * тег <audio> откажется играть файл.
 *
 * Record<string, string> — это тип «объект, где ключи и значения — строки».
 * Record — встроенный в TypeScript generic-тип, удобная замена interface
 * для словарей.
 */
const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
};

/**
 * Определяет MIME-тип по расширению.
 * Если расширение неизвестно — отдаём общий бинарный тип: браузер попробует
 * разобраться сам, и хотя бы не сломается.
 */
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Разбирает заголовок Range.
 *
 * ── ФОРМАТ ЗАГОЛОВКА ──────────────────────────────────────────────────────
 *     Range: bytes=0-1023        первые 1024 байта
 *     Range: bytes=1024-          всё, начиная с 1024-го байта
 *     Range: bytes=-1024         ПОСЛЕДНИЕ 1024 байта (суффиксный запрос)
 *
 * Возвращаем нормализованные start/end, где end — ВКЛЮЧИТЕЛЬНО (как в HTTP).
 * Если заголовка нет — возвращаем null (значит, отдаём файл целиком).
 * Если заголовок некорректен — возвращаем "invalid" (ответ 416).
 */
function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number,
): { start: number; end: number } | "invalid" | null {
  // Заголовка нет — Range не запрошен.
  if (!rangeHeader) return null;

  // Заголовок обязан начинаться с "bytes=". Другие единицы измерения
  // в спецификации есть, но на практике для файлов используют только байты.
  if (!rangeHeader.startsWith("bytes=")) return "invalid";

  // Убираем префикс "bytes=" и читаем то, что после него.
  const spec = rangeHeader.slice("bytes=".length).trim();

  // Множественные диапазоны ("bytes=0-100,200-300") в спецификации есть,
  // но мы их не поддерживаем: <audio> в браузерах их не использует,
  // а реализация multipart/byteranges сильно усложнила бы код.
  if (spec.includes(",")) return "invalid";

  // Разделяем по дефису: "0-1023" → ["0", "1023"].
  const dashIndex = spec.indexOf("-");
  if (dashIndex === -1) return "invalid";

  const rawStart = spec.slice(0, dashIndex).trim();
  const rawEnd = spec.slice(dashIndex + 1).trim();

  // --- Суффиксный запрос: "bytes=-500" -------------------------------------
  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid";

    // Последние N байт. Если файл меньше N, отдаём его целиком.
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  // --- Обычный запрос с началом --------------------------------------------
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0) return "invalid";

  // Начало за пределами файла — отдать нечего.
  if (start >= fileSize) return "invalid";

  // --- Конец: либо указан явно, либо «до конца файла» ----------------------
  if (rawEnd === "") {
    return { start, end: fileSize - 1 };
  }

  const parsedEnd = Number(rawEnd);
  if (!Number.isInteger(parsedEnd) || parsedEnd < start) return "invalid";

  // Если клиент запросил больше, чем есть, обрезаем до конца файла.
  // Это не ошибка: спецификация предписывает так поступать.
  return { start, end: Math.min(parsedEnd, fileSize - 1) };
}

/**
 * Проверка простого токена доступа.
 *
 * ── КАК ЭТО РАБОТАЕТ ──────────────────────────────────────────────────────
 * Если переменная окружения STREAM_TOKEN не задана, проверка выключена
 * (удобно для локальной разработки). Если задана — её значение обязательно
 * должно прийти либо в query-параметре ?token=..., либо в заголовке
 * X-Stream-Token.
 *
 * ── ПОЧЕМУ ЭТО НЕ «НАСТОЯЩАЯ» АВТОРИЗАЦИЯ ───────────────────────────────
 * Настоящая авторизация — это логин, пароль, сессии, роли. ТЗ прямо просит
 * НЕ усложнять. Токен в URL решает конкретную задачу: закрыть музыку от
 * случайных людей в той же сети. Этого достаточно для домашнего плеера и
 * не требует ни базы пользователей, ни библиотек.
 *
 * Важно понимать: токен в URL попадает в историю браузера и в логи. Поэтому
 * для чего-то серьёзного так делать нельзя.
 */
function checkAccessToken(request: Request): boolean {
  const expected = process.env.STREAM_TOKEN?.trim();

  // Токен не настроен — пускаем всех.
  if (!expected) return true;

  // new URL(request.url) разбирает URL на части, и .searchParams даёт
  // удобный доступ к параметрам ?ключ=значение.
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token");
  const fromHeader = request.headers.get("x-stream-token");

  return fromQuery === expected || fromHeader === expected;
}

/**
 * ОБЩАЯ ОБРАБОТКА ЗАПРОСА для методов GET и HEAD.
 *
 * ── ЗАЧЕМ ДЕЛАТЬ HEAD ─────────────────────────────────────────────────────
 * Некоторые плееры перед загрузкой посылают HEAD-запрос: «расскажи про файл,
 * но тело не присылай». Мы отвечаем теми же заголовками, но без тела.
 * Это дешевле, чем качать мегабайты, чтобы просто узнать длину.
 */
async function handleAudioRequest(request: Request, rawId: string): Promise<Response> {
  // --- 1. Проверяем доступ --------------------------------------------------
  if (!checkAccessToken(request)) {
    return jsonError("Доступ запрещён: неверный токен", 401);
  }

  // --- 2. Валидируем id -----------------------------------------------------
  // Всё из URL — строки. Number("abc") даст NaN, и запрос к базе с NaN
  // вернёт пустоту. Проверяем явно и отвечаем внятной ошибкой.
  const trackId = Number(rawId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return jsonError("Некорректный идентификатор трека", 400);
  }

  // --- 3. Ищем трек в базе --------------------------------------------------
  const track = await getTrackRowById(trackId);
  if (!track) {
    return jsonError(`Трек ${trackId} не найден в библиотеке`, 404);
  }

  // --- 4. Собираем АБСОЛЮТНЫЙ путь и проверяем, что файл на месте -----------
  //
  // ── ВАЖНО: В БАЗЕ ЛЕЖИТ ОТНОСИТЕЛЬНЫЙ ПУТЬ ────────────────────────────────
  // Например «ATL - Ящик.mp3», без папки. Абсолютный путь собирается здесь,
  // добавлением MUSIC_DIR. Так одна и та же база работает и локально,
  // и в Docker, и на другом компьютере — потому что папку можно смонтировать
  // куда угодно, а путь ВНУТРИ библиотеки от этого не меняется.
  // Подробный разбор — в src/lib/config.ts.
  //
  // База — это индекс, а файл могли удалить или переименовать после скана.
  const absolutePath = resolveMusicPath(track.path);

  let fileSize: number;
  let lastModified: Date;
  try {
    const stats = await stat(absolutePath);
    fileSize = stats.size;
    lastModified = stats.mtime;
  } catch {
    return jsonError(
      `Файл не найден по пути ${absolutePath}. Возможно, он перемещён, удалён или библиотека не примонтирована — запусти сканирование заново.`,
      404,
    );
  }

  if (fileSize === 0) {
    return jsonError("Файл пустой", 404);
  }

  // --- 5. Разбираем Range ---------------------------------------------------
  const rangeHeader = request.headers.get("range");
  const parsedRange = parseRangeHeader(rangeHeader, fileSize);

  // --- 6. Некорректный Range → 416 ------------------------------------------
  if (parsedRange === "invalid") {
    // По спецификации в ответе 416 обязателен заголовок Content-Range
    // с реальным размером файла — чтобы клиент понял, какие диапазоны есть.
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const mimeType = getMimeType(absolutePath);
  // ETag — «отпечаток версии файла». Браузер запоминает его и при следующем
  // запросе присылает обратно в If-None-Match: «а у меня уже есть эта версия».
  // Мы используем размер и время изменения — они меняются при любой правке.
  const etag = `"${fileSize}-${lastModified.getTime()}"`;

  // --- 7. Range не запрошен → отдаём весь файл (200) ------------------------
  if (parsedRange === null) {
    // Если файл не менялся с прошлого раза, можно ответить 304 Not Modified
    // и не гонять байты вообще.
    const clientEtag = request.headers.get("if-none-match");
    if (clientEtag === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    return new Response(createFileStream(absolutePath, 0, fileSize - 1, request.method === "HEAD"), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        // Главный заголовок: «я умею отдавать кусками». Без него браузер
        // не станет запрашивать Range и не сможет перематывать.
        "Accept-Ranges": "bytes",
        "Last-Modified": lastModified.toUTCString(),
        ETag: etag,
        // Аудиофайлы неизменяемы → можно кэшировать надолго.
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // --- 8. Range запрошен → отдаём кусок (206) -------------------------------
  const { start, end } = parsedRange;
  // Content-Length считаем как «конец минус начало плюс один», потому что
  // и start, и end ВКЛЮЧИТЕЛЬНЫ. Классическая ошибка новичка — забыть +1
  // и отдать на один байт меньше.
  const chunkSize = end - start + 1;

  return new Response(createFileStream(absolutePath, start, end, request.method === "HEAD"), {
    status: 206,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(chunkSize),
      // Content-Range объясняет клиенту, какой именно кусок он получил
      // и сколько всего байт в файле: "bytes 0-1023/5000000".
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Last-Modified": lastModified.toUTCString(),
      ETag: etag,
      // Частичный контент кэшируем умеренно.
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/**
 * Создаёт поток чтения файла с нужного смещения.
 *
 * ── ЧТО ТАКОЕ ПОТОК (STREAM) ──────────────────────────────────────────────
 * Поток — это способ обрабатывать данные ПО ЧАСТЯМ, не загружая их целиком
 * в память. Вместо «прочитай 50 МБ и верни массив байт» мы говорим
 * «читай файл кусками по 64 КБ и отдавай их по мере поступления».
 *
 * Сервер при этом держит в памяти килобайты вместо десятков мегабайт.
 * Ровно поэтому этим пользуются для видео, больших отчётов, логов.
 *
 * ── ПРО ДВА ВИДА ПОТОКОВ ─────────────────────────────────────────────────
 *   node:fs / node:stream  → серверные потоки Node.js (классические)
 *   Web Streams (ReadableStream) → стандарт веба, на нём работает fetch
 * Next.js (и веб-платформа в целом) ожидает именно Web Stream.
 * Поэтому мы конвертируем одно в другое через Readable.toWeb().
 *
 * ── АЛЬТЕРНАТИВА ДЛЯ BUN ─────────────────────────────────────────────────
 * Так как проект работает на рантайме Bun, можно было бы написать короче:
 *
 *     const file = Bun.file(absolutePath);
 *     return new Response(file.slice(start, end + 1), { status: 206, ... });
 *
 * Bun.file ленивый: он не читает файл, пока данные не понадобятся, и умеет
 * отдавать срез без копирования в память. Это быстрее.
 *
 * Но мы используем node:fs, потому что:
 *   1. этот код будет работать и на Node.js, если однажды переедем;
 *   2. явный createReadStream нагляднее показывает, что такое поток.
 * Если захочешь ускорить — вот здесь и меняй, это ровно две строки.
 */
function createFileStream(filePath: string, start: number, end: number, isHeadRequest: boolean): BodyInit | null {
  // HEAD-запрос: тело не нужно, только заголовки.
  if (isHeadRequest) return null;

  // createReadStream с параметрами start и end читает ровно указанный кусок.
  // ВАЖНО: здесь end ВКЛЮЧИТЕЛЬНЫЙ — то же соглашение, что и в HTTP.
  const nodeStream = createReadStream(filePath, { start, end });

  // Readable.toWeb превращает серверный поток в веб-поток.
  // Приведение `as unknown as ReadableStream` нужно потому, что TypeScript
  // считает ReadableStream из "node:stream/web" и глобальный ReadableStream
  // разными типами, хотя фактически это одно и то же.
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
}

/**
 * ============================================================================
 * ЭКСПОРТЫ — ТОЧКИ ВХОДА ROUTE HANDLER.
 * ----------------------------------------------------------------------------
 * Имя файла route.ts и экспортированные функции с именами GET/POST/... —
 * это и есть весь «роутинг» в Next.js. Файл лежит по пути
 * src/app/api/tracks/[id]/stream/route.ts, значит URL будет
 * /api/tracks/<любой id>/stream.
 *
 * ── ПРО ВТОРОЙ АРГУМЕНТ context ───────────────────────────────────────────
 * Начиная с Next.js 15 параметры динамического сегмента приходят как ПРОМИС,
 * и их обязательно нужно await'ить. Это одна из главных ломающих перемен
 * между версиями, о которой предупреждает AGENTS.md.
 *
 *     { params }: { params: Promise<{ id: string }> }
 *     const { id } = await params;   ← вот так, а не params.id
 * ============================================================================
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return await handleAudioRequest(request, id);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * HEAD обрабатывается той же функцией, но без тела ответа
 * (см. параметр isHeadRequest внутри createFileStream).
 */
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return await handleAudioRequest(request, id);
  } catch (error) {
    return handleApiError(error);
  }
}
