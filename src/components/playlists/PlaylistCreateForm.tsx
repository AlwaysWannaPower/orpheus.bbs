"use client";

// ============================================================================
// src/components/playlists/PlaylistCreateForm.tsx — СОЗДАНИЕ ПЛЕЙЛИСТА.
// ----------------------------------------------------------------------------
// Пример работы с формой: отправка по Enter, блокировка кнопки во время
// запроса, обработка ошибок и очистка поля после успеха.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlaylistCreateForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * handleSubmit принимает событие формы.
   *
   * ── ЗАЧЕМ preventDefault ─────────────────────────────────────────────────
   * По умолчанию отправка формы заставляет браузер ПЕРЕЗАГРУЗИТЬ страницу
   * и уйти на адрес из атрибута action. Для одностраничного приложения это
   * катастрофа: вся загрузка заново, музыка останавливается.
   *
   * preventDefault() отменяет стандартное поведение, и мы сами решаем,
   * что делать.
   */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = name.trim();
    if (trimmed === "" || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    void fetch("/api/playlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Не удалось создать плейлист");
        }
        // Успех: чистим поле и обновляем данные с сервера,
        // чтобы новый плейлист появился в списке.
        setName("");
        router.refresh();
      })
      .catch((submitError: unknown) => {
        setError(submitError instanceof Error ? submitError.message : "Ошибка");
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          type="text"
          className="term-input !py-1 !text-[11px]"
          placeholder="новый плейлист…"
          value={name}
          onChange={(event) => setName(event.target.value)}
          // maxLength — простая защита: не даём ввести 10 000 символов.
          // Сервер тоже проверяет длину (см. /api/playlists), и это правильно:
          // клиентская проверка для удобства, серверная — для безопасности.
          maxLength={100}
          aria-label="Название нового плейлиста"
        />
        <button
          type="submit"
          className="term-btn !px-2"
          disabled={isSubmitting || name.trim() === ""}
          aria-label="Создать плейлист"
          title="Создать плейлист"
        >
          {isSubmitting ? "…" : "＋"}
        </button>
      </div>

      {error && (
        <div role="alert" className="text-[10px] text-alert">
          ⚠ {error}
        </div>
      )}
    </form>
  );
}
