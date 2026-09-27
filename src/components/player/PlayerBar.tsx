"use client";

// ============================================================================
// src/components/player/PlayerBar.tsx — ПАНЕЛЬ ПЛЕЕРА ВНИЗУ ЭКРАНА.
// ----------------------------------------------------------------------------
// Здесь собраны все элементы управления: обложка, название, транспорт,
// полоса перемотки, громкость, режимы повтора и перемешивания.
//
// Панель закреплена внизу (position: sticky) и видна на всех страницах,
// потому что живёт в корневом layout.
// ============================================================================

import { useEffect } from "react";

import { usePlayerActions, usePlayerTimeline, usePlayerTrack } from "@/components/player/player-context";
import { CoverArt } from "@/components/ui/CoverArt";
import { formatDuration } from "@/lib/format";

export function PlayerBar() {
  // Три подписки — но панель и есть тот единственный компонент, которому
  // нужно всё сразу, включая быстро меняющееся время.
  const { currentTrack, isPlaying, isLoading, error, repeat, shuffle, queueLength, queuePosition } = usePlayerTrack();
  const { currentTime, duration, volume, muted } = usePlayerTimeline();
  const actions = usePlayerActions();

  // --------------------------------------------------------------------------
  // ГОРЯЧИЕ КЛАВИШИ.
  //
  // Глобальные обработчики вешаются на window в useEffect. Всё, что
  // подписывается на события, обязано отписаться при размонтировании —
  // иначе получим утечку памяти и «призрачные» обработчики.
  //
  // Аргумент [actions] означает: пересоздать подписку, если действия
  // изменились. Так как они стабильны, подписка создаётся один раз.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ----------------------------------------------------------------------
      // ГЛАВНАЯ ПРОВЕРКА: не мешаем ли мы пользователю печатать.
      //
      // Если фокус стоит в поле поиска и пользователь нажал пробел, он
      // ожидает пробел в тексте, а не паузу в музыке. Поэтому проверяем,
      // куда направлено событие.
      //
      // event.target — элемент, получивший событие.
      // tagName содержит имя тега В ВЕРХНЕМ РЕГИСТРЕ ("INPUT", "TEXTAREA").
      // ----------------------------------------------------------------------
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditing =
        tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;

      if (isEditing) return;

      // Не перехватываем сочетания с Ctrl/Cmd/Alt: там свои горячие клавиши
      // (Ctrl+R — перезагрузка, Cmd+L — адресная строка).
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case " ":
          // preventDefault обязателен: пробел по умолчанию прокручивает
          // страницу вниз, и без этого музыка ставилась бы на паузу,
          // а страница одновременно прыгала.
          event.preventDefault();
          actions.toggle();
          break;

        case "ArrowRight":
          event.preventDefault();
          // Перемотка вперёд на 5 секунд от текущей позиции.
          actions.seek(currentTime + 5);
          break;

        case "ArrowLeft":
          event.preventDefault();
          actions.seek(currentTime - 5);
          break;

        case "ArrowUp":
          event.preventDefault();
          // Шаг громкости 5%. Округление до сотых убирает накопление
          // ошибки сложения дробных чисел (0.1 + 0.2 ≠ 0.3 в JS!).
          actions.setVolume(Math.round((volume + 0.05) * 100) / 100);
          break;

        case "ArrowDown":
          event.preventDefault();
          actions.setVolume(Math.round((volume - 0.05) * 100) / 100);
          break;

        case "n":
        case "N":
          actions.next();
          break;

        case "p":
        case "P":
          actions.previous();
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, currentTime, volume]);

  // Процент проигранного — для подписи и для ширины «залитой» части полосы.
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <footer
      // ------------------------------------------------------------------------
      // sticky bottom-0 — панель «прилипает» к низу экрана при прокрутке.
      // z-40 — выше контента, но ниже оверлея со сканирующими линиями (z-50).
      // ------------------------------------------------------------------------
      className="sticky bottom-0 z-40 term-panel border-t-2 border-line-strong bg-canvas/95 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-[1600px] px-3 py-2">
        {/* ================= ВЕРХНЯЯ СТРОКА: ИНФО О ТРЕКЕ =================== */}
        <div className="flex items-center gap-3">
          {currentTrack ? (
            <CoverArt trackId={currentTrack.id} hasCover={currentTrack.hasCover} size={40} alt={`Обложка: ${currentTrack.album}`} />
          ) : (
            <div className="w-10 h-10 border border-line flex items-center justify-center text-ink-faint">♪</div>
          )}

          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-ink glow">
              {currentTrack ? currentTrack.title : "НЕТ АКТИВНОГО ТРЕКА"}
            </div>
            <div className="truncate text-[11px] text-ink-muted">
              {currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : "выбери песню в библиотеке"}
            </div>
          </div>

          {/* Индикатор состояния: загрузка / играет / пауза */}
          <div className="hidden sm:block text-[10px] text-ink-muted tabular-nums">
            {isLoading ? "[ БУФЕРИЗАЦИЯ ]" : isPlaying ? "[ ВОСПРОИЗВЕДЕНИЕ ]" : "[ ПАУЗА ]"}
          </div>

          {/* Позиция в очереди, например 3/25 */}
          {queueLength > 0 && (
            <div className="hidden md:block text-[10px] text-ink-muted tabular-nums">
              {queuePosition}/{queueLength}
            </div>
          )}
        </div>

        {/* ================= СРЕДНЯЯ СТРОКА: ПЕРЕМОТКА ====================== */}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-ink-muted tabular-nums w-10 text-right">{formatDuration(currentTime)}</span>

          <SeekBar
            value={currentTime}
            max={duration}
            percent={progressPercent}
            disabled={!currentTrack}
            onChange={(seconds) => actions.seek(seconds)}
          />

          <span className="text-[10px] text-ink-muted tabular-nums w-10">{formatDuration(duration)}</span>
        </div>

        {/* ================= НИЖНЯЯ СТРОКА: КНОПКИ ========================== */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          {/* --- Транспорт --- */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="term-btn"
              onClick={actions.previous}
              disabled={!currentTrack}
              title="Предыдущий трек (P)"
              aria-label="Предыдущий трек"
            >
              ◀◀
            </button>

            <button
              type="button"
              className="term-btn !px-3"
              onClick={actions.toggle}
              disabled={!currentTrack}
              title="Играть / пауза (пробел)"
              aria-label={isPlaying ? "Пауза" : "Играть"}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>

            <button
              type="button"
              className="term-btn"
              onClick={actions.next}
              disabled={!currentTrack}
              title="Следующий трек (N)"
              aria-label="Следующий трек"
            >
              ▶▶
            </button>

            <button
              type="button"
              className="term-btn"
              onClick={actions.stop}
              disabled={!currentTrack}
              title="Стоп"
              aria-label="Стоп"
            >
              ■
            </button>
          </div>

          {/* --- Режимы --- */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`term-btn ${shuffle ? "!border-accent-2 !text-accent-2" : ""}`}
              onClick={actions.toggleShuffle}
              // aria-pressed сообщает скринридеру состояние переключателя.
              aria-pressed={shuffle}
              title="Перемешивание"
              aria-label="Перемешивание"
            >
              ⤨
              <span className="hidden lg:inline text-[9px]">{shuffle ? "ВКЛ" : "ВЫКЛ"}</span>
            </button>

            <button
              type="button"
              className={`term-btn ${repeat !== "off" ? "!border-accent-2 !text-accent-2" : ""}`}
              onClick={actions.cycleRepeat}
              title="Повтор: выкл → весь список → один трек"
              aria-label={`Режим повтора: ${repeat === "off" ? "выключен" : repeat === "all" ? "весь список" : "один трек"}`}
            >
              {repeat === "one" ? "↻1" : "↻"}
              <span className="hidden lg:inline text-[9px]">
                {repeat === "off" ? "ВЫКЛ" : repeat === "all" ? "ВСЁ" : "ТРЕК"}
              </span>
            </button>
          </div>

          {/* --- Громкость --- */}
          <div className="flex items-center gap-2 min-w-[140px]">
            <button
              type="button"
              className="term-btn !px-2"
              onClick={actions.toggleMute}
              aria-pressed={muted}
              title="Без звука"
              aria-label={muted ? "Включить звук" : "Выключить звук"}
            >
              {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
            </button>

            <input
              type="range"
              className="term-range"
              // ------------------------------------------------------------------
              // min/max/step — границы ползунка.
              // Шаг 0.01 (1%) даёт достаточно плавную регулировку.
              // ------------------------------------------------------------------
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => actions.setVolume(Number(event.target.value))}
              aria-label="Громкость"
              title={`Громкость: ${Math.round(volume * 100)}%`}
            />
            <span className="text-[10px] text-ink-muted tabular-nums w-8">{Math.round(volume * 100)}%</span>
          </div>
        </div>

        {/* ================= ОШИБКА ========================================= */}
        {error && (
          <div
            // role="alert" заставляет скринридер прочитать сообщение
            // немедленно, прервав текущее — для ошибок это правильно.
            role="alert"
            className="mt-1 border border-alert px-2 py-1 text-[11px] text-alert"
          >
            ⚠ {error}
          </div>
        )}
      </div>
    </footer>
  );
}

// ============================================================================
// ПОЛОСА ПЕРЕМОТКИ
// ----------------------------------------------------------------------------
// За внешний вид отвечает сам <input type="range">, а мы рисуем поверх него
// «залитую» часть — визуальную подсказку, сколько уже проиграно.
//
// Почему не наоборот (сначала полоса, потом невидимый input)? Потому что
// тогда пришлось бы вручную реализовывать перетаскивание, поддержку
// клавиатуры, доступность. Используя настоящий input, мы получаем всё это
// бесплатно от браузера.
// ============================================================================

type SeekBarProps = {
  value: number;
  max: number;
  percent: number;
  disabled: boolean;
  onChange: (seconds: number) => void;
};

function SeekBar({ value, max, percent, disabled, onChange }: SeekBarProps) {
  return (
    <div className="relative flex-1 flex items-center h-5">
      {/* Фоновая дорожка */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[6px] bg-surface-2 border border-line-strong pointer-events-none" />

      {/* Проигранная часть. Ширина задаётся в процентах.
          pointer-events-none, чтобы полоска не мешала кликам по ползунку. */}
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-[6px] bg-accent pointer-events-none"
        style={{ width: `${percent}%` }}
      />

      {/* Настоящий ползунок — прозрачный, но полностью рабочий.
          Он находится ВЫШЕ нарисованных полос (z-10), чтобы принимать клики. */}
      <input
        type="range"
        className="term-range relative z-10"
        min={0}
        // max не может быть нулём: браузер не позволит. Если длительность
        // ещё неизвестна, ставим 1 — ползунок просто будет в начале.
        max={max > 0 ? max : 1}
        // step="any" разрешает дробные значения — важно для секунд с долями.
        step="any"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Позиция воспроизведения"
        aria-valuetext={`${formatDuration(value)} из ${formatDuration(max)}`}
      />
    </div>
  );
}
