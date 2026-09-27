// ============================================================================
// src/app/history/page.tsx — ИСТОРИЯ ПРОСЛУШИВАНИЙ.
// ----------------------------------------------------------------------------
// Три блока:
//   1. «Недавно слушали» — уникальные треки без повторов;
//   2. «Топ по прослушиваниям» — маленькая аналитическая витрина
//      (GROUP BY + COUNT, ровно как в dbt-модели);
//   3. Полный журнал событий с датами.
//
// Все три запроса идут параллельно через Promise.all, потому что они
// не зависят друг от друга.
// ============================================================================

import type { Metadata } from "next";

import { HistoryList } from "@/components/history/HistoryList";
import { BRANDING } from "@/config/branding";
import { RecentlyPlayed } from "@/components/history/RecentlyPlayed";
import { TopTracks } from "@/components/history/TopTracks";
import { listHistory, listRecentlyPlayedTracks, listTopTracks } from "@/lib/db/history-queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Имя проекта берём из BRANDING: оно объявлено ровно в одном месте
  // (src/config/branding.ts) и не может разъехаться по файлам.
  title: `История — ${BRANDING.name}`,
};

export default async function HistoryPage() {
  // --------------------------------------------------------------------------
  // ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА.
  //
  // Если бы мы написали три await подряд, каждый ждал бы предыдущего.
  // Promise.all запускает все три одновременно и ждёт завершения всех.
  //
  // Временная сложность: не сумма времён, а МАКСИМУМ из них.
  // --------------------------------------------------------------------------
  const [history, recentlyPlayed, topTracks] = await Promise.all([
    listHistory(100),
    listRecentlyPlayedTracks(12),
    listTopTracks(10),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <section className="term-panel p-3">
        <h2 className="term-title mb-1">{"// ИСТОРИЯ ПРОСЛУШИВАНИЙ"}</h2>
        <p className="text-[10px] text-ink-muted">
          Записей в журнале: {history.length}. Событие записывается, когда трек реально начал звучать.
        </p>
      </section>

      {/* Недавно слушали — только если есть данные. */}
      {recentlyPlayed.length > 0 && <RecentlyPlayed tracks={recentlyPlayed} />}

      {/* Топ треков — если есть хотя бы одно прослушивание. */}
      {topTracks.length > 0 && <TopTracks tracks={topTracks} />}

      <HistoryList entries={history} />
    </div>
  );
}
