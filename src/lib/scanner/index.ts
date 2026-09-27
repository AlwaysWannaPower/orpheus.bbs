// ============================================================================
// src/lib/scanner/index.ts — СКАНЕР БИБЛИОТЕКИ (этап 5 технического задания).
// ----------------------------------------------------------------------------
// Здесь собирается вся логика сканирования:
//
//     /music
//        │
//        ▼  1. обходим папки            (walk.ts)
//     список файлов
//        │
//        ▼  2. сравниваем с базой       (инкрементальность!)
//     что читать, что пропустить
//        │
//        ▼  3. читаем теги              (metadata.ts)
//     title, artist, album, обложка
//        │
//        ▼  4. UPSERT в SQLite
//     готовый индекс
//        │
//        ▼  5. удаляем записи о пропавших файлах
//     база синхронна с диском
// ============================================================================

import path from "node:path";

import { MUSIC_DIR, log, toMusicRelative } from "@/lib/config";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  deleteTracksMissingFromDisk,
  getTrackIndexByPath,
  repairAbsolutePaths,
  upsertTrack,
} from "@/lib/db/track-queries";
import { readTrackMetadata, saveCoverIfNeeded } from "@/lib/scanner/metadata";
import { checkMusicDirectory, walkMusicDirectory, type FoundFile } from "@/lib/scanner/walk";
import type { ScanResultDTO } from "@/lib/types";

/**
 * Сколько файлов читать одновременно.
 *
 * Почему не больше: чтение тегов — операция ввода-вывода. Диск (особенно
 * механический HDD) от большого числа параллельных обращений начинает
 * «метаться» головками и работает только медленнее. 6 — практичный
 * компромисс для SSD и HDD.
 */
const PARSE_CONCURRENCY = 6;

/**
 * Собирает «поисковый слепок»: все текстовые поля трека в нижнем регистре,
 * склеенные пробелами.
 *
 * ── ЗАЧЕМ (повторение важного) ────────────────────────────────────────────
 * SQLite делает LIKE регистронезависимым только для латиницы. Чтобы поиск
 * работал и для русских названий, мы заранее приводим строку к нижнему
 * регистру силами JavaScript (он умеет Unicode) и сохраняем в отдельную
 * колонку search_text.
 *
 * Пример результата:
 *   "ящик ATL ящик ATL ящик atl - ящик mp3"
 *   (title, artist, album, имя файла — всё в одном месте)
 */
function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

/**
 * ГЛАВНАЯ ФУНКЦИЯ СКАНЕРА.
 *
 * Вызывается из Route Handler POST /api/scan.
 * Возвращает отчёт: сколько добавили, обновили, удалили, пропустили.
 */
export async function scanMusicLibrary(): Promise<ScanResultDTO> {
  const startedAt = Date.now();
  log(`Старт сканирования: ${MUSIC_DIR}`);

  // --------------------------------------------------------------------------
  // ШАГ 0. Проверяем, что папка вообще существует.
  // Частая ситуация в Docker: забыли смонтировать volume — и вместо ошибки
  // хочется получить понятное сообщение.
  // --------------------------------------------------------------------------
  const directoryCheck = await checkMusicDirectory(MUSIC_DIR);
  if (!directoryCheck.ok) {
    // Бросаем ошибку — Route Handler поймает её и вернёт HTTP 400
    // с текстом сообщения. Пользователь увидит внятное объяснение.
    throw new Error(directoryCheck.message);
  }

  // --------------------------------------------------------------------------
  // ШАГ 0.5. ПОЧИНКА СТАРЫХ ЗАПИСЕЙ (разовая операция).
  //
  // В первых версиях проекта в базе хранились АБСОЛЮТНЫЕ пути. Из-за этого
  // база ломалась при переносе: просканировал локально — в базе /home/...,
  // запустил в Docker — таких путей внутри контейнера нет, музыка не играет.
  //
  // Теперь храним путь ОТНОСИТЕЛЬНО папки музыки (см. src/lib/config.ts).
  // Эта функция один раз переводит старые записи в новый формат, сохраняя
  // id треков, а значит и плейлисты с историей.
  //
  // Если чинить нечего — вернёт 0 и не сделает ни одного запроса на запись.
  // --------------------------------------------------------------------------
  const repaired = await repairAbsolutePaths();
  if (repaired > 0) {
    log(`Починено старых путей: ${repaired} (абсолютные → относительные)`);
  }

  // --------------------------------------------------------------------------
  // ШАГ 1. Обходим файловую систему.
  // --------------------------------------------------------------------------
  const foundFiles: FoundFile[] = await walkMusicDirectory(MUSIC_DIR);
  log(`Найдено аудиофайлов: ${foundFiles.length}`);

  // --------------------------------------------------------------------------
  // ШАГ 2. ИНКРЕМЕНТАЛЬНОСТЬ — сердце быстрого сканера.
  //
  // ── ЧТО ЭТО ЗНАЧИТ ───────────────────────────────────────────────────────
  // Полное сканирование читает теги у ВСЕХ файлов. Для 5000 песен это может
  // занять минуты, хотя 4990 из них не менялись с прошлого раза.
  //
  // Мы сравниваем «отпечаток» файла: размер + время изменения (mtime).
  // Если оба совпали — файл точно не менялся, и читать теги не нужно.
  // Второй скан большой библиотеки после этого проходит за секунды.
  //
  // ── ПОЧЕМУ ДВУХ ПОЛЕЙ ДОСТАТОЧНО ─────────────────────────────────────────
  // Размер ловит большинство изменений. mtime — время последней записи файла.
  // Совпадение обоих означает, что файл с очень высокой вероятностью тот же.
  // Теоретически можно поменять содержимое, сохранив и размер, и дату
  // (например, через touch), но для домашней музыкальной библиотеки это
  // нереальный сценарий, а экономия огромная.
  // --------------------------------------------------------------------------
  const knownTracks = await getTrackIndexByPath();

  const filesToParse: FoundFile[] = [];
  let skipped = 0;

  for (const file of foundFiles) {
    // В базе путь ОТНОСИТЕЛЬНЫЙ, поэтому и сравнивать надо относительный.
    // Приводим найденный файл к тому же виду.
    const relativePath = toMusicRelative(file.absolutePath);
    if (relativePath === null) continue; // файл вне библиотеки — пропускаем

    const known = knownTracks.get(relativePath);

    const isUnchanged =
      known !== undefined && known.size === file.size && known.mtimeMs === file.mtime.getTime();

    if (isUnchanged) {
      skipped += 1;
      continue;
    }

    filesToParse.push(file);
  }

  log(`К разбору: ${filesToParse.length}, пропускаем без изменений: ${skipped}`);

  // --------------------------------------------------------------------------
  // ШАГ 3. Читаем теги и пишем в базу.
  //
  // mapWithConcurrency не даёт запустить 500 чтений разом (см. async-pool.ts).
  // Внутри обработчика мы и читаем теги, и сразу сохраняем результат —
  // так не надо держать в памяти метаданные всех файлов одновременно.
  // --------------------------------------------------------------------------
  const counters = { added: 0, updated: 0 };
  const errors: string[] = [];

  await mapWithConcurrency(
    filesToParse,
    async (file) => {
      try {
        // --- 3.1. Читаем теги ----------------------------------------------
        const metadata = await readTrackMetadata(file.absolutePath, file.filename, MUSIC_DIR);

        // --- 3.2. Сохраняем обложку (если есть и если её ещё нет) -----------
        const coverFile = await saveCoverIfNeeded(metadata.picture);

        // --- 3.3. UPSERT в базу ---------------------------------------------
        // В базу пишем ОТНОСИТЕЛЬНЫЙ путь: он не зависит от того, куда
        // смонтирована папка с музыкой (подробно — в src/lib/config.ts).
        const relativePath = toMusicRelative(file.absolutePath);
        if (relativePath === null) return; // файл вне библиотеки

        const existing = knownTracks.get(relativePath);

        await upsertTrack({
          path: relativePath,
          filename: file.filename,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          albumArtist: metadata.albumArtist,
          genre: metadata.genre,
          year: metadata.year,
          trackNumber: metadata.trackNumber,
          duration: metadata.duration,
          size: file.size,
          mtime: file.mtime,
          searchText: buildSearchText([
            metadata.title,
            metadata.artist,
            metadata.album,
            metadata.albumArtist,
            metadata.genre,
            file.filename,
          ]),
          // coverFile === null означает «обложки нет». Мы НЕ затираем уже
          // сохранённую обложку пустым значением — наоборот, если картинка
          // найдена, обновляем; если нет, оставляем как было.
          ...(coverFile ? { coverFile } : {}),
        });

        if (existing) {
          counters.updated += 1;
        } else {
          counters.added += 1;
        }
      } catch (error) {
        // Один проблемный файл не должен останавливать скан.
        const message = `Файл «${file.filename}»: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(message);
      }
    },
    PARSE_CONCURRENCY,
  );

  // --------------------------------------------------------------------------
  // ШАГ 4. Убираем из базы записи о файлах, которых больше нет.
  // Если пользователь удалил mp3 из папки — он должен исчезнуть и из плеера.
  // --------------------------------------------------------------------------
  // Список «что реально лежит на диске» — тоже в относительном виде,
  // иначе функция удалит все записи как «пропавшие».
  const relativePathsOnDisk = foundFiles
    .map((file) => toMusicRelative(file.absolutePath))
    .filter((value): value is string => value !== null);

  const removed = await deleteTracksMissingFromDisk(relativePathsOnDisk);

  const durationMs = Date.now() - startedAt;

  const result: ScanResultDTO = {
    filesFound: foundFiles.length,
    added: counters.added,
    updated: counters.updated,
    removed,
    skipped,
    errors,
    durationMs,
  };

  log(
    `Скан завершён за ${durationMs} мс: +${result.added} новых, ${result.updated} обновлено, ` +
      `${result.removed} удалено, ${result.skipped} без изменений`,
  );

  return result;
}

/**
 * Небольшая утилита: превращает абсолютный путь трека в путь ОТНОСИТЕЛЬНО
 * корня библиотеки. Пригодится для отображения в интерфейсе — показывать
 * абсолютный путь вида /home/august/... и некрасиво, и небезопасно.
 */
export function relativeToMusicDir(absolutePath: string): string {
  return path.relative(MUSIC_DIR, absolutePath);
}
