"use client";

// ============================================================================
// src/components/playlists/PlaylistCard.tsx — КАРТОЧКА ПЛЕЙЛИСТА С УПРАВЛЕНИЕМ.
// ----------------------------------------------------------------------------
// Переименование, изменение описания и удаление.
//
// Здесь показан приём «инлайн-редактирование»: вместо отдельной страницы
// настройки пользователь правит название прямо на карточке. Это меньше
// кликов и меньше кода.
// ============================================================================

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { tracksLabel } from "@/lib/format";
import type { PlaylistDTO } from "@/lib/types";

export function PlaylistCard({ playlist }: { playlist: PlaylistDTO }) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Сохраняет новое имя. */
  const handleRename = () => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === playlist.name) {
      // Нечего сохранять — просто выходим из режима редактирования.
      setName(playlist.name);
      setIsEditing(false);
      return;
    }

    setIsBusy(true);
    setError(null);

    void fetch(`/api/playlists/${playlist.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Не удалось переименовать");
        }
        setIsEditing(false);
        router.refresh();
      })
      .catch((renameError: unknown) => {
        setError(renameError instanceof Error ? renameError.message : "Ошибка");
        setName(playlist.name);
      })
      .finally(() => setIsBusy(false));
  };

  /** Удаляет плейлист. */
  const handleDelete = () => {
    // window.confirm — простейшая защита от случайного удаления.
    // Она выглядит «из 90-х», что идеально подходит нашей стилистике :)
    // В серьёзном продукте сделали бы модальное окно, но confirm честно
    // решает задачу и не требует ни строчки кода интерфейса.
    const confirmed = window.confirm(`Удалить плейлист «${playlist.name}»?\n\nМузыкальные файлы не пострадают.`);
    if (!confirmed) return;

    setIsBusy(true);

    void fetch(`/api/playlists/${playlist.id}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось удалить");
        router.refresh();
      })
      .catch((deleteError: unknown) => {
        setError(deleteError instanceof Error ? deleteError.message : "Ошибка");
      })
      .finally(() => setIsBusy(false));
  };

  return (
    <article className="term-panel p-3 flex flex-col gap-2">
      {isEditing ? (
        // ---------------- Режим редактирования ----------------
        <div className="flex gap-1">
          <input
            type="text"
            className="term-input !py-1 !text-[12px]"
            value={name}
            onChange={(event) => setName(event.target.value)}
            // Автофокус: пользователь уже выразил намерение редактировать,
            // лишний клик по полю ни к чему.
            autoFocus
            maxLength={100}
            aria-label="Новое название плейлиста"
            onKeyDown={(event) => {
              if (event.key === "Enter") handleRename();
              // Escape — отмена. Хороший тон: у любого действия должна быть
              // возможность отмены.
              if (event.key === "Escape") {
                setName(playlist.name);
                setIsEditing(false);
              }
            }}
          />
          <button type="button" className="term-btn !px-2" onClick={handleRename} disabled={isBusy}>
            ✓
          </button>
          <button
            type="button"
            className="term-btn !px-2"
            onClick={() => {
              setName(playlist.name);
              setIsEditing(false);
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        // ---------------- Обычный вид ----------------
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/playlists/${playlist.id}`}
            className="text-[13px] text-ink hover:text-accent-2 truncate"
            title={playlist.name}
          >
            {playlist.name}
          </Link>

          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              className="term-btn !px-2 !py-0.5 !text-[10px]"
              onClick={() => setIsEditing(true)}
              title="Переименовать"
              aria-label={`Переименовать плейлист ${playlist.name}`}
            >
              ✎
            </button>
            <button
              type="button"
              className="term-btn term-btn-danger !px-2 !py-0.5 !text-[10px]"
              onClick={handleDelete}
              disabled={isBusy}
              title="Удалить плейлист"
              aria-label={`Удалить плейлист ${playlist.name}`}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="text-[10px] text-ink-muted">{tracksLabel(playlist.trackCount)}</div>

      {error && (
        <div role="alert" className="text-[10px] text-alert">
          ⚠ {error}
        </div>
      )}
    </article>
  );
}
