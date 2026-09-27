"use client";

// ============================================================================
// src/components/library/FavoriteButton.tsx — КНОПКА «В ИЗБРАННОЕ».
// ----------------------------------------------------------------------------
// Здесь показан полный цикл изменения данных на клиенте:
//     1. пользователь жмёт кнопку;
//     2. мы ОПТИМИСТИЧНО меняем значение в интерфейсе (не дожидаясь сервера);
//     3. отправляем запрос;
//     4. если сервер ответил ошибкой — откатываем изменение назад.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type FavoriteButtonProps = {
  trackId: number;
  isFavorite: boolean;
  /** Компактный вариант — только звёздочка, без подписи. */
  compact?: boolean;
};

export function FavoriteButton({ trackId, isFavorite, compact = true }: FavoriteButtonProps) {
  const router = useRouter();

  // --------------------------------------------------------------------------
  // ЛОКАЛЬНОЕ СОСТОЯНИЕ вместо прямого использования пропса.
  //
  // Зачем дублировать? Чтобы кнопка отреагировала МГНОВЕННО, не дожидаясь
  // ответа сервера и повторного рендера страницы. Такой приём называется
  // ОПТИМИСТИЧНЫМ ОБНОВЛЕНИЕМ (optimistic update): мы предполагаем, что
  // всё пройдёт хорошо, и показываем результат сразу.
  //
  // Начальное значение берём из пропса — данные уже пришли с сервера.
  // --------------------------------------------------------------------------
  const [optimisticValue, setOptimisticValue] = useState(isFavorite);

  // useTransition помечает обновление как «не срочное». React может
  // отложить перерисовку, если пользователь в это время что-то делает.
  // isPending — идёт ли переход/обновление прямо сейчас.
  const [isPending, startTransition] = useTransition();

  const handleClick = (event: React.MouseEvent) => {
    // Строка списка целиком кликабельна и запускает воспроизведение.
    // stopPropagation() не даёт клику «всплыть» до строки — иначе нажатие
    // на звёздочку запускало бы ещё и музыку. Это очень распространённая
    // ошибка, о которой стоит помнить.
    event.stopPropagation();

    const nextValue = !optimisticValue;
    setOptimisticValue(nextValue);

    void fetch(`/api/tracks/${trackId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFavorite: nextValue }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось сохранить");

        // ------------------------------------------------------------------
        // router.refresh() — перезапрашивает данные СЕРВЕРНЫХ компонентов.
        //
        // После изменения в базе страница должна показать новые данные.
        // refresh() заставляет Next.js заново выполнить Server Components,
        // не теряя состояние клиентских компонентов (в том числе плеер
        // НЕ останавливается и не сбрасывается).
        //
        // Это главное отличие от window.location.reload(), который
        // перезагрузил бы всю страницу и убил воспроизведение.
        //
        // startTransition(router.refresh) говорит React: «это обновление
        // можно делать в фоне, не блокируй интерфейс».
        // ------------------------------------------------------------------
        startTransition(() => router.refresh());
      })
      .catch(() => {
        // Откат: возвращаем то, что было до нажатия.
        setOptimisticValue(!nextValue);
      });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      // ----------------------------------------------------------------------
      // ДОСТУПНОСТЬ (a11y).
      //
      // aria-pressed сообщает скринридеру, что это кнопка-переключатель
      // и в каком состоянии она сейчас. Без этого незрячий пользователь
      // услышит просто «звезда» и не поймёт, добавлен трек или нет.
      //
      // title даёт всплывающую подсказку при наведении.
      // ----------------------------------------------------------------------
      aria-pressed={optimisticValue}
      aria-label={optimisticValue ? "Убрать из избранного" : "Добавить в избранное"}
      title={optimisticValue ? "Убрать из избранного" : "Добавить в избранное"}
      className={`shrink-0 leading-none transition-colors ${
        optimisticValue ? "text-accent-2" : "text-ink-faint hover:text-ink-muted"
      }`}
    >
      {/* Тот же символ, но форма разная — визуально понятнее, чем цвет. */}
      <span aria-hidden="true">{optimisticValue ? "★" : "☆"}</span>
      {!compact && <span className="ml-2 text-xs">{optimisticValue ? "В ИЗБРАННОМ" : "В ИЗБРАННОЕ"}</span>}
    </button>
  );
}
