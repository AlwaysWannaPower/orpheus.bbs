"use client";

// ============================================================================
// src/components/library/SortSelect.tsx — ВЫБОР СОРТИРОВКИ.
// ----------------------------------------------------------------------------
// Тот же принцип, что и в поиске: выбранная сортировка живёт в URL,
// сервер читает её и сортирует данные в SQL (ORDER BY), а не в браузере.
//
// Такой подход ещё называют «серверная сортировка». Он единственно верный
// при больших объёмах: сортировать 5000 записей на клиенте — тратить
// время пользователя впустую.
// ============================================================================

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { TrackSortKey } from "@/lib/types";

/** Варианты сортировки. Массив объектов — удобно выводить и хранить подписи. */
const SORT_OPTIONS: Array<{ value: TrackSortKey; label: string }> = [
  { value: "added_desc", label: "недавно добавленные" },
  { value: "title_asc", label: "по названию" },
  { value: "artist_asc", label: "по исполнителю" },
  { value: "album_asc", label: "по альбому" },
  { value: "duration_desc", label: "по длительности" },
];

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Текущее значение из URL. `?? "added_desc"` — значение по умолчанию,
  // если параметра в адресе нет.
  const currentSort = searchParams.get("sort") ?? "added_desc";

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", event.target.value);

    // Здесь push уместнее, чем replace? Нет — тоже replace.
    // Сортировка не настолько значимое действие, чтобы забаррикадировать
    // историю браузера. Но при желании легко поменять на push.
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <label className="flex items-center gap-2 text-[10px] text-ink-muted uppercase tracking-wider">
      <span className="hidden sm:inline">сортировка</span>
      {/*
        <select> — нативный элемент. Он выглядит по-разному в разных ОС,
        и полностью стилизовать его нельзя. Зато:
          * работает с клавиатуры «из коробки»;
          * на телефоне открывает системный «барабан» выбора;
          * доступен для скринридеров без единой строчки кода.
        Для выбора из списка это правильный выбор — не изобретай свой
        выпадающий список, если хватает нативного.
      */}
      <select
        className="term-input !w-auto !py-1 text-[11px] cursor-pointer"
        value={currentSort}
        onChange={handleChange}
        aria-label="Сортировка треков"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-canvas text-ink">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
