"use client";

// ============================================================================
// src/components/library/ScanButton.tsx — КНОПКА «СКАНИРОВАТЬ БИБЛИОТЕКУ».
// ----------------------------------------------------------------------------
// Запускает POST /api/scan и показывает отчёт.
//
// Это пример классического асинхронного действия с индикацией состояния:
// пользователь должен видеть, что программа работает, иначе он нажмёт
// кнопку второй раз.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ScanResultDTO } from "@/lib/types";

export function ScanButton() {
  const router = useRouter();

  // Три состояния экрана: простаивает / сканирует / показывает отчёт.
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<ScanResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = () => {
    // Защита от двойного запуска: пока идёт один скан, второй не начинаем.
    // Это важно, потому что одновременно работающие сканеры подерутся
    // за базу данных и наделают дублей.
    if (isScanning) return;

    setIsScanning(true);
    setResult(null);
    setError(null);

    void fetch("/api/scan", { method: "POST" })
      .then(async (response) => {
        const data = (await response.json()) as ScanResultDTO | { error: string };

        // Проверяем HTTP-статус. Ответ 500 тоже содержит JSON — но с полем error.
        if (!response.ok) {
          throw new Error("error" in data ? data.error : "Не удалось выполнить сканирование");
        }

        setResult(data as ScanResultDTO);

        // ------------------------------------------------------------------
        // router.refresh() заново выполняет Server Components — и список
        // треков на странице обновляется свежими данными из базы.
        //
        // Обрати внимание: нам НЕ нужно вручную перезапрашивать треки и
        // складывать их в состояние. Серверный компонент сделает это сам.
        // Это одно из главных удобств архитектуры с Server Components.
        // ------------------------------------------------------------------
        router.refresh();
      })
      .catch((scanError: unknown) => {
        setError(scanError instanceof Error ? scanError.message : "Ошибка сканирования");
      })
      .finally(() => setIsScanning(false));
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="term-btn"
        onClick={handleScan}
        disabled={isScanning}
        // aria-busy сообщает вспомогательным технологиям, что идёт работа.
        aria-busy={isScanning}
      >
        {isScanning ? (
          <>
            {/* Простейшая текстовая «вертушка». Настоящий прогресс-бар
                потребовал бы SSE или WebSocket — в ТЗ это не нужно. */}
            <span aria-hidden="true">▓▒░</span> СКАНИРОВАНИЕ…
          </>
        ) : (
          <>⟳ СКАНИРОВАТЬ</>
        )}
      </button>

      {/* ---------------- Отчёт о сканировании ---------------- */}
      {result && (
        <div className="term-panel p-2 text-[10px] leading-relaxed">
          <div className="text-accent-2">
            [ СКАН ЗАВЕРШЁН ЗА {(result.durationMs / 1000).toFixed(2)} С ]
          </div>
          <div className="text-ink">найдено файлов: {result.filesFound}</div>
          <div className="text-ink">добавлено: {result.added}</div>
          <div className="text-ink">обновлено: {result.updated}</div>
          <div className="text-ink">без изменений: {result.skipped}</div>
          {result.removed > 0 && <div className="text-alert">удалено: {result.removed}</div>}

          {result.errors.length > 0 && (
            <div className="mt-1 text-alert">
              ошибок: {result.errors.length}
              {/* Показываем первые три — чтобы отчёт не разросся на полэкрана. */}
              {result.errors.slice(0, 3).map((message) => (
                <div key={message} className="truncate" title={message}>
                  ⚠ {message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="term-panel border-alert p-2 text-[10px] text-alert">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
