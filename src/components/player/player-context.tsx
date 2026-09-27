"use client";

// ============================================================================
// src/components/player/player-context.tsx — ЯДРО ПЛЕЕРА.
// ----------------------------------------------------------------------------
// Это САМЫЙ ВАЖНЫЙ файл всего проекта. Здесь живёт вся логика
// воспроизведения: очередь, play/pause, перемотка, громкость, следующий трек,
// повтор, перемешивание, сохранение позиции.
//
// ── ПОЧЕМУ "use client" ───────────────────────────────────────────────────
// Директива "use client" в самой первой строке помечает ВЕСЬ файл и всё, что
// он импортирует, как КЛИЕНТСКИЙ код. Такой код выполняется в браузере.
//
// Это обязательно, потому что нам нужны:
//   * хуки React (useState, useEffect, useRef) — они работают только в браузере;
//   * объект HTMLAudioElement — его на сервере не существует;
//   * доступ к DOM и к localStorage.
//
// ── АРХИТЕКТУРА: ПОЧЕМУ ТРИ КОНТЕКСТА, А НЕ ОДИН ──────────────────────────
// Соблазнительно положить всё состояние в один контекст. Но тогда ЛЮБОЕ
// изменение (например, currentTime, который обновляется 60 раз в секунду)
// перерисовывало бы ВСЕХ потребителей контекста — включая список из 1000
// треков. Это гарантированные тормоза.
//
// Поэтому состояние разделено по ЧАСТОТЕ ИЗМЕНЕНИЙ:
//
//   1. PlayerActionsContext   — только функции. Меняется никогда.
//                               Нужен строкам списка треков (кнопка «играть»).
//   2. PlayerTrackContext     — текущий трек + играет/нет + загрузка.
//                               Меняется раз в несколько минут.
//                               Нужен списку, чтобы подсветить играющую строку.
//   3. PlayerTimelineContext  — время, длительность, громкость.
//                               Меняется постоянно. Нужен ТОЛЬКО панели плеера.
//
// Приём «разделяй состояние по частоте изменений» стоит запомнить: он
// применим и в React, и в подписках, и в любом другом UI-фреймворке.
//
// ── ГДЕ ЖИВЁТ ПРОВАЙДЕР ───────────────────────────────────────────────────
// В корневом layout (src/app/layout.tsx). Благодаря этому <audio> НЕ
// пересоздаётся при переходах между страницами: музыка продолжает играть,
// пока ты листаешь библиотеку, плейлисты и историю.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { buildCoverUrl, buildStreamUrl } from "@/lib/stream-url";
import type { TrackDTO } from "@/lib/types";

// ============================================================================
// ТИПЫ
// ============================================================================

/** Режим повтора. Строковый union — «одно из трёх значений». */
export type RepeatMode = "off" | "all" | "one";

/** Что знает панель плеера о времени и звуке. Меняется часто. */
export type TimelineState = {
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
};

/** Что знает интерфейс о текущем треке. Меняется редко. */
export type TrackState = {
  currentTrack: TrackDTO | null;
  isPlaying: boolean;
  isLoading: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Сколько треков в очереди — для надписи «3 / 25». */
  queueLength: number;
  /** Позиция текущего трека в очереди, начиная с 1. 0 — если очереди нет. */
  queuePosition: number;
  error: string | null;
};

/** Функции управления плеером. Ссылки на них стабильны. */
export type PlayerActions = {
  /**
   * Запустить воспроизведение списка с указанной позиции.
   *
   * @param tracks   список треков
   * @param startIndex с какого трека начать (индекс в массиве)
   * @param startAtSeconds необязательно: начать не с нуля, а с этой секунды.
   *        Нужно для функции «продолжить слушать».
   */
  playQueue: (tracks: TrackDTO[], startIndex: number, startAtSeconds?: number) => void;
  /** Запустить один трек (очередь = [этот трек]). */
  playSingle: (track: TrackDTO) => void;
  /** Play / pause. */
  toggle: () => void;
  /** Следующий трек. */
  next: () => void;
  /** Предыдущий трек. */
  previous: () => void;
  /** Перемотать на секунду N. */
  seek: (seconds: number) => void;
  /** Установить громкость 0..1. */
  setVolume: (value: number) => void;
  /** Включить/выключить беззвучный режим. */
  toggleMute: () => void;
  /** Переключить режим повтора: off → all → one → off. */
  cycleRepeat: () => void;
  /** Включить/выключить перемешивание. */
  toggleShuffle: () => void;
  /** Остановить воспроизведение и сбросить позицию. */
  stop: () => void;
};

// ============================================================================
// КОНТЕКСТЫ
// ----------------------------------------------------------------------------
// createContext(null) создаёт «пустой» контекст. Значение null означает
// «вне провайдера ничего нет», и наши хуки это проверяют — так проще поймать
// ошибку «забыл обернуть приложение в PlayerProvider», чем получить
// непонятный undefined где-то в глубине.
// ============================================================================

const PlayerActionsContext = createContext<PlayerActions | null>(null);
const PlayerTrackContext = createContext<TrackState | null>(null);
const PlayerTimelineContext = createContext<TimelineState | null>(null);

// ============================================================================
// ХУКИ ДОСТУПА
// ----------------------------------------------------------------------------
// Компоненты не обращаются к контексту напрямую — они используют эти хуки.
// Плюсы: короче в местах использования, и проверка на null ровно в одном месте.
// ============================================================================

/** Получить функции управления плеером. */
export function usePlayerActions(): PlayerActions {
  const context = useContext(PlayerActionsContext);
  if (!context) {
    throw new Error("usePlayerActions нужно вызывать внутри <PlayerProvider>");
  }
  return context;
}

/** Получить информацию о текущем треке. */
export function usePlayerTrack(): TrackState {
  const context = useContext(PlayerTrackContext);
  if (!context) {
    throw new Error("usePlayerTrack нужно вызывать внутри <PlayerProvider>");
  }
  return context;
}

/** Получить время/громкость (используется только панелью плеера). */
export function usePlayerTimeline(): TimelineState {
  const context = useContext(PlayerTimelineContext);
  if (!context) {
    throw new Error("usePlayerTimeline нужно вызывать внутри <PlayerProvider>");
  }
  return context;
}

// ============================================================================
// ВСПОМОГАТЕЛЬНОЕ
// ============================================================================

/**
 * Перемешивает массив индексов 0..length-1.
 *
 * ── ПОЧЕМУ НЕ sort(() => Math.random() - 0.5) ─────────────────────────────
 * Этот «однострочник» встречается в интернете повсюду, но он НЕПРАВИЛЬНЫЙ:
 * распределение получается неравномерным, какие-то перестановки выпадают
 * чаще других. Для музыки это не критично, но знать ошибку полезно.
 *
 * Алгоритм Фишера–Йетса (он же «тасование Кнута») корректен и работает
 * за O(n): идём с конца массива, и для каждой позиции выбираем случайный
 * индекс от 0 до неё же и меняем элементы местами.
 */
function shuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, index) => index);

  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    // Деструктуризация для обмена значений без временной переменной:
    // [a, b] = [b, a]
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices;
}

/**
 * Переставляет текущий элемент в начало перемешанного порядка.
 *
 * ── ЗАЧЕМ ────────────────────────────────────────────────────────────────
 * Пользователь нажал на конкретную песню и включил shuffle. Ожидаемое
 * поведение — эта песня играет первой, а дальше порядок случайный.
 * Без этой правки перемешивание «отбросило» бы выбранный трек в середину.
 */
function putFirst(indices: number[], targetQueueIndex: number): number[] {
  const result = indices.slice();
  const position = result.indexOf(targetQueueIndex);
  if (position > 0) {
    [result[0], result[position]] = [result[position], result[0]];
  }
  return result;
}

// ============================================================================
// КОНСТАНТЫ НАСТРОЕК
// ============================================================================

/** Ключи localStorage. Префикс не даёт конфликтовать с другими сайтами. */
const STORAGE_VOLUME_KEY = "pmp.volume";
const STORAGE_REPEAT_KEY = "pmp.repeat";
const STORAGE_SHUFFLE_KEY = "pmp.shuffle";

/**
 * Безопасное чтение из localStorage.
 *
 * ── ПОЧЕМУ НУЖНА ОБЁРТКА ──────────────────────────────────────────────────
 * localStorage может быть недоступен: режим приватного окна в некоторых
 * браузерах, отключённые cookies, серверный рендеринг (на сервере window нет).
 * Обращение к нему без проверки роняет приложение.
 */
function readLocalStorage(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // Не смогли сохранить — не беда, это всего лишь настройка удобства.
  }
}

// ============================================================================
// ПРОВАЙДЕР
// ============================================================================

type PlayerProviderProps = {
  children: ReactNode;
  /**
   * Токен доступа к аудиопотоку.
   *
   * Приходит ПРОПСОМ С СЕРВЕРА (см. src/app/layout.tsx), а не из
   * переменной NEXT_PUBLIC_*. Причина простая: NEXT_PUBLIC_* подставляется
   * в код в момент СБОРКИ, а в Docker сборка идёт раньше, чем применяются
   * переменные окружения. Токен просто не успел бы существовать.
   *
   * Пустая строка означает, что проверка доступа выключена.
   */
  streamToken?: string;
};

export function PlayerProvider({ children, streamToken }: PlayerProviderProps) {
  // --------------------------------------------------------------------------
  // ССЫЛКА НА <audio>.
  //
  // useRef даёт «коробку», которая сохраняет значение между рендерами,
  // но НЕ вызывает перерисовку при изменении. Для DOM-узлов это идеально:
  // сам элемент уже живёт в DOM, React его не пересоздаёт.
  // --------------------------------------------------------------------------
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --------------------------------------------------------------------------
  // ОЧЕРЕДЬ ВОСПРОИЗВЕДЕНИЯ.
  //
  // Две сущности:
  //   queue — сам список треков (в исходном порядке, как в библиотеке);
  //   order — последовательность ИНДЕКСОВ в queue, задающая порядок игры.
  //
  // Зачем отдельный order, а не просто перемешать queue?
  // Потому что при выключении shuffle хочется вернуться к исходному порядку.
  // Если перемешать queue, исходный порядок потеряется навсегда.
  //
  // Пример: queue = [A, B, C, D], order = [2, 0, 3, 1]
  //         играем в порядке C → A → D → B.
  // --------------------------------------------------------------------------
  const [queue, setQueue] = useState<TrackDTO[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [orderPosition, setOrderPosition] = useState(0);

  // --------------------------------------------------------------------------
  // ОСНОВНОЕ СОСТОЯНИЕ
  // --------------------------------------------------------------------------
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // ССЫЛКИ ДЛЯ ОБРАБОТЧИКОВ СОБЫТИЙ.
  //
  // Обработчики событий <audio> вешаются ОДИН раз (useEffect с пустым списком
  // зависимостей). Такой обработчик «запоминает» значения из момента создания
  // — это называется ЗАМЫКАНИЕ (closure). Чтобы не пересоздавать подписки
  // при каждом изменении состояния, мы держим актуальные значения в ref'ах
  // и читаем их внутри обработчика. Ref всегда даёт свежее значение.
  // --------------------------------------------------------------------------
  const repeatRef = useRef<RepeatMode>("off");
  const shuffleRef = useRef(false);
  const orderRef = useRef<number[]>([]);
  const orderPositionRef = useRef(0);
  const queueRef = useRef<TrackDTO[]>([]);

  /** Играть ли автоматически после смены трека. */
  const shouldAutoplayRef = useRef(false);

  /** Какой трек уже записан в историю — чтобы не писать дважды. */
  const historyTrackIdRef = useRef<number | null>(null);

  /** Время последнего сохранения позиции (чтобы не писать в базу слишком часто). */
  const lastStateSaveRef = useRef(0);

  /**
   * Секунда, на которую нужно перемотать после загрузки трека.
   *
   * ── ЗАЧЕМ ОТДЕЛЬНАЯ ССЫЛКА, А НЕ ПРОСТО audio.currentTime ────────────────
   * Пока файл не загружен, браузер не знает его длительность, и установка
   * currentTime может «не прилипнуть». Поэтому мы запоминаем желаемую
   * позицию здесь, а применяем её в момент события loadedmetadata —
   * когда метаданные уже известны и перемотка сработает надёжно.
   */
  const pendingSeekRef = useRef<number | null>(null);

  const currentIndex = order[orderPosition] ?? -1;
  const currentTrack = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;

  // --------------------------------------------------------------------------
  // Синхронизация ref'ов с состоянием.
  // Этот эффект выполняется после каждого рендера, где изменились зависимости.
  // --------------------------------------------------------------------------
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    orderRef.current = order;
    orderPositionRef.current = orderPosition;
    queueRef.current = queue;
  }, [repeat, shuffle, order, orderPosition, queue]);

  /**
   * Отправляет текущую позицию воспроизведения на сервер.
   * Нужна для функции «продолжить слушать».
   */
  const savePlaybackStateToServer = useCallback((position: number) => {
    const track = queueRef.current[orderRef.current[orderPositionRef.current] ?? -1];
    if (!track) return;

    // void — «я сознательно не жду этот промис».
    // .catch(() => {}) — молча игнорируем ошибку: не сохранилось, не критично.
    void fetch("/api/playback-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId: track.id, position }),
    }).catch(() => undefined);
  }, []);

  // --------------------------------------------------------------------------
  // ЧТЕНИЕ СОХРАНЁННЫХ НАСТРОЕК ПРИ СТАРТЕ.
  //
  // ВАЖНО: это делается в useEffect, а не при инициализации useState.
  // Причина — серверный рендеринг. На сервере localStorage нет, значит
  // начальное значение будет одно (например, 1), а в браузере другое (0.5).
  // React пожалуется на «hydration mismatch» — несовпадение разметки.
  // Читаем настройки ПОСЛЕ первого рендера, в браузере.
  //
  // ── ПОЧЕМУ ЗДЕСЬ ОТКЛЮЧЕНО ПРАВИЛО ЛИНТЕРА ────────────────────────────────
  // ESLint (правило react-hooks/set-state-in-effect) справедливо предупреждает:
  // вызывать setState прямо в теле эффекта — обычно плохая идея, потому что
  // это вызывает лишний «каскадный» рендер.
  //
  // Но здесь случай особый: мы читаем данные из ВНЕШНЕГО источника
  // (localStorage), которого на сервере не существует. Другие способы решить
  // эту задачу хуже:
  //   * читать localStorage при инициализации useState → hydration mismatch,
  //     React перерисует всё дерево и выругается в консоли;
  //   * использовать useSyncExternalStore → корректно, но это заметно
  //     сложнее и для трёх настроек избыточно.
  //
  // Плата — ровно один дополнительный рендер при открытии страницы.
  // Мы сознательно её принимаем и явно об этом пишем.
  // --------------------------------------------------------------------------
  /* eslint-disable react-hooks/set-state-in-effect -- осознанное чтение localStorage после первого рендера, см. комментарий выше */
  useEffect(() => {
    const savedVolume = Number(readLocalStorage(STORAGE_VOLUME_KEY));
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
      setVolumeState(savedVolume);
    }

    const savedRepeat = readLocalStorage(STORAGE_REPEAT_KEY);
    if (savedRepeat === "off" || savedRepeat === "all" || savedRepeat === "one") {
      setRepeat(savedRepeat);
    }

    setShuffle(readLocalStorage(STORAGE_SHUFFLE_KEY) === "true");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --------------------------------------------------------------------------
  // ФУНКЦИИ УПРАВЛЕНИЯ.
  //
  // Все они обёрнуты в useCallback. Это нужно, чтобы ссылки на функции были
  // стабильными: контекст с действиями не должен меняться, иначе строки
  // списка треков будут перерисовываться на каждый чих.
  //
  // При включённом React Compiler он делает мемоизацию сам, но писать
  // useCallback всё равно полезно: код явнее и не зависит от настроек.
  // --------------------------------------------------------------------------

  /**
   * Ставит на воспроизведение трек с индексом startIndex внутри массива tracks.
   * Это самая используемая функция: её вызывают клики по строкам списка.
   */
  const playQueue = useCallback((tracks: TrackDTO[], startIndex: number, startAtSeconds?: number) => {
    if (tracks.length === 0) return;

    // Math.min/Math.max защищают от выхода за границы массива.
    const safeIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);

    // Запоминаем, куда перемотать после загрузки (если попросили).
    pendingSeekRef.current = startAtSeconds != null && startAtSeconds > 1 ? startAtSeconds : null;

    setQueue(tracks);

    if (shuffleRef.current) {
      // Порядок случайный, но выбранный трек — первым.
      setOrder(putFirst(shuffleIndices(tracks.length), safeIndex));
      setOrderPosition(0);
    } else {
      // Естественный порядок: 0, 1, 2, 3, ...
      setOrder(tracks.map((_, index) => index));
      setOrderPosition(safeIndex);
    }

    shouldAutoplayRef.current = true;
  }, []);

  /** Играть один трек (очередь из одного элемента). */
  const playSingle = useCallback(
    (track: TrackDTO) => {
      playQueue([track], 0);
    },
    [playQueue],
  );

  /** Play / pause текущего трека. */
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Если трек не выбран — ничего не делаем.
    if (!audio.src) return;

    if (audio.paused) {
      audio.play().catch(() => {
        setError("Не удалось начать воспроизведение");
      });
    } else {
      audio.pause();
      // При паузе сразу сохраняем позицию — вдруг пользователь уйдёт.
      savePlaybackStateToServer(audio.currentTime);
    }
  }, [savePlaybackStateToServer]);

  /** Переход к следующему треку. */
  const next = useCallback(() => {
    setOrderPosition((position) => {
      const total = orderRef.current.length;
      if (total === 0) return position;
      // Оператор % даёт «закольцованность»: после последнего идёт первый.
      return (position + 1) % total;
    });
    shouldAutoplayRef.current = true;
  }, []);

  /** Предыдущий трек. */
  const previous = useCallback(() => {
    const audio = audioRef.current;

    // Привычное поведение плееров: если трек играет дольше 3 секунд,
    // кнопка «назад» перематывает в начало, а не переключает трек.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    setOrderPosition((position) => {
      const total = orderRef.current.length;
      if (total === 0) return position;
      // +total перед % защищает от отрицательного числа.
      return (position - 1 + total) % total;
    });
    shouldAutoplayRef.current = true;
  }, []);

  /** Перемотка на указанную секунду. */
  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Зажимаем значение в допустимый диапазон [0, duration].
    const clamped = Math.min(Math.max(seconds, 0), audio.duration || 0);
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  /** Установка громкости с сохранением в localStorage. */
  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setVolumeState(clamped);
    // Если пользователь крутит громкость — снимаем режим «без звука».
    if (clamped > 0) setMuted(false);
    writeLocalStorage(STORAGE_VOLUME_KEY, String(clamped));
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  /** Повтор: off → all → one → off. */
  const cycleRepeat = useCallback(() => {
    setRepeat((current) => {
      const nextMode: RepeatMode = current === "off" ? "all" : current === "all" ? "one" : "off";
      writeLocalStorage(STORAGE_REPEAT_KEY, nextMode);
      return nextMode;
    });
  }, []);

  /**
   * Перемешивание.
   *
   * При включении перестраиваем order так, чтобы текущий трек остался первым:
   * пользователь не должен «прыгать» на другую песню в момент нажатия кнопки.
   */
  const toggleShuffle = useCallback(() => {
    const nextValue = !shuffleRef.current;
    // Сразу обновляем ref, чтобы последующие вызовы видели новое значение
    // (обновление state произойдёт чуть позже, асинхронно).
    shuffleRef.current = nextValue;
    setShuffle(nextValue);
    writeLocalStorage(STORAGE_SHUFFLE_KEY, String(nextValue));

    const currentOrder = orderRef.current;
    if (currentOrder.length === 0) return;

    // Индекс играющего трека в исходной очереди.
    const playingQueueIndex = currentOrder[orderPositionRef.current];

    if (nextValue) {
      setOrder(putFirst(shuffleIndices(currentOrder.length), playingQueueIndex));
      setOrderPosition(0);
    } else {
      // Возвращаем естественный порядок и находим в нём играющий трек.
      // slice() создаёт копию, sort() упорядочивает её по возрастанию индексов.
      const natural = currentOrder.slice().sort((a, b) => a - b);
      setOrder(natural);
      setOrderPosition(Math.max(natural.indexOf(playingQueueIndex), 0));
    }
  }, []);

  /** Полная остановка. */
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  // --------------------------------------------------------------------------
  // ССЫЛКИ НА ФУНКЦИИ ДЛЯ ОБРАБОТЧИКОВ MEDIA SESSION.
  //
  // Обработчики Media Session ставятся в useEffect, но next/previous
  // объявлены чуть ниже по тексту. Чтобы не ловить путаницу с порядком
  // объявлений, держим актуальные версии в ref'ах.
  // --------------------------------------------------------------------------
  const nextRef = useRef(next);
  const previousRef = useRef(previous);
  useEffect(() => {
    nextRef.current = next;
    previousRef.current = previous;
  }, [next, previous]);

  // --------------------------------------------------------------------------
  // ПОДПИСКА НА СОБЫТИЯ <audio>.
  //
  // useEffect с пустым массивом зависимостей [] выполняется ОДИН РАЗ после
  // первого рендера — как раз когда <audio> уже есть в DOM.
  //
  // Функция, возвращаемая из useEffect, называется ФУНКЦИЕЙ ОЧИСТКИ
  // (cleanup). React вызовет её при размонтировании компонента. Мы снимаем
  // обработчики, чтобы не оставлять «висящих» подписок.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // ---- Браузер загрузил метаданные (стала известна длительность) ---------
    const handleLoadedMetadata = () => {
      // duration может быть Infinity у потоковых источников — защищаемся.
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setIsLoading(false);
    };

    // ---- Кнопка play нажата (или play() вызван из кода) --------------------
    const handlePlay = () => {
      setIsPlaying(true);
      setError(null);
    };

    // ---- Пауза -------------------------------------------------------------
    const handlePause = () => setIsPlaying(false);

    // ---- Трек реально начал звучать ---------------------------------------
    // Событие `playing` отличается от `play`: play — «начали пытаться»,
    // playing — «звук пошёл». Именно здесь уместно писать историю.
    const handlePlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);

      const track = queueRef.current[orderRef.current[orderPositionRef.current] ?? -1];
      if (track && historyTrackIdRef.current !== track.id) {
        historyTrackIdRef.current = track.id;

        void fetch("/api/history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trackId: track.id }),
        }).catch(() => undefined);
      }
    };

    // ---- Буферизация -------------------------------------------------------
    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    // ---- Ошибка воспроизведения -------------------------------------------
    // MediaError — объект с числовым кодом. Расшифруем самые частые.
    const handleError = () => {
      setIsLoading(false);
      setIsPlaying(false);

      const code = audio.error?.code;
      const messages: Record<number, string> = {
        1: "Загрузка прервана",
        2: "Ошибка сети при загрузке файла",
        3: "Не удалось декодировать файл (возможно, он повреждён)",
        4: "Формат файла не поддерживается браузером",
      };
      setError(messages[code ?? 0] ?? "Не удалось воспроизвести трек");
    };

    // ---- Трек доиграл до конца --------------------------------------------
    const handleEnded = () => {
      // Логика повтора:
      //   "one" — играем тот же трек заново;
      //   "all" — идём к следующему, а на последнем возвращаемся к первому;
      //   "off" — на последнем треке останавливаемся.
      const currentOrder = orderRef.current;
      const position = orderPositionRef.current;

      if (repeatRef.current === "one") {
        audio.currentTime = 0;
        void audio.play();
        return;
      }

      const isLast = position >= currentOrder.length - 1;

      if (isLast && repeatRef.current === "off") {
        setIsPlaying(false);
        return;
      }

      setOrderPosition(isLast ? 0 : position + 1);
      shouldAutoplayRef.current = true;
    };

    // ------------------------------------------------------------------------
    // ПОДПИСКА.
    // Имена событий пишутся в нижнем регистре: "loadedmetadata", "canplay" —
    // это НАТИВНЫЕ DOM-события, а не React-пропсы вроде onLoadedMetadata.
    // ------------------------------------------------------------------------
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  // --------------------------------------------------------------------------
  // СМЕНА ТРЕКА: подставляем новый src.
  //
  // Зависимость — именно id трека, а не весь объект. Перерисовка списка
  // создаёт НОВЫЙ объект трека с теми же данными; если бы мы зависели от
  // объекта, аудио перезагружалось бы на каждой перерисовке.
  // --------------------------------------------------------------------------
  const currentTrackId = currentTrack?.id ?? null;

  /*
    eslint-disable react-hooks/set-state-in-effect --
    Здесь setState вызывается синхронно в эффекте, и это ОПРАВДАНО:
    мы синхронизируем React-состояние с внешней системой — элементом <audio>.
    Плеер не должен помнить позицию предыдущего трека, поэтому при смене
    трека обнуляем время и длительность. Правило предупреждает о возможном
    «каскадном» рендере — здесь он нужен и происходит только в момент
    смены трека (не в цикле).
  */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrackId === null) {
      // Очередь пуста — очищаем плеер.
      audio.removeAttribute("src");
      audio.load();
      setDuration(0);
      setCurrentTime(0);
      return;
    }

    // ------------------------------------------------------------------------
    // СБРОС СОСТОЯНИЯ ПЕРЕД ЗАГРУЗКОЙ.
    // Без этого на секунду мелькнёт длительность предыдущего трека.
    // ------------------------------------------------------------------------
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setIsLoading(true);

    // Смена .src запускает загрузку. Браузер сам отправит Range-запрос,
    // когда пользователь начнёт перематывать.
    audio.src = buildStreamUrl(currentTrackId, streamToken);
    audio.load();

    // ------------------------------------------------------------------------
    // ОТЛОЖЕННАЯ ПЕРЕМОТКА (для «продолжить слушать»).
    //
    // Подписываемся на loadedmetadata ОДИН раз и сразу отписываемся внутри
    // обработчика (см. removeEventListener). Такой приём называется
    // «одноразовый слушатель»: он не останется висеть на элементе.
    // ------------------------------------------------------------------------
    if (pendingSeekRef.current !== null) {
      const seekTarget = pendingSeekRef.current;
      pendingSeekRef.current = null;

      const applyPendingSeek = () => {
        // Защита от ситуации, когда сохранённая позиция оказалась
        // больше длительности (например, трек заменили на короткий).
        audio.currentTime = Math.min(seekTarget, audio.duration || seekTarget);
        audio.removeEventListener("loadedmetadata", applyPendingSeek);
      };

      audio.addEventListener("loadedmetadata", applyPendingSeek);
    }

    // ------------------------------------------------------------------------
    // АВТОЗАПУСК.
    //
    // audio.play() возвращает Promise, который МОЖЕТ быть отклонён, если
    // браузер запретил автозапуск (autoplay policy требует, чтобы
    // воспроизведение начиналось после действия пользователя).
    // Все наши вызовы play() происходят из обработчиков клика, но
    // подстраховаться и показать понятную ошибку всё равно нужно.
    // ------------------------------------------------------------------------
    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false;
      audio.play().catch((playError: unknown) => {
        setIsLoading(false);
        setError("Браузер заблокировал автозапуск. Нажми ▶");
        console.warn("[player] play() отклонён:", playError);
      });
    }
  }, [currentTrackId, streamToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --------------------------------------------------------------------------
  // ПРИМЕНЕНИЕ ГРОМКОСТИ.
  // Свойство volume принимает значения от 0 до 1, где 1 — 100%.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  // --------------------------------------------------------------------------
  // ПЛАВНОЕ ОБНОВЛЕНИЕ ПОЛОСЫ ПРОГРЕССА ЧЕРЕЗ requestAnimationFrame.
  //
  // ── ПОЧЕМУ НЕ СОБЫТИЕ timeupdate ─────────────────────────────────────────
  // Браузер шлёт timeupdate примерно 4 раза в секунду. Полоса прогресса
  // двигалась бы рывками — выглядит дёшево.
  //
  // requestAnimationFrame(callback) просит браузер вызвать функцию ПЕРЕД
  // следующей перерисовкой экрана, то есть обычно 60 раз в секунду.
  //
  // ── ПОЧЕМУ ЭТО НЕ СЪЕДАЕТ РЕСУРСЫ ────────────────────────────────────────
  // Цикл работает ТОЛЬКО пока играет музыка (см. зависимость [isPlaying]).
  // На паузе кадров нет вообще. Плюс перерисовывается лишь панель плеера,
  // потому что время лежит в отдельном контексте.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isPlaying) return;

    let frameId = 0;

    const updateTime = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);

        // Сохраняем позицию на сервере, но не чаще раза в 10 секунд.
        const now = Date.now();
        if (now - lastStateSaveRef.current > 10_000) {
          lastStateSaveRef.current = now;
          savePlaybackStateToServer(audio.currentTime);
        }
      }
      frameId = window.requestAnimationFrame(updateTime);
    };

    frameId = window.requestAnimationFrame(updateTime);

    // Очистка: отменяем запрошенный кадр при паузе или размонтировании.
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, savePlaybackStateToServer]);

  // --------------------------------------------------------------------------
  // СОХРАНЕНИЕ ПОЗИЦИИ ПРИ УХОДЕ СО СТРАНИЦЫ.
  //
  // Событие pagehide срабатывает и при закрытии вкладки, и при уходе в bfcache.
  // Обычный fetch в этот момент может не успеть — браузер просто закроет
  // страницу. Поэтому используем navigator.sendBeacon: он специально сделан
  // для «отправь и не жди ответа».
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handlePageHide = () => {
      const audio = audioRef.current;
      const track = queueRef.current[orderRef.current[orderPositionRef.current] ?? -1];
      if (!audio || !track || typeof navigator.sendBeacon !== "function") return;

      // Blob с типом application/json — чтобы сервер понял формат тела.
      const payload = new Blob([JSON.stringify({ trackId: track.id, position: audio.currentTime })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/playback-state", payload);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  // --------------------------------------------------------------------------
  // MEDIA SESSION API — управление с клавиатуры, из наушников и с экрана
  // блокировки телефона.
  //
  // Если этого не сделать, кнопки «следующий/предыдущий» на клавиатуре
  // (обычно Fn+стрелки) и на Bluetooth-наушниках работать не будут.
  // Поддерживается в Chrome, Edge, Firefox; в Safari — частично.
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Проверяем, что API вообще есть: в старых браузерах его нет.
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      // artwork принимает массив картинок разного размера.
      // sizes — ПОДСКАЗКА браузеру, реальный размер он определит сам.
      artwork: currentTrack.hasCover ? [{ src: buildCoverUrl(currentTrack.id), sizes: "512x512" }] : [],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      void audioRef.current?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => previousRef.current());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextRef.current());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (details.seekTime != null && audio) {
        audio.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });
  }, [currentTrack]);

  // --------------------------------------------------------------------------
  // СБОРКА ЗНАЧЕНИЙ КОНТЕКСТОВ.
  //
  // useMemo пересобирает объект только при изменении перечисленных
  // зависимостей. Без него на каждом рендере создавался бы новый объект,
  // и все потребители контекста перерисовывались бы впустую — это одна из
  // самых частых причин «почему у меня всё тормозит» в React.
  // --------------------------------------------------------------------------
  const actions = useMemo<PlayerActions>(
    () => ({
      playQueue,
      playSingle,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      stop,
    }),
    [playQueue, playSingle, toggle, next, previous, seek, setVolume, toggleMute, cycleRepeat, toggleShuffle, stop],
  );

  const trackState = useMemo<TrackState>(
    () => ({
      currentTrack,
      isPlaying,
      isLoading,
      repeat,
      shuffle,
      queueLength: order.length,
      queuePosition: order.length > 0 ? orderPosition + 1 : 0,
      error,
    }),
    [currentTrack, isPlaying, isLoading, repeat, shuffle, order.length, orderPosition, error],
  );

  const timelineState = useMemo<TimelineState>(
    () => ({ currentTime, duration, volume, muted }),
    [currentTime, duration, volume, muted],
  );

  return (
    <PlayerActionsContext.Provider value={actions}>
      <PlayerTrackContext.Provider value={trackState}>
        <PlayerTimelineContext.Provider value={timelineState}>
          {/*
            Сам аудиоэлемент.

            ── ПОЧЕМУ ОН ОТРИСОВАН, А НЕ СОЗДАН ЧЕРЕЗ new Audio() ────────────
            Если элемент есть в разметке, его видно в DevTools (вкладка
            Elements), им удобно управлять через ref, и он ведёт себя
            предсказуемо при серверном рендеринге.

            preload="metadata" — браузер подгрузит только начало файла,
            чтобы узнать длительность, но не станет качать весь трек заранее.
            Это экономит трафик: в библиотеке может быть 2000 песен.
          */}
          <audio ref={audioRef} preload="metadata" />
          {children}
        </PlayerTimelineContext.Provider>
      </PlayerTrackContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
