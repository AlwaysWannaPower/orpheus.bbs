// ============================================================================
// src/lib/db/track-queries.ts — ВСЕ ЗАПРОСЫ К ТАБЛИЦЕ tracks.
// ----------------------------------------------------------------------------
// Это «слой доступа к данным» (data access layer). Правило простое:
// ни один React-компонент и ни один Route Handler не пишет SQL сам — все
// обращаются сюда. Так у нас ровно одно место, где живут запросы, и его
// легко читать, менять и оптимизировать.
//
// ── КАК ЧИТАТЬ ЭТОТ ФАЙЛ ───────────────────────────────────────────────────
// У каждой функции в комментарии есть строка вида
//     -- SQL: SELECT ...
// Это тот самый SQL, который сгенерирует Drizzle. Полезно сверять: ты
// параллельно учишь SQL и сразу видишь, во что превращается код на TypeScript.
// ============================================================================

import path from "node:path";

import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm";

import { MUSIC_DIR } from "@/lib/config";

import { db } from "@/lib/db/client";
import { toTrackDTO, toTrackDTOList } from "@/lib/db/mappers";
import { tracks, type TrackRow } from "@/lib/db/schema";
import type { AlbumDTO, ArtistDTO, TrackDTO, TrackSortKey } from "@/lib/types";

// ============================================================================
// ЧАСТЬ 1. ЧТЕНИЕ СПИСКА ТРЕКОВ С ФИЛЬТРАМИ
// ============================================================================

/**
 * Параметры выборки треков. Все поля необязательные — это удобно:
 * можно вызвать listTracks() вообще без аргументов и получить всю библиотеку.
 */
export type ListTracksOptions = {
  /** Поисковая строка. Ищем по названию, исполнителю, альбому и имени файла. */
  search?: string;
  /** Фильтр по конкретному исполнителю. */
  artist?: string;
  /** Фильтр по конкретному альбому. */
  album?: string;
  /** Показывать только избранное. */
  favoritesOnly?: boolean;
  /** Как сортировать. */
  sort?: TrackSortKey;
  /** Максимум строк в ответе. */
  limit?: number;
  /** Сколько первых строк пропустить (постраничный вывод). */
  offset?: number;
};

/**
 * Главная функция чтения библиотеки.
 *
 * Возвращает треки в виде DTO, уже готовые к отправке в браузер.
 */
export async function listTracks(options: ListTracksOptions = {}): Promise<TrackDTO[]> {
  // --------------------------------------------------------------------------
  // ШАГ 1. Собираем условия WHERE.
  //
  // Мы не пишем строку "WHERE title LIKE ... AND artist = ..." вручную
  // (это прямая дорога к SQL-инъекции). Вместо этого накапливаем МАССИВ
  // условий и передаём его в and(...).
  //
  // Тип SQL[] означает «массив условий, которые Drizzle умеет вставить в SQL».
  // --------------------------------------------------------------------------
  const conditions = [];

  // --- Поиск ----------------------------------------------------------------
  if (options.search && options.search.trim() !== "") {
    // Приводим запрос к нижнему регистру ТЕМ ЖЕ способом, каким мы сохранили
    // колонку search_text при сканировании (JS-toLowerCase знает Unicode).
    const needle = `%${options.search.trim().toLowerCase()}%`;

    // ------------------------------------------------------------------------
    // like(колонка, шаблон) — оператор LIKE.
    //   %  = «любое количество любых символов»
    //   _  = «ровно один любой символ»
    // '%numb%' найдёт "Numb", "Numb (Live)", "Radio Numb".
    //
    // Почему мы ищем по одной колонке search_text, а не по четырём полям
    // через OR? Потому что search_text уже содержит склейку
    // "название исполнитель альбом имяфайла" в нижнем регистре.
    // Один LIKE вместо четырёх — и проще, и быстрее.
    // ------------------------------------------------------------------------
    conditions.push(like(tracks.searchText, needle));
  }

  // --- Точные фильтры -------------------------------------------------------
  if (options.artist) {
    // eq = equals = «равно». Генерирует `artist = 'ATL'`.
    // Никогда не подставляй значение в SQL-строку через конкатенацию:
    // eq() передаёт значение как ПАРАМЕТР запроса, и SQL-инъекция невозможна.
    conditions.push(eq(tracks.artist, options.artist));
  }
  if (options.album) {
    conditions.push(eq(tracks.album, options.album));
  }
  if (options.favoritesOnly) {
    // В базе это 0/1, но Drizzle с mode:"boolean" принимает обычный true.
    conditions.push(eq(tracks.isFavorite, true));
  }

  // --------------------------------------------------------------------------
  // ШАГ 2. Строим запрос.
  //
  // Обрати внимание на цепочку вызовов (method chaining). Каждый метод
  // возвращает новый объект запроса, поэтому вызовы можно выстраивать
  // в «поезд». Пока не добавлен await, НИ ОДНОГО обращения к базе не
  // происходит — это называется ленивым построением запроса.
  // --------------------------------------------------------------------------
  const query = db
    .select()
    .from(tracks)
    // and(...) склеивает массив условий через AND. Если массив пуст,
    // and() вернёт undefined, и метод .where(undefined) просто ничего не добавит
    // (Drizzle это разрешает) — получится SELECT без WHERE.
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...buildOrderBy(options.sort))
    .limit(options.limit ?? 1000)
    .offset(options.offset ?? 0);

  // --------------------------------------------------------------------------
  // SHAPE РЕЗУЛЬТАТА: массив строк вида TrackRow.
  // Дальше маппер превратит их в DTO.
  // --------------------------------------------------------------------------
  const rows: TrackRow[] = await query;

  return toTrackDTOList(rows);
}

/**
 * Превращает ключ сортировки из интерфейса в аргументы для ORDER BY.
 *
 * `switch` здесь удобнее if-else, а `default` защищает от ситуации, когда
 * в URL случайно пришло неизвестное значение — тогда просто берём
 * сортировку по умолчанию.
 *
 * Возвращаемый тип — массив: SQL позволяет сортировать по нескольким полям
 * сразу: ORDER BY artist ASC, album ASC, track_number ASC.
 */
function buildOrderBy(sort: TrackSortKey | undefined) {
  switch (sort) {
    case "title_asc":
      // -- SQL: ORDER BY title ASC
      return [asc(tracks.title)];

    case "artist_asc":
      // -- SQL: ORDER BY artist ASC, album ASC, track_number ASC
      // Внутри одного исполнителя сортируем по альбому, внутри альбома —
      // по номеру трека. Так список выглядит «как в плеере».
      return [asc(tracks.artist), asc(tracks.album), asc(tracks.trackNumber)];

    case "album_asc":
      return [asc(tracks.album), asc(tracks.trackNumber)];

    case "duration_desc":
      // Самые длинные сверху.
      return [desc(tracks.duration)];

    case "added_desc":
    default:
      // Свежедобавленные сверху — самый ожидаемый порядок по умолчанию.
      // -- SQL: ORDER BY created_at DESC
      return [desc(tracks.createdAt)];
  }
}

// ============================================================================
// ЧАСТЬ 2. ЧТЕНИЕ ОДНОГО ТРЕКА
// ============================================================================

/**
 * Возвращает строку базы целиком. Нужна там, где требуется АБСОЛЮТНЫЙ ПУТЬ
 * к файлу, — например, для стриминга. Наружу (в браузер) такой объект
 * отдавать нельзя: в нём есть path.
 *
 * Тип возврата `Promise<TrackRow | null>` читается так:
 *   «обещание, которое разрешится либо строкой трека, либо null».
 * Явно указанный null заставляет вызывающий код обработать случай
 * «трека нет» — TypeScript не даст забыть про эту проверку.
 */
export async function getTrackRowById(id: number): Promise<TrackRow | null> {
  // -- SQL: SELECT * FROM tracks WHERE id = ? LIMIT 1
  const rows = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
  // rows[0] может быть undefined (если ничего не нашли) — превращаем
  // undefined в null, чтобы тип был честным.
  return rows[0] ?? null;
}

/** То же самое, но уже в виде DTO для интерфейса. */
export async function getTrackById(id: number): Promise<TrackDTO | null> {
  const row = await getTrackRowById(id);
  return row ? toTrackDTO(row) : null;
}

/**
 * Достаёт сразу много треков по списку id.
 *
 * ── ОЧЕНЬ ВАЖНЫЙ ПРИЁМ: ПРОБЛЕМА N+1 ЗАПРОСОВ ──────────────────────────────
 * Наивное решение — пройтись циклом и вызывать getTrackRowById для каждого id:
 *     100 треков в плейлисте → 100 отдельных запросов к базе.
 * Это классическая проблема N+1 (один запрос + N запросов на детали), из-за
 * которой страницы грузятся в разы медленнее.
 *
 * Правильно — сделать ОДИН запрос с условием IN:
 *     SELECT * FROM tracks WHERE id IN (1, 5, 9, ...)
 * Именно это и делает inArray().
 * ============================================================================
 */
export async function getTrackRowsByIds(ids: number[]): Promise<TrackRow[]> {
  if (ids.length === 0) return [];

  // -- SQL: SELECT * FROM tracks WHERE id IN (?, ?, ?)
  const rows = await db.select().from(tracks).where(inArray(tracks.id, ids));

  // ── ВАЖНАЯ ДЕТАЛЬ: ПОРЯДОК ─────────────────────────────────────────────
  // SQL не обязан возвращать строки в порядке из списка IN — он возвращает
  // их как удобно оптимизатору. А нам нужно сохранить порядок плейлиста.
  // Поэтому раскладываем результат в Map (словарь «id → трек») и собираем
  // массив заново в нужном порядке.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is TrackRow => row !== undefined);
}

// ============================================================================
// ЧАСТЬ 3. АГРЕГАЦИИ: АЛЬБОМЫ И ИСПОЛНИТЕЛИ (GROUP BY)
// ============================================================================
// Здесь начинается настоящий SQL: GROUP BY, COUNT, SUM.
// Если ты параллельно учишь ClickHouse и dbt — этот код тебе будет знаком:
// логика ровно та же, только данных меньше.
// ============================================================================

/**
 * Список альбомов с количеством треков и суммарной длительностью.
 *
 * Эквивалентный SQL целиком:
 *
 *   SELECT
 *     album,
 *     album_artist,
 *     MAX(year)                                   AS year,
 *     COUNT(*)                                    AS track_count,
 *     COALESCE(SUM(duration), 0)                  AS total_duration,
 *     MAX(CASE WHEN cover_file IS NOT NULL THEN id END) AS cover_track_id
 *   FROM tracks
 *   GROUP BY album, album_artist
 *   ORDER BY album_artist ASC, year DESC
 *
 * ── Разбор по частям ──────────────────────────────────────────────────────
 *   GROUP BY album       — «сверни все строки с одинаковым album в одну».
 *   COUNT(*)             — сколько строк попало в группу.
 *   SUM(duration)        — сложить длительности всех треков группы.
 *   COALESCE(x, 0)       — «верни x, а если x = NULL, верни 0».
 *                          SUM по пустой группе даёт NULL, это защита.
 *   MAX(CASE WHEN ...)   — трюк: берём id того трека, у которого есть
 *                          обложка. CASE WHEN работает как if-else внутри
 *                          агрегата: для треков без обложки значение NULL,
 *                          а MAX игнорирует NULL и берёт реальный id.
 *
 * ── ПОЧЕМУ ГРУППИРУЕМ ПО ДВУМ ПОЛЯМ? ──────────────────────────────────────
 * Бывает, что два разных исполнителя выпустили альбом с одинаковым названием
 * («Greatest Hits» — вечная классика). Группировка по паре (album, album_artist)
 * не даст им склеиться в один.
 */
export async function listAlbums(): Promise<AlbumDTO[]> {
  const rows = await db
    .select({
      album: tracks.album,
      albumArtist: tracks.albumArtist,
      // MAX(year) — если у треков разные годы, возьмём наибольший.
      year: sql<number>`COALESCE(MAX(${tracks.year}), 0)`,
      // count() — функция-хелпер Drizzle, эквивалент COUNT(*).
      trackCount: count(),
      totalDuration: sql<number>`COALESCE(SUM(${tracks.duration}), 0)`,
      coverTrackId: sql<number | null>`MAX(CASE WHEN ${tracks.coverFile} IS NOT NULL THEN ${tracks.id} END)`,
    })
    .from(tracks)
    .groupBy(tracks.album, tracks.albumArtist)
    .orderBy(asc(tracks.albumArtist), asc(tracks.album));

  // --------------------------------------------------------------------------
  // Обрати внимание: строки из SQLite могут прийти как "строки с числами",
  // а иногда агрегатные функции возвращают числа в виде строк.
  // Number(...) — надёжная страховка.
  // --------------------------------------------------------------------------
  return rows.map((row) => ({
    album: row.album,
    albumArtist: row.albumArtist,
    year: Number(row.year ?? 0),
    trackCount: Number(row.trackCount ?? 0),
    totalDuration: Number(row.totalDuration ?? 0),
    coverTrackId: row.coverTrackId == null ? null : Number(row.coverTrackId),
  }));
}

/**
 * Список исполнителей с числом треков и числом уникальных альбомов.
 *
 *   SELECT artist,
 *          COUNT(*)                    AS track_count,
 *          COUNT(DISTINCT album)       AS album_count
 *   FROM tracks
 *   GROUP BY artist
 *   ORDER BY artist ASC
 *
 * COUNT(DISTINCT album) — считает НЕ строки, а РАЗНЫЕ значения альбомов.
 * Если у исполнителя 12 песен, но всего 2 альбома, DISTINCT вернёт 2.
 */
export async function listArtists(): Promise<ArtistDTO[]> {
  const rows = await db
    .select({
      artist: tracks.artist,
      trackCount: count(),
      albumCount: sql<number>`COUNT(DISTINCT ${tracks.album})`,
    })
    .from(tracks)
    .groupBy(tracks.artist)
    .orderBy(asc(tracks.artist));

  return rows.map((row) => ({
    artist: row.artist,
    trackCount: Number(row.trackCount ?? 0),
    albumCount: Number(row.albumCount ?? 0),
  }));
}

// ============================================================================
// ЧАСТЬ 4. ОБНОВЛЕНИЕ ДАННЫХ
// ============================================================================

/**
 * Переключает или явно задаёт статус «избранное».
 *
 * ── ПРО ПАРАМЕТР value ────────────────────────────────────────────────────
 * Если value не передан (undefined) — инвертируем текущее значение.
 * Если передан — ставим его. Так одна функция обслуживает и кнопку-переключатель,
 * и явную установку значения.
 */
export async function setTrackFavorite(id: number, value?: boolean): Promise<boolean> {
  const current = await getTrackRowById(id);
  if (!current) {
    // Бросаем ошибку — вызывающий Route Handler превратит её в HTTP 404.
    throw new Error(`Трек ${id} не найден`);
  }

  const next = value ?? !current.isFavorite;

  // -- SQL: UPDATE tracks SET is_favorite = ?, updated_at = ? WHERE id = ?
  await db
    .update(tracks)
    .set({ isFavorite: next, updatedAt: new Date() })
    .where(eq(tracks.id, id));

  return next;
}

/** Записывает имя файла обложки (вызывается сканером). */
export async function setTrackCover(id: number, coverFile: string | null): Promise<void> {
  await db.update(tracks).set({ coverFile }).where(eq(tracks.id, id));
}

// ============================================================================
// ЧАСТЬ 5. СТАТИСТИКА БИБЛИОТЕКИ
// ============================================================================

/** Сводка для шапки сайта: сколько всего музыки. */
export type LibraryStats = {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalDuration: number;
  favoriteCount: number;
};

/**
 * Один запрос вместо пяти.
 *
 *   SELECT
 *     COUNT(*)                              AS total_tracks,
 *     COUNT(DISTINCT artist)                AS total_artists,
 *     COUNT(DISTINCT album)                 AS total_albums,
 *     COALESCE(SUM(duration), 0)            AS total_duration,
 *     COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) AS favorite_count
 *   FROM tracks
 *
 * Последняя строка — ещё один полезный приём: «условная агрегация».
 * SUM по выражению CASE считает, сколько раз условие оказалось истинным.
 * То же самое, что COUNT(*) с фильтром, но за один проход по таблице.
 */
export async function getLibraryStats(): Promise<LibraryStats> {
  const rows = await db
    .select({
      totalTracks: count(),
      totalArtists: sql<number>`COUNT(DISTINCT ${tracks.artist})`,
      totalAlbums: sql<number>`COUNT(DISTINCT ${tracks.album})`,
      totalDuration: sql<number>`COALESCE(SUM(${tracks.duration}), 0)`,
      favoriteCount: sql<number>`COALESCE(SUM(CASE WHEN ${tracks.isFavorite} = 1 THEN 1 ELSE 0 END), 0)`,
    })
    .from(tracks);

  const row = rows[0];
  return {
    totalTracks: Number(row?.totalTracks ?? 0),
    totalArtists: Number(row?.totalArtists ?? 0),
    totalAlbums: Number(row?.totalAlbums ?? 0),
    totalDuration: Number(row?.totalDuration ?? 0),
    favoriteCount: Number(row?.favoriteCount ?? 0),
  };
}

// ============================================================================
// ЧАСТЬ 6. ФУНКЦИИ ДЛЯ СКАНЕРА
// ============================================================================

/**
 * Карта «путь файла → служебные поля» для всех треков в базе.
 *
 * ── ВАЖНО ПРО ФОРМАТ ПУТИ ─────────────────────────────────────────────────
 * Ключом здесь ОТНОСИТЕЛЬНЫЙ путь (например «ATL - Ящик.mp3»), а не
 * абсолютный. Почему так — подробно объяснено в src/lib/config.ts.
 * Коротко: база лежит в томе и переносится между локальным запуском
 * и Docker, поэтому абсолютные пути в ней хранить нельзя.
 *
 * Нужна сканеру, чтобы за ОДИН запрос узнать, какие файлы уже известны
 * и не изменились ли они. Иначе пришлось бы делать по запросу на каждый
 * файл — снова та самая проблема N+1.
 */
export async function getTrackIndexByPath(): Promise<Map<string, { id: number; mtimeMs: number; size: number }>> {
  // Берём только нужные колонки, а не всю строку: так запрос быстрее
  // и меньше данных гоняется из базы в память.
  const rows = await db
    .select({ id: tracks.id, path: tracks.path, mtime: tracks.mtime, size: tracks.size })
    .from(tracks);

  return new Map(rows.map((row) => [row.path, { id: row.id, mtimeMs: row.mtime.getTime(), size: row.size }]));
}

/**
 * Удаляет из базы записи о файлах, которых больше нет на диске.
 *
 * ── КАК ЭТО НЕ НАДО ДЕЛАТЬ (важный урок) ──────────────────────────────────
 * Соблазнительно написать один запрос:
 *     DELETE FROM tracks WHERE path NOT IN (...список всех файлов...)
 * Но у SQLite есть лимит на количество параметров в одном запросе. Если
 * разбить список на части и выполнить `NOT IN` для каждой части, получится
 * ХУЖЕ: первый же запрос удалит все треки, которых нет в первой части,
 * то есть половину живой библиотеки. Это классическая ошибка.
 *
 * ── КАК ПРАВИЛЬНО ─────────────────────────────────────────────────────────
 *   1. Прочитать из базы только id + path (лёгкий запрос).
 *   2. Вычислить разницу множеств в JavaScript — это быстро.
 *   3. Удалить строго по списку id, порезав его на порции.
 *
 * Такой подход ещё и безопаснее: мы точно знаем, какие именно строки удаляем.
 */
export async function deleteTracksMissingFromDisk(existingPaths: string[]): Promise<number> {
  if (existingPaths.length === 0) {
    // Особый случай: музыкальной папки нет вообще или она пуста.
    // Удалять всю библиотеку в такой ситуации ОПАСНО — вероятнее всего,
    // пользователь просто забыл примонтировать папку. Поэтому ничего не делаем.
    return 0;
  }

  // Set — коллекция уникальных значений с очень быстрой проверкой «есть ли тут».
  // Для массива операция `includes` перебирает элементы, для Set — прыгает
  // сразу. На десятках тысяч файлов разница заметна.
  const onDisk = new Set(existingPaths);

  // -- SQL: SELECT id, path FROM tracks
  const knownRows = await db.select({ id: tracks.id, path: tracks.path }).from(tracks);

  const orphanIds = knownRows.filter((row) => !onDisk.has(row.path)).map((row) => row.id);
  if (orphanIds.length === 0) return 0;

  let removed = 0;
  const CHUNK_SIZE = 500;

  // Режем список id на порции и удаляем по IN (...).
  for (let index = 0; index < orphanIds.length; index += CHUNK_SIZE) {
    const chunk = orphanIds.slice(index, index + CHUNK_SIZE);
    // -- SQL: DELETE FROM tracks WHERE id IN (?, ?, ...)
    // ON DELETE CASCADE в связанных таблицах отработает автоматически,
    // потому что мы включили PRAGMA foreign_keys = ON.
    const deleted = await db.delete(tracks).where(inArray(tracks.id, chunk)).returning({ id: tracks.id });
    removed += deleted.length;
  }

  return removed;
}

/**
 * ОДНОРАЗОВЫЙ РЕМОНТ СТАРЫХ ЗАПИСЕЙ: абсолютный путь → относительный.
 *
 * ── ЗАЧЕМ ЭТО НУЖНО ───────────────────────────────────────────────────────
 * В первых версиях проекта в базе хранились абсолютные пути. После запуска
 * через Docker в базе оказались пути вида «/music/ATL - Ящик.mp3», которых
 * на локальной машине не существует — и вся музыка перестала играть (404).
 *
 * Можно было бы просто удалить базу и просканировать заново. Но тогда
 * пропали бы плейлисты и история: они связаны с треками внешними ключами
 * с ON DELETE CASCADE. А это уже данные, которые создал пользователь, —
 * их терять нельзя.
 *
 * Поэтому чиним аккуратно: у каждой записи с абсолютным путём отрезаем
 * известный корень и получаем относительный путь. Строка трека остаётся
 * той же самой (id не меняется), а значит плейлисты и история целы.
 *
 * Функция идемпотентна: если чинить нечего, она ничего не делает и
 * возвращает 0. Вызывается один раз при каждом сканировании — это дёшево,
 * потому что проверка сводится к «начинается ли строка со слэша».
 */
export async function repairAbsolutePaths(): Promise<number> {
  // -- SQL: SELECT id, path FROM tracks WHERE path LIKE '/%'
  // Ищем только те записи, где путь абсолютный (начинается со слэша).
  const rows = await db.select({ id: tracks.id, path: tracks.path }).from(tracks);

  // Какие корни могли быть записаны раньше. Перебираем по очереди:
  //   * /music          — путь внутри Docker-контейнера;
  //   * MUSIC_DIR       — путь при локальном запуске на этой машине.
  const knownRoots = ["/music", MUSIC_DIR];

  let repaired = 0;

  for (const row of rows) {
    // Относительный путь уже — чинить нечего.
    if (!path.isAbsolute(row.path)) continue;

    for (const root of knownRoots) {
      const withoutRoot = path.relative(root, row.path);

      // path.relative вернёт ".." если файл не внутри этого корня.
      if (withoutRoot === "" || withoutRoot.startsWith("..")) continue;

      // -- SQL: UPDATE tracks SET path = ? WHERE id = ?
      await db.update(tracks).set({ path: withoutRoot }).where(eq(tracks.id, row.id));
      repaired += 1;
      break;
    }
  }

  return repaired;
}

/**
 * UPSERT — «вставь или обнови».
 *
 * Это одна из самых полезных конструкций при сканировании: мы не знаем,
 * видели ли этот файл раньше.
 *
 *   INSERT INTO tracks (...) VALUES (...)
 *   ON CONFLICT(path) DO UPDATE SET title = excluded.title, ...
 *
 * `excluded` — специальное ключевое слово SQLite, означающее «значение,
 * которое мы пытались вставить». Так мы говорим базе: «если такой path уже
 * есть, обнови остальные поля новыми значениями».
 *
 * Благодаря этому сканер не создаёт дубликаты при повторных запусках.
 */
export async function upsertTrack(values: typeof tracks.$inferInsert): Promise<number> {
  const result = await db
    .insert(tracks)
    .values(values)
    .onConflictDoUpdate({
      target: tracks.path,
      set: {
        // Перечисляем поля, которые надо перезаписать при повторном скане.
        filename: values.filename,
        title: values.title,
        artist: values.artist,
        album: values.album,
        albumArtist: values.albumArtist,
        genre: values.genre,
        year: values.year,
        trackNumber: values.trackNumber,
        duration: values.duration,
        size: values.size,
        mtime: values.mtime,
        searchText: values.searchText,
        updatedAt: new Date(),
        // ВАЖНО: is_favorite мы НЕ трогаем! Это данные, которые создал
        // пользователь, а не сканер. Скан не должен сбрасывать избранное.
      },
    })
    .returning({ id: tracks.id });

  return result[0].id;
}
