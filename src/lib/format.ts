// ============================================================================
// src/lib/format.ts — ФОРМАТИРОВАНИЕ ЗНАЧЕНИЙ ДЛЯ ПОКАЗА В ИНТЕРФЕЙСЕ.
// ----------------------------------------------------------------------------
// ── ВАЖНОЕ ПРАВИЛО РАЗДЕЛЕНИЯ КОДА ────────────────────────────────────────
// Этот файл НЕ импортирует ничего серверного: ни базу, ни fs, ни config.
// Только чистые функции «вход → выход».
//
// Благодаря этому его можно безопасно использовать и на сервере
// (в Server Component), и в браузере (в Client Component). Такие модули
// называют ИЗОМОРФНЫМИ.
//
// Держи серверный и клиентский код раздельно: как только в клиентский файл
// попадёт `import fs from "node:fs"`, сборка упадёт с длинной и непонятной
// ошибкой про "Module not found: Can't resolve 'fs'".
// ============================================================================

/**
 * Секунды → "3:45" или "1:02:13".
 *
 * ── РАЗБОР ЛОГИКИ ─────────────────────────────────────────────────────────
 * Math.floor — округление ВНИЗ до целого. 213.99 → 213.
 * Если округлять обычно (Math.round), на 213.9 плеер показывал бы 3:34,
 * а реальное время было бы 3:33 — счётчик «прыгал» бы.
 */
export function formatDuration(totalSeconds: number): string {
  // Защита от мусора: NaN, отрицательные значения, Infinity.
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";

  const total = Math.floor(totalSeconds);

  // --------------------------------------------------------------------------
  // Оператор % — остаток от деления.
  //   213 % 60 = 33   (секунды)
  //   213 / 60 = 3.55 → 3 (минуты)
  // --------------------------------------------------------------------------
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  // padStart(2, "0") дописывает нули слева: "5" → "05".
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * Общая длительность библиотеки в человеческом виде: "12 ч 34 мин".
 * Используется в статистике в шапке сайта.
 */
export function formatTotalDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0 мин";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

/**
 * Байты → "4.2 МБ".
 *
 * ── ПОЧЕМУ ДЕЛИМ НА 1024, А НЕ НА 1000 ────────────────────────────────────
 * Строго говоря, «мегабайт» (МБ) — это 1 000 000 байт, а «мебибайт» (МиБ) —
 * 1 048 576. Windows и большинство программ исторически называют мебибайты
 * мегабайтами. Мы поступаем так же, чтобы цифры совпадали с ожиданиями.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";

  const units = ["Б", "КБ", "МБ", "ГБ"];
  // Math.log(bytes) / Math.log(1024) — «в какую степень надо возвести 1024,
  // чтобы получить bytes». Это логарифм по основанию 1024.
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;

  // toFixed(1) оставляет одну цифру после запятой. Для байтов дробь не нужна,
  // поэтому при нулевом индексе показываем целое.
  return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Unix-время в миллисекундах → "5 минут назад", "вчера", "12.03.2024".
 *
 * ── КАК СЧИТАЕТСЯ «НАЗАД» ────────────────────────────────────────────────
 * Берём разницу между «сейчас» и моментом события. Дальше выбираем
 * подходящую единицу измерения.
 *
 * ── ГЛАВНЫЙ ПОДВОДНЫЙ КАМЕНЬ: ЧАСОВЫЕ ПОЯСА ──────────────────────────────
 * Мы храним время в UTC (универсальное), а показывать должны в местном.
 * Date сам знает про часовой пояс браузера, поэтому new Date(ms).getHours()
 * вернёт местное время. Если бы мы хранили строку "2024-03-12 14:30",
 * пришлось бы вручную разбираться с поясами — и почти наверняка были бы баги.
 *
 * Общее правило: В БАЗЕ ВСЕГДА ХРАНИ МОМЕНТ ВРЕМЕНИ В UTC (или unix-время),
 * а форматируй его только при показе.
 */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "только что";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} мин назад`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} ч назад`;
  if (diffMs < 2 * day) return "вчера";
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} дн назад`;

  // Для старых дат показываем обычную дату.
  // toLocaleDateString("ru-RU") форматирует по правилам русского языка:
  // 12.03.2024
  return new Date(timestampMs).toLocaleDateString("ru-RU");
}

/**
 * Дата и время события: "12.03.2024, 14:30".
 */
export function formatDateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Обрезает длинную строку и добавляет многоточие.
 * Нужна для заголовков, которые не влезают в колонку.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  // slice(0, n) берёт первые n символов (индексы 0..n-1).
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Русское склонение существительных после числа.
 *   1 трек, 2 трека, 5 треков
 *
 * ── ЭТО ХОРОШИЙ ПРИМЕР СЛОЖНОСТИ, КОТОРУЮ ИНОГДА НЕДООЦЕНИВАЮТ ───────────
 * В английском достаточно one/other. В русском три формы, и выбор зависит
 * от последних цифр числа. Готовые библиотеки (plural-ru) делают то же самое.
 *
 * @param count  число
 * @param one    форма для 1  («трек»)
 * @param few    форма для 2–4 («трека»)
 * @param many   форма для 5+ («треков»)
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  // 11–14 — исключение: говорим «11 треков», а не «11 трек».
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Готовая связка: "12 треков". */
export function tracksLabel(count: number): string {
  return `${count} ${pluralize(count, "трек", "трека", "треков")}`;
}

/** Готовая связка: "3 альбома". */
export function albumsLabel(count: number): string {
  return `${count} ${pluralize(count, "альбом", "альбома", "альбомов")}`;
}
