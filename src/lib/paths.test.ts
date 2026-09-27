// ============================================================================
// src/lib/paths.test.ts — ТЕСТЫ ПРЕОБРАЗОВАНИЯ ПУТЕЙ.
// ----------------------------------------------------------------------------
// ── КАКОЙ БАГ ЗДЕСЬ ЗАЩИЩАЕТСЯ ────────────────────────────────────────────
// В проекте была ошибка, из-за которой МУЗЫКА ПЕРЕСТАВАЛА ИГРАТЬ после
// запуска через Docker. Выглядело так:
//
//     GET /api/tracks/6/stream 404
//     [browser] play() отклонён: NotSupportedError
//
// Причина: в базе хранились АБСОЛЮТНЫЕ пути к файлам.
//
//     локальный запуск:  /home/august/.../music/ATL - Ящик.mp3
//     запуск в Docker:   /music/ATL - Ящик.mp3
//
// База-то одна (она в томе ./data), а пути в ней — от конкретной машины.
// Просканировал локально → в базе /home/..., запустил в Docker → таких путей
// внутри контейнера нет → 404 на каждый трек.
//
// ── ЧТО ПРОВЕРЯЮТ ЭТИ ТЕСТЫ ───────────────────────────────────────────────
// Что путь, сохранённый ОТНОСИТЕЛЬНО папки музыки, можно развернуть обратно
// в абсолютный — и он совпадёт с исходным. Это и есть свойство переносимости:
// папку можно смонтировать куда угодно, а путь внутри библиотеки не меняется.
//
// ЗАПУСК: bun test
// ============================================================================

import { describe, expect, test } from "bun:test";
import path from "node:path";

import { MUSIC_DIR, resolveMusicPath, toMusicRelative } from "@/lib/config";

describe("toMusicRelative — абсолютный путь → относительный", () => {
  test("файл прямо в корне библиотеки", () => {
    const absolute = path.join(MUSIC_DIR, "ATL - Ящик.mp3");
    expect(toMusicRelative(absolute)).toBe("ATL - Ящик.mp3");
  });

  test("файл во вложенной папке — вложенность сохраняется", () => {
    // Типичная раскладка музыкальной библиотеки: Исполнитель/Альбом/трек.mp3
    const absolute = path.join(MUSIC_DIR, "ATL", "Ящик", "01 - Трек.mp3");
    expect(toMusicRelative(absolute)).toBe(path.join("ATL", "Ящик", "01 - Трек.mp3"));
  });

  test("сам корень библиотеки относительным путём не является", () => {
    // path.relative вернёт пустую строку — это не файл, а папка.
    expect(toMusicRelative(MUSIC_DIR)).toBeNull();
  });

  test("файл ВНЕ библиотеки отбрасывается", () => {
    // Это важно для безопасности: сканер не должен индексировать файлы
    // за пределами музыкальной папки, даже если они ему «попались».
    expect(toMusicRelative("/etc/passwd")).toBeNull();
    expect(toMusicRelative(path.join(MUSIC_DIR, "..", "секрет.txt"))).toBeNull();
  });
});

describe("resolveMusicPath — относительный путь → абсолютный", () => {
  test("собирает абсолютный путь из корня библиотеки", () => {
    expect(resolveMusicPath("ATL - Ящик.mp3")).toBe(path.join(MUSIC_DIR, "ATL - Ящик.mp3"));
  });

  test("сохраняет вложенность", () => {
    expect(resolveMusicPath("ATL/Ящик/01.mp3")).toBe(path.join(MUSIC_DIR, "ATL/Ящик/01.mp3"));
  });
});

describe("переносимость базы (главное свойство)", () => {
  test("туда и обратно — путь не меняется", () => {
    // Ключевая проверка. Сканер сохраняет путь через toMusicRelative,
    // а роут воспроизведения разворачивает его через resolveMusicPath.
    // Если эти две функции не согласованы — музыка не играет.
    const original = path.join(MUSIC_DIR, "ATL", "Ящик", "01 - Трек.mp3");

    const stored = toMusicRelative(original); // так путь попадает в базу
    expect(stored).not.toBeNull();

    const restored = resolveMusicPath(stored!); // так он достаётся из базы
    expect(restored).toBe(original);
  });

  test("в базе НЕ остаётся абсолютных путей", () => {
    // Это и была причина бага: абсолютный путь в базе привязывает её
    // к одной конкретной машине. Проверяем, что относительный путь
    // не начинается со слэша и не содержит корень библиотеки.
    const stored = toMusicRelative(path.join(MUSIC_DIR, "песня.mp3"));
    expect(stored!.startsWith("/")).toBe(false);
    expect(stored!.includes(MUSIC_DIR)).toBe(false);
  });
});
