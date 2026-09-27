# TypeScript: справочник для новичка (на коде этого проекта)

Учебный материал проекта. Он не про «TypeScript вообще», а про то, **какие конструкции реально
встречаются в этом плеере и что они означают**. Все примеры — из настоящего кода, с путями к файлам.

Это справочник: читать подряд не обязательно. Но разделы 1–3 стоит прочитать целиком — без них
остальное будет выглядеть как случайный набор символов.

1. [Зачем TypeScript, если есть JavaScript](#1-зачем-typescript-если-есть-javascript)
2. [Как читать типы: азбука](#2-как-читать-типы-азбука)
3. [`type` против `interface`](#3-type-против-interface)
4. [Объединения и литеральные типы](#4-объединения-union-и-литеральные-типы)
5. [Опциональные поля](#5-опциональные-поля--против--undefined)
6. [Функции, `Promise<T>`, `async/await`](#6-функции-promiset-asyncawait)
7. [Дженерики](#7-дженерики-t-titem-tresult)
8. [Сужение типов и type guards](#8-сужение-типов-и-type-guards)
9. [Операторы: `??`, `?.`, `!`, `as`](#9-операторы--и-as)
10. [Деструктуризация, spread, rest](#10-деструктуризация-spread-rest)
11. [`as const`](#11-as-const)
12. [Типы из схемы Drizzle](#12-типы-из-схемы-drizzle)
13. [Утилитарные типы](#13-утилитарные-типы)
14. [`readonly`](#14-readonly)
15. [Частые ошибки и как их читать](#15-частые-ошибки-новичков-и-как-их-читать)
16. [Шпаргалка](#16-шпаргалка)

---

## 1. Зачем TypeScript, если есть JavaScript

**Тип — это описание того, какие данные лежат в переменной.** `"ATL"` — строка, `213.457` — число.
В JavaScript типы есть, но они невидимы: движок выясняет их во время выполнения. В TypeScript ты
пишешь описания прямо в коде, а компилятор проверяет их **до запуска**. Это и называется
**статической типизацией**: проверка один раз, заранее, на этапе сборки — а не в момент, когда
пользователь нажал кнопку.

Аналогия из твоего мира данных:

| Мир данных | Мир TypeScript |
|---|---|
| Схема таблицы: `duration REAL NOT NULL` | `duration: number` в `type TrackDTO` |
| Ошибка «column does not exist» | Ошибка «Property 'titel' does not exist» |
| `dbt test` ловит проблему на сборке | Компилятор ловит проблему при наборе текста |

В этом проекте типизация окупается в трёх конкретных местах.

**1. Опечатки в полях базы.** Схема в `src/lib/db/schema.ts` описана на TypeScript, и Drizzle
выводит из неё типы строк. `row.titel` вместо `row.title` — ошибка сразу. В «голом» SQL такая
опечатка всплыла бы только при выполнении запроса.

**2. Граница сервер ↔ браузер.** Через неё проходят только сериализуемые значения: `number` можно,
`Date` нельзя. В `src/lib/types.ts` это зафиксировано:

```ts
// src/lib/types.ts
export type TrackDTO = {
  id: number;
  title: string;
  /** Когда трек появился в библиотеке. Unix-время в МИЛЛИСЕКУНДАХ. */
  addedAt: number;
};
```

`addedAt` — число. А в базе колонка `createdAt` объявлена через `mode: "timestamp_ms"`, поэтому
Drizzle отдаёт **`Date`**. Превращение делает маппер:

```ts
// src/lib/db/mappers.ts
addedAt: row.createdAt.getTime(),   // Date → number
```

Забудь `.getTime()` — компилятор откажется: «`Date` не присваивается к `number`». Это ровно та
ошибка, которая иначе всплыла бы в интерфейсе как `[object Date]`.

**3. Необязательные поля.** `listTracks` возвращает `Promise<TrackDTO[]>` — и никакой компонент
не может случайно обратиться к `track.path`, потому что в DTO такого поля нет. Его там нет
сознательно: раскрывать пути файловой системы наружу не нужно (комментарий в `types.ts`).

**Чего TypeScript НЕ делает.** Не проверяет данные извне (ответ API, тело запроса, `localStorage`
для него «неизвестно что» — отсюда ручные проверки `isTrackSortKey`, `parseId`, `parseNumberParam`);
не ловит логические ошибки (тип скажет «здесь число», но не скажет «здесь 0..1» — диапазон
проверяется руками, см. `setVolume` в `player-context.tsx`); исчезает в рантайме (в собранном
JS-файле нет ни слова `TrackDTO`).

**Итог:** TypeScript — не защита от всех ошибок, а очень дешёвый фильтр для самой скучной их
категории: опечаток, забытых проверок, неверных типов аргументов.

---

## 2. Как читать типы: азбука

```ts
string    // "ATL", "", "Ящик"
number    // 42, 3.14, -1, NaN, Infinity — ВСЕ числа одним типом
boolean   // true / false
null      // «значение сознательно пустое»
undefined // «значение не задано»
```

Отдельных `int` и `float` нет — всё `number`. Длительность `213.457` и номер трека `7` — оба
`number`. Это отличается от SQLite, где `INTEGER` и `REAL` — разные типы (`schema.ts`). `NaN` и
`Infinity` тоже `number`, поэтому в форматировании есть ручная защита:

```ts
// src/lib/format.ts
if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
```

`Number.isFinite` отсеивает и `NaN`, и `Infinity` — типы этого не сделают, они «законные» числа.

### Массивы

```ts
TrackDTO[]        // «массив треков»
Array<TrackDTO>   // то же самое через generic
```

В проекте используется короткая форма:

```ts
// src/lib/db/track-queries.ts
export async function listTracks(options: ListTracksOptions = {}): Promise<TrackDTO[]> {
```

Читается: «функция вернёт промис, который разрешится массивом `TrackDTO`». Вложенные массивы
читаются справа налево: `string[][]` — массив массивов строк.

### Объекты

```ts
// src/lib/db/track-queries.ts — параметры выборки треков
export type ListTracksOptions = {
  search?: string;
  artist?: string;
  album?: string;
  favoritesOnly?: boolean;
  sort?: TrackSortKey;
  limit?: number;
  offset?: number;
};
```

Типы объектов в TypeScript **структурные**: важен набор полей, а не имя типа. Поэтому в маппере
тип описан «на месте», без отдельного имени, и подойдёт любой объект с такой формой:

```ts
// src/lib/db/mappers.ts
export function toPlaylistDTO(row: {
  id: number; name: string; description: string | null;
  trackCount: number | null; createdAt: Date;
}): PlaylistDTO {
```

Полезный навык — произносить тип словами:

```ts
Map<string, { id: number; mtimeMs: number; size: number }>   // track-queries.ts
// «Map, где ключ — строка, а значение — объект с тремя числами»

{ start: number; end: number } | "invalid" | null           // stream/route.ts
// «либо диапазон, либо строка "invalid", либо null»
```

Если можешь произнести тип словами — ты его понимаешь.

---

## 3. `type` против `interface`

Оба описывают форму объекта:

```ts
type TrackDTO = { id: number; title: string };
interface TrackDTO { id: number; title: string }   // то же самое
```

| Возможность | `type` | `interface` |
|---|---|---|
| Объединения (`string \| null`) | ✅ | ❌ |
| Литеральные типы (`"off" \| "all"`) | ✅ | ❌ |
| Слияние объявлений (дописать позже) | ❌ | ✅ |
| Псевдоним для массива или примитива | ✅ | ❌ |

**В проекте используется `type` везде.** Причина: значительная часть типов здесь — не «форма
объекта», а объединения и псевдонимы, которые интерфейсом не записать в принципе:

```ts
// src/lib/types.ts
export type TrackSortKey = "added_desc" | "title_asc" | "artist_asc" | "album_asc" | "duration_desc";
```

Смешивать два инструмента — значит каждый раз вспоминать, «что тут можно», поэтому выбран один.
**Совет:** не чувствуешь разницы — пиши `type`. `interface` понадобится, только если ты пишешь
библиотеку, которую должны дополнять снаружи.

---

## 4. Объединения (union) и литеральные типы

Символ `|` — это «или». В проекте он почти всегда означает честное признание, что значения
может не быть:

```ts
// src/lib/types.ts
export type PlaylistDTO = {
  id: number;
  name: string;
  description: string | null;   // у плейлиста может не быть описания
  trackCount: number;
  createdAt: number;
};

export type PlaybackStateDTO = {
  track: TrackDTO | null;       // плеер может быть пустым
  position: number;
};
```

Ценность: TypeScript **обязательно** заставит обработать обе ветки. `playlist.description.length`
не скомпилируется — «может быть `null`».

### Литеральные типы

Литеральный тип допускает ровно одно значение: `"off"` — это не «строка вообще», а именно
строка `off`. Из них собирают union'ы, работающие как enum, только без церемоний:

```ts
// src/components/player/player-context.tsx
/** Режим повтора. Строковый union — «одно из трёх значений». */
export type RepeatMode = "off" | "all" | "one";

const [repeat, setRepeat] = useState<RepeatMode>("off");
const nextMode: RepeatMode = current === "off" ? "all" : current === "all" ? "one" : "off";
```

`setRepeat("al")` — опечатка ловится сразу. С типом `string` она ушла бы в рантайм и проявилась
как «повтор почему-то не работает».

**Ключевой момент:** значение из `localStorage` — это обычный `string`, не `RepeatMode`. Поэтому
в том же файле есть ручная проверка:

```ts
// src/components/player/player-context.tsx
const savedRepeat = readLocalStorage(STORAGE_REPEAT_KEY);
if (savedRepeat === "off" || savedRepeat === "all" || savedRepeat === "one") {
  setRepeat(savedRepeat);   // только здесь TypeScript согласен, что это RepeatMode
}
```

Литеральные типы проверяются статически, а данные из внешнего мира — руками. Три сравнения через
`||` и есть эта ручная проверка.

### Union из нескольких форм, а не «значение или null»

```ts
// src/app/api/tracks/[id]/stream/route.ts
function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number,
): { start: number; end: number } | "invalid" | null {
```

«Либо диапазон байт, либо `"invalid"` (заголовок битый), либо `null` (заголовка нет — отдаём файл
целиком)». Три состояния вместо двух осмысленны: они требуют разной реакции (200 против 416).
С одним `null` на оба случая логику пришлось бы угадывать.

---

## 5. Опциональные поля: `?` против `| undefined`

```ts
type A = { name?: string };            // поле может ОТСУТСТВОВАТЬ
type B = { name: string | undefined }; // поле ЕСТЬ, но значение может быть undefined
```

В `ListTracksOptions` (`track-queries.ts`) использовано `?` — и это осознанно: функция должна
вызываться без аргументов, поэтому у неё есть значение по умолчанию `= {}`.

```ts
export async function listTracks(options: ListTracksOptions = {}): Promise<TrackDTO[]> {
```

Внутри поля проверяются перед использованием — и `if` здесь не привычка: внутри блока
`string | undefined` сужается до `string`, и `eq()` получает гарантированную строку.

```ts
// src/lib/db/track-queries.ts
if (options.artist) {
  conditions.push(eq(tracks.artist, options.artist));
}
```

**Когда что выбирать:**

* `?` — «настроечные» объекты, где поле логично не указывать (опции запроса, параметры функции).
* `| null` — данные, где «пусто» приходит **из базы**. В `PlaylistDTO` стоит
  `description: string | null`, потому что в SQLite колонка объявлена без `.notNull()`
  (`schema.ts`), то есть `NULL` — законное значение, и оно доедет как `null`.
* `| undefined` пишут редко: в 95% случаев хватает `?`.

---

## 6. Функции, `Promise<T>`, `async/await`

```ts
function formatDuration(totalSeconds: number): string
//       ↑ имя            ↑ параметр: тип       ↑ что вернёт
```

Из `src/lib/format.ts`. Читается буквально: «дай число секунд — получишь строку». Аннотация
возврата **фиксирует контракт**: если внутри случайно написать `return total`, компилятор
пожалуется, что возвращается `number` вместо `string`.

Параметр со значением по умолчанию короче, чем `?` плюс проверка внутри:

```ts
// src/lib/api-helpers.ts
export function parseNumberParam(value: string | null, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number
```

### `Promise<T>` — обещание значения типа T

Асинхронная функция возвращает не значение, а **обещание** его вернуть:

```ts
// src/lib/db/track-queries.ts
export async function getTrackRowById(id: number): Promise<TrackRow | null> {
  const rows = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
  return rows[0] ?? null;
}
```

Комментарий в файле объясняет, зачем здесь `| null`: «явно указанный null заставляет вызывающий код
обработать случай "трека нет" — TypeScript не даст забыть про эту проверку». И это действительно
работает:

```ts
// src/app/api/tracks/[id]/stream/route.ts
const track = await getTrackRowById(trackId);
if (!track) {
  return jsonError(`Трек ${trackId} не найден в библиотеке`, 404);
}
// только ЗДЕСЬ track имеет тип TrackRow, а не TrackRow | null
```

Без `| null` проверку можно было бы забыть — и однажды получить падение на `track.path`.

### Правила `async` / `await`

1. `await` пишется только внутри `async`-функции.
2. `await` разворачивает промис: `await foo()` даёт `T`, а не `Promise<T>`.
3. Забыл `await` — получил промис вместо значения. TypeScript поймает это, если тип объявлен явно.

Живой пример: `context.params` в Next.js 16 — это `Promise<{ id: string }>`, поэтому без `await`
обращение `.id` было бы к полю промиса, которого не существует:

```ts
// src/app/api/playlists/[id]/route.ts
const parsed = parseId((await context.params).id);
```

Параллельные запросы — через `Promise.all`, тип результата при этом кортеж, поэтому деструктуризация
массива даёт точные типы:

```ts
// src/app/page.tsx
const [tracks, playbackState] = await Promise.all([
  listTracks({ ... }),
  getPlaybackState(),
]);
```

Функция без возвращаемого значения помечается `void` — писать не обязательно, но полезно:
читающий сразу видит, что результат ждать не нужно.

```ts
// src/components/player/player-context.tsx
function writeLocalStorage(key: string, value: string): void {
```

---

## 7. Дженерики (`<T>`, `<TItem, TResult>`)

Без дженериков функция «взять первый элемент массива» выглядит так:

```ts
function first(arr: any[]): any { return arr[0]; }   // теряем всю информацию о типе
```

`any` означает «выключи проверки»: вместе с ним ты теряешь подсказки и проверки у всего, что с этим
значением потом делают. **Дженерик — это тип-параметр: тип, который подставится в момент вызова.**
В момент написания функции он неизвестен, в момент вызова — известен.

```ts
// src/lib/async-pool.ts
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  worker: (item: TItem, index: number) => Promise<TResult>,
  limit = 6,
): Promise<TResult[]> {
```

Читаем вслух: «дай массив элементов `TItem` и функцию, превращающую `TItem` в обещание `TResult`;
я верну массив `TResult`». В вызове конкретные типы подставляются сами:

```ts
const sizes = await mapWithConcurrency(files, async (file) => file.size);
//     ↑ number[]        ↑ TItem выведен из files как FoundFile
//                       ↑ TResult = number — выведен из возврата worker'а
```

TypeScript вывел `TItem` из первого аргумента, а `TResult` — из тела колбэка, и ни одного углового
слова писать не пришлось. **В этом и смысл дженериков: строгость без многословия.** Выводу помогает
связь: `TItem` встречается и в `items`, и в `worker`. Будь у `worker` тип `any`, связи бы не было.

### Когда дженерик указывают вручную

```ts
// src/lib/api-helpers.ts
export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
```

Здесь `T` **нельзя** вывести: тело запроса — рантайм-данные, у них нет статического типа. Поэтому
его пишут явно:

```ts
// src/app/api/playlists/[id]/route.ts
type UpdatePlaylistBody = { name?: string; description?: string | null };

const body = await readJsonBody<UpdatePlaylistBody>(request);
if (!body) return jsonError("Тело запроса пустое или не является JSON", 400);
if (body.name !== undefined && body.name.trim() === "") { ... }
```

Что здесь честно, а что нет — важный урок:

* **Честно:** `Promise<T | null>` заставляет проверить `if (!body)`. Битое тело действительно даёт
  `null`: `request.json()` бросает исключение, `catch` его ловит.
* **Не вполне честно:** `as T` — это **обещание**, а не проверка. Никто не проверял, что в JSON есть
  поле `name` строкового типа. Пришлют `{"name": 42}` — TypeScript будет уверен, что там строка,
  и `body.name.trim()` упадёт в рантайме.

Это нормальный компромисс для учебного проекта, но знать о нём обязательно: **`as T` после
`request.json()` — доверие, а не валидация.** Настоящая валидация — Zod или ручные проверки вроде
`parseNumberParam`.

### Дженерики у хуков React

```ts
// src/components/player/player-context.tsx
const [queue, setQueue] = useState<TrackDTO[]>([]);
const audioRef = useRef<HTMLAudioElement | null>(null);
const actions = useMemo<PlayerActions>(() => ({ ... }), [ ... ]);
```

`useState<TrackDTO[]>` нужен потому, что из `[]` тип элемента не вывести (без него `queue` был бы
`never[]`). А `useState(false)` дженерика не требует: из `false` выводится `boolean`.

---

## 8. Сужение типов и type guards

Изначально тип может быть широким (`string | null`). По ходу кода ты **доказываешь** компилятору,
что значение уже не `null`, — и тип сужается (narrowing). Способы сузить:

```ts
if (value !== null) { ... }        // сравнение
if (value) { ... }                 // truthiness (осторожно: "" и 0 «ложные»)
if (typeof value === "string")     // проверка typeof
if (Array.isArray(value))          // проверка массива
if (value instanceof Response)     // проверка класса
switch (value) { case "off": ... } // по литералам union
```

### Свой type guard: `isTrackSortKey`

```ts
// src/app/api/tracks/route.ts
const ALLOWED_SORTS: readonly TrackSortKey[] = [
  "added_desc", "title_asc", "artist_asc", "album_asc", "duration_desc",
];

function isTrackSortKey(value: string | null): value is TrackSortKey {
  // `value is TrackSortKey` — обещание TypeScript'у:
  // «если функция вернула true, считай value именно этим типом».
  return value !== null && (ALLOWED_SORTS as readonly string[]).includes(value);
}
```

Обычный `boolean` в возвращаемом типе ничего не доказывает: `if (isTrackSortKey(x))` не сузило бы
тип. Конструкция `value is TrackSortKey` — **предикат типа**; она говорит: «вернула `true` — значит
аргумент имеет такой тип».

```ts
// src/app/api/tracks/route.ts
const rawSort = params.get("sort");   // тип: string | null
const tracks = await listTracks({
  sort: isTrackSortKey(rawSort) ? rawSort : "added_desc",
  //    ↑ здесь rawSort сузился до TrackSortKey
});
```

Без `is` пришлось бы писать `rawSort as TrackSortKey`, то есть выключить проверку. А так проверка
реально произошла: внутри честный `includes` по списку разрешённых значений, соврать он не может.
Заметь `value !== null` в теле: без него `.includes()` не примет `null` — компилятор буквально ведёт
тебя к правильному коду.

### Type guard через класс: `parseId`

```ts
// src/app/api/playlists/[id]/route.ts
function parseId(rawId: string): number | Response {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Некорректный идентификатор плейлиста", 400);
  }
  return id;
}
```

Функция возвращает **либо число, либо готовый HTTP-ответ с ошибкой**: она сама решает, что не так
с входом. Вызывающему остаётся вернуть ответ, если это ответ:

```ts
const parsed = parseId((await context.params).id);   // number | Response
if (parsed instanceof Response) return parsed;
// ↑ после этой строки parsed: number
const playlist = await getPlaylist(parsed);          // здесь точно number
```

`instanceof Response` — встроенный type guard: раз это не `Response`, значит `number`. Приём хорош
тем, что валидация становится обычной веткой кода, а не исключением: иначе всё пришлось бы оборачивать
в `try/catch`, и ошибка валидации смешалась бы с настоящими сбоями.

### Сужение в хуках контекста

```ts
// src/components/player/player-context.tsx
export function usePlayerActions(): PlayerActions {
  const context = useContext(PlayerActionsContext);   // PlayerActions | null
  if (!context) {
    throw new Error("usePlayerActions нужно вызывать внутри <PlayerProvider>");
  }
  return context;   // здесь уже PlayerActions
}
```

Контекст создан как `createContext<PlayerActions | null>(null)` — «вне провайдера ничего нет».
После проверки тип сужается, и хук может обещать потребителям честный `PlayerActions`. Вся работа
с «а вдруг null» собрана в одном месте — в этих трёх хуках.

---

## 9. Операторы: `??`, `?.`, `!` и `as`

### `??` — nullish coalescing

Возвращает правую часть, только если слева `null` или `undefined`:

```ts
// src/lib/db/track-queries.ts
.limit(options.limit ?? 1000)
.offset(options.offset ?? 0);
```

**Главное отличие от `||`:** `||` срабатывает и на других «ложных» значениях — `0`, `""`, `false`.
Наглядный случай из `player-context.tsx`:

```ts
const next = value ?? !current.isFavorite;
```

Если пользователь явно передал `false`, `??` его сохранит, а `||` заменил бы на инверсию — кнопка
«убрать из избранного» работала бы наоборот. **Правило: для чисел и булевых значение по умолчанию —
почти всегда `??`, а не `||`.** Бывает и обратное: в `src/lib/config.ts` использован `||` намеренно,
потому что пустая строка тоже должна считаться «не задано»:

```ts
const value = rawValue?.trim() || fallback;
```

### `?.` — optional chaining

Обращается к полю, но если слева `null`/`undefined` — останавливается и возвращает `undefined`
вместо падения. Тут два оператора подряд, разберём по шагам:

```ts
// src/components/player/player-context.tsx
const code = audio.error?.code;                              // 1. нет ошибки → undefined
setError(messages[code ?? 0] ?? "Не удалось воспроизвести трек");
//              ↑ 2. если код неизвестен, ищем по ключу 0 (там пусто)
//                                  ↑ 3. и тогда подставляем общий текст
```

Ещё пример — «вызови метод, только если объект есть»: `void audioRef.current?.play();`
Без `?.` пришлось бы писать `if (audioRef.current) audioRef.current.play();`.

### `!` — non-null assertion (лучше избегать)

Восклицательный знак означает: «я, человек, обещаю, что здесь не `null`, отключи проверку».
Плохо это потому, что обещание никем не проверяется: если оно ложное, будет ошибка в рантайме,
которую компилятор мог предотвратить.

```ts
const audio = audioRef.current!;   // ⚠️ «поверь мне»
audio.play();
```

**Как в проекте делают вместо этого:**

```ts
// src/components/player/player-context.tsx
const toggle = useCallback(() => {
  const audio = audioRef.current;
  if (!audio) return;        // ← настоящая проверка вместо `!`
  if (!audio.src) return;
  // дальше audio имеет тип HTMLAudioElement
```

Этот шаблон повторяется в `player-context.tsx` многократно и является **правильным способом работы
с `useRef`**: одна честная проверка — и сужение работает на весь блок. `!` уместен только там, где
ты знаешь больше компилятора и можешь это обосновать (например, `result[0].id` в конце `upsertTrack`:
запрос `INSERT ... RETURNING id` обязан вернуть строку).

**Практическое правило: сначала пробуй `if (!x) return;`. `!` — последнее средство.**

### `as` — приведение типа и когда оно опасно

`as` означает «считай это значение таким типом». Никакой проверки при этом не происходит.

**Опасно** — приводить данные извне:

```ts
// src/lib/api-helpers.ts
return (await request.json()) as T;   // тело запроса может содержать что угодно
```

**Относительно безопасно** — когда значение уже проверено руками:

```ts
// src/app/page.tsx
const sort: TrackSortKey =
  rawSort && (ALLOWED_SORTS as readonly string[]).includes(rawSort) ? (rawSort as TrackSortKey) : "added_desc";
```

`as TrackSortKey` стоит **после** проверки `includes`, то есть не создаёт уверенность, а
подтверждает её. Порядок «сначала проверить, потом привести» — правильный.

**Вынужденно** — несовершенство типов библиотек:

```ts
// src/app/api/tracks/[id]/stream/route.ts
return Readable.toWeb(nodeStream) as unknown as ReadableStream;
```

Двойное приведение нужно потому, что тип `ReadableStream` из `node:stream/web` и глобальный
`ReadableStream` (из DOM) формально разные, хотя фактически это одно и то же. Прямое
`as ReadableStream` TypeScript запретил бы как «слишком разные типы», поэтому идём через `unknown`,
совместимый со всем. Причина описана в комментарии рядом — так и надо делать.

**Сигнал на будущее:** понадобилось `as unknown as` — почти всегда разошлись типы из разных миров
(Node vs браузер, две версии библиотеки). Костыль допустимый, но требует комментария. Похожий
«костыль с признанием» есть в `src/lib/async-pool.ts`:

```ts
results[currentIndex] = undefined as unknown as TResult;   // ошибка элемента не валит всю пачку
```

Замысел понятен, но честно говоря, это **запах**: массив `TResult[]`, в котором может лежать
`undefined`, — уже не совсем `TResult[]`. Правильнее было бы `(TResult | undefined)[]`, и тогда
вызывающий был бы обязан обработать пропуски.

---

## 10. Деструктуризация, spread, rest

### Деструктуризация объектов и массивов

```ts
// src/app/api/tracks/[id]/stream/route.ts
const { start, end } = parsedRange;          // объект → переменные
const chunkSize = end - start + 1;
const { id } = await context.params;         // вместо context.params.id
```

С переименованием — когда имя уже занято: `const { id: trackId } = await context.params;`

```ts
// src/app/page.tsx
// Деструктуризация массива: порядок результатов совпадает с порядком промисов
const [tracks, playbackState] = await Promise.all([ ... ]);
```

Порядок важен: первая переменная получает первый элемент. Ошибка в порядке — частая причина
загадочных багов, поэтому в проекте рядом стоит комментарий. Тот же приём — для обмена значений
без временной переменной (правая часть вычисляется целиком **до** присваивания):

```ts
// src/components/player/player-context.tsx (shuffleIndices)
[indices[i], indices[j]] = [indices[j], indices[i]];
```

### Spread `...` — «раскрыть»

В вызовах — превратить массив в список аргументов:

```ts
// src/lib/db/track-queries.ts
.where(conditions.length > 0 ? and(...conditions) : undefined)
.orderBy(...buildOrderBy(options.sort))
```

`and(...conditions)` передаёт массив условий как отдельные аргументы: `and(c1, c2, c3)`. То же
с `orderBy`, которому `buildOrderBy` возвращает массив полей сортировки (в SQL — `ORDER BY artist
ASC, album ASC`) — см. `buildOrderBy` в том же файле.

Для копирования массива — в React это нужно постоянно, чтобы не мутировать состояние:

```ts
// src/components/player/player-context.tsx (putFirst, toggleShuffle)
const result = indices.slice();                       // копия
const natural = currentOrder.slice().sort((a, b) => a - b);
```

Копия обязательна, потому что `sort()` меняет массив **на месте**: без `slice()` мы бы
отсортировали состояние React, что запрещено.

### Rest `...` — «собери остальное»

```ts
// src/lib/config.ts
export function log(message: string, ...details: unknown[]): void {
  console.log(`[player] ${message}`, ...details);
}
```

`...details: unknown[]` — «все остальные аргументы собери в массив». Вызывать можно с любым их
количеством: `log("скан начат", MUSIC_DIR, 42)`. Обрати внимание: `unknown[]`, а не `any[]` —
см. раздел 15.

---

## 11. `as const`

`as const` говорит компилятору две вещи: не расширять литералы (`".mp3"` останется типом `".mp3"`,
а не станет `string`) и сделать всё только для чтения.

```ts
// src/lib/config.ts
export const AUDIO_EXTENSIONS = [".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav"] as const;
```

Без `as const` тип был бы `string[]`. С ним — `readonly [".mp3", ".flac", ...]`, то есть **кортеж
литералов**: TypeScript знает не просто «это строки», а какие именно и сколько их.

### Почему приходится писать `as readonly string[]`

Комментарий в `src/lib/scanner/walk.ts` объясняет это точнее всего:

> `AUDIO_EXTENSIONS` объявлен через `as const`, поэтому его тип — `readonly [".mp3", ".flac", ...]`,
> а не `string[]`. Массив `includes` у такого типа ждёт строго один из этих литералов, а у нас
> обычная строка `string` — TypeScript справедливо ругается. Приведение `as readonly string[]`
> снимает излишнюю строгость.

```ts
// src/lib/scanner/walk.ts
function isAudioFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();   // тип: string
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}
```

Разбор, почему без приведения не обойтись: `extension` — обычная `string`, её значение известно
только в рантайме; а `AUDIO_EXTENSIONS` — `readonly [".mp3", ...]`, и его `includes` **сужен** до
`(searchElement: ".mp3" | ".flac" | ...)`. Произвольную строку туда не передать: почти все строки
в этот список не входят. Приведение к `readonly string[]` расширяет параметр `includes` до `string`;
логика не меняется, меняется только строгость.

| Плюсы и минусы `as const` в этом месте | |
|---|---|
| ➕ | константа неизменяема: `AUDIO_EXTENSIONS.push("...")` не скомпилируется |
| ➕ | тип точно описывает содержимое — IDE подсказывает конкретные расширения |
| ➖ | обычные операции вроде `includes(variable)` требуют `as readonly string[]` |

Компромисс нормальный: строгость там, где она ловит ошибки, и **видимое** ослабление там, где она
мешает. Читающий человек видит `as readonly string[]` и понимает, что проверка ослаблена сознательно.

Тот же приём в другом смысле — в `src/components/layout/MainNav.tsx`, где `NAV_ITEMS = [...] as const`
защищает пункты меню от случайного изменения. А в `src/app/api/tracks/route.ts` та же задача решена
**иначе** — аннотацией вместо `as const`:

```ts
const ALLOWED_SORTS: readonly TrackSortKey[] = [ ... ];
```

Массив тоже неизменяем, но его тип — `string`, поэтому надоедливое приведение при `includes` не
понадобится. Хорошая иллюстрация, что одну задачу можно решить двумя способами.

---

## 12. Типы из схемы Drizzle

Можно было бы объявить `type TrackRow = { id: number; path: string; /* ... ещё 15 полей */ }` и потом
**следить**, чтобы это не разошлось со схемой. Забыл дописать новую колонку — и компилятор ругается
на поле, которое в базе есть. Drizzle решает это так: схема в `src/lib/db/schema.ts` — **источник
правды**, а типы выводятся из неё.

```ts
// src/lib/db/schema.ts
/** Строка таблицы tracks, как её возвращает SELECT. */
export type TrackRow = typeof tracks.$inferSelect;

/** Объект для вставки в tracks (id и даты можно не указывать). */
export type NewTrack = typeof tracks.$inferInsert;
```

Читаем по частям: `tracks` — обычное **значение** (результат вызова `sqliteTable(...)`), а не тип;
`typeof tracks` — «возьми тип этого значения»; `.$inferSelect` — свойство схемы, типизированное как
«форма строки SELECT»; `export type TrackRow = ...` даёт типу короткое имя.

**`$inferSelect` против `$inferInsert`** — разница принципиальная:

* **`$inferSelect`** — форма того, что база **возвращает**: все поля заполнены, `createdAt` — это
  `Date`, `isFavorite` — настоящий `boolean`.
* **`$inferInsert`** — форма того, что можно **отправить на вставку**: поля с `.default(...)` и
  `$defaultFn(...)` становятся необязательными (`id`, `createdAt`, `updatedAt` можно не указывать).

Поэтому в запросе вставки достаточно такого параметра — вызывающий не обязан передавать `id`, но все
остальные поля доступны с автодополнением:

```ts
// src/lib/db/track-queries.ts
export async function upsertTrack(values: typeof tracks.$inferInsert): Promise<number> {
```

### `mode:` — типы, которые появляются «сами»

```ts
// src/lib/db/schema.ts
mtime: integer("mtime", { mode: "timestamp_ms" }).notNull(),
isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
```

В SQLite нет ни `Date`, ни `boolean` — есть только числа. Но `mode` говорит Drizzle: «читай это
число как `Date`» или «читай 0/1 как `boolean`». Поэтому в коде можно писать
`eq(tracks.isFavorite, true)` — настоящий `true`, а не `1`. Без `mode` пришлось бы всюду писать
`=== 1`. **Тип здесь не просто описание — он спрятал особенность хранилища.**

Обратная сторона: `coverFile` в схеме объявлен без `.notNull()`, поэтому его тип — `string | null`.
Отсюда проверка в маппере, где `!= null` ловит и `null`, и `undefined` (разница с `!== null`,
о которой легко забыть):

```ts
// src/lib/db/mappers.ts
hasCover: row.coverFile != null,
```

---

## 13. Утилитарные типы

### `Record<K, V>` — словарь

«Объект, где ключи типа `K`, значения типа `V`». Самый частый кейс — `Record<string, string>`:

```ts
// src/app/api/tracks/[id]/stream/route.ts
const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  // ...
};

function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[extension] ?? "application/octet-stream";
}
```

`?? "application/octet-stream"` здесь принципиален. Тип `Record<string, string>` утверждает, что
**любой** ключ даст строку, но для неизвестного расширения ключа нет, и в рантайме придёт `undefined`.
Это **известная слабость `Record<string, V>`**: он не умеет выразить «не для всех ключей есть
значение». Честнее было бы `Partial<Record<string, string>>` — тогда `??` стал бы обязательным, и
TypeScript напоминал бы о нём сам. **Полезная привычка: `??` рядом с `Record` — признак, что автор
понимает эту слабость.**

Другие примеры — заголовки и таблица сообщений об ошибках:

```ts
// src/lib/api-helpers.ts
export const noStoreHeaders: Record<string, string> = {
  "Cache-Control": "no-store, must-revalidate, max-age=0",
};

// src/components/player/player-context.tsx
const messages: Record<number, string> = {
  1: "Загрузка прервана",
  2: "Ошибка сети при загрузке файла",
  3: "Не удалось декодировать файл (возможно, он повреждён)",
  4: "Формат файла не поддерживается браузером",
};
```

### `Partial<T>`

`Partial<PlayerActions>` — то же, что `PlayerActions`, но каждое поле может отсутствовать: типовой
способ описать «настройки, где можно указать часть полей». Ближайший родственник в проекте —
`UpdatePlaylistBody` из `playlists/[id]/route.ts`:

```ts
type UpdatePlaylistBody = { name?: string; description?: string | null };
```

По смыслу это `Partial<{ name: string; description: string | null }>`, только записано руками — и
точнее, потому что `description` может быть явным `null` («стереть описание»), а это не то же самое,
что «не трогать описание».

### `Array<T>` и коллекции

Длинная форма записи массива: в проекте предпочитают `T[]`, но короткая не всегда возможна.

```ts
// src/lib/async-pool.ts
items: readonly TItem[]     // то же, что ReadonlyArray<TItem>
```

`Map<K, V>` — настоящая структура данных с методами `get`, `has`, `set`, в отличие от `Record`,
который лишь описывает форму объекта. `Map` предпочтительнее, когда ключей много и нужна быстрая
проверка «есть ли такой ключ»:

```ts
// src/lib/db/track-queries.ts
const byId = new Map(rows.map((row) => [row.id, row]));
return ids.map((id) => byId.get(id)).filter((row): row is TrackRow => row !== undefined);
```

Последняя строка — ещё один type guard, на этот раз в `.filter`. `byId.get(id)` возвращает
`TrackRow | undefined`, а нужен `TrackRow[]`. Запись `(row): row is TrackRow => row !== undefined`
говорит компилятору: «после этого фильтра `undefined` в массиве не осталось». Такой `filter` и
называют type predicate filter.

---

## 14. `readonly`

`readonly` запрещает изменение:

```ts
const arr: readonly number[] = [1, 2, 3];
arr.push(4);   // ❌ ошибка компиляции
arr[0] = 99;   // ❌ ошибка компиляции
```

**Это защита не от багов в рантайме, а от твоих собственных случайных правок.** В JS-массиве
`readonly` не существует: после компиляции ограничение исчезает. Польза приходит в момент написания
кода — IDE подчеркнёт `push` красным, и ты задумаешься.

```ts
// src/lib/async-pool.ts
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],   // ← «я обещаю не менять твой массив»
  worker: (item: TItem, index: number) => Promise<TResult>,
  limit = 6,
): Promise<TResult[]> {
```

Функция обрабатывает чужой массив файлов. Если бы она его перемешала или отсортировала, вызывающий
код получил бы неприятный сюрприз. `readonly` — обещание, что этого не случится, и оно
**проверяется компилятором**: внутри `items.push(...)` не скомпилируется. Ещё два места:
`ALLOWED_SORTS: readonly TrackSortKey[]` в `src/app/api/tracks/route.ts` и `AUDIO_EXTENSIONS`
в `src/lib/config.ts` (там `readonly` включился автоматически из `as const`).

### Правило совместимости

```ts
const normal: number[] = [1, 2, 3];
const ro: readonly number[] = normal;   // ✅ можно

const other: readonly number[] = [1, 2, 3];
const mutable: number[] = other;        // ❌ нельзя
```

«Только для чтения» — **более широкий** тип. Функция, обещающая ничего не менять, примет любой
массив. А сузить `readonly` до изменяемого нельзя: ты получил бы право менять то, что менять
запрещено. Именно поэтому `mapWithConcurrency` спокойно вызывается с обычным `TrackDTO[]`.

---

## 15. Частые ошибки новичков и как их читать

### `Object is possibly 'null'` (или `'undefined'`)

**Что случилось:** ты обращаешься к полю значения, которое может быть `null`.

```ts
const track = await getTrackById(id);   // TrackDTO | null
console.log(track.title);                // ❌ 'track' is possibly 'null'
```

Три способа починить, по возрастанию качества:

```ts
// 1. Проверка — правильный путь, так делает проект
if (!track) return jsonError("Трек не найден", 404);
console.log(track.title);   // ✅

// 2. Optional chaining, если уместно (проверь, нужен ли тебе этот undefined)
console.log(track?.title);   // ✅

// 3. `!` — «поверь мне». Только если правда знаешь, что не null
console.log(track!.title);   // ⚠️
```

Живой пример из `src/app/api/tracks/[id]/stream/route.ts`:

```ts
const track = await getTrackRowById(trackId);
if (!track) {
  return jsonError(`Трек ${trackId} не найден в библиотеке`, 404);
}
// дальше track.path, track.createdAt и т.д. работают
```

**Правило:** сообщение не «мешает жить», а указывает на реальную ветку, которую нужно обработать.
Обычно это 2–3 строки.

### `Type 'string' is not assignable to type ...`

**Что случилось:** значение одного типа кладут туда, где ожидается другой.

```ts
setRepeat("al");   // ❌ Type '"al"' is not assignable to type 'RepeatMode'
```

Здесь ошибка — **хорошая новость**: опечатка поймана до запуска. Коварнее случай с `string`:

```ts
const saved = readLocalStorage("pmp.repeat");   // string | null
setRepeat(saved);                                // ❌ Type 'string' is not assignable to type 'RepeatMode'
```

`string` — «любая строка», а `RepeatMode` — только три конкретные. TypeScript прав: `saved` может
быть `"banana"`. Решение — сузить тип проверкой, как в проекте:

```ts
if (savedRepeat === "off" || savedRepeat === "all" || savedRepeat === "one") {
  setRepeat(savedRepeat);   // ✅
}
```

**Правило:** увидел эту ошибку — спроси себя: «откуда я знаю, что там именно это значение?».
Ответ «я проверил(а)» → добавь проверку. Ответ «оно всегда такое» → компилятор прав, что не верит
на слово.

### `Property ... does not exist on type ...`

**Что случилось:** обращение к полю, которого в типе нет. Три типовые причины.

**Причина 1 — работа с DTO.** В `TrackDTO` (`src/lib/types.ts`) поле времени называется `addedAt`
и это `number`. В `TrackRow` оно называется `createdAt` и это `Date`.

```ts
// src/lib/db/mappers.ts — так НЕ надо
return { ...row, addedAt: row.createdAt };   // ❌ Property 'createdAt' does not exist on type 'TrackDTO'

// правильно
return { addedAt: row.createdAt.getTime() };
```

**Причина 2 — опечатка:** `row.titel` → `Property 'titel' does not exist on type 'TrackRow'.
Did you mean 'title'?` TypeScript даже подсказывает правильное имя. Это ровно та ошибка, ради
которой обычно и заводят типы.

**Причина 3 — обращение к полю не того union'а.** Например, `parsed.id`, где `parsed` имеет тип
`number | Response`. Нужно сначала сузить:

```ts
if (parsed instanceof Response) return parsed;
const playlist = await getPlaylist(parsed);   // теперь parsed — number
```

### `Argument of type ... is not assignable to parameter of type ...`

Частный случай предыдущей ошибки, но про аргументы функции. Обычно сообщение прямо говорит, какое
свойство требуется: `mapWithConcurrency` из `async-pool.ts` ждёт массив, и на `Map` компилятор
объяснит, что у `Map` нет `length`.

### Забытый `await`

TypeScript поймает это **только** если возвращаемый тип объявлен явно. Именно поэтому в проекте
у функций стоят явные аннотации: `Promise<Response>`, `Promise<TrackDTO[]>`, `Promise<TrackRow | null>`.

### `any` против `unknown`

`any` **отключает проверки для всего, что через него прошло** (`function broken(x: any) { return
x.foo.bar; }` компилируется и падает в рантайме), поэтому в проекте он не используется. Вместо него
`unknown` — «тут что-то есть, но я не знаю что»; с ним нельзя ничего делать без проверки:

```ts
// src/lib/api-helpers.ts
export function handleApiError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка сервера";
```

`error.message` не скомпилируется, пока не сузишь тип через `instanceof`. Тот же приём в логгере:
`export function log(message: string, ...details: unknown[]): void` (`src/lib/config.ts`).

**Правило: `unknown` — честное «не знаю». `any` — враньё «знаю всё». По умолчанию выбирай `unknown`.**

### Про `strict` в tsconfig

```json
"strict": true
```

Это набор проверок, включающий «значение может быть `null`», «неявный `any`», строгую проверку
функций. Именно из-за него появляются сообщения вида `Object is possibly 'null'`. **Отключать
`strict` не нужно** — если ошибка мешает, скорее всего она указывает на реальную дыру.

Отдельно стоит знать про `noUncheckedIndexedAccess` (в проекте не включён). Включишь его —
`rows[0]` получит тип `TrackRow | undefined`, и код вроде `result[0].id` в `upsertTrack` перестанет
компилироваться без проверки. Строже, но честнее.

---

## 16. Шпаргалка

| Конструкция | Что делает | Пример из проекта |
|---|---|---|
| `: string` | аннотация типа | `formatDuration(totalSeconds: number): string` — `src/lib/format.ts` |
| `type X = { ... }` | именованный тип объекта | `export type TrackDTO = { ... }` — `src/lib/types.ts` |
| `A \| B` | «или A, или B» | `track: TrackDTO \| null` — `src/lib/types.ts` |
| `"off" \| "all" \| "one"` | литеральный union вместо enum | `export type RepeatMode` — `player-context.tsx` |
| `field?: T` | необязательное поле | `search?: string` — `ListTracksOptions`, `track-queries.ts` |
| `T[]`, `Array<T>` | массив | `Promise<TrackDTO[]>` — `listTracks`, `track-queries.ts` |
| `readonly T[]` | массив, который нельзя менять | `items: readonly TItem[]` — `src/lib/async-pool.ts` |
| `Promise<T>` | обещание значения | `Promise<TrackRow \| null>` — `getTrackRowById` |
| `async` / `await` | асинхронность | `const rows = await query` — `listTracks` |
| `Promise.all([...])` | параллельные запросы | `src/app/page.tsx` |
| `<T>`, `<TItem, TResult>` | дженерик | `mapWithConcurrency<TItem, TResult>` — `async-pool.ts` |
| `readJsonBody<T>` | дженерик, указанный вручную | `readJsonBody<UpdatePlaylistBody>` — `playlists/[id]/route.ts` |
| `value is T` | предикат типа (type guard) | `isTrackSortKey(value: string \| null): value is TrackSortKey` — `tracks/route.ts` |
| `number \| Response` | union «значение или ответ с ошибкой» | `parseId` — `src/app/api/playlists/[id]/route.ts` |
| `instanceof` | сужение по классу | `if (parsed instanceof Response) return parsed;` |
| `??` | значение по умолчанию для null/undefined | `options.limit ?? 1000` — `track-queries.ts` |
| `?.` | безопасное обращение | `audio.error?.code` — `player-context.tsx` |
| `!` | «поверь, здесь не null» (избегать) | правильный путь: `const audio = audioRef.current; if (!audio) return;` |
| `as T` | приведение типа без проверки | `(await request.json()) as T` — `api-helpers.ts` |
| `as unknown as T` | приведение через «что угодно» | `Readable.toWeb(nodeStream) as unknown as ReadableStream` — `stream/route.ts` |
| `as const` | литералы + readonly | `AUDIO_EXTENSIONS = [...] as const` — `src/lib/config.ts` |
| `as readonly string[]` | ослабить строгость `includes` | `(AUDIO_EXTENSIONS as readonly string[]).includes(extension)` — `scanner/walk.ts` |
| `typeof x` | взять тип значения | `typeof tracks.$inferSelect` — `src/lib/db/schema.ts` |
| `$inferSelect` | тип строки из SELECT | `export type TrackRow = typeof tracks.$inferSelect` |
| `$inferInsert` | тип объекта для вставки | `upsertTrack(values: typeof tracks.$inferInsert)` — `track-queries.ts` |
| `Record<K, V>` | словарь | `Record<string, string>` — `stream/route.ts`; `Record<number, string>` — `player-context.tsx` |
| `Partial<T>` | все поля необязательны | ручной аналог: `UpdatePlaylistBody` — `playlists/[id]/route.ts` |
| `Map<K, V>` | коллекция «ключ → значение» | `Map<string, { id, mtimeMs, size }>` — `track-queries.ts` |
| `void` | функция ничего не возвращает | `writeLocalStorage(key: string, value: string): void` |
| `unknown` | «не знаю что» (безопасно) | `handleApiError(error: unknown)` — `api-helpers.ts` |
| `{ a, b } = obj` | деструктуризация объекта | `const { start, end } = parsedRange;` — `stream/route.ts` |
| `[a, b] = arr` | деструктуризация массива | `const [tracks, playbackState] = await Promise.all([...])` — `page.tsx` |
| `...arr` (в вызове) | развернуть массив в аргументы | `.orderBy(...buildOrderBy(options.sort))` — `track-queries.ts` |
| `...rest` (в параметре) | собрать оставшиеся аргументы | `log(message: string, ...details: unknown[])` — `config.ts` |
| `useState<T>(...)` | дженерик у хука | `useState<TrackDTO[]>([])` — `player-context.tsx` |
| `useRef<T \| null>(null)` | дженерик у ref | `useRef<HTMLAudioElement \| null>(null)` — `player-context.tsx` |
| `useMemo<T>(...)` | дженерик у мемоизации | `useMemo<PlayerActions>(() => ({...}), [...])` — `player-context.tsx` |

### Три правила на память

1. **Данные из внешнего мира (URL, JSON, `localStorage`, база) не имеют статического типа.**
   Их проверяют руками: `isTrackSortKey`, `parseId`, `parseNumberParam`, `if (!body)`.
2. **`as` — не проверка, а обещание.** Сначала проверь, потом приводи. И не приводи то, чему
   не доверяешь.
3. **Ошибка типа — подсказка, а не препятствие.** В 9 случаях из 10 компилятор указывает на ветку,
   которую ты не обработал: `null` от базы, отсутствующий трек, пустое тело запроса. Обработай её —
   и код станет надёжнее, а не «просто скомпилируется».
