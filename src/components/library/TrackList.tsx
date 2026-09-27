"use client";

// ============================================================================
// src/components/library/TrackList.tsx — СПИСОК ТРЕКОВ БИБЛИОТЕКИ.
// ----------------------------------------------------------------------------
// Главный элемент интерфейса: таблица песен, по клику на строку которой
// начинается воспроизведение.
//
// ── ПОЧЕМУ ЭТО КЛИЕНТСКИЙ КОМПОНЕНТ ───────────────────────────────────────
// Список должен реагировать на клики и знать, какой трек играет сейчас.
// Данные при этом приходят С СЕРВЕРА как пропс — то есть тяжёлую работу
// (запрос к базе) делает Server Component, а клиент занимается только
// интерактивностью. Это правильное разделение: сервер — данные,
// браузер — реакция на действия.
// ============================================================================

import { useRouter } from "next/navigation";

import { AddToPlaylistButton } from "@/components/library/AddToPlaylistButton";
import { FavoriteButton } from "@/components/library/FavoriteButton";
import { usePlayerActions, usePlayerTrack } from "@/components/player/player-context";
import { CoverArt } from "@/components/ui/CoverArt";
import { formatDuration, formatFileSize } from "@/lib/format";
import type { TrackDTO } from "@/lib/types";

type TrackListProps = {
  tracks: TrackDTO[];
  /** Что показать, если список пуст. */
  emptyMessage?: string;
  /** Показывать ли колонку с плейлистом-владельцем (для страницы плейлиста). */
  playlistId?: number;
};

export function TrackList({ tracks, emptyMessage = "НЕТ ТРЕКОВ", playlistId }: TrackListProps) {
  // --------------------------------------------------------------------------
  // ПОДПИСКА НА ДВА КОНТЕКСТА С РАЗНОЙ ЧАСТОТОЙ ИЗМЕНЕНИЙ.
  //
  // actions — функции, они никогда не меняются: подписка на них ничего
  //           не стоит.
  // track   — текущий трек. Меняется редко (раз в несколько минут),
  //           поэтому перерисовка списка случается редко.
  //
  // А вот контекст с текущим ВРЕМЕНЕМ мы здесь НЕ используем сознательно:
  // иначе список из 1000 строк перерисовывался бы 60 раз в секунду.
  // --------------------------------------------------------------------------
  const actions = usePlayerActions();
  const { currentTrack, isPlaying } = usePlayerTrack();

  if (tracks.length === 0) {
    return (
      <div className="term-panel p-6 text-center text-xs text-ink-muted">
        <div className="mb-2 text-2xl" aria-hidden="true">
          ░▒▓
        </div>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {tracks.map((track, index) => (
        <TrackRow
          // key — обязательный пропс при выводе списка в React.
          //
          // React использует key, чтобы понимать, какой элемент списка
          // соответствует какому компоненту. Без key он сравнивает элементы
          // по позиции, и при удалении/сортировке состояние «съезжает».
          //
          // ВАЖНО: никогда не используй индекс массива как key, если список
          // может меняться местами. id из базы — правильный выбор.
          key={track.id}
          track={track}
          index={index}
          isCurrent={currentTrack?.id === track.id}
          isPlaying={isPlaying}
          playlistId={playlistId}
          onPlay={() => actions.playQueue(tracks, index)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// ОДНА СТРОКА СПИСКА
// ----------------------------------------------------------------------------
// Компонент объявлен в том же файле, а не в отдельном. Это нормально и
// даже полезно, когда компоненты тесно связаны и второй больше нигде
// не используется: читающему не надо прыгать между файлами.
//
// Как только TrackRow понадобится в другом месте — вынесем в свой файл.
// ============================================================================

type TrackRowProps = {
  track: TrackDTO;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  playlistId?: number;
  onPlay: () => void;
};

function TrackRow({ track, index, isCurrent, isPlaying, playlistId, onPlay }: TrackRowProps) {
  const router = useRouter();

  /**
   * Убирает трек из плейлиста.
   * Кнопка показывается только на странице плейлиста (когда передан playlistId).
   */
  const handleRemoveFromPlaylist = (event: React.MouseEvent) => {
    // Не даём клику дойти до строки — иначе начнётся воспроизведение.
    event.stopPropagation();
    if (!playlistId) return;

    void fetch(`/api/playlists/${playlistId}/tracks?trackId=${track.id}`, { method: "DELETE" })
      .then(() => router.refresh())
      .catch(() => undefined);
  };

  return (
    <div
      // ----------------------------------------------------------------------
      // data-playing — свойство-атрибут, по которому CSS красит строку
      // (см. .track-row[data-playing="true"] в globals.css).
      //
      // Почему data-атрибут, а не класс? Потому что это СОСТОЯНИЕ, а не
      // оформление. Разделение смысла и вида — хорошая привычка.
      //
      // ВАЖНО: React рендерит data-атрибуты только если значение — строка.
      // Boolean true он молча выбросит (это частая ловушка), поэтому
      // приводим к строке через String(...).
      // ----------------------------------------------------------------------
      className="track-row grid-cols-[2rem_2.5rem_1fr_auto] md:grid-cols-[2rem_2.5rem_1fr_10rem_4.5rem_auto]"
      data-playing={String(isCurrent)}
      // ----------------------------------------------------------------------
      // ДОСТУПНОСТЬ: строка списка работает как кнопка, значит должна
      // быть доступна с клавиатуры (Tab) и «нажиматься» Enter или пробелом.
      //
      //   role="button"   — сообщает скринридеру, что это кнопка
      //   tabIndex={0}    — делает элемент фокусируемым с клавиатуры
      //   onKeyDown       — обрабатывает нажатие клавиш
      //
      // Без этого мышью пользоваться можно, а с клавиатуры — нет, и это
      // грубое нарушение доступности.
      // ----------------------------------------------------------------------
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          // preventDefault нужен для пробела: иначе браузер прокрутит страницу.
          event.preventDefault();
          onPlay();
        }
      }}
    >
      {/* --- Колонка 1: номер или индикатор воспроизведения ---------------- */}
      <div className="text-[11px] text-ink-muted text-center tabular-nums">
        {isCurrent ? (
          // Раньше здесь была анимированная ASCII-полоска. Статичный
          // символ выбран сознательно: анимация на каждой строке отвлекает
          // и нагружает браузер. Строка уже подсвечена фоном.
          <span className="text-accent glow" aria-label={isPlaying ? "играет" : "на паузе"}>
            {isPlaying ? "▶" : "❚❚"}
          </span>
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </div>

      {/* --- Колонка 2: обложка ------------------------------------------- */}
      <CoverArt trackId={track.id} hasCover={track.hasCover} size={32} alt={`Обложка: ${track.album}`} />

      {/* --- Колонка 3: название и исполнитель ---------------------------- */}
      {/*
        min-w-0 — КРИТИЧНО ВАЖНЫЙ класс.

        По умолчанию флекс- и грид-элементы имеют min-width: auto, то есть
        не сжимаются меньше своего содержимого. Длинное название песни
        распирало бы всю таблицу и ломало вёрстку.

        min-w-0 разрешает сжатие, и тогда срабатывает truncate (обрезка
        с многоточием).
      */}
      <div className="min-w-0">
        <div className={`truncate text-[13px] ${isCurrent ? "text-accent glow" : "text-ink"}`} title={track.title}>
          {track.title}
        </div>
        <div className="truncate text-[11px] text-ink-muted">
          {track.artist}
          {/* На узких экранах альбом показываем под исполнителем, потому что
              отдельная колонка не помещается. */}
          <span className="md:hidden"> · {track.album}</span>
        </div>
      </div>

      {/* --- Колонка 4: альбом (только на широких экранах) ----------------- */}
      <div className="hidden md:block min-w-0 truncate text-[11px] text-ink-muted" title={track.album}>
        {track.album}
        {track.year > 0 && <span className="text-ink-faint"> · {track.year}</span>}
      </div>

      {/* --- Колонка 5: длительность и размер ------------------------------ */}
      <div className="text-[11px] text-ink-muted tabular-nums text-right">
        {formatDuration(track.duration)}
        {/* Размер файла виден только на очень широких экранах: это
            второстепенная информация. */}
        <span className="hidden xl:inline text-ink-faint"> · {formatFileSize(track.size)}</span>
      </div>

      {/* --- Колонка 6: действия ------------------------------------------ */}
      <div className="flex items-center gap-2 justify-end">
        <FavoriteButton trackId={track.id} isFavorite={track.isFavorite} />

        {playlistId !== undefined && (
          <button
            type="button"
            onClick={handleRemoveFromPlaylist}
            className="term-btn term-btn-danger !px-2 !py-0.5 !text-[10px]"
            title="Убрать из плейлиста"
            aria-label="Убрать из плейлиста"
          >
            ✕
          </button>
        )}

        <AddToPlaylistButton trackId={track.id} />
      </div>
    </div>
  );
}
