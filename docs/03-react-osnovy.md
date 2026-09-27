# Глава 3. React: основы

Всё в этой главе — на реальном коде проекта. Открывай файл рядом и читай параллельно.
Порядок в каждом разделе: **ЧТО** → **ЗАЧЕМ** → **КАК** → **ПРИМЕР из проекта**.

---

## 3.1. React и компонент

**ЧТО.** React — библиотека, описывающая интерфейс набором функций. **Компонент — это функция,
возвращающая разметку.** Ни классов, ни наследования.

```tsx
// Имя с БОЛЬШОЙ буквы — требование React: по ней он отличает свой компонент
// (<PlayerBar />) от HTML-тега (<footer>).
export function Hello() {
  return <div>привет</div>;
}
```

**ЗАЧЕМ.** Главная идея: **интерфейс — функция от состояния**, `UI = f(state)`. Ты не трогаешь DOM
руками, а меняешь данные — React пересчитывает функцию и приводит DOM в соответствие.

**КАК.** Вызвал `setState(...)` → React пометил компонент «грязным» → вызвал функцию заново
(**рендер**) → сравнил разметку с прошлой и поменял в DOM только отличия (**согласование**).
Последний шаг ключевой: ты пишешь «верни список из 500 треков», а React обновит одну строку.

**ПРИМЕР.** `src/components/ui/CoverArt.tsx` — почти минимальный компонент: получил пропсы,
вернул картинку или заглушку. В `TrackList` он выводится с `size={32}`, в `PlayerBar` — с
`size={40}`: один компонент, два места, ноль дублирования.

---

## 3.2. JSX: HTML внутри JavaScript

**ЧТО.** JSX — синтаксис, похожий на HTML, прямо внутри `.tsx`. Сборщик превращает его в вызовы
функций: `<div className="x">` → `jsx("div", { className: "x" })`.

**ЧЕМ ОТЛИЧАЕТСЯ ОТ HTML.** Отличий немного, но это главный источник мелких ошибок:

| HTML | JSX | Почему |
|---|---|---|
| `class="term-panel"` | `className="term-panel"` | `class` зарезервировано в JS |
| `for="name"` | `htmlFor="name"` | `for` занято циклом |
| `onclick="..."` | `onClick={функция}` | обработчик — функция, а не строка |
| `<img>` | `<img />` | теги обязаны быть закрыты |
| `style="width: 10px"` | `style={{ width: 10 }}` | стиль — объект |
| `<!-- -->` | `{/* */}` | внутри JSX `//` не работает |

Двойные скобки в `style` — это внутренние `{}` («вставь JS-выражение») вокруг внешних `{}` (объект
стилей). Так написано в `CoverArt.tsx`: `style={{ width: size, height: size }}`. Почему не
Tailwind-класс `w-10 h-10`: размер приходит пропсом и может быть любым, а Tailwind-классы
генерируются заранее на сборке.

**ФИГУРНЫЕ СКОБКИ `{}` — «вставь значение».** Внутри можно любое **выражение**, но не инструкции:

```tsx
{formatDuration(currentTime)}     {/* вызов функции — можно */}
{isPlaying ? "❚❚" : "▶"}          {/* тернарник — можно */}
{ if (x) { ... } }                {/* инструкция if — НЕЛЬЗЯ, синтаксическая ошибка */}
```

**КОММЕНТАРИИ.** В `HistoryList.tsx` про это есть предупреждение в шапке файла:

```tsx
{/* Это правильный комментарий внутри JSX. */}
// А это ВНУТРИ разметки — синтаксическая ошибка.
```

Вне разметки обычный `//` работает как всегда; в `TrackList.tsx` пояснения стоят в `{/* */}`,
потому что находятся внутри `return`.

---

## 3.3. Props

**ЧТО.** **Пропсы — входные параметры компонента**, как аргументы функции. Родитель передаёт данные
через атрибуты, ребёнок получает их первым параметром.

**ЗАЧЕМ.** Пропсы делают компоненты переиспользуемыми и предсказуемыми: компонент, читающий данные
«откуда-то извне», нельзя ни переиспользовать, ни протестировать.

**КАК ТИПИЗИРОВАТЬ.** В проекте один стиль: рядом с компонентом объявляется `type`.

```tsx
// src/components/library/TrackList.tsx
type TrackListProps = {
  tracks: TrackDTO[];        // обязательный
  emptyMessage?: string;     // «?» = необязательный
  playlistId?: number;
};

export function TrackList({ tracks, emptyMessage = "НЕТ ТРЕКОВ", playlistId }: TrackListProps) {
```

У `playlistId` значение `undefined` несёт смысл — «это не страница плейлиста». Значения по
умолчанию задаются в деструктуризации (в `FavoriteButton` — `compact = true`).

**ПОЧЕМУ НЕЛЬЗЯ МЕНЯТЬ ПРОПСЫ.** Представь, что `TrackList` сделал бы `tracks.length = 0` — он
«обнулил» бы массив родителя, и сломалось бы везде, где тот же массив используется. Правило:
**данные идут вниз через пропсы, изменения уходят вверх через функции-колбэки.**

```tsx
// TrackRow не знает про плеер — он лишь сообщает «меня нажали»
<TrackRow track={track} index={index} onPlay={() => actions.playQueue(tracks, index)} />
```

Это **инверсия управления**. Колбэк типизируется как функция: в `SeekBar` (внутри `PlayerBar.tsx`)
— `onChange: (seconds: number) => void`.

---

## 3.4. Списки и `key`

**ЧТО.** Выводя массив через `.map()`, ты обязан передать каждому элементу `key` — строку или
число, уникальное внутри списка.

**ЗАЧЕМ.** React хранит соответствие «этот компонент в дереве ← этот элемент массива»; `key` — имя
элемента. Без ключа React сравнивает по позиции, и при удалении/сортировке состояние «съезжает»:

```tsx
// TrackList.tsx
// ВАЖНО: никогда не используй индекс массива как key, если список
// может меняться местами. id из базы — правильный выбор.
key={track.id}
```

**ПОЧЕМУ ИНДЕКС — ПЛОХОЙ КЛЮЧ.** Пусть список `[A, B, C]` и у строк есть хоть какое-то состояние.
Удалили `B`, стало `[A, C]`:

| Позиция | Было (key=0,1,2) | Стало (key=0,1) | Что делает React |
|---|---|---|---|
| 0 | A | A | «тот же элемент, ничего не делаю» |
| 1 | B | C | «тот же элемент, обновляю пропсы с B на C» |
| 2 | C | — | «удаляю» |

Данные обновились верно, но **состояние осталось по позициям**: состояние строки `B` досталось `C`.
То же при сортировке. Мораль: `key={track.id}` — идентичность («тот же трек переехал»),
`key={index}` — позиция («то же место, данные другие»). Индекс допустим только для полностью
статичного списка без состояния; в проекте он как `key` не используется нигде.

**ПОКАЗАТЕЛЬНЫЙ ПРИМЕР — `HistoryList`** (`src/components/history/HistoryList.tsx`): редкий случай,
когда выбор ключа неочевиден, и автор объясняет всё прямо в коде.

```tsx
{entries.map((entry, index) => {
  // Почему не track.id? Один и тот же трек встречается в журнале много раз,
  // и ключи получились бы неуникальными.
  // Почему не индекс массива? Список обновляется после router.refresh():
  // React решил бы, что элемент с индексом 0 остался тем же, хотя данные другие.
  // Комбинация «время + id» уникальна.
  const rowKey = `${entry.playedAt}-${entry.track.id}-${index}`;
  return <li key={rowKey} ... />;
})}
```

**`key` должна быть стабильной И уникальной одновременно.** Индекс не стабилен при изменении
списка, `id` трека не уникален в журнале — составной ключ удовлетворяет обоим требованиям.

---

## 3.5. Состояние: `useState`

**ЧТО.** **Состояние — данные, которые меняются во времени и влияют на то, что видно на экране.**

```tsx
const [value, setValue] = useState(начальноеЗначение);
//     ↑ текущее  ↑ функция изменения
```

**ПРАВИЛО.** Проверяй переменную вопросом: «может измениться, пока пользователь смотрит на экран, и
от этого зависит картинка?» Не клади в состояние пропсы, константы и **то, что можно вычислить**:

```tsx
// PlayerBar.tsx: currentTime и duration — состояние, а progressPercent — ВЫЧИСЛЕНИЕ из них
const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
```

Храни процент отдельно — и его придётся не забывать обновлять. Забыли бы. Всегда забывают.

**У каждого экземпляра компонента своё состояние:** в `TrackList` рисуется 500 `TrackRow`, и у
каждой `CoverArt` независимый `hasError` — сломанная обложка даёт заглушку только у себя.

**ПРИМЕР 1: `CoverArt`.** Тонкость, отмеченная в комментарии:

```tsx
const [hasError, setHasError] = useState(false);
// Начальное значение (false) вычисляется при каждом рендере, но useState
// использует его только при ПЕРВОМ: если hasCover изменится, ошибка не сбросится.
```

`useState(false)` — не «значение по умолчанию», а «значение при рождении компонента». Исключение —
ленивая инициализация: `useState(() => дорогоеВычисление())` вызовет функцию только один раз.

**ПРИМЕР 2: `FavoriteButton` — оптимистичное обновление.**

```tsx
// Почему дублируем пропс в состояние? Чтобы кнопка отреагировала МГНОВЕННО, не
// дожидаясь сервера. Это ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ. Начальное значение — из пропса.
const [optimisticValue, setOptimisticValue] = useState(isFavorite);
// ...
.catch(() => setOptimisticValue(!nextValue));   // ← ОТКАТ: сервер не принял — вернуть как было
```

**Оптимистичное обновление обязано уметь откатываться:** без `.catch()` пользователь увидит
закрашенную звезду, а в базе ничего не сохранится.

**ПРИМЕР 3: `SearchBar` — локальный ввод + URL.** Два источника правды одновременно, и это
осознанно (`src/components/library/SearchBar.tsx`):

```tsx
// Локальное состояние — только чтобы буквы появлялись в поле мгновенно.
const [value, setValue] = useState(searchParams.get("search") ?? "");
```

| Что | Где живёт | Зачем |
|---|---|---|
| Текст в поле | `useState` | мгновенная реакция на клавишу |
| Параметр поиска | URL (`?search=...`) | ссылка рабочая, F5 не теряет результат, «назад» работает |

Цитата из файла, почему фильтрация не делается в браузере: масштаб (5000 треков в памяти на каждое
нажатие), правильное место для поиска — база, ссылка становится рабочей, перезагрузка не теряет
результат. Это идиома **«URL как состояние»**.

---

## 3.6. Обновление состояния: почему `setState` асинхронный

**ЧТО.** `setState` **не меняет переменную на месте**, а планирует обновление.

```tsx
const [count, setCount] = useState(0);
setCount(5);
console.log(count);   // напечатает 0, а НЕ 5!
```

`count` — **константа**, зафиксированная для этого рендера; внутри одного вызова функции она не
изменится никогда.

**ЗАЧЕМ ТАК.** React собирает несколько обновлений и делает **один** рендер: три `setState` на один
клик = одна перерисовка вместо трёх. Рендер — самая дорогая операция.

**ФУНКЦИЯ-АПДЕЙТЕР.** Внутри одного «пакета» вызовы не видят друг друга:

```tsx
setCount(count + 1); setCount(count + 1); setCount(count + 1);   // ПЛОХО: результат 1
setCount((prev) => prev + 1); /* ... */                          // ХОРОШО: результат 3
```

**Правило: если новое значение зависит от предыдущего — всегда функция-апдейтер.** Это не
оптимизация, это корректность.

**ПРИМЕР 1: `cycleRepeat`** (`player-context.tsx`) — переключение по кругу:

```tsx
/** Повтор: off → all → one → off. */
const cycleRepeat = useCallback(() => {
  setRepeat((current) => {
    const nextMode: RepeatMode = current === "off" ? "all" : current === "all" ? "one" : "off";
    writeLocalStorage(STORAGE_REPEAT_KEY, nextMode);
    return nextMode;
  });
}, []);
```

`current` — гарантированно актуальный режим, даже если пользователь щёлкает очень быстро. Сохранение
в `localStorage` стоит **внутри** апдейтера: запись не может разойтись с состоянием. Напиши мы
`setRepeat(repeat === "off" ? ...)` — при двух кликах в одном пакете режим переключился бы один раз
вместо двух.

**ПРИМЕР 2: `next` / `previous`** — апдейтер обязан **вернуть** значение:

```tsx
setOrderPosition((position) => {
  const total = orderRef.current.length;
  if (total === 0) return position;    // вернуть прежнее = «не менять»
  return (position + 1) % total;       // % даёт закольцованность
});
// В previous: +total перед % защищает от отрицательного числа —
// в JS (-1) % 5 равно -1, а не 4.
```

**ПРИМЕР 3: `toggleShuffle` — почему здесь НЕ апдейтер:**

```tsx
const nextValue = !shuffleRef.current;
// Сразу обновляем ref, чтобы последующие вызовы видели новое значение
// (обновление state произойдёт чуть позже, асинхронно).
shuffleRef.current = nextValue;
setShuffle(nextValue);
```

`nextValue` нужен ещё в нескольких местах снаружи `setState` — для `localStorage`, для решения
«перемешивать или восстанавливать порядок», для `putFirst(...)`. Апдейтер вернул бы значение только
внутрь себя. Поэтому работает `shuffleRef` — тема раздела 3.9.

---

## 3.7. События

**ЧТО.** Обработчик — функция в пропсе с именем `on...` в camelCase. **Мы передаём функцию, а не
вызываем её:** `onClick={actions.toggle}` — верно, `onClick={actions.toggle()}` — неверно (функция
вызовется при рендере, а в пропс попадёт `undefined`).

| Свойство события | Что это | Пример в проекте |
|---|---|---|
| `event.target` | элемент, где произошло событие | `PlayerBar.tsx`: `event.target as HTMLElement` |
| `event.key` | какая клавиша нажата | `PlaylistCard.tsx`: `if (event.key === "Enter")` |
| `event.preventDefault()` | отменить поведение браузера | `PlaylistCreateForm.tsx` |
| `event.stopPropagation()` | не пускать событие выше по дереву | `FavoriteButton.tsx` |

**`onClick`** (`PlayerBar.tsx`): `<button type="button" onClick={actions.toggle} disabled={!currentTrack} />`.
`type="button"` обязателен: иначе кнопка внутри формы отправит форму — классическая ошибка.

**`onChange`.** В `SearchBar` — `onChange={(event) => setValue(event.target.value)}`. В `PlayerBar`
(ползунок) нужно приведение типа, потому что `event.target.value` **всегда строка**, даже у
`type="range"`: `actions.setVolume(Number(event.target.value))`.

**`onKeyDown`.** `TrackRow` в `TrackList.tsx` — строка «нажимается» с клавиатуры:

```tsx
onKeyDown={(event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();   // для пробела: иначе браузер прокрутит страницу
    onPlay();
  }
}}
```

**`preventDefault` — отменить поведение браузера:**

| Событие | Поведение по умолчанию | Почему мешает |
|---|---|---|
| `submit` формы | перезагрузка страницы | убивает SPA, останавливает музыку |
| пробел | прокрутка вниз | пауза и прыжок страницы одновременно |
| клик по ссылке | переход | мешает своему роутингу |

```tsx
// PlaylistCreateForm.tsx: по умолчанию отправка формы заставляет браузер
// ПЕРЕЗАГРУЗИТЬ страницу. Для одностраничного приложения это катастрофа.
const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
};
```

Проверка в горячих клавишах `PlayerBar.tsx` — признак зрелого кода:

```tsx
const tagName = (event.target as HTMLElement | null)?.tagName;  // В ВЕРХНЕМ РЕГИСТРЕ: "INPUT"
const isEditing = tagName === "INPUT" || tagName === "TEXTAREA" || /* ... */;
if (isEditing) return;                                      // не мешаем печатать текст
if (event.ctrlKey || event.metaKey || event.altKey) return;  // не ломаем Ctrl+R, Cmd+L
```

Смысл: **глобальная горячая клавиша не должна мешать писать текст.** Если фокус в поле поиска,
пробел обязан вставиться в текст, а не поставить музыку на паузу.

**`stopPropagation`.** Событие всплывает: кнопка → строка → контейнер → `document`. Строка трека
целиком кликабельна и запускает воспроизведение, а внутри неё — звёздочка, крестик и меню
плейлистов. Без остановки всплытия клик по ним **ещё и запускал бы музыку**.

```tsx
// FavoriteButton.tsx
// Строка списка целиком кликабельна и запускает воспроизведение.
// stopPropagation() не даёт клику «всплыть» до строки.
event.stopPropagation();

// TrackList.tsx, кнопка «убрать из плейлиста» — то же самое.
// AddToPlaylistButton.tsx — остановка на контейнере целиком, короче и надёжнее:
<div className="relative" ref={containerRef} onClick={(event) => event.stopPropagation()}>
```

Остановка на контейнере проще, но тогда всплытие теряет всё внутри, включая возможные ссылки.
Останавливать на конкретной кнопке точнее, но легко забыть в одном месте.

**Фазы события:** перехват (сверху вниз) → цель → всплытие (снизу вверх). Флаг `capture` меняет
сторону, и `AddToPlaylistButton` это использует:

```tsx
// { capture: true } — срабатывает на фазе ПЕРЕХВАТА, раньше, чем событие
// дойдёт до элементов: меню закрывается до того, как строка запустит музыку.
document.addEventListener("mousedown", handlePointerDown, true);
```

---

## 3.8. Эффекты: `useEffect`

**ЧТО.** `useEffect` — хук для **синхронизации компонента с чем-то внешним по отношению к React**.

```tsx
useEffect(() => {
  /* выполняется ПОСЛЕ отрисовки */
  return () => { /* необязательная функция очистки */ };
}, [зависимости]);
```

**ЗАЧЕМ.** Функция компонента должна быть чистой: получила пропсы и состояние — вернула разметку.
Но приложению нужны таймеры, подписки, DOM, сеть. **«Внешний мир»** — DOM (`<audio>`, `window`),
таймеры, подписки, запросы, `localStorage`, сторонние библиотеки.

**МАССИВ ЗАВИСИМОСТЕЙ — самая важная часть:**

| Зависимости | Когда выполняется | Применение |
|---|---|---|
| не указаны | после **каждого** рендера | почти никогда не нужно |
| `[]` | **один раз** после первого рендера | подписки, начальная загрузка |
| `[a, b]` | после первого и далее при изменении `a` или `b` | синхронизация с данными |

**Пустой массив `[]` означает буквально «для этого эффекта нет зависимостей, выполни один раз»** —
эквивалент старого `componentDidMount`. Оговорка: в React 18+ в разработке со Strict Mode эффект
намеренно выполняется дважды, чтобы ты поймал ошибки в очистке; в продакшене — один раз.

**Правило, спасающее от 90% багов:** в массив попадает **всё**, что эффект читает из внешней
области видимости. Положишь не всё — эффект «запомнит» старые значения (см. 3.9).

**ФУНКЦИЯ ОЧИСТКИ** вызывается перед следующим выполнением эффекта и при размонтировании; без неё
будут **утечка памяти**, **призрачные обработчики** и **двойное срабатывание**:

```tsx
useEffect(() => {
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

**ЭФФЕКТ 1: подписка на события `<audio>`.**

```tsx
// useEffect с пустым списком зависимостей [] выполняется ОДИН РАЗ после первого
// рендера — как раз когда <audio> уже есть в DOM. Возвращаемая функция — ОЧИСТКА.
useEffect(() => {
  const audio = audioRef.current;
  if (!audio) return;

  const handleEnded = () => { /* логика повтора: one / all / off */ };
  const handleError = () => { /* расшифровка MediaError по коду 1..4 */ };

  // Имена событий в нижнем регистре — это НАТИВНЫЕ DOM-события,
  // а не React-пропсы вроде onLoadedMetadata.
  audio.addEventListener("loadedmetadata", handleLoadedMetadata);
  audio.addEventListener("play", handlePlay);
  audio.addEventListener("pause", handlePause);
  audio.addEventListener("error", handleError);
  audio.addEventListener("ended", handleEnded);      // ... ещё три: playing, waiting, canplay

  return () => {
    audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    audio.removeEventListener("play", handlePlay);   // ... снимаем все восемь
  };
}, []);
```

Почему через `addEventListener`, а не через пропсы JSX: у `<audio>` есть события, которых в
React-пропсах нет или они названы иначе (`canplay`, `playing`, `waiting`, `seeked`). Разница между
`play` и `playing` тонкая, но важная:

```tsx
// play — «начали пытаться», playing — «звук пошёл». Именно здесь уместно писать
// историю: иначе трек, который не смог воспроизвестись, тоже попадёт в неё.
const track = queueRef.current[orderRef.current[orderPositionRef.current] ?? -1];
if (track && historyTrackIdRef.current !== track.id) {
  historyTrackIdRef.current = track.id;   // защита от повторной записи
  void fetch("/api/history", { method: "POST" /* ... */ }).catch(() => undefined);
}
```

**ЭФФЕКТ 2: цикл `requestAnimationFrame`.**

```tsx
// ПОЧЕМУ НЕ timeupdate: браузер шлёт его ~4 раза в секунду, полоса двигалась бы
// рывками. requestAnimationFrame просит вызвать функцию ПЕРЕД перерисовкой экрана,
// то есть обычно 60 раз в секунду.
useEffect(() => {
  if (!isPlaying) return;          // на паузе кадров нет вообще

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
    frameId = window.requestAnimationFrame(updateTime);   // ← цикл: функция просит свой след. вызов
  };

  frameId = window.requestAnimationFrame(updateTime);
  return () => window.cancelAnimationFrame(frameId);   // очистка: отменяем кадр при паузе
}, [isPlaying, savePlaybackStateToServer]);
```

Разбор: `if (!isPlaying) return` — **ранний выход** вместо холостого цикла; `let frameId` живёт
внутри одного запуска эффекта; очистка отменяет кадр, иначе цикл продолжил бы дёргать состояние
после паузы. `savePlaybackStateToServer` в зависимостях обязателен, потому что эффект её вызывает —
именно для этого она обёрнута в `useCallback`, чтобы ссылка была стабильной. Благодаря этому цикл
**работает только пока играет музыка**, а перерисовывается **только панель плеера**.

**ЭФФЕКТ 3: `pagehide` и `sendBeacon`.**

```tsx
// sendBeacon вместо fetch: pagehide срабатывает при закрытии вкладки, и обычный
// fetch может не успеть — браузер просто закроет страницу.
if (!audio || !track || typeof navigator.sendBeacon !== "function") return;

const payload = new Blob([JSON.stringify({ trackId: track.id, position: audio.currentTime })],
  { type: "application/json" });
navigator.sendBeacon("/api/playback-state", payload);

window.addEventListener("pagehide", handlePageHide);
return () => window.removeEventListener("pagehide", handlePageHide);
```

`typeof navigator.sendBeacon !== "function"` — защита от старых браузеров и серверного рендеринга.

**ЭФФЕКТ 4: горячие клавиши и честные зависимости** (`PlayerBar.tsx`).

```tsx
// Обработчик читает actions, currentTime и volume — значит при их изменении подписку
// надо пересоздать, иначе замыкание «запомнит» старые значения и перемотка стрелками
// будет всегда прыгать в одну и ту же точку.
// «Так как действия стабильны, подписка создаётся один раз».
}, [actions, currentTime, volume]);
```

**ЭФФЕКТ 5: `localStorage` и hydration mismatch.**

```tsx
// ВАЖНО: это делается в useEffect, а не при инициализации useState.
// На сервере localStorage нет, значит начальное значение одно, а в браузере другое.
// React пожалуется на «hydration mismatch». Читаем ПОСЛЕ первого рендера.
useEffect(() => {
  const savedVolume = Number(readLocalStorage(STORAGE_VOLUME_KEY));
  if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
    setVolumeState(savedVolume);
  }
  setShuffle(readLocalStorage(STORAGE_SHUFFLE_KEY) === "true");
}, []);
```

Первые миллисекунды плеер показывает громкость 100%, потом сохранённые 50%. Незаметно, зато рендер
честный.

**КОГДА `useEffect` НЕ НУЖЕН.** Для вычисляемых значений (`progressPercent` считается прямо в теле
функции; эффект с `setState` внутри — почти всегда лишний рендер). Для реакции на клик — это
`onClick`. Как «componentDidUpdate» — думай «синхронизация с внешним». Для копирования пропсов в
состояние — почти всегда ошибка.

---

## 3.9. `useRef`: коробка без перерисовки

**ЧТО.** `useRef(значение)` возвращает объект с одним свойством `current`, живущий между рендерами.
**Изменение `ref.current` не вызывает перерисовку.**

| | `useState` | `useRef` |
|---|---|---|
| Вызывает перерисовку | да | нет |
| Меняется | отложенно | синхронно |
| Для чего | данные, влияющие на вид | DOM-узлы, «память» обработчиков |

**ПРИМЕНЕНИЕ 1: ссылка на DOM-элемент.**

```tsx
// useRef даёт «коробку», которая сохраняет значение между рендерами, но НЕ вызывает
// перерисовку. Для DOM-узлов это идеально: элемент уже живёт в DOM, React его не пересоздаёт.
const audioRef = useRef<HTMLAudioElement | null>(null);
// ...
<audio ref={audioRef} preload="metadata" />

const toggle = useCallback(() => {
  const audio = audioRef.current;
  if (!audio) return;                 // TypeScript прав: current может быть null
  if (audio.paused) audio.play().catch(() => setError("Не удалось начать воспроизведение"));
  else { audio.pause(); savePlaybackStateToServer(audio.currentTime); }
}, [savePlaybackStateToServer]);
```

Почему `<audio>` отрисован в JSX, а не создан через `new Audio()` — цитата из кода: «его видно в
DevTools, им удобно управлять через ref, и он ведёт себя предсказуемо при серверном рендеринге».
`preload="metadata"` — браузер подгрузит только начало файла ради длительности, а не весь трек.

**ЗАМЫКАНИЕ — функция вместе с переменными внешней области видимости, которые она использует:**

```tsx
function makeCounter() {
  let count = 0;                                // переменная внешней функции
  return () => { count += 1; return count; };   // ← функция «замыкает» count
}
```

Главное: **каждый рендер компонента — новый вызов функции со своими переменными.** Обработчик,
созданный в рендере №1 и подписанный один раз, замыкает значения рендера №1 и видит их навсегда:

```tsx
useEffect(() => {
  const id = setInterval(() => {
    console.log(count);   // ← ВСЕГДА 0, сколько бы раз ни нажали кнопку
  }, 1000);
  return () => clearInterval(id);
}, []);   // пустой массив: замыкание из первого рендера
```

Чинить можно двумя способами: добавлять значение в зависимости (тогда подписка пересоздаётся) или
держать актуальное значение в `ref`. В плеере выбран второй путь:

```tsx
// Обработчики событий <audio> вешаются ОДИН раз. Такой обработчик «запоминает» значения
// из момента создания — это ЗАМЫКАНИЕ. Чтобы не пересоздавать подписки при каждом
// изменении состояния, мы держим актуальные значения в ref'ах: ref всегда даёт свежее.
const repeatRef = useRef<RepeatMode>("off");
const shuffleRef = useRef(false);
const orderRef = useRef<number[]>([]);
const orderPositionRef = useRef(0);
const queueRef = useRef<TrackDTO[]>([]);

// Синхронизация ref'ов с состоянием — после каждого рендера, где изменились зависимости.
useEffect(() => {
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  orderRef.current = order;
  orderPositionRef.current = orderPosition;
  queueRef.current = queue;
}, [repeat, shuffle, order, orderPosition, queue]);
```

**`ref.current` всегда актуален, потому что ref — один и тот же объект на протяжении жизни
компонента:** меняется не объект, а поле внутри него. Теперь понятно, почему `handleEnded` читает
`repeatRef.current`, а не `repeat`:

```tsx
const handleEnded = () => {
  const currentOrder = orderRef.current;
  const position = orderPositionRef.current;

  if (repeatRef.current === "one") { audio.currentTime = 0; void audio.play(); return; }

  const isLast = position >= currentOrder.length - 1;
  if (isLast && repeatRef.current === "off") { setIsPlaying(false); return; }

  setOrderPosition(isLast ? 0 : position + 1);
  shouldAutoplayRef.current = true;
};
```

С переменной `repeat` обработчик видел бы режим из **первого рендера** — всегда `"off"`. Кнопка
повтора переключала бы иконку, но музыка останавливалась бы в конце списка: снаружи всё выглядит
правильно, а поведение не то — очень трудно находимый баг.

Почему не добавить `repeat` в зависимости эффекта подписки? Можно, но тогда при каждом переключении
режима все восемь обработчиков снимались бы и вешались заново. С ref'ами подписка создаётся **один
раз за всё время жизни приложения**.

| Ref | Зачем |
|---|---|
| `audioRef` | ссылка на DOM-элемент |
| `repeatRef`, `shuffleRef`, `orderRef`, `orderPositionRef`, `queueRef` | актуальные значения в обработчиках |
| `shouldAutoplayRef` | «играть ли после смены трека» — сигнал между эффектами |
| `historyTrackIdRef` | «какой трек уже записан» — защита от дублей |
| `lastStateSaveRef` | «когда последний раз сохраняли» — троттлинг |
| `pendingSeekRef` | «куда перемотать после загрузки» — отложенное действие |
| `nextRef`, `previousRef` | актуальные версии функций для Media Session |

`shouldAutoplayRef` взводится при выборе трека и гасится после попытки воспроизведения: с
состоянием пришлось бы платить лишним рендером, а погасить флаг синхронно было бы нельзя.

**`pendingSeekRef`.** Из кода: «Пока файл не загружен, браузер не знает его длительность, и
установка `currentTime` может „не прилипнуть“. Поэтому запоминаем желаемую позицию здесь, а
применяем её в момент события `loadedmetadata`»:

```tsx
const applyPendingSeek = () => {
  audio.currentTime = Math.min(seekTarget, audio.duration || seekTarget);
  audio.removeEventListener("loadedmetadata", applyPendingSeek);   // одноразовый слушатель
};
```

`removeEventListener` **внутри самого обработчика** — приём «одноразовый слушатель».

**`useRef` для DOM в `AddToPlaylistButton.tsx`** — как понять, куда кликнул пользователь:

```tsx
// `contains` проверяет, находится ли узел внутри контейнера.
const target = event.target as Node | null;
if (containerRef.current && target && !containerRef.current.contains(target)) setIsOpen(false);
```

Запомни паттерн: выпадающие меню, модальные окна, поповеры делаются именно так.

---

## 3.10. `useCallback` и `useMemo`

**ЧТО.** Оба хука — про мемоизацию: `useCallback` запоминает **функцию**, `useMemo` — **значение**.
Зависимости не менялись — вернётся **та же самая ссылка**, что и в прошлый раз.

**КЛЮЧЕВАЯ ИДЕЯ: в JavaScript функции и объекты сравниваются по ссылке.**

```jsx
{} === {}                  // false — два разных объекта
(() => {}) === (() => {})  // false — две разные функции

<Button onClick={() => doSomething()} />   // новая функция каждый рендер — пропс «изменился»

const handleClick = useCallback(() => doSomething(), []);   // хук вызывается НА ВЕРХНЕМ уровне
<Button onClick={handleClick} />           // одна и та же ссылка, пока зависимости не менялись
```

Нюанс: если компонент не обёрнут в `React.memo`, разницы не будет — ребёнок перерисуется вместе с
родителем независимо от ссылок.

**ГДЕ ЭТО КРИТИЧНО: КОНТЕКСТ.**

```tsx
// useMemo пересобирает объект только при изменении перечисленных зависимостей.
// Без него на каждом рендере создавался бы новый объект, и все потребители контекста
// перерисовывались бы впустую — одна из самых частых причин «почему всё тормозит».
const actions = useMemo<PlayerActions>(
  () => ({ playQueue, playSingle, toggle, next, previous, seek, setVolume,
           toggleMute, cycleRepeat, toggleShuffle, stop }),
  [playQueue, playSingle, toggle, next, previous, seek, setVolume,
   toggleMute, cycleRepeat, toggleShuffle, stop],
);
```

Если бы `actions` создавался заново при каждом рендере провайдера, **каждое** изменение времени
(60 раз в секунду) заставляло бы перерисовываться все 500 строк списка: кнопка «играть» в каждой
строке получала бы новые пропсы. А так `actions` создаётся один раз и не меняется никогда.

Отсюда правило, которое стоит запомнить на всю жизнь:

> **Разделяй состояние по частоте изменений.**

```tsx
// ── ПОЧЕМУ ТРИ КОНТЕКСТА, А НЕ ОДИН ──────────────────────────────
// 1. PlayerActionsContext  — только функции. Меняется никогда.
// 2. PlayerTrackContext    — текущий трек + играет/нет. Раз в несколько минут.
// 3. PlayerTimelineContext — время, длительность, громкость. Меняется постоянно.
//                            Нужен ТОЛЬКО панели плеера.

// TrackList.tsx — контекст с ВРЕМЕНЕМ мы здесь НЕ используем сознательно:
// иначе список из 1000 строк перерисовывался бы 60 раз в секунду.
const actions = usePlayerActions();
const { currentTrack, isPlaying } = usePlayerTrack();
```

**КАК ПИСАТЬ ЗАВИСИМОСТИ:**

```tsx
const toggle = useCallback(() => {
  savePlaybackStateToServer(audio.currentTime);
}, [savePlaybackStateToServer]);          // ← вызывает её, значит зависим

const playQueue = useCallback((tracks, startIndex, startAtSeconds) => {
  if (shuffleRef.current) { /* ... */ }   // читает только ref'ы и вызывает сеттеры
}, []);                                   // ← поэтому пусто
```

Мнемоника: **читает только ref'ы и вызывает сеттеры — зависимостей нет; читает состояние или
пропсы — они обязаны быть в списке.** Сами сеттеры указывать не нужно: React гарантирует их
стабильность.

**ПОЧЕМУ `progressPercent` НЕ ОБЁРНУТ.** Деление двух чисел стоит наносекунды, и сравнение
зависимостей обошлось бы дороже. **`useMemo` нужен для дорогих вычислений и стабильных ссылок, а не
«на всякий случай».** Эвристика: мемоизируй то, что **пересекает границу компонента** (пропсы,
значения контекста, зависимости эффектов).

---

## 3.11. `useContext`

**ЧТО.** Контекст передаёт данные вглубь дерева, не протаскивая их пропсами через каждый уровень.

**ЗАЧЕМ.** `PlayerProvider` живёт в `layout.tsx`, а `TrackRow` — глубоко внутри `main`. Чтобы
`TrackRow` получила `playQueue`, её пришлось бы передавать через `layout → main → TrackList →
TrackRow`, и каждый промежуточный компонент знал бы про пропс, который ему не нужен. Это **prop
drilling**: чужие пропсы, правки в 5 файлах при добавлении поля, невозможность переиспользовать
`TrackList` там, где нет плеера.

**ШАГ 1. Создание.**

```tsx
// createContext(null) создаёт «пустой» контекст. Значение null означает «вне провайдера
// ничего нет», и наши хуки это проверяют — так проще поймать ошибку «забыл обернуть
// приложение в PlayerProvider», чем получить непонятный undefined где-то в глубине.
const PlayerActionsContext = createContext<PlayerActions | null>(null);
const PlayerTrackContext = createContext<TrackState | null>(null);
const PlayerTimelineContext = createContext<TimelineState | null>(null);
```

**ШАГ 2. Свои хуки вместо прямого `useContext`:**

```tsx
// Компоненты не обращаются к контексту напрямую — они используют эти хуки.
// Плюсы: короче в местах использования, и проверка на null ровно в одном месте.
export function usePlayerActions(): PlayerActions {
  const context = useContext(PlayerActionsContext);
  if (!context) throw new Error("usePlayerActions нужно вызывать внутри <PlayerProvider>");
  return context;
}
```

Что это даёт: **тип гарантирован** (возвращается `PlayerActions`, а не `PlayerActions | null`);
**понятная ошибка** вместо «cannot read property playQueue of null»; **одна точка изменения**. Приём
называется **инкапсуляция контекста**.

**ШАГ 3. Провайдеры** вложены друг в друга и содержат единственный `<audio>`:

```tsx
<PlayerActionsContext.Provider value={actions}>
  <PlayerTrackContext.Provider value={trackState}>
    <PlayerTimelineContext.Provider value={timelineState}>
      <audio ref={audioRef} preload="metadata" />
      {children}
```

**ШАГ 4. Использование.** `TrackList` — `usePlayerActions()` + `usePlayerTrack()`; `HistoryList` —
только действия (`actions.playSingle(entry.track)`); `PlayerBar` — все три, и в коде есть уточнение:

```tsx
// Три подписки — но панель и есть тот единственный компонент, которому
// нужно всё сразу, включая быстро меняющееся время.
```

Правило «не подписывайся на частое» не означает «никогда»: панель **обязана** знать текущее время,
просто она маленькая, и перерисовывать её 60 раз в секунду дёшево.

**ГДЕ ЖИВЁТ ПРОВАЙДЕР** — в `src/app/layout.tsx`:

```tsx
// Именно поэтому <PlayerProvider> живёт здесь: аудиоэлемент создаётся один раз при
// открытии сайта и продолжает играть, пока пользователь листает библиотеку. Если бы
// провайдер стоял в page.tsx, музыка обрывалась бы при каждом переходе.
<PlayerProvider>
  <AppHeader />
  <div className="flex-1 ..."><Sidebar /><main>{children}</main></div>
  <PlayerBar />
</PlayerProvider>
```

`layout.tsx` не пересоздаётся при переходах между страницами, а `page.tsx` — пересоздаётся.

**МИНУСЫ КОНТЕКСТА.** Каждое изменение значения перерисовывает **всех** потребителей (отсюда три
контекста вместо одного); отлаживать сложнее, чем пропсы; есть соблазн положить туда всё — не надо.

---

## 3.12. `useTransition` и `router.refresh()`

**ЧТО.**

```tsx
const [isPending, startTransition] = useTransition();
startTransition(() => { /* обновление, которое можно делать «в фоне» */ });
```

`startTransition(fn)` помечает обновления внутри как **несрочные**: React может их прервать, если
пользователь в это время что-то делает. `isPending` — идёт ли переход сейчас.

**ЗАЧЕМ.** Срочные обновления — ввод текста, клик, скролл; несрочные — пересчёт длинного списка,
загрузка данных. Если всё считать срочным, интерфейс «залипает»: пользователь нажимает клавишу, а
React занят рендером 1000 строк.

**ПРИМЕР — `FavoriteButton`:**

```tsx
// router.refresh() перезапрашивает данные СЕРВЕРНЫХ компонентов, НЕ теряя состояние
// клиентских (плеер НЕ останавливается). Главное отличие от window.location.reload().
// startTransition говорит React: «это обновление можно делать в фоне».
startTransition(() => router.refresh());

// isPending блокирует кнопку на время работы:
<button onClick={handleClick} disabled={isPending}>
```

**ПОЧЕМУ `router.refresh()`.** Server Components (`AppHeader`, `Sidebar`, страницы) выполняются на
сервере и читают базу; Client Components (`TrackList`, `PlayerBar` и всё с `"use client"`) — в
браузере. Когда клиент поменял данные, серверные компоненты об этом не знают — `refresh()`
заставляет выполнить их заново и прислать новый HTML.

| | `router.refresh()` | `window.location.reload()` |
|---|---|---|
| Серверные данные обновляются | да | да |
| Состояние клиента сохраняется | да | нет |
| Музыка продолжает играть | да | **нет, всё умирает** |

Поэтому он используется без исключений: `FavoriteButton`, `PlaylistCard`, `PlaylistCreateForm`,
`HistoryList`, `TrackList`, `AddToPlaylistButton`.

**`useTransition` НУЖЕН НЕ ВСЕГДА.** В `PlaylistCard` и `PlaylistCreateForm` его нет — там просто
`isBusy` / `isSubmitting`: это небольшие обновления. Он нужен там, где **обновление может быть
тяжёлым** — лайк меняет данные, и `refresh()` перерисует весь список треков. **Не добавляй его
превентивно.**

---

## 3.13. Условный рендеринг

```tsx
{error && <div role="alert">⚠ {error}</div>}      // 1. && — показать или ничего
{isPlaying ? "❚❚" : "▶"}                          // 2. тернарник — одно или другое
if (tracks.length === 0) return <div>НЕТ ТРЕКОВ</div>;   // 3. ранний return
```

**ЛОВУШКА `&&`.** Если левая часть — число `0`, React отрисует **цифру 0 на экране**: `0 && <div/>`
возвращает `0`, а `0` — валидный React-элемент.

```tsx
{queueLength && <span>{queueLength}</span>}        // ❌ при 0 появится «0»
{queueLength > 0 && <span>{queueLength}</span>}    // ✅ явное сравнение — так в PlayerBar.tsx
```

**ТЕРНАРНИК.** Больше двух уровней — сигнал завести словарь:

```tsx
{isLoading ? "[ БУФЕРИЗАЦИЯ ]" : isPlaying ? "[ ВОСПРОИЗВЕДЕНИЕ ]" : "[ ПАУЗА ]"}
{repeat === "off" ? "ВЫКЛ" : repeat === "all" ? "ВСЁ" : "ТРЕК"}

// Читаемее:
const repeatLabels: Record<RepeatMode, string> = { off: "ВЫКЛ", all: "ВСЁ", one: "ТРЕК" };
```

**РАННИЙ `return` — самый читаемый способ** (`TrackList.tsx`):

```tsx
if (tracks.length === 0) {
  return <div className="term-panel p-6 text-center text-xs text-ink-muted">{emptyMessage}</div>;
}
// А дальше — обычный список, без единого if.
return <div className="flex flex-col">{tracks.map(...)}</div>;
```

Вложенность меньше на уровень, главный `return` остаётся «плоским», и, читая файл сверху вниз, ты
сначала видишь исключения. Это **guard clauses**. `HistoryList` использует тернарник, потому что
«пусто» — лишь часть разметки (заголовок с кнопкой остаётся). Выбор приёма зависит от того,
**сколько разметки зависит от условия**: всё — ранний `return`, часть — тернарник. А в `CoverArt`
условие вынесено в переменную: `const showPlaceholder = !hasCover || hasError;` — читается сразу.

---

## 3.14. Формы и управляемые компоненты

**ЧТО.** **Управляемый компонент — поле, значение которого живёт в состоянии React.** React
становится **единственным источником правды** для содержимого поля:

```tsx
const [name, setName] = useState("");
<input value={name} onChange={(event) => setName(event.target.value)} />
```

**ЗАЧЕМ.** Цена — рендер на каждое нажатие клавиши. Выгода больше: значение всегда доступно в
переменной, можно валидировать на лету (`disabled={name.trim() === ""}`) и менять программно
(очистить после отправки, сбросить по Escape).

**РАЗБОР `PlaylistCreateForm`.** Три состояния: текст в поле, признак «идёт запрос», текст ошибки.
**`<form onSubmit>` вместо `<button onClick>`** даёт бесплатно отправку по **Enter**, семантику для
скринридеров и нативную валидацию (`required`, `maxLength`, `pattern`).

```tsx
const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();                     // 1. иначе браузер перезагрузит страницу

  const trimmed = name.trim();                // 2. «   » — не имя плейлиста
  if (trimmed === "" || isSubmitting) return;  // 3. второе условие — защита от двойного клика

  void fetch("/api/playlists", {              // 4. void — «я сознательно не жду этот промис»
    method: "POST", body: JSON.stringify({ name: trimmed }),
  })
    .then(async (response) => {
      if (!response.ok) {                     // 5. fetch НЕ считает 404 и 500 ошибкой!
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Не удалось создать плейлист");
      }
      setName("");                            // успех: чистим поле
      router.refresh();                       // и обновляем данные с сервера
    })
    .catch(/* показываем ошибку */)
    .finally(() => setIsSubmitting(false));   // 6. ВСЕГДА: иначе кнопка останется заблокированной
};
```

| Метод | Когда вызывается | Что делает здесь |
|---|---|---|
| `.then()` | запрос успешен | очищает поле, обновляет данные |
| `.catch()` | любая ошибка (сеть или наш `throw`) | показывает сообщение |
| `.finally()` | **всегда** | снимает блокировку с кнопки |

`as { error?: string }` — **утверждение типа**: TypeScript не знает, что вернул сервер, и мы
обещаем ему форму ответа. Это обещание, а не проверка: неверный формат вылезет в рантайме.

**РАЗМЕТКА И ВАЛИДАЦИЯ:**

```tsx
<input type="text" value={name} onChange={(event) => setName(event.target.value)}
       maxLength={100} aria-label="Название нового плейлиста" />
<button type="submit" disabled={isSubmitting || name.trim() === ""}>
  {isSubmitting ? "…" : "＋"}
</button>
```

В комментарии к `maxLength` сформулировано правило безопасности: «Сервер тоже проверяет длину
(см. `/api/playlists`), и это правильно: клиентская проверка для удобства, серверная — для
безопасности». Пользователь может отключить JS, поправить `maxLength` в DevTools или отправить
запрос через `curl`. А `type="submit"` здесь правильный, тогда как в `PlayerBar` и `TrackList` стоит
`type="button"` именно потому, что те кнопки **не** должны ничего отправлять.

**ЕЩЁ ПРИМЕР: `PlaylistCard`** — четыре состояния (`isEditing`, `name`, `isBusy`, `error`)
описывают целую мини-форму; обе кнопки блокируются через `disabled={isBusy}`, а клавиатура
обрабатывается в поле:

```tsx
onKeyDown={(event) => {
  if (event.key === "Enter") handleRename();
  // Escape — отмена. Хороший тон: у любого действия должна быть возможность отмены.
  if (event.key === "Escape") { setName(playlist.name); setIsEditing(false); }
}}
```

Откат `setName(playlist.name)` обязателен — иначе при следующем входе в редактирование там был бы
мусор. **Когда управляемый ввод не нужен:** если значение поля тебе никогда не нужно в JS, поле
можно оставить неуправляемым и читать через `ref`. В этом проекте так не делается нигде.

---

## 3.15. Правила хуков

1. Хуки вызываются только **на верхнем уровне** компонента — не внутри условий, циклов и вложенных
   функций.
2. Хуки вызываются только **из React-функций** — из компонентов и из других хуков.
3. **Порядок вызовов одинаков при каждом рендере.**

**ПОЧЕМУ ЭТО ВАЖНО.** React не подписывает состояние на имена переменных. Он хранит список ячеек
памяти **по порядку вызова хуков**: первый `useState` — ячейка №0, второй — №1, `useEffect` — №2.

```tsx
function Component({ flag }) {
  const [a, setA] = useState(0);     // ячейка 0
  if (flag) {
    const [b, setB] = useState(0);   // ❌ ячейка 1 только когда flag === true
  }
  const [c, setC] = useState(0);     // при flag=false это ячейка 1, при true — ячейка 2
}
```

При переключении `flag` количество хуков меняется, и React прочитает состояние `c` из ячейки, где
лежит `b`. В лучшем случае увидишь ошибку *«Rendered more hooks than during the previous render»*, в
худшем — просто неправильные данные.

**КАК ПРАВИЛЬНО: ранний `return` идёт ПОСЛЕ хуков** (`TrackList.tsx` — образец):

```tsx
const actions = usePlayerActions();                     // ← хуки
const { currentTrack, isPlaying } = usePlayerTrack();   // ← хуки
if (tracks.length === 0) return <div>пусто</div>;       // ← ранний выход ПОСЛЕ
return <div className="flex flex-col">{tracks.map(...)}</div>;
```

**ЭФФЕКТ НЕ МОЖЕТ БЫТЬ УСЛОВНЫМ, НО УСЛОВИЕ МОЖЕТ БЫТЬ ВНУТРИ:**

```tsx
// ❌ НЕЛЬЗЯ: при isPlaying === false хук не вызовется, порядок сломается
if (isPlaying) { useEffect(() => { ... }, []); }

// ✅ ТАК ПРАВИЛЬНО — реальный код из player-context.tsx
useEffect(() => {
  if (!isPlaying) return;
  ...
}, [isPlaying]);
```

То же в `AddToPlaylistButton.tsx` (`if (!isOpen || playlists !== null) return;`) и в эффекте Media
Session (`if (!("mediaSession" in navigator)) return; if (!currentTrack) return;`).
**Мнемоника: хук — всегда, условие — внутри.**

**ХУКИ НЕЛЬЗЯ ВЫЗЫВАТЬ ИЗ ОБЫЧНЫХ ФУНКЦИЙ**, но можно — из функции, имя которой начинается с `use`:

```tsx
function helper() { const [v, setV] = useState(0); }   // ❌ ошибка

function usePlayerActions(): PlayerActions {           // ✅ свой хук
  const context = useContext(PlayerActionsContext);
  if (!context) throw new Error("usePlayerActions нужно вызывать внутри <PlayerProvider>");
  return context;
}
```

**Префикс `use` — не украшение:** по нему линтер (`eslint-plugin-react-hooks` внутри
`eslint-config-next`) проверяет правила хуков. Запуск — `bun run lint`. **Не игнорируй предупреждения
о зависимостях**: почти всегда это настоящий баг. Если зависимость действительно не нужна — объясни
комментарием, как делает автор:

```tsx
// searchParams и pathname в зависимостях: если пользователь перешёл
// на другую страницу, поиск должен применяться уже к ней.
}, [value, pathname, router, searchParams]);
```

---

## 3.16. React Compiler

**ЧТО.** **React Compiler** автоматически оптимизирует компоненты: анализирует код и сам решает, что
можно закешировать. Включается строкой `reactCompiler: true` в `next.config.ts`, плюс
`babel-plugin-react-compiler` в `devDependencies`. Это не эксперимент: компилятор официально
поддерживается и в проекте включён. Он делает то же, что ты написал бы руками, но точнее (видит все
зависимости, а не только вспомненные), везде и без обёрток.

**ПОЧЕМУ `useCallback` ВСЁ РАВНО НАПИСАНЫ РУКАМИ** — ответ прямо в `player-context.tsx`:

```tsx
// При включённом React Compiler он делает мемоизацию сам, но писать
// useCallback всё равно полезно: код явнее и не зависит от настроек.
```

1. **Явность.** Читающий видит `useCallback(..., [])` и сразу понимает: «функция стабильна,
   зависимости пусты, безопасна как пропс и как зависимость эффекта». С компилятором это надо
   выводить из анализа.
2. **Независимость от настроек сборки.** Строку `reactCompiler: true` можно убрать. Если мемоизация
   держалась только на компиляторе, проект начнёт тормозить, и причина будет неочевидна.
3. **Массив зависимостей — документация связей.** `}, [isPlaying, savePlaybackStateToServer]);`
   сообщает читателю, при изменении чего эффект перезапускается.

**ЧТО ДЕЛАТЬ ТЕБЕ.** Пиши `useMemo`/`useCallback` руками, пока учишься. Оптимизируя существующий
код, сначала измерь проблему. И **не оборачивай всё подряд**: `useMemo` вокруг деления двух чисел
или `useCallback` вокруг функции, используемой один раз в `onClick` того же компонента, — это шум.
Мемоизируй то, что пересекает границу компонента: пропсы, значения контекста, зависимости эффектов.

---

## 3.17. Шпаргалка: хук → когда использовать → пример в проекте

| Хук | Когда использовать | Пример в проекте |
|---|---|---|
| `useState` | Данные, которые меняются во времени и влияют на вид | `FavoriteButton` — `optimisticValue`; `SearchBar` — `value`; `PlaylistCreateForm` — `name`/`isSubmitting`/`error`; `CoverArt` — `hasError` |
| `useEffect` | Синхронизация с внешним миром: подписки, таймеры, DOM, сеть, `localStorage` | `player-context.tsx` — события `<audio>`, `requestAnimationFrame`, `pagehide`, Media Session, чтение настроек; `PlayerBar` — горячие клавиши; `AddToPlaylistButton` — клик вне меню |
| `useRef` | DOM-узел или «коробка» для значения без перерисовки | `audioRef`; `repeatRef`/`shuffleRef`/`orderRef`/`orderPositionRef`/`queueRef`; `shouldAutoplayRef`; `pendingSeekRef`; `containerRef` |
| `useCallback` | Стабильная ссылка на функцию: пропс или зависимость эффекта | `playQueue`, `playSingle`, `toggle`, `next`, `previous`, `seek`, `setVolume`, `toggleMute`, `cycleRepeat`, `toggleShuffle`, `stop` |
| `useMemo` | Дорогое вычисление или стабильный объект (значение контекста) | `actions`, `trackState`, `timelineState` |
| `useContext` | Данные нужны глубоко в дереве, а тащить пропсы через 5 уровней не хочется | `usePlayerActions()`, `usePlayerTrack()`, `usePlayerTimeline()` |
| `useTransition` | Обновление может быть тяжёлым и не должно блокировать интерфейс | `FavoriteButton` — `startTransition(() => router.refresh())` |
| `useRouter` | Программная навигация, `refresh()`, `replace()` | `FavoriteButton`, `SearchBar`, `PlaylistCard`, `HistoryList`, `TrackList` |

**Хуки, написанные вручную** (все — в `player-context.tsx`): `usePlayerActions()` — функции плеера;
`usePlayerTrack()` — текущий трек, играет/нет, загрузка, повтор, shuffle, очередь;
`usePlayerTimeline()` — время, длительность, громкость (использует только панель плеера).

| Событие | Когда срабатывает | Пример |
|---|---|---|
| `onClick` | клик мышью или Enter | `PlayerBar` — транспорт; `TrackRow` — запуск трека |
| `onChange` | изменение поля/ползунка | `SearchBar` — ввод; `PlayerBar` — громкость и перемотка |
| `onKeyDown` | нажатие клавиши | `TrackRow` — Enter/пробел; `PlaylistCard` — Enter/Escape |
| `onSubmit` | отправка формы | `PlaylistCreateForm` |
| `onError` | ошибка загрузки ресурса | `CoverArt` — заглушка вместо обложки |

| Приём | Суть | Где смотреть |
|---|---|---|
| Разделяй состояние по частоте изменений | Три контекста; список не подписан на время | шапка `player-context.tsx`, `TrackList.tsx` |
| Ref'ы для актуальных значений | Обойти замыкание в обработчике, подписанном один раз | `repeatRef`, `orderRef`, `queueRef` |
| Оптимистичное обновление | Показать результат сразу, откатить при ошибке | `FavoriteButton` |
| URL как состояние | Поиск живёт в адресной строке | `SearchBar` |
| `router.refresh()` вместо `reload()` | Обновить данные, не убив плеер | `FavoriteButton`, `PlaylistCard` |
| Дебаунс через cleanup | Отменить предыдущий таймер при новом вводе | `SearchBar` (300 мс) |
| Одноразовый слушатель | `removeEventListener` внутри самого обработчика | `pendingSeekRef` |
| Guard clauses | Ранний `return` вместо вложенных условий | `TrackList`, `HistoryList` |

---

## 3.18. Итоги

1. **React — это функция от состояния:** `UI = f(state)`. DOM руками не трогаем, кроме случаев,
   когда иначе нельзя (`<audio>`).
2. **Пропсы вниз, события вверх.** Компонент не знает, кто его использует, — и это делает его
   переиспользуемым.
3. **`useEffect` — не «после рендера», а «синхронизация с внешним».** Нет внешнего — скорее всего,
   эффект не нужен.
4. **`useRef` нужен для DOM и для «памяти» обработчиков.** Именно ref'ы решают проблему замыканий в
   обработчиках, подписанных один раз; здесь живёт половина сложных багов в React.
5. **Разделяй состояние по частоте изменений.** Правило важнее знания отдельных хуков: три
   контекста появились не из любви к архитектуре, а потому что иначе список из 1000 треков
   перерисовывался бы 60 раз в секунду.

Дальше — `docs/04-nextjs-app-router.md`: Server и Client Components, роутинг, API-роуты, работа с
базой через Drizzle, то есть как клиентский React из этой главы стыкуется с сервером.
