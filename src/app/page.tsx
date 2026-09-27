// ============================================================================
// src/app/page.tsx — ГЛАВНАЯ СТРАНИЦА: БИБЛИОТЕКА.
// ----------------------------------------------------------------------------
// ЭТО СЕРВЕРНЫЙ КОМПОНЕНТ (Server Component).
//
// ── ЧТО ЗНАЧИТ «СЕРВЕРНЫЙ» ────────────────────────────────────────────────
// Такой компонент выполняется ТОЛЬКО на сервере и в браузер не попадает
// вообще: его код не уезжает пользователю. Он может:
//   * быть async и использовать await;
//   * обращаться к базе данных, файлам, переменным окружения;
//   * держать в себе секреты (ключи, пароли) — они не утекут.
//
// Чего он НЕ может:
//   * использовать useState / useEffect (это про браузер);
//   * обрабатывать клики (onClick);
//   * работать с window, document, localStorage.
//
// ── ГЛАВНАЯ ИДЕЯ ЭТОЙ СТРАНИЦЫ ───────────────────────────────────────────
// Фильтрация, поиск и сортировка происходят в БАЗЕ ДАННЫХ, а не в браузере.
// Серверный компонент получает параметры из URL, делает один SQL-запрос
// и отдаёт браузеру готовый список.
//
// Это заметно быстрее, чем грузить 5000 треков в браузер и фильтровать
// их там, и работает даже на слабом телефоне.
// ============================================================================

import { Suspense } from "react";
import Link from "next/link";

import { ContinueListening } from "@/components/library/ContinueListening";
import { ScanButton } from "@/components/library/ScanButton";
import { SearchBar } from "@/components/library/SearchBar";
import { SortSelect } from "@/components/library/SortSelect";
import { TrackList } from "@/components/library/TrackList";
import { getPlaybackState } from "@/lib/db/history-queries";
import { listTracks } from "@/lib/db/track-queries";
import { tracksLabel } from "@/lib/format";
import type { TrackSortKey } from "@/lib/types";

// ============================================================================
// ОБЪЯВЛЕНИЯ УРОВНЯ СЕГМЕНТА (route segment config).
// Эти константы Next.js читает и меняет поведение всей страницы.
// ============================================================================

/**
 * force-dynamic — рендерить страницу при КАЖДОМ запросе.
 *
 * Без этого Next попытался бы «заморозить» страницу при сборке. Но данные
 * меняются (пользователь добавил песню, нажал «избранное»), и статическая
 * страница показывала бы устаревшую библиотеку. К тому же во время сборки
 * база данных может быть ещё не создана.
 */
export const dynamic = "force-dynamic";

/** Допустимые значения сортировки — тот же список, что и в API. */
const ALLOWED_SORTS: readonly TrackSortKey[] = [
  "added_desc",
  "title_asc",
  "artist_asc",
  "album_asc",
  "duration_desc",
];

/**
 * Достаёт из searchParams одно строковое значение.
 *
 * ── ПОЧЕМУ НУЖНА ЭТА ФУНКЦИЯ ─────────────────────────────────────────────
 * Тип searchParams в Next.js: { [key: string]: string | string[] | undefined }.
 * Значение может быть МАССИВОМ, если в URL параметр повторён:
 *     ?search=атл&search=horus
 * Тогда браузер отдаст ["атл", "horus"], а наш код ждёт строку.
 * Функция честно обрабатывает все три случая.
 */
function readStringParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function LibraryPage({ searchParams }: PageProps<"/">) {
  // --------------------------------------------------------------------------
  // searchParams — это ПРОМИС (изменение Next.js 15).
  // Обязательно await, иначе получишь сам объект Promise вместо данных.
  // --------------------------------------------------------------------------
  const params = await searchParams;

  const search = readStringParam(params.search);
  const artistFilter = readStringParam(params.artist);
  const albumFilter = readStringParam(params.album);
  const favoritesOnly = readStringParam(params.favorites) === "true";
  const rawSort = readStringParam(params.sort);

  // Проверка значения на принадлежность списку разрешённых.
  // Приём называется TYPE GUARD (защитник типа): мы сужаем тип string
  // до конкретного набора литералов TrackSortKey.
  const sort: TrackSortKey =
    rawSort && (ALLOWED_SORTS as readonly string[]).includes(rawSort) ? (rawSort as TrackSortKey) : "added_desc";

  // --------------------------------------------------------------------------
  // ДВА НЕЗАВИСИМЫХ ЗАПРОСА К БАЗЕ.
  //
  // Promise.all запускает их ПАРАЛЛЕЛЬНО, а не по очереди. На SQLite
  // экономия микроскопическая, но привычка правильная: с внешними сервисами
  // это разница в секунды.
  //
  // Деструктуризация массива: порядок результатов совпадает с порядком
  // промисов в Promise.all.
  // --------------------------------------------------------------------------
  const [tracks, playbackState] = await Promise.all([
    listTracks({
      search,
      artist: artistFilter,
      album: albumFilter,
      favoritesOnly,
      sort,
      limit: 2000,
    }),
    getPlaybackState(),
  ]);

  const hasActiveFilter = Boolean(search || artistFilter || albumFilter || favoritesOnly);

  return (
    <div className="flex flex-col gap-3">
      {/* ===================== ПАНЕЛЬ УПРАВЛЕНИЯ ======================== */}
      <section className="term-panel p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="term-title whitespace-nowrap">{"// БИБЛИОТЕКА"}</h2>

          {/*
            ── ЗАЧЕМ SUSPENSE ────────────────────────────────────────────────
            SearchBar использует хук useSearchParams. Next.js требует, чтобы
            такие компоненты были обёрнуты в <Suspense>: пока параметры URL
            неизвестны, показывается запасной вариант (fallback).

            На практике это выглядит как «поле ввода появилось чуть позже».
          */}
          <Suspense fallback={<div className="flex-1 term-input opacity-50">&gt; загрузка…</div>}>
            <SearchBar />
          </Suspense>

          <Suspense fallback={null}>
            <SortSelect />
          </Suspense>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            Фильтр «все / только избранное» реализован простыми ссылками.
            Ссылка меняет URL → серверный компонент перечитывает данные.
            Никакого состояния в React для этого не нужно.
          */}
          <FilterLink href="/" isActive={!favoritesOnly} label="ВСЕ" />
          <FilterLink href="/?favorites=true" isActive={favoritesOnly} label="★ ИЗБРАННОЕ" />

          <div className="ml-auto">
            <ScanButton />
          </div>
        </div>

        {/* Активные фильтры и кнопка сброса. */}
        {hasActiveFilter && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-accent-2">
            <span>[ ФИЛЬТР АКТИВЕН ]</span>
            {search && <span>поиск: «{search}»</span>}
            {artistFilter && <span>исполнитель: {artistFilter}</span>}
            {albumFilter && <span>альбом: {albumFilter}</span>}
            <Link href="/" className="underline hover:text-ink">
              сбросить
            </Link>
          </div>
        )}

        <div className="text-[10px] text-ink-muted">
          найдено: {tracksLabel(tracks.length)}
          {tracks.length >= 2000 && " (показаны первые 2000)"}
        </div>
      </section>

      {/* ===================== ПРОДОЛЖИТЬ СЛУШАТЬ ======================= */}
      {/* Показываем блок, только если есть что продолжать. */}
      {playbackState.track && <ContinueListening track={playbackState.track} position={playbackState.position} />}

      {/* ===================== СПИСОК ТРЕКОВ =========================== */}
      <section className="term-panel p-2">
        {/* Заголовок «шапки таблицы» — только для широких экранов. */}
        <div className="hidden md:grid grid-cols-[2rem_2.5rem_1fr_10rem_4.5rem_auto] gap-3 px-2 pb-2 text-[9px] uppercase tracking-widest text-ink-faint border-b border-line">
          <div className="text-center">#</div>
          <div />
          <div>название / исполнитель</div>
          <div>альбом</div>
          <div className="text-right">время</div>
          <div />
        </div>

        <TrackList
          tracks={tracks}
          emptyMessage={
            hasActiveFilter
              ? "НИЧЕГО НЕ НАЙДЕНО. Попробуй изменить запрос или сбросить фильтры."
              : "БИБЛИОТЕКА ПУСТА. Нажми «СКАНИРОВАТЬ» — плеер обойдёт папку music/ и прочитает теги файлов."
          }
        />
      </section>
    </div>
  );
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЙ КОМПОНЕНТ: КНОПКА-ФИЛЬТР.
// ----------------------------------------------------------------------------
// Это НЕ клиентский компонент: он не содержит состояния и обработчиков,
// только ссылку.
//
// Клик меняет URL → Next.js заново выполняет серверный компонент → данные
// приходят уже отфильтрованные. Такой приём называют «навигация как
// изменение состояния», и он бесплатно даёт: работу кнопки «назад»,
// возможность поделиться ссылкой и отсутствие лишнего JavaScript.
//
// Почему <Link>, а не <a>: Link делает «мягкий» переход без полной
// перезагрузки страницы. Перезагрузка остановила бы музыку — а это ровно то,
// чего мы весь проект старались избежать.
// ============================================================================

function FilterLink({ href, isActive, label }: { href: string; isActive: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`term-btn ${isActive ? "!bg-accent !text-on-accent" : ""}`}
    >
      {label}
    </Link>
  );
}
