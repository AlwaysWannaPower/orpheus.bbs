"use client";

// ============================================================================
// src/components/library/AddToPlaylistButton.tsx — «ДОБАВИТЬ В ПЛЕЙЛИСТ».
// ----------------------------------------------------------------------------
// Кнопка открывает небольшое выпадающее меню со списком плейлистов.
// Список загружается ЛЕНИВО — только когда пользователь открыл меню.
//
// ── ПОЧЕМУ ЛЕНИВО ─────────────────────────────────────────────────────────
// Если бы мы грузили плейлисты сразу для каждой строки списка из 500 треков,
// получилось бы 500 одинаковых запросов (или один, но всё равно на каждой
// странице, даже если пользователь никогда не открывает меню).
//
// Правило: не делай работу, которую пользователь не просил.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PlaylistDTO } from "@/lib/types";

type AddToPlaylistButtonProps = {
  trackId: number;
};

export function AddToPlaylistButton({ trackId }: AddToPlaylistButtonProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistDTO[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // ССЫЛКА НА КОНТЕЙНЕР МЕНЮ.
  //
  // Нужна, чтобы понять, куда кликнул пользователь: внутрь меню или мимо.
  // Если мимо — меню надо закрыть. Это стандартное поведение любого
  // выпадающего списка, и без него интерфейс кажется «залипшим».
  // --------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Загрузка списка плейлистов при первом открытии.
  useEffect(() => {
    if (!isOpen || playlists !== null) return;

    void fetch("/api/playlists")
      .then((response) => response.json() as Promise<{ playlists: PlaylistDTO[] }>)
      .then((data) => setPlaylists(data.playlists))
      .catch(() => setPlaylists([]));
  }, [isOpen, playlists]);

  // Закрытие по клику вне меню и по Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      // `contains` проверяет, находится ли узел внутри контейнера.
      // event.target может быть null по типам, поэтому приводим к Node.
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    // ------------------------------------------------------------------------
    // ВАЖНО: подписка на событие через document, а не через сам элемент.
    //
    // Клик может произойти в ЛЮБОМ месте страницы. Если слушать только
    // контейнер, мы не узнаем о клике снаружи.
    //
    // Аргумент { capture: true } заставляет обработчик срабатывать на фазе
    // ПЕРЕХВАТА — раньше, чем событие дойдёт до элементов. Это нужно,
    // чтобы меню закрывалось до того, как другой обработчик, например
    // строка списка, запустит воспроизведение.
    // ------------------------------------------------------------------------
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  /** Добавляет трек в выбранный плейлист. */
  const handleAdd = (playlistId: number, playlistName: string) => {
    void fetch(`/api/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId }),
    })
      .then(async (response) => {
        if (response.status === 409) {
          setMessage(`Уже в «${playlistName}»`);
          return;
        }
        if (!response.ok) throw new Error("Ошибка");

        setMessage(`Добавлено в «${playlistName}»`);
        // Обновляем серверные данные, чтобы счётчики треков пересчитались.
        router.refresh();
      })
      .catch(() => setMessage("Не удалось добавить"))
      // Сообщение исчезает само через 2 секунды.
      .finally(() => window.setTimeout(() => setMessage(null), 2000));
  };

  return (
    // ref на контейнер нужен для проверки «клик внутрь или наружу».
    // stopPropagation не даёт клику дойти до строки трека.
    <div className="relative" ref={containerRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="term-btn !px-2 !py-0.5 !text-[10px]"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Добавить в плейлист"
      >
        <span aria-hidden="true">＋</span>
        <span className="sr-only">Добавить в плейлист</span>
      </button>

      {/* Всплывающее сообщение о результате. */}
      {message && (
        <div
          // role="status" — «вежливое» объявление для скринридера:
          // он прочитает текст, когда освободится, не перебивая пользователя.
          role="status"
          className="absolute right-0 top-full mt-1 z-40 whitespace-nowrap border border-accent-2 bg-canvas px-2 py-1 text-[10px] text-accent-2"
        >
          {message}
        </div>
      )}

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[180px] term-panel p-1"
        >
          {playlists === null && <div className="px-2 py-1 text-[11px] text-ink-muted">загрузка…</div>}

          {playlists !== null && playlists.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-ink-muted">нет плейлистов</div>
          )}

          {playlists?.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              role="menuitem"
              onClick={() => {
                handleAdd(playlist.id, playlist.name);
                setIsOpen(false);
              }}
              className="block w-full text-left px-2 py-1 text-[11px] hover:bg-accent hover:text-on-accent"
            >
              {playlist.name}
              <span className="ml-2 text-ink-muted">{playlist.trackCount}</span>
            </button>
          ))}

          {playlists !== null && playlists.length > 0 && (
            <>
              <div className="ascii-rule text-[8px] my-1">──────────────────</div>
              <Link
                href="/playlists"
                className="block px-2 py-1 text-[10px] text-accent-3 hover:bg-accent-3 hover:text-on-accent"
              >
                управлять плейлистами →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
