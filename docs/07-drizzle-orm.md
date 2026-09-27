# 07. Drizzle ORM: как TypeScript превращается в SQL

Этот документ — про слой данных нашего плеера. Разберём его медленно и подробно,
потому что именно здесь проходит граница между твоим «родным» миром (SQL,
ClickHouse, dbt) и миром фронтенда.

**Главная мысль на весь документ:** Drizzle — это не «замена SQL», а **тонкая
прослойка**, которая строит SQL за тебя. Магии нет. Если тебе когда-нибудь
покажется, что ORM что-то делает непонятно — ты всегда можешь нажать одну
кнопку и увидеть получившийся SQL.

---

## 1. Что такое ORM и зачем он вообще нужен

**ORM** расшифровывается как *Object-Relational Mapping* — «отображение объектов
в реляционную модель».

Идея простая. В базе данных живут **таблицы, строки и колонки**. В TypeScript
живут **объекты, свойства и массивы**. Это разные миры, и между ними нужен
переводчик. ORM — и есть переводчик.

Без ORM ты пишешь так:

```ts
// «Сырой» драйвер bun:sqlite — просто выполняет строку SQL.
const rows = raw.query("SELECT * FROM tracks WHERE artist = ?").all("ATL");
// rows имеет тип any[]
// rows[0].artst — опечатка. TypeScript промолчит. Ошибка вылезет в рантайме.
```

С ORM ты пишешь так:

```ts
const rows = await db.select().from(tracks).where(eq(tracks.artist, "ATL"));
// rows имеет тип TrackRow[]
// rows[0].artst — редактор подчеркнёт КРАСНЫМ ещё до запуска.
```

### Плюсы ORM

| Плюс | Что это даёт на практике |
|---|---|
| **Типизация** | Опечатку в имени колонки видно в редакторе, а не в проде |
| **Автодополнение** | Пишешь `tracks.` — IDE показывает список всех колонок |
| **Рефакторинг** | Переименовал колонку — TypeScript покажет все места, где надо поправить |
| **Защита от SQL-инъекций** | Значения уходят параметрами, а не склейкой строки |
| **Меньше boilerplate** | Не надо руками писать `rowToObject()` для каждой таблицы |
| **Единый источник правды** | Схема описана один раз — и для чтения, и для записи, и для миграций |

### Минусы ORM (честно)

| Минус | Как с этим жить |
|---|---|
| **Ты не видишь SQL** | Лечится `.toSQL()` (см. раздел 14). У нас SQL ещё и в комментариях |
| **«Толстые» ORM генерируют монстров** | Классическая болезнь Hibernate/TypeORM: один вызов → десять JOIN'ов, которых ты не просил |
| **Своя терминология** | Приходится учить API. Но он меньше, чем кажется |
| **Не всё можно выразить** | Оконные функции, рекурсивные CTE — иногда проще написать `sql\`...\`` |
| **Ложное чувство безопасности** | ORM защищает от инъекций, но не от медленного запроса без индекса |

**Важный вывод для тебя:** ORM **не отменяет знание SQL**. Он его *требует*.
Человек, который не понимает SQL, с ORM напишет медленный код и не поймёт,
почему. Ты — в выигрышном положении: ты уже знаешь SQL, и ORM для тебя станет
просто удобной обёрткой, а не чёрным ящиком.

---

## 2. Почему здесь выбран именно Drizzle

Drizzle — не единственный ORM для TypeScript. Есть Prisma, TypeORM, Sequelize.
Вот почему в этом проекте выбрали Drizzle.

### 2.1. TypeScript-first, а не «TypeScript сверху»

У Prisma есть **свой язык описания схемы** (`schema.prisma`) — отдельный файл
на своём синтаксисе, из которого потом *генерируется* TypeScript-клиент. Это
значит: два источника правды, обязательный шаг генерации, и «магия».

У Drizzle схема — это **обычный TypeScript-файл**. `src/lib/db/schema.ts` — это
просто код, который читает TypeScript. Никакой генерации клиента, никакого
`.prisma`-файла, никакого шага `prisma generate`.

### 2.2. «Тонкий» ORM

Drizzle не притворяется, что базы данных не существует. Он **не прячет SQL, а
строит его**. Каждый метод цепочки — это буквально кусочек будущего SQL-запроса.

```ts
db.select().from(tracks).where(eq(tracks.artist, "ATL")).limit(10)
//                        ↑ это станет "where"    ↑ это станет "limit"
```

### 2.3. Предсказуемый SQL

Вот **настоящий** вывод `.toSQL()` для запроса выше (я его реально запустил,
это не «примерно так»):

```sql
select "id", "path", "filename", "search_text", "title", "artist", ...
from "tracks"
where "tracks"."artist" = ?
limit ?
```

Что ты видишь: обычный `SELECT`. Никаких лишних JOIN'ов, подзапросов,
`SELECT *` «сюрпризом». **Один вызов Drizzle = один предсказуемый SQL.**

### 2.4. Нет магии

Никаких lazy-loading, которые незаметно стреляют запросами в цикле. Никаких
неявных транзакций. Никаких «магических» сеттеров. Если Drizzle сделал запрос —
значит, ты его вызвал.

### 2.5. Близость к SQL — то, что тебе особенно важно

Синтаксис Drizzle читается **как SQL**: `select().from().where().groupBy().orderBy()`.
Порядок методов совпадает с порядком клауз в SQL. Тебе не нужно учить новую
логику — ты узнаёшь знакомую.

---

## 3. Установка и состав: два разных пакета

```bash
bun add drizzle-orm            # рантайм: работает, когда сайт запущен
bun add -d drizzle-kit         # ТОЛЬКО разработка: CLI для миграций
```

В `package.json` это выглядит так:

```jsonc
{
  "dependencies": {
    "drizzle-orm": "^0.45.3"     // нужен на продакшене
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.11"    // нужен только тебе на ноутбуке
  }
}
```

**Почему два пакета — это важно понимать:**

- `drizzle-orm` — библиотека, которая **исполняет** запросы. Она попадает в
  собранное приложение.
- `drizzle-kit` — **CLI-утилита** (программа командной строки). Она сравнивает
  `schema.ts` с папкой `drizzle/` и **пишет SQL-файлы**. В работающем
  приложении она не нужна вообще: в Docker-образ её можно не ставить.

Ещё в проекте используется **драйвер** `bun:sqlite` — он встроен в Bun,
устанавливать нечего.

| Слой | Что это | Кто использует |
|---|---|---|
| Драйвер `bun:sqlite` | Умеет открыть файл и выполнить SQL-строку | Drizzle под капотом |
| `drizzle-orm` | Строит SQL и типизирует результат | Код приложения |
| `drizzle-kit` | Генерирует файлы миграций | Только разработчик |

Аналогия из твоего мира: **`bun:sqlite` — это `clickhouse-client`**,
**`drizzle-orm` — это твой SQL-скрипт**, а **`drizzle-kit` — это `dbt compile`**,
который ничего не выполняет, а только готовит файлы.

---

## 4. Описание схемы: `src/lib/db/schema.ts`

### 4.1. `sqliteTable` — таблица как TypeScript-объект

```ts
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

Читается так:

- **`sqliteTable("playlists", {...})`** — первый аргумент это **имя таблицы
  в SQL**. Второй — объект с колонками.
- **`integer("id")`** — первый аргумент это **имя колонки в SQL**.
- **Ключ объекта** (`id`, `createdAt`) — это **имя свойства в TypeScript**.

**Обрати внимание:** имена специально разные. В SQL принят `snake_case`
(`created_at`), в TypeScript — `camelCase` (`createdAt`). Drizzle переводит
одно в другое автоматически. В SQL-запросе при этом будет `created_at`.

### 4.2. Типы колонок

В SQLite всего пять «настоящих» типов хранения. В Drizzle тебе нужны три:

| Drizzle | SQL | Что хранит | Пример в нашей схеме |
|---|---|---|---|
| `integer` | `INTEGER` | целое число | `year`, `size`, `id` |
| `text` | `TEXT` | строка | `title`, `artist`, `path` |
| `real` | `REAL` | число с точкой | `duration`, `position` |

```ts
year: integer("year").notNull().default(0),
duration: real("duration").notNull().default(0),   // 213.457 секунды
title: text("title").notNull(),
```

### 4.3. Модификаторы колонки

**`.primaryKey()`** — первичный ключ. Значение уникально и никогда не `NULL`.

```ts
id: integer("id").primaryKey({ autoIncrement: true }),
```

`autoIncrement: true` — SQLite сам выдаёт 1, 2, 3… В SQLite это псевдоним для
`INTEGER PRIMARY KEY`, он же **rowid** — самый быстрый способ найти строку.

```sql
"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL
```

**`.notNull()`** — колонка обязана быть заполнена.

```ts
path: text("path").notNull(),
```

```sql
"path" text NOT NULL
```

**`.default(...)`** — значение по умолчанию **на стороне базы**.

```ts
year: integer("year").notNull().default(0),
```

```sql
"year" integer DEFAULT 0 NOT NULL
```

Смысл: если в `INSERT` не указать `year`, база сама подставит 0. Это удобно,
но помни: **это защита базы, а не проверка в коде**. `$inferInsert` всё равно
позволит не указывать поле — но при чтении оно будет заполнено.

**`.references(...)`** — внешний ключ.

```ts
playlistId: integer("playlist_id")
  .notNull()
  .references(() => playlists.id, { onDelete: "cascade" }),
```

```sql
FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id")
  ON UPDATE no action ON DELETE cascade
```

Здесь два важных момента.

**Первый:** `() => playlists.id` — это **стрелочная функция**, а не само
значение. Причина в **циклических зависимостях**: таблица `playlist_tracks`
ссылается на `playlists`, а `playlists` в коде объявлена *раньше*. Если бы мы
написали `references(playlists.id)` напрямую, на момент выполнения строчки
переменная `playlists` ещё не была бы готова. Функция откладывает обращение
до момента, когда всё уже определено.

**Второй:** `onDelete` описывает, что делать со ссылающимися строками при
удалении «родителя»:

| `onDelete` | Поведение | Где у нас |
|---|---|---|
| `"cascade"` | Удалить и зависимые строки | `playlist_tracks` → `playlists`, `tracks` |
| `"set null"` | Обнулить ссылку | `playback_state` → `tracks` |
| `"no action"` / `"restrict"` | Запретить удаление, если есть ссылки | — |
| `"set default"` | Поставить значение по умолчанию | — |

**В SQLite внешние ключи по умолчанию ВЫКЛЮЧЕНЫ.** Это историческая
особенность ради совместимости. Пока ты не выполнишь `PRAGMA foreign_keys = ON`,
`ON DELETE CASCADE` **не сработает**, и в `playlist_tracks` останутся «сироты».
Мы включаем PRAGMA при открытии соединения (раздел 6).

### 4.4. Составной первичный ключ

```ts
export const playlistTracks = sqliteTable(
  "playlist_tracks",
  {
    playlistId: integer("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
    trackId: integer("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.trackId] }),
    index("playlist_tracks_position_idx").on(table.playlistId, table.position),
  ],
);
```

```sql
PRIMARY KEY("playlist_id", "track_id")
```

Смысл составного ключа: **пара `(playlist_id, track_id)` уникальна**. Нельзя
положить один трек в один плейлист дважды. Но `(1, 5)` и `(2, 5)` — разные
пары, поэтому один трек спокойно лежит в разных плейлистах. Это ровно то, что
нужно для отношения «многие-ко-многим».

### 4.5. Индексы и callback с массивом

**Важный момент про версию API.** Второй (третий для `playlist_tracks`)
аргумент `sqliteTable` — это **функция**, которая возвращает **МАССИВ**:

```ts
export const tracks = sqliteTable(
  "tracks",
  {
    /* ...колонки... */
  },
  // ↓↓↓ ВОТ ЗДЕСЬ ↓↓↓
  (table) => [
    uniqueIndex("tracks_path_unique").on(table.path),
    index("tracks_artist_idx").on(table.artist),
    index("tracks_album_idx").on(table.album),
    index("tracks_created_idx").on(table.createdAt),
  ],
);
```

**Почему это стоит запомнить:** раньше Drizzle ждал здесь **объект**
(`(table) => ({ pathIdx: uniqueIndex(...).on(...) })`). В старых статьях и
видео в интернете ты увидишь именно объектную форму. В версии 0.45 (наша)
объектная форма помечена в исходниках как **deprecated**, а актуальной стала
массив. Если скопируешь старый пример — получишь ошибку типов.

Параметр `table` внутри callback — это та же таблица; через него ты обращаешься
к колонкам: `table.path`, `table.artist`.

```sql
CREATE UNIQUE INDEX `tracks_path_unique` ON `tracks` (`path`);
CREATE INDEX `tracks_artist_idx` ON `tracks` (`artist`);
CREATE INDEX `tracks_album_idx` ON `tracks` (`album`);
CREATE INDEX `tracks_created_idx` ON `tracks` (`created_at`);
```

**Что такое индекс простыми словами.** Это алфавитный указатель в конце книги.
Без него, чтобы найти песню по исполнителю, база честно прочитает **все 10 000
строк**. С индексом — прыгнет сразу в нужное место.

**Плата за индекс:** он занимает место и чуть замедляет `INSERT` (при вставке
надо обновить и индекс). Поэтому индексы ставят не «на всё», а там, где реально
ищут и сортируют. Ты это уже знаешь по ClickHouse — там `ORDER BY` в `MergeTree`
играет ту же роль.

**Разница `index` и `uniqueIndex`:**

| | `index` | `uniqueIndex` |
|---|---|---|
| Ускоряет поиск | ✅ | ✅ |
| Запрещает дубликаты | ❌ | ✅ |
| Можно вставить `'ATL'` дважды | ✅ можно | — |
| Можно вставить один `path` дважды | — | ❌ ошибка базы |

У нас `path` уникален **сознательно**: именно на этой уникальности держится
`INSERT ... ON CONFLICT(path) DO UPDATE` — основа повторного сканирования
библиотеки (раздел 13).

---

## 5. Как Drizzle прячет особенности SQLite

### 5.1. `mode: "timestamp_ms"` — даты

В SQLite **нет типа даты**. Есть только `INTEGER`, `TEXT`, `REAL`, `BLOB`,
`NULL`. Поэтому даты хранят либо как число, либо как строку — и каждый раз
приходится помнить, в каком формате.

Drizzle убирает эту головную боль:

```ts
mtime: integer("mtime", { mode: "timestamp_ms" }).notNull(),
createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
```

- **В базе** лежит целое число: миллисекунды с 1 января 1970 UTC.
- **В TypeScript** это обычный `Date`.

```ts
// Ты пишешь:
await db.update(tracks).set({ updatedAt: new Date() }).where(eq(tracks.id, 1));

// Drizzle превращает это в:
```

```sql
update "tracks" set "is_favorite" = ?, "updated_at" = ? where "tracks"."id" = ?
-- params: [1, 1783374120345, 1]
--                    ↑ Date стал числом
```

При чтении — обратное превращение: из числа `1783374120345` получится `Date`,
и на нём сразу работают методы `.getTime()`, `.toISOString()` и т.д.
Вот как маппер вытаскивает миллисекунды:

```ts
// src/lib/db/mappers.ts
addedAt: row.createdAt.getTime(),   // Date → number, чтобы можно было отдать в JSON
```

Заметь: есть ещё `mode: "timestamp"` — это **секунды**, а не миллисекунды.
Мы используем `timestamp_ms`, потому что Java/JS-время — миллисекундное, и
никаких `* 1000` в коде не нужно.

### 5.2. `mode: "boolean"` — булевы значения

В SQLite нет `BOOLEAN`. Есть только `0` и `1` в колонке `INTEGER`.

```ts
isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
```

- **В TypeScript**: `boolean` (`true` / `false`).
- **В базе**: `1` / `0`.

```ts
// Ты пишешь:
conditions.push(eq(tracks.isFavorite, true));

// Drizzle делает:
```

```sql
-- где-то в WHERE:
"tracks"."is_favorite" = ?
-- params: [1]     ← true стал 1
```

И обратно: при чтении `1` превращается в `true`. В `TrackRow` поле
`isFavorite` имеет тип `boolean`, и в React-компоненте ты пишешь
`track.isFavorite ? "★" : "☆"` — без всяких `=== 1`.

**В сгенерированной миграции видно, что внутри всё равно число:**

```sql
"is_favorite" integer DEFAULT false NOT NULL
```

SQLite понимает `false` как `0`. Это работает, но это именно `INTEGER`.

---

## 6. `$defaultFn` — значения по умолчанию на стороне JavaScript

Есть два похожих, но **разных** механизма.

| | `.default(...)` | `.$defaultFn(...)` |
|---|---|---|
| Где вычисляется | **В базе** (SQLite) | **В JavaScript** |
| Попадает в миграцию | ✅ да, в `CREATE TABLE` | ❌ нет |
| Можно вызвать `new Date()` | ❌ | ✅ |
| Работает при `INSERT` из SQL-консоли | ✅ | ❌ |

```ts
createdAt: integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .$defaultFn(() => new Date()),
```

Здесь важен практический момент: **`.$defaultFn()` не создаёт `DEFAULT` в SQL**.
Если посмотреть миграцию, ты увидишь:

```sql
"created_at" integer NOT NULL
```

Никакого `DEFAULT`. Значит, дату подставляет **сам Drizzle**, когда выполняет
`INSERT`, — ровно в момент формирования запроса. В SQL-параметрах поедет
уже готовое число.

**Зачем это вообще нужно:** без `$defaultFn` пришлось бы в каждом месте кода,
где создаётся плейлист или трек, писать `createdAt: new Date()`. Забыл один
раз — получил `NOT NULL constraint failed`. С `$defaultFn` ты просто пишешь
`db.insert(playlists).values({ name: "Любимое" })` — и всё работает.

**Когда что использовать:**

- `.$defaultFn(() => new Date())` — даты, случайные id, `crypto.randomUUID()`.
- `.default(false)`, `.default(0)`, `.default("")` — простые константы. Их лучше
  держать на стороне базы: тогда даже ручной `INSERT` в консоли получит
  значение по умолчанию.

---

## 7. Вывод типов: `$inferSelect` и `$inferInsert`

Это **самая приятная** возможность Drizzle, и её стоит понять хорошо.

В конце `schema.ts`:

```ts
/** Строка таблицы tracks, как её возвращает SELECT. */
export type TrackRow = typeof tracks.$inferSelect;

/** Объект для вставки в tracks (id и даты можно не указывать). */
export type NewTrack = typeof tracks.$inferInsert;
```

### 7.1. Как это читается

```
typeof tracks.$inferSelect
↑           ↑
"узнай тип  "специальное поле Drizzle,
 значения"   которое несёт информацию о типе"
```

`$inferSelect` — это не значение, а **фантомное поле только ради типа**. Оно
существует исключительно для TypeScript; в JavaScript в рантайме его нет.

### 7.2. `$inferSelect` vs `$inferInsert`

Разница — ровно в том же, в чём разница между «прочитать строку» и «вставить
строку».

| | `$inferSelect` | `$inferInsert` |
|---|---|---|
| Что описывает | Строку **из** базы | Объект **для вставки** |
| `id` | `number` (всегда есть) | `number \| undefined` (можно не указывать) |
| Колонки с `$defaultFn` | `Date` | `Date \| undefined` |
| `coverFile` (nullable) | `string \| null` | `string \| null \| undefined` |
| `isFavorite` | `boolean` | `boolean \| undefined` |

Вот как это видно в коде сканера:

```ts
// src/lib/db/track-queries.ts
export async function upsertTrack(values: typeof tracks.$inferInsert): Promise<number> {
```

Мы **не пишем** отдельный интерфейс для вставки. Тип выведен из схемы. И это
огромный плюс: добавь в `schema.ts` новую колонку `bitrate: integer(...)` — и
TypeScript **сразу** покажет все места, где её не хватает в объекте вставки.

### 7.3. Почему это лучше ручных интерфейсов

Наивный подход выглядит так:

```ts
// ❌ ТАК ДЕЛАТЬ НЕ НАДО
interface TrackRow {
  id: number;
  path: string;
  title: string;
  // ...и ещё 15 полей, написанных руками
}
```

Проблемы:

1. **Дублирование.** Схема есть — и интерфейс есть. Два источника правды.
2. **Расхождение.** Добавил колонку в схему, забыл в интерфейсе — TypeScript
   не заметит, потому что интерфейс всё ещё «валиден».
3. **Ручной труд.** `null` / `undefined`, `Date` / `number` — всё надо
   отслеживать самому.

С `$inferSelect` источник правды **один** — схема. Всё остальное выводится.

**Связь с твоим миром:** это как если бы dbt-модель сама генерировала типы
колонок для витрины, и они не могли разойтись с `SELECT`-ом. У нас — именно так.

---

## 8. Подключение: `drizzle(new Database(...), { schema })`

```ts
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

const raw = new Database(DB_PATH, { create: true });
const db = drizzle(raw, { schema });
```

Что здесь происходит:

- **`new Database(DB_PATH, { create: true })`** — открывает файл базы. Если
  файла нет, SQLite создаст его при первой записи. Никакого «подними сервер,
  создай пользователя, выдай права». Это одна из причин, почему SQLite так
  удобен для локального приложения.
- **`drizzle(raw, { schema })`** — **обёртка** над драйвером. Она добавляет
  типы и конструктор запросов.

**Зачем нужен `{ schema }`:**

1. Чтобы Drizzle **знал обо всех таблицах** и мог выводить типы результата.
2. Чтобы работал **реляционный API** вида `db.query.tracks.findMany({ with: ... })`.

Без `schema` обычные `db.select().from(tracks)` тоже работают — но реляционный
API и часть вывода типов будут недоступны.

### 8.1. Что такое `BunSQLiteDatabase<typeof schema>`

```ts
export type AppDatabase = BunSQLiteDatabase<typeof schema>;
```

Разберём по частям.

**`BunSQLiteDatabase`** — это **обобщённый (generic) тип** из
`drizzle-orm/bun-sqlite`. Он означает: «база данных, работающая через драйвер
`bun:sqlite`». Появился он именно потому, что Drizzle поддерживает много
драйверов: `better-sqlite3`, `libsql`, `d1`, `postgres-js`, `neon`… У каждого
свой тип базы. Нам нужен именно **bun-sqlite**.

**`<typeof schema>`** — «параметр типа». Читается так: «возьми **тип** значения
`schema` и подставь его сюда».

**Зачем вообще эта возня с типом?** Затем, что функции запросов принимают базу
**аргументом**:

```ts
export async function listTracks(db: AppDatabase, options: ListTracksOptions) { ... }
```

Это позволяет в тестах подсунуть **базу в памяти** (`new Database(":memory:")`)
вместо файла. Тесты становятся быстрыми и не трогают реальные данные.

**Важно понимать:** `BunSQLiteDatabase<typeof schema>` — это **тип**, а не
значение. Он стирается при компиляции, в JavaScript его нет вообще.

---

## 9. PRAGMA: настройка соединения

**PRAGMA** — это команды настройки самого SQLite. Аналог `SET` в других СУБД.
Их принято выполнять **сразу после открытия соединения**.

```ts
const raw = new Database(DB_PATH, { create: true });

raw.exec("PRAGMA journal_mode = WAL;");
raw.exec("PRAGMA foreign_keys = ON;");
raw.exec("PRAGMA busy_timeout = 5000;");
raw.exec("PRAGMA synchronous = NORMAL;");
```

**Важно:** часть PRAGMA — **на уровне соединения**, а не базы. Значит, их надо
выполнять при каждом открытии. Именно поэтому они стоят в `createDatabase()`,
а не в миграции.

Разберём каждую.

### 9.1. `PRAGMA journal_mode = WAL`

**WAL** = *Write-Ahead Logging*, «журнал упреждающей записи».

Обычный режим (`DELETE`) работает так: при записи база блокируется **целиком**.
Читатели ждут, пока писатель закончит.

В режиме `WAL` изменения пишутся в **отдельный файл-журнал** (`music.db-wal`),
а читатели продолжают читать старую версию страниц. Результат: **можно
одновременно читать список треков и писать историю прослушиваний**.

Для веб-приложения это критично: пользователь листает библиотеку (чтение), а
плеер в это время отправляет `POST /api/history` (запись).

```sql
PRAGMA journal_mode = WAL;
```

**Это единственная PRAGMA из четырёх, которая сохраняется в файле базы.** У нас
она записана в БД навсегда — но мы всё равно выполняем её при каждом старте,
чтобы код был явным.

### 9.2. `PRAGMA foreign_keys = ON`

По умолчанию SQLite **НЕ проверяет внешние ключи**. Это историческая
особенность ради обратной совместимости: старые базы не должны ломаться.

Пока это не включено:

- `ON DELETE CASCADE` **не срабатывает** → в `playlist_tracks` остаются «сироты»
  со ссылками на несуществующие плейлисты;
- можно вставить строку со ссылкой на несуществующий `track_id`.

```sql
PRAGMA foreign_keys = ON;
```

**Это PRAGMA уровня соединения, а не базы.** Забыл выполнить — и каскады тихо
не работают. Отличный пример «ошибки, которая не падает, а портит данные».

### 9.3. `PRAGMA busy_timeout = 5000`

SQLite — **файловая** база. Писать в неё может только **один** процесс в момент
времени (даже в WAL). Если база занята, по умолчанию SQLite **мгновенно**
возвращает ошибку `SQLITE_BUSY`.

`busy_timeout` говорит: «если база занята — подожди до 5 секунд, вдруг
освободится». Обычно блокировка длится миллисекунды, и ожидание решает
проблему незаметно для пользователя.

```sql
PRAGMA busy_timeout = 5000;   -- 5000 миллисекунд = 5 секунд
```

У нас сервер Next.js — один процесс, поэтому коллизии редки. Но в Docker,
при `bun --watch`, или если ты случайно откроешь базу ещё и в `sqlite3` —
столкновение вполне реально.

### 9.4. `PRAGMA synchronous = NORMAL`

`synchronous` определяет, **насколько настойчиво** SQLite заставляет систему
физически записать данные на диск, прежде чем сказать «готово».

| Значение | Надёжность | Скорость |
|---|---|---|
| `FULL` | Самая высокая: `fsync` после каждой транзакции | Медленно |
| `NORMAL` | Высокая (в режиме WAL) | Быстро |
| `OFF` | Данные могут потеряться при сбое питания | Очень быстро |

В режиме `WAL` значение `NORMAL` — **безопасный компромисс**: данные не
потеряются при падении *приложения*, но запись идёт заметно быстрее, чем при
`FULL`.

```sql
PRAGMA synchronous = NORMAL;
```

Оговорка честности: `NORMAL` в WAL защищает от падения приложения, но при
**отключении питания** последние транзакции могут потеряться. Для персонального
плеера, где самое страшное — потеря одной записи из истории, это приемлемо.
Для банка — нет.

---

## 10. Singleton через `globalThis` и `Proxy` — разбор подробно

Это **самый нетривиальный приём** во всём файле `client.ts`. Разберём его
медленно, шаг за шагом.

### 10.1. Задача: одно соединение на процесс

Хочется, чтобы любой файл мог написать:

```ts
import { db } from "@/lib/db/client";
```

и сразу работать. И при этом **не открывать соединение много раз**.

### 10.2. Наивный вариант №1: открыть сразу при импорте

```ts
// ❌ ПЛОХО
export const db = drizzle(new Database(DB_PATH), { schema });
```

Что не так:

1. **Побочный эффект при импорте.** Во время `next build` серверные модули
   могут быть импортированы для анализа. Тогда сборка попытается создать файл
   базы. Это плохо: сборка не должна трогать данные.
2. **При `next dev` — утечка.** Next.js перезагружает изменившиеся модули «на
   горячую» (HMR). Файл выполнится заново → **второе** соединение. Через сотню
   правок — сотое. Это утечка ресурсов и ошибки `database is locked`.

### 10.3. Наивный вариант №2: ленивая функция

```ts
// 🟡 РАБОТАЕТ, НО НЕУДОБНО
function getDatabase() {
  /* ...открыть один раз... */
}

// В каждой функции:
const db = getDatabase();
const rows = await db.select().from(tracks);
```

Всё правильно, но **многословно**. `getDatabase()` придётся вызывать в каждом
запросе. Забыл — ошибка. Хочется красивее.

### 10.4. `Module Singleton` (шаг 1): держим базу в `globalThis`

```ts
const GLOBAL_KEY = "__personalMusicPlayerDb__";

declare global {
  // eslint-disable-next-line no-var
  var __personalMusicPlayerDb__: { db: AppDatabase; raw: Database } | undefined;
}

function getDatabase(): { db: AppDatabase; raw: Database } {
  // Есть в глобальном объекте? Отдаём как есть.
  const cached = globalThis[GLOBAL_KEY];
  if (cached) return cached;

  // Нет — создаём и кладём туда.
  const created = createDatabase();
  globalThis[GLOBAL_KEY] = created;
  return created;
}
```

**Ключевая идея:** `globalThis` — это **глобальный объект процесса**. Он живёт
всё время работы сервера и **НЕ сбрасывается при перезагрузке модулей**.

```
Первая загрузка client.ts:
  globalThis["__personalMusicPlayerDb__"] === undefined  → создать базу, положить

HMR перезагрузил модуль, файл выполнился заново:
  globalThis["__personalMusicPlayerDb__"] === { db, raw }  → вернуть существующую
```

**Почему ключ такой страшный** (`__personalMusicPlayerDb__`)? Потому что
`globalThis` — это **общий** объект. Если назвать ключ `db`, можно случайно
пересечься с другой библиотекой. Префикс `__personalMusicPlayer` гарантирует
уникальность.

**Что делает `declare global`?** TypeScript «не знает», что мы подкладываем в
`globalThis` свои поля. Конструкция `declare global { var ... }` **расширяет**
тип глобального объекта — после неё `globalThis[GLOBAL_KEY]` типизирован как
`{ db, raw } | undefined`, а не как `any`.

**`var`, а не `let`/`const`** — это требование TypeScript: в `declare global`
можно объявлять только `var`. Именно поэтому стоит
`// eslint-disable-next-line no-var` — правило линтера, которое мы сознательно
нарушаем.

**Безвредно ли это для продакшена?** Да. В production-сборке модуль и так
выполняется один раз, `globalThis` просто используется как кэш.

### 10.5. `Proxy` (шаг 2): делаем вид, что `db` — это база

Теперь хочется, чтобы в остальном коде было ровно `db.select()...`, без
`getDatabase().db`. Но если написать:

```ts
// ❌ снова нетерпеливо!
export const db = getDatabase().db;
```

…то соединение откроется **в момент импорта** — а мы этого как раз избегаем.

Решение — **`Proxy`**.

**Что такое `Proxy` вообще.** Это встроенный в JavaScript объект-«притворщик».
Он оборачивает другой объект и позволяет **перехватывать** операции над ним:
чтение свойства, запись, вызов функции.

```ts
const target = { name: "Настоящая база" };

const proxy = new Proxy(target, {
  get(target, property) {
    console.log("кто-то читает свойство:", property);
    return target[property];
  },
});

console.log(proxy.name);   // напечатает "кто-то читает свойство: name", затем "Настоящая база"
```

Для внешнего кода `proxy` **ведёт себя как** `target`.

Теперь наш код:

```ts
export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, property, receiver) {
    // При ПЕРВОМ обращении лениво создаём (или достаём из кэша) соединение.
    const { db: realDb } = getDatabase();
    // Проксируем чтение свойства в настоящую базу.
    return Reflect.get(realDb, property, receiver);
  },
});
```

Разберём построчно.

**`new Proxy({} as AppDatabase, {...})`** — первый аргумент это **пустой
объект** `{}`. То есть на старте `db` — это буквально `{}`. Никакого соединения
нет. `as AppDatabase` — это «обещание» TypeScript'у: «считай, что это база».
Оно ничего не делает в рантайме, только успокаивает компилятор.

**Момент создания `Proxy` — мгновенный.** Модуль импортируется, `db` создаётся,
база **не открывается**. Это и есть ленивая инициализация.

**`get(_target, property, receiver)`** — обработчик, который вызывается при
**любом** чтении свойства. Что такое «любое чтение»? Обрати внимание:

```ts
db.select()      // ← читается свойство "select"    → get срабатывает
db.insert(tracks) // ← читается свойство "insert"    → get срабатывает
db.transaction(...) // ← читается "transaction"      → get срабатывает
```

**Drizzle — это не объект с богатым состоянием, а набор методов.** Поэтому
«перехватить чтение свойства» = «перехватить начало работы с базой». Идеально.

**`_target`** — тот самый пустой `{}`. Он нам не нужен, поэтому имя начинается
с подчёркивания: это общепринятый сигнал «параметр не используется».

**Два `db` в одной строчке** — самое коварное место, разберём:

```ts
const { db: realDb } = getDatabase();
//    ↑                  ↑
//    берём из результата поле "db" — и сразу переименовываем в realDb
```

Здесь `getDatabase()` возвращает объект `{ db, raw }`. Мы берём из него поле
`db` и через **деструктуризацию с переименованием** (`db: realDb`) называем
локальную переменную `realDb`, чтобы не конфликтовать с внешней `db` (нашим
прокси). Без переименования получилось бы `const { db } = ...` внутри функции,
где уже есть внешняя `db` — путаница.

**`Reflect.get(realDb, property, receiver)`** — третий параметр `receiver`
и здесь главный.

`Reflect.get(obj, key, receiver)` делает то же, что `obj[key]`, **но**
сохраняет `receiver` в качестве `this` внутри вызванного метода. Зачем это
нужно? Методы Drizzle внутри себя обращаются к `this`. Если бы мы написали
просто `return realDb[property]`, то при вызове `db.select()` метод `select`
получил бы в `this` **сам `realDb`** — что, казалось бы, правильно. Но
`Reflect.get` с `receiver` гарантирует корректное поведение и для геттеров,
и для унаследованных свойств. Это «делай правильно, а не как сработает».

### 10.6. Итоговая картина

```ts
export const db: AppDatabase = new Proxy({} as AppDatabase, { ... });
```

```
    Импорт модуля                  Первый db.select()           Второй db.select()
         │                                │                              │
         ▼                                ▼                              ▼
   Proxy создан                  get() → getDatabase()          get() → getDatabase()
   БАЗА НЕ ОТКРЫТА               └─ нет в globalThis            └─ ЕСТЬ в globalThis
                                    → createDatabase()              → возврат кэша
                                    → PRAGMA                        (мгновенно)
                                    → migrate()
                                    → положили в globalThis
```

Плюс этого приёма: **всё остальное приложение ничего не знает о сложности**.
В `track-queries.ts` написано просто `import { db } from "@/lib/db/client"` —
и всё.

### 10.7. Ещё один экспорт: сырой драйвер

```ts
export function getRawDatabase(): Database {
  return getDatabase().raw;
}
```

Иногда нужен **именно** `bun:sqlite` — например, для массовых PRAGMA или
`ANALYZE`, которые Drizzle не умеет строить. Для этого мы храним рядом с
`db` ещё и `raw` — «сырое» соединение.

---

## 11. Конструктор запросов

Теперь — самое приятное. **Порядок методов Drizzle повторяет порядок клауз SQL.**

### 11.1. `select()` — чтение

```ts
const rows = await db
  .select()
  .from(tracks)
  .where(and(like(tracks.searchText, "%numb%"), eq(tracks.artist, "ATL")))
  .orderBy(asc(tracks.artist), asc(tracks.album), asc(tracks.trackNumber))
  .limit(1000)
  .offset(20);
```

**Настоящий SQL, который из этого получается:**

```sql
select "id", "path", "filename", "search_text", "title", "artist", "album",
       "album_artist", "genre", "year", "track_number", "duration", "size",
       "mtime", "is_favorite", "cover_file", "created_at", "updated_at"
from "tracks"
where ("tracks"."search_text" like ? and "tracks"."artist" = ?)
order by "tracks"."artist" asc, "tracks"."album" asc, "tracks"."track_number" asc
limit ? offset ?
```

Обрати внимание: **`select()` без аргументов разворачивается в список ВСЕХ
колонок** — не `SELECT *`, а явное перечисление. Это сделано намеренно: если
завтра в таблицу добавят колонку, старые запросы не начнут неожиданно тянуть
лишние данные, а типы останутся честными.

### 11.2. Выбор конкретных колонок

Если вся строка не нужна — перечисли колонки. Так запрос быстрее и данных
меньше гоняется из базы в память:

```ts
const rows = await db
  .select({ id: tracks.id, path: tracks.path, mtime: tracks.mtime, size: tracks.size })
  .from(tracks);
```

```sql
select "id", "path", "mtime", "size" from "tracks"
```

**Правило:** перечисляй только то, что реально используешь. Сканеру, который
проверяет «изменился ли файл», не нужны `title`, `artist`, `genre`.

### 11.3. Вложенный объект в `select`

Очень удобная возможность — **сгруппировать колонки под одним ключом**:

```ts
const rows = await db
  .select({ track: tracks })
  .from(playlistTracks)
  .innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))
  .where(eq(playlistTracks.playlistId, playlistId))
  .orderBy(asc(playlistTracks.position));
```

Ключ `track: tracks` означает: «все колонки таблицы `tracks` положи в поле
`track`». Результат имеет форму `[{ track: TrackRow }, ...]`, и в коде мы
просто разворачиваем её:

```ts
return toTrackDTOList(rows.map((row) => row.track));
```

Это **очень** удобно при JOIN'ах: можно достать сразу и плейлист, и трек, и
не путаться, чья колонка `id`.

### 11.4. `insert().values().returning()`

```ts
const inserted = await db
  .insert(playlists)
  .values({ name: name.trim(), description: description?.trim() || null })
  .returning();
```

```sql
insert into "playlists" ("id", "name", "description", "created_at")
values (null, ?, ?, ?)
returning "id", "name", "description", "created_at"
```

Разберём:

- **`insert(playlists)`** — в какую таблицу.
- **`.values({...})`** — что вставить. Объект имеет тип `$inferInsert`:
  `id` и `created_at` можно не указывать (они подставятся — `null` для
  автоинкремента и `$defaultFn` для даты). Видно в SQL: первым параметром идёт
  `null` для `id`, а `created_at` посчитался в JS и поехал третьим параметром.
- **`.returning()`** — **возможность SQLite и PostgreSQL вернуть вставленную
  строку сразу**, без отдельного `SELECT`. Очень удобно: не надо делать
  `INSERT`, потом `SELECT last_insert_rowid()`.

Без `returning()` ты можешь попросить только нужное поле:

```ts
const result = await db.insert(tracks).values(values).returning({ id: tracks.id });
return result[0].id;
```

```sql
insert into "tracks" (...) values (...) returning "id"
```

### 11.5. `update().set().where()`

```ts
await db
  .update(tracks)
  .set({ isFavorite: next, updatedAt: new Date() })
  .where(eq(tracks.id, id));
```

```sql
update "tracks" set "is_favorite" = ?, "updated_at" = ? where "tracks"."id" = ?
-- params: [1, 1783374120345, 1]
--           ↑ true стал 1     ↑ Date стал числом
```

**Опасность, о которой надо помнить.** Drizzle **не защищает** от забытого
`.where()`. Вот что произойдёт:

```ts
await db.update(tracks).set({ isFavorite: false });   // ❌ затрёт ВСЕ 10 000 строк
await db.delete(tracks);                                // ❌ сотрёт всю библиотеку
```

```sql
update "tracks" set "is_favorite" = ?        -- без WHERE = каждая строка таблицы
delete from "tracks"                          -- без WHERE = вся таблица
```

Это **не гипотетическая** опасность: именно так и происходит большинство
«случайно удалил базу» в реальной жизни. Причина проста — `.where()` стоит в
конце цепочки, и его легко просто не написать.

**Практические защиты, которые стоит держать в голове:**

1. **`.where()` — обязательный элемент, а не опция.** Если очень нужно удалить
   всё — делай это осознанно и с комментарием (как в `clearHistory()`:
   `await db.delete(playHistory)` — и рядом объяснено, почему без `WHERE`).
2. **Транзакция для операций удаления.** `db.transaction()` даёт шанс откатить
   (`ROLLBACK`), если что-то пошло не так в той же транзакции.
3. **`returning()` как контроль.** Если просишь `.returning({ id: ... })`, ты
   **увидишь**, сколько строк реально попало под запрос. Увидел 10 000 вместо
   ожидаемых 3 — понял, что забыл `.where()`, ещё до того, как стало поздно.
   Именно так сделано в `deleteTracksMissingFromDisk`.
4. **Защита от пустого входа.** Функция, которая удаляет, должна уметь сказать
   «мне нечего удалять» и выйти — как это делает `deleteTracksMissingFromDisk`
   при `existingPaths.length === 0`.
5. **Резервная копия — это один `cp`.** Наша база это просто файл
   `data/music.db`. Но помни: в режиме WAL рядом живут ещё `music.db-wal` и
   `music.db-shm`, так что копировать лучше всю папку `data/`.

### 11.6. `delete().where()`

```ts
const deleted = await db
  .delete(tracks)
  .where(inArray(tracks.id, chunk))
  .returning({ id: tracks.id });
```

```sql
delete from "tracks" where "tracks"."id" in (?, ?, ?) returning "id"
```

`returning()` работает и на `DELETE`: можно узнать, **сколько строк** реально
удалено (в примере выше мы накапливаем `removed += deleted.length`), и **какие
именно**. Это гораздо надёжнее, чем надеяться на какую-то счётчик-переменную.

Удаление всей таблицы — тоже просто:

```ts
await db.delete(playHistory);   // кнопка «забыть историю»
```

```sql
delete from "play_history"
```

**Тут стоит отметить приятный момент:** удалять строки из `playlist_tracks`
руками не нужно. `ON DELETE CASCADE` сделает это сам — благодаря
`PRAGMA foreign_keys = ON`.

---

## 12. Операторы и почему SQL-инъекция невозможна

Импорт:

```ts
import { and, asc, count, desc, eq, inArray, like, notInArray, or, sql } from "drizzle-orm";
```

### 12.1. Сравнение: `eq`

```ts
eq(tracks.artist, "ATL")
```

```sql
"tracks"."artist" = ?      -- params: ["ATL"]
```

Обрати внимание на **два разных способа** передать значение, и это самое
важное место всего документа.

### 12.2. ⚠️ Параметр против склейки строки — вот здесь рождается SQL-инъекция

**Правильно — параметром.** Drizzle **всегда** так делает:

```ts
// ✅ БЕЗОПАСНО
const artist = "ATL";
db.select().from(tracks).where(eq(tracks.artist, artist));
```

```sql
select ... from "tracks" where "tracks"."artist" = ?
-- params: ["ATL"]
--         ↑ значение уходит ОТДЕЛЬНО от текста запроса
```

**Катастрофически неправильно — склейкой строки:**

```ts
// ❌ SQL-ИНЪЕКЦИЯ. НИКОГДА ТАК НЕ ДЕЛАЙ.
const artist = "' OR '1'='1";
raw.query(`SELECT * FROM tracks WHERE artist = '${artist}'`).all();
```

Что выполнится:

```sql
SELECT * FROM tracks WHERE artist = '' OR '1'='1'
--                               ^^^^^^^^^^^^^^
--                               запрос всегда истинен → вернутся ВСЕ строки
```

А если пользователь пришлёт вот это:

```ts
const artist = "x'; DROP TABLE tracks; --";
```

```sql
SELECT * FROM tracks WHERE artist = 'x'; DROP TABLE tracks; --'
--                                                        ^^^^^^^^^^^^^^^^^
--                                        комментарий съедает остаток запроса
--                                        и таблица УДАЛЕНА
```

**В чём разница технически.** Когда значение уходит **параметром** (`?`), драйвер
передаёт его SQLite **отдельным каналом**. SQLite уже знает: «первый `?` — это
строка, положи её сюда». Он **никогда не парсит** её как SQL. Даже если значение
целиком состоит из кавычек и точек с запятой — оно останется **данными**, а не
кодом.

Когда значение **склеено** со строкой запроса, различить «данные» и «код»
невозможно в принципе: к моменту передачи это уже одна строка.

**Drizzle делает это за тебя всегда.** Все операторы — `eq`, `like`, `inArray` —
передают значения параметрами. Статический анализатор в Drizzle физически не
даёт тебе собрать SQL через конкатенацию: нет такого метода.

Именно поэтому в `track-queries.ts` стоит:

> *«Мы не пишем строку `"WHERE title LIKE ... AND artist = ..."` вручную (это
> прямая дорога к SQL-инъекции). Вместо этого накапливаем МАССИВ условий и
> передаём его в `and(...)`».*

### 12.3. Логика: `and`, `or`

```ts
db.select()
  .from(playlistTracks)
  .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)));
```

```sql
select ... from "playlist_tracks"
where ("playlist_tracks"."playlist_id" = ? and "playlist_tracks"."track_id" = ?)
```

Тонкость, которую стоит знать: **`and(...)` с пустым списком возвращает
`undefined`** (не «истину»!). Именно на это рассчитывает `listTracks`:

```ts
.where(conditions.length > 0 ? and(...conditions) : undefined)
```

Если условий нет, `.where(undefined)` просто ничего не добавит — получится
`SELECT` без `WHERE`. Drizzle это разрешает явно.

Ещё тонкость: **`and()` и `or()` оборачивают результат в скобки.** Посмотри на
SQL выше — скобки есть. Это спасает от классической ошибки приоритета
операторов, когда `A OR B AND C` читается не так, как ты думал.

### 12.4. `like`

```ts
const needle = `%${options.search.trim().toLowerCase()}%`;
conditions.push(like(tracks.searchText, needle));
```

```sql
"tracks"."search_text" like ?      -- params: ["%numb%"]
```

`%` = «любое количество любых символов», `_` = «ровно один любой символ».

**Важный подводный камень SQLite, о котором надо помнить:**

> В SQLite `LIKE` регистронезависим **ТОЛЬКО для латиницы**. Для этого нужна
> сборка с ICU, а она есть не везде.

То есть `WHERE title LIKE '%атл%'` **не найдёт** песню «АТЛ». Это не баг
Drizzle и не баг проекта — это особенность самого SQLite.

**Как мы это обошли.** Заводим отдельную колонку `search_text` — «поисковый
слепок» строки, **всегда в нижнем регистре**, собранный **средствами
JavaScript**:

```ts
searchText: text("search_text").notNull().default(""),
```

Внутри — склейка «название + исполнитель + альбом + имя файла», приведённая к
нижнему регистру через `toLowerCase()`. JavaScript знает про Unicode отлично,
поэтому кириллица обрабатывается правильно. При поиске мы точно так же
понижаем регистр у запроса — и один обычный `LIKE` находит всё.

Это классическая **денормализация**: мы сознательно дублируем данные в другом
виде, чтобы запрос стал простым и быстрым. Один `LIKE` вместо четырёх `OR` —
и проще, и быстрее.

### 12.5. `inArray` и `notInArray`

```ts
db.select().from(tracks).where(inArray(tracks.id, [1, 5, 9]));
```

```sql
select ... from "tracks" where "tracks"."id" in (?, ?, ?)
-- params: [1, 5, 9]
```

```ts
db.select().from(tracks).where(notInArray(tracks.id, [1, 2]));
```

```sql
select ... from "tracks" where "tracks"."id" not in (?, ?)
```

**Сколько значений — столько `?`.** Drizzle динамически строит нужное число
параметров. Это и есть его главное преимущество перед «ручными» ORM: список
`IN` собирается корректно и безопасно для любого размера массива (в разумных
пределах лимита SQLite на параметры).

Подробнее про `inArray` как лекарство от N+1 — в разделе 15.

### 12.6. Сортировка: `asc` и `desc`

```ts
.orderBy(asc(tracks.artist), asc(tracks.album), asc(tracks.trackNumber))
```

```sql
order by "tracks"."artist" asc, "tracks"."album" asc, "tracks"."track_number" asc
```

```ts
.orderBy(desc(tracks.createdAt))
```

```sql
order by "tracks"."created_at" desc
```

`orderBy` принимает **несколько аргументов** (или spread массива) — ровно как
SQL сортирует по нескольким полям. В `track-queries.ts` это вынесено в
функцию `buildOrderBy()`, которая возвращает массив:

```ts
.orderBy(...buildOrderBy(options.sort))
```

`...` — это **spread-оператор**: он «раскрывает» массив в отдельные аргументы.
Так `orderBy([a, b, c])` превращается в `orderBy(a, b, c)`.

### 12.7. `sql\`...\`` — экранированный люк наружу

Иногда SQL-конструкции нет в API Drizzle (или она есть, но громоздкая).
Тогда используется **шаблонный литерал** `sql`:

```ts
sql<number>`COALESCE(SUM(${tracks.duration}), 0)`
```

Что здесь происходит:

- **`sql`** — специальная функция-тег. Она **не** склеивает строку наивно.
- **`${tracks.duration}`** — это **не значение**, а **ссылка на колонку**.
  Drizzle подставит её как идентификатор в кавычках: `"duration"`.
- **`<number>`** — «параметр типа»: мы говорим TypeScript'у, что результат —
  число. Drizzle не может это вывести сам.

```sql
COALESCE(SUM("duration"), 0)
```

**Ключевой момент:** то, что внутри `${...}` — колонка Drizzle, а не
пользовательская строка, — критично именно для **идентификаторов**.

Я это проверил, и вот что реально происходит с `sql`-шаблоном. Если подставить
в него **значение** (строку от пользователя), Drizzle отправит его
**параметром** — инъекция невозможна:

```ts
const userInput = "'; DROP TABLE tracks; --";
db.select().from(tracks).where(sql`${tracks.title} = ${userInput}`).toSQL();
```

```
sql:    ... where "tracks"."title" = ?
params: [ "'; DROP TABLE tracks; --" ]      ← это ДАННЫЕ, а не код
```

А если подставить **колонку** — она станет идентификатором в кавычках:

```ts
db.select().from(tracks).where(sql`${tracks.title} = 'x'`).toSQL();
```

```
sql: ... where "tracks"."title" = 'x'
```

**Единственный способ вставить в запрос «сырой» текст — явно попросить об этом:
`sql.raw(...)`.**

```ts
// ⚠️ ТОЛЬКО когда строка формируется ТОБОЙ, а не приходит от пользователя
db.select().from(tracks).where(sql`${sql.raw("1=1")}`).toSQL();
// → ... where 1=1
```

**Вывод, который стоит запомнить:**

| Что подставляешь в `${...}` | Что получается | Безопасно? |
|---|---|---|
| Колонка Drizzle (`tracks.title`) | `"tracks"."title"` | ✅ да |
| Другое `sql`-выражение | Как есть, рекурсивно | ✅ да |
| Строка/число (**значение**) | `?` — параметр | ✅ да, это данные |
| `sql.raw(чужаяСтрока)` | Текст прямо в SQL | ❌ **ИНЪЕКЦИЯ** |

**Итог простой: `sql.raw()` с пользовательскими данными — это единственная
дыра, которую Drizzle оставляет открытой.** Не открывай её.

Это, кстати, отличает Drizzle от «ручной» сборки SQL в том же `bun:sqlite`, где
соблазн написать ``raw.query(`... WHERE title = '${s}'`)`` очень велик — и
именно там рождается большинство инъекций.

---

## 13. Агрегации

Здесь начинается настоящий SQL, и для тебя это будет самое знакомое место.

### 13.1. `count()` — хелпер Drizzle

```ts
import { count } from "drizzle-orm";

const rows = await db.select({ trackCount: count() }).from(tracks);
```

```sql
select count(*) from "tracks"
```

`count()` без аргумента разворачивается в `count(*)`. С аргументом — в
`count(колонка)`, и тогда `NULL`-значения не считаются. Есть ещё
`countDistinct(column)` — прямой аналог `COUNT(DISTINCT ...)`.

### 13.2. `COALESCE(SUM(...), 0)` — защита от NULL

Список альбомов с суммарной длительностью (`listAlbums`):

```ts
const rows = await db
  .select({
    album: tracks.album,
    albumArtist: tracks.albumArtist,
    year: sql<number>`COALESCE(MAX(${tracks.year}), 0)`,
    trackCount: count(),
    totalDuration: sql<number>`COALESCE(SUM(${tracks.duration}), 0)`,
    coverTrackId: sql<number | null>`MAX(CASE WHEN ${tracks.coverFile} IS NOT NULL THEN ${tracks.id} END)`,
  })
  .from(tracks)
  .groupBy(tracks.album, tracks.albumArtist)
  .orderBy(asc(tracks.albumArtist), asc(tracks.album));
```

**Настоящий SQL:**

```sql
select "album", "album_artist",
       COALESCE(MAX("year"), 0),
       count(*),
       COALESCE(SUM("duration"), 0),
       MAX(CASE WHEN "cover_file" IS NOT NULL THEN "id" END)
from "tracks"
group by "tracks"."album", "tracks"."album_artist"
order by "tracks"."album_artist" asc, "tracks"."album" asc
```

Разбор:

- **`GROUP BY album, album_artist`** — «сверни все строки с одинаковым альбомом
  в одну». Группируем по **паре** полей намеренно: два разных исполнителя
  вполне могли выпустить альбом с одинаковым названием («Greatest Hits» —
  вечная классика), и склеивать их в один нельзя.
- **`COUNT(*)`** — сколько строк попало в группу.
- **`SUM(duration)`** — сложить длительности всех треков группы.
- **`COALESCE(x, 0)`** — «верни `x`, а если `x` = `NULL`, верни `0`»,
  ровно как в ClickHouse. `SUM` по пустой группе даёт `NULL` — это страховка.

**Отдельно стоит объяснить `MAX(CASE WHEN ...)`** — это трюк, который стоит
запомнить:

```sql
MAX(CASE WHEN "cover_file" IS NOT NULL THEN "id" END)
```

`CASE WHEN` работает как `if-else` **внутри агрегата**:

- если у трека есть обложка → значением становится его `id`;
- если обложки нет → `CASE` не находит `ELSE` и возвращает **`NULL`**.

А `MAX` **игнорирует `NULL`** (это стандартное поведение всех агрегатов, кроме
`COUNT(*)`) и берёт реальный `id`. Итог: «дай мне id любого трека этого
альбома, у которого есть обложка». Одним проходом по данным, без подзапроса.

**Родство с ClickHouse:** в ClickHouse это записалось бы как
`maxIf(id, cover_file IS NOT NULL)` или `argMax(id, cover_file IS NOT NULL)`.
Логика идентична, синтаксис разный.

> **Осторожно с типами.** SQLite иногда возвращает результат агрегата **строкой**,
> а не числом. Поэтому в маппере стоит страховка:
>
> ```ts
> totalDuration: Number(row.totalDuration ?? 0),
> ```
>
> Это не паранойя — это реальная особенность драйверов.

### 13.3. `COUNT(DISTINCT ...)`

```ts
const rows = await db
  .select({
    artist: tracks.artist,
    trackCount: count(),
    albumCount: sql<number>`COUNT(DISTINCT ${tracks.album})`,
  })
  .from(tracks)
  .groupBy(tracks.artist)
  .orderBy(asc(tracks.artist));
```

```sql
select "artist", count(*), COUNT(DISTINCT "album")
from "tracks"
group by "tracks"."artist"
order by "tracks"."artist" asc
```

`COUNT(DISTINCT album)` считает **не строки, а разные значения**.
Если у исполнителя 12 песен, но всего 2 альбома — вернётся `2`, а не `12`.
`COUNT(*)` и `COUNT(DISTINCT ...)` в одном запросе — совершенно нормально.

### 13.4. Условная агрегация: `SUM(CASE WHEN ...)`

Статистика библиотеки — **один запрос вместо пяти**:

```ts
const rows = await db
  .select({
    totalTracks: count(),
    totalArtists: sql<number>`COUNT(DISTINCT ${tracks.artist})`,
    totalAlbums: sql<number>`COUNT(DISTINCT ${tracks.album})`,
    totalDuration: sql<number>`COALESCE(SUM(${tracks.duration}), 0)`,
    favoriteCount: sql<number>`COALESCE(SUM(CASE WHEN ${tracks.isFavorite} = 1 THEN 1 ELSE 0 END), 0)`,
  })
  .from(tracks);
```

```sql
select count(*),
       COUNT(DISTINCT "artist"),
       COUNT(DISTINCT "album"),
       COALESCE(SUM("duration"), 0),
       COALESCE(SUM(CASE WHEN "is_favorite" = 1 THEN 1 ELSE 0 END), 0)
from "tracks"
```

**Последняя строка — самый интересный приём.** `SUM` по выражению `CASE` считает,
сколько раз условие оказалось истинным:

```
строка 1: is_favorite = 1 → CASE даёт 1
строка 2: is_favorite = 0 → CASE даёт 0
строка 3: is_favorite = 1 → CASE даёт 1
                              SUM = 2  ← столько избранных
```

Результат — **то же самое, что `COUNT(*)` с фильтром, но за один проход по
таблице.** В ClickHouse это делается через `countIf(is_favorite = 1)` — суть та
же, синтаксис другой.

**Здесь ты видишь и главный принцип оптимизации:** вместо пяти запросов к базе
мы делаем один. Каждый запрос — это round-trip и открытие/закрытие читающего
контекста. Пять вместо одного — в разы медленнее, даже если данные крошечные.

### 13.5. `GROUP BY` + `aggregate` + `orderBy` по агрегату

Топ треков (`listTopTracks`) — это уже почти dbt-модель:

```ts
const rows = await db
  .select({ track: tracks, playCount: sql<number>`COUNT(*)` })
  .from(playHistory)
  .innerJoin(tracks, eq(tracks.id, playHistory.trackId))
  .groupBy(tracks.id)
  .orderBy(desc(sql`COUNT(*)`))
  .limit(limit);
```

```sql
select "tracks"."id", "tracks"."path", ..., count(*)
from "play_history"
inner join "tracks" on "tracks"."id" = "play_history"."track_id"
group by "tracks"."id"
order by count(*) desc
limit ?
```

Обрати внимание: **сортировать можно прямо по агрегату**, без `AS`-алиаса.
А вот `GROUP BY tracks.id` при выборе всех колонок `tracks` — момент, который
SQLite **разрешает**, но стандартный SQL (и ClickHouse) требуют группировать по
всем неагрегированным колонкам. SQLite здесь мягче: он знает, что `tracks.id` —
первичный ключ, а значит все остальные колонки `tracks` функционально от него
зависят. **Удобно, но знай: в ClickHouse так не пройдёт.**

---

## 14. Транзакции на синхронном драйвере

### 14.1. Зачем нужна транзакция

Задача: `reorderPlaylistTracks` — поменять порядок треков. На вход приходит
полный список id в новом порядке.

Наивно — цикл с `UPDATE`:

```ts
for (let i = 0; i < orderedTrackIds.length; i++) {
  await db.update(playlistTracks).set({ position: i }).where(...);
}
```

**Что не так:** если между итерациями что-то пойдёт не так (ошибка, отключение
питания, `Ctrl+C`), плейлист останется в **полу-изменённом** состоянии: часть
треков с новыми номерами, часть со старыми. Порядок превратится в кашу, и
чинить его придётся руками.

**ТРАНЗАКЦИЯ** — это «всё или ничего». Все изменения внутри применяются одной
**неделимой** операцией: либо целиком, либо никак. Это свойство **ACID**, буква
«A» (Atomicity).

```sql
BEGIN;
UPDATE ...; UPDATE ...; UPDATE ...;
COMMIT;      -- или ROLLBACK при ошибке
```

Drizzle делает это за нас через `db.transaction()`.

### 14.2. Синхронный драйвер — важная деталь

```ts
export async function reorderPlaylistTracks(playlistId: number, orderedTrackIds: number[]): Promise<void> {
  // ВАЖНО: драйвер bun:sqlite синхронный, поэтому и колбэк транзакции
  // синхронный — внутри используем .run(), а не await.
  db.transaction((tx) => {
    orderedTrackIds.forEach((trackId, index) => {
      tx.update(playlistTracks)
        .set({ position: index })     // позиция = индекс в массиве: 0, 1, 2, ...
        .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
        .run();                       // ← .run(), а не await
    });
  });
}
```

Разберём то, что тебя, скорее всего, смутит.

**`db.transaction((tx) => { ... })` — без `await`.** Обычно в примерах из
интернета ты увидишь `await db.transaction(async (tx) => { ... })`. Почему у
нас иначе?

Потому что `bun:sqlite` — **синхронный драйвер**. Файловые операции SQLite при
таком драйвере выполняются прямо в текущем потоке, без возврата в event loop.
Отсюда важное следствие: **между двумя операциями внутри транзакции в
JavaScript не может ничего произойти** — никакой другой код не успеет
вклиниться, потому что мы не отдаём управление.

Это именно то, что нужно транзакции. Поэтому колбэк **синхронный**, и
`db.transaction(...)` **возвращает результат сразу**, а не `Promise`.
Соответственно и `await` не нужен — точнее, он безвреден, но бессмыслен.

**Почему `.run()`, а не `await`.** Запросы Drizzle **ленивы**: пока ты не
скажешь «выполняй», ничего не происходит. Есть три способа сказать:

| Способ | Что делает | Когда |
|---|---|---|
| `await query` | Выполняет и возвращает **массив** строк | В `async`-функциях, обычный путь |
| `.run()` | Выполняет **синхронно**, ничего не возвращает | В синхронной транзакции |
| `.all()` | Выполняет синхронно, возвращает массив | Тоже синхронный путь |
| `.get()` | Выполняет синхронно, возвращает первую строку | Когда нужна одна строка |

Внутри **синхронного** колбэка транзакции `await` использовать нельзя
(колбэк не `async` — иначе транзакция закроется раньше, чем промисы
разрешатся). Поэтому мы вызываем `.run()`: «выполни прямо сейчас, я не жду».

**Порядок в `.set({ position: index })`.** Важная тонкость логики:
позицией становится **индекс в массиве**, а не `id`. Поэтому перетаскивание
трека наверх меняет `position` у всех, а `id` остаются прежними. Именно так и
должно быть: `id` — это идентичность, `position` — порядок. Смешивать их —
классическая ошибка проектирования.

**Кстати, приём `db.transaction()` пригодится и для сканера:** когда он
обрабатывает 10 000 файлов, полезно обернуть вставки пачками в транзакции —
это на порядок быстрее, чем по одной (каждый отдельный `INSERT` в SQLite
это отдельная транзакция с записью в журнал).

---

## 15. UPSERT: `onConflictDoUpdate` / `onConflictDoNothing`

**UPSERT** = *UPdate* + inSERT. «Вставь, а если такая строка уже есть — сделай
что-то другое».

### 15.1. Зачем это нужно при сканировании

Сканер обходит папки с музыкой. Для каждого файла он **не знает**, видел ли его
раньше. Варианты:

- **Плохо:** сделать `SELECT` по path, потом решить — `INSERT` или `UPDATE`.
  Два запроса на каждый файл, плюс гонка (race condition), если что-то
  изменится между ними.
- **Хорошо:** один `INSERT ... ON CONFLICT`.

### 15.2. `onConflictDoUpdate`

```ts
export async function upsertTrack(values: typeof tracks.$inferInsert): Promise<number> {
  const result = await db
    .insert(tracks)
    .values(values)
    .onConflictDoUpdate({
      target: tracks.path,       // ← по какой колонке ищем конфликт
      set: {
        filename: values.filename,
        title: values.title,
        artist: values.artist,
        // ...остальные поля...
        updatedAt: new Date(),
        // ВАЖНО: is_favorite мы НЕ трогаем! Это данные пользователя,
        // а не сканера. Скан не должен сбрасывать избранное.
      },
    })
    .returning({ id: tracks.id });

  return result[0].id;
}
```

```sql
insert into "tracks" ("id", "path", "filename", "search_text", "title", "artist",
                      "album", "album_artist", "genre", "year", "track_number",
                      "duration", "size", "mtime", "is_favorite", "cover_file",
                      "created_at", "updated_at")
values (null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)
on conflict ("tracks"."path") do update set "title" = ?
returning "id"
```

Разберём:

- **`target: tracks.path`** — колонка, по которой определяется конфликт. Это
  **работает только потому, что на `path` есть `uniqueIndex`**. Убери
  уникальный индекс — и `ON CONFLICT(path)` перестанет ловить конфликты
  (SQLite потребует уникальный индекс или уникальное ограничение).
- **`set: { ... }`** — что перезаписать, если конфликт нашёлся. Значения мы
  берём из **того же объекта `values`**, который пытались вставить. Это и есть
  смысл UPSERT: «сделай строку такой, как будто я её только что вставил».
- **`returning({ id: tracks.id })`** — возвращаем id **в обоих случаях**
  (и при вставке, и при обновлении). Сканеру это и нужно.

### 15.3. Что означает `excluded`

Вот **чистый SQL** этого UPSERT (то, как он выглядит «по-учебнику»):

```sql
INSERT INTO tracks (path, filename, title, artist, ...)
VALUES (?, ?, ?, ?, ...)
ON CONFLICT(path) DO UPDATE SET
    title       = excluded.title,
    artist      = excluded.artist,
    updated_at  = excluded.updated_at;
```

**`excluded`** — это специальное ключевое слово SQLite (и PostgreSQL).
Оно означает псевдотаблицу с теми значениями, **которые мы пытались вставить**.

Читается так: *«возьми новое значение `title` из того, что я хотел вставить»*.

```
INSERT'им строку:   title = "Numb (Remastered)"
А в базе лежит:     title = "Numb"
Конфликт по path!
excluded.title  →  "Numb (Remastered)"   ← НОВОЕ значение
tracks.title    →  "Numb"                ← СТАРОЕ значение
```

В SQL можно выбрать любое из двух:

```sql
ON CONFLICT(path) DO UPDATE SET
    title = excluded.title,                    -- взять новое
    created_at = tracks.created_at             -- сохранить старое!
```

**Важное расхождение с Drizzle, которое надо понимать.** Посмотри на
сгенерированный SQL выше: там в `set` попали **параметры** (`?`), а не
`excluded.column`. Почему?

Потому что мы передали в `set` **явные значения из JavaScript**:

```ts
set: { title: values.title }
```

Это `values.title` — то же значение, но переданное **параметром**. Для SQLite
это эквивалентно: значение-то одинаковое. Но есть два следствия:

1. **Плюс:** больше параметров → запрос не такой «умный», зато полностью
   предсказуемый.
2. **Минус:** на длинных списках полей запрос раздувается.

Если хочется получить **буквально** `excluded.title` в SQL, нужно использовать
`sql`-выражение:

```ts
import { sql } from "drizzle-orm";

.onConflictDoUpdate({
  target: tracks.path,
  set: {
    title: sql`excluded.title`,
    artist: sql`excluded.artist`,
  },
})
```

**Что из этого следует практически:** в нашем случае разницы в поведении нет,
но `excluded` — это то, что ты увидишь, если будешь читать SQLite-логи или
открывать базу в DB-браузере. И теперь ты знаешь, откуда оно берётся.

**Ещё одна важная деталь проекта:** обрати внимание на комментарий в
`upsertTrack`:

> *«ВАЖНО: `is_favorite` мы НЕ трогаем! Это данные, которые создал
> пользователь, а не сканер».*

Это архитектурное решение, а не случайность. **Сканер владеет тегами
файла** (title, artist, album, duration, mtime). **Пользователь владеет
`is_favorite`**. Если бы сканер перезаписывал избранное, каждая пересборка
библиотеки стирала бы все твои отметки. Правило простое: **каждое поле имеет
ровно одного владельца**.

### 15.4. `onConflictDoNothing`

Иногда конфликт — это не «обнови», а «просто ничего не делай».

```ts
const inserted = await db
  .insert(playlistTracks)
  .values({ playlistId, trackId, position: nextPosition })
  .onConflictDoNothing()
  .returning({ trackId: playlistTracks.trackId });

// Если returning() ничего не вернул — значит конфликт был, трек уже лежал тут.
return inserted.length > 0;
```

```sql
insert into "playlist_tracks" ("playlist_id", "track_id", "position", "added_at")
values (?, ?, ?, ?)
on conflict do nothing
returning "track_id"
```

Логика добавления трека в плейлист:

1. Узнать текущую максимальную позицию:
   ```sql
   SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?
   ```
   `COALESCE(..., -1)` нужен для **пустого** плейлиста: `MAX` вернёт `NULL`, а
   `-1 + 1 = 0` — то есть первый трек встанет на позицию `0`.

2. Вставить. **Составной первичный ключ `(playlist_id, track_id)` не даст
   вставить трек дважды** — вместо ошибки мы просим SQLite просто ничего не
   делать.

3. **Трюк с `returning()` как индикатором.** Если `INSERT` прошёл — строка
   вернётся, `inserted.length > 0` → `true`. Если конфликт был и мы «ничего не
   сделали» — вернётся пустой массив → `false`. Один запрос отвечает и «сделай»,
   и «получилось ли».

### 15.5. UPSERT для singleton-таблицы

`playback_state` — таблица «одна строка на весь плеер». Мы жёстко фиксируем
`id = 1`:

```ts
await db
  .insert(playbackState)
  .values({ id: 1, trackId, position, updatedAt: new Date() })
  .onConflictDoUpdate({
    target: playbackState.id,
    set: { trackId, position, updatedAt: new Date() },
  });
```

```sql
insert into "playback_state" ("id", "track_id", "position", "updated_at")
values (?, ?, ?, ?)
on conflict ("playback_state"."id") do update set "track_id" = ?, "position" = ?, "updated_at" = ?
```

**Красота приёма:** не важно, есть строка или нет — **в конце она будет ровно
одна и с нужными значениями**. Никаких `if (exists) update else insert`. Этот
паттерн в аналитике встречается постоянно (`ReplacingMergeTree` в ClickHouse
делает то же самое на уровне движка).

---

## 16. Миграции

### 16.1. Проблема, которую решают миграции

Ты добавил колонку `bitrate` в `schema.ts`. На твоём ноутбуке база новая —
всё хорошо. А у друга, который уже запустил проект месяц назад, база **старая**,
и в ней нет колонки `bitrate`. Приложение упадёт.

Миграции — это **пронумерованный список изменений структуры базы**, который
применяется по порядку и **ровно один раз**.

### 16.2. `drizzle-kit generate`

```bash
bunx drizzle-kit generate
```

Что делает:

1. Читает `src/lib/db/schema.ts`.
2. Сравнивает со **снимком** предыдущего состояния (`drizzle/meta/*_snapshot.json`).
3. Находит разницу.
4. Пишет **новый SQL-файл** в `drizzle/` с нужными `CREATE TABLE` / `ALTER TABLE`.
5. Обновляет снимок и журнал.

Настройки — в `drizzle.config.ts`:

```ts
export default defineConfig({
  schema: "./src/lib/db/schema.ts",   // откуда читать схему
  out: "./drizzle",                   // куда складывать SQL-миграции
  dialect: "sqlite",                  // какая база
  dbCredentials: { url: process.env.DB_PATH ?? "./data/music.db" },  // для push
  verbose: true,
  strict: true,                       // спрашивать перед разрушительными действиями
});
```

**`drizzle.config.ts` — файл только для разработчика.** В рантайме он
не используется и в сборку не попадает. Вспомни раздел 3: `drizzle-kit` — это
CLI, а не библиотека приложения.

### 16.3. Что лежит в папке `drizzle/`

```
drizzle/
├── 0000_clammy_norrin_radd.sql     ← SQL первой миграции
└── meta/
    ├── _journal.json               ← список миграций по порядку
    └── 0000_snapshot.json          ← снимок схемы после этой миграции
```

Содержимое первого файла (сокращённо):

```sql
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	...
	`is_favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_path_unique` ON `tracks` (`path`);
CREATE INDEX `tracks_artist_idx` ON `tracks` (`artist`);
```

Разберём составные части:

**Имя файла `0000_clammy_norrin_radd.sql`:**

- `0000` — **порядковый номер**. Он определяет порядок применения. Именно
  поэтому миграции — это «журнал», а не «набор файлов».
- `clammy_norrin_radd` — **случайное осмысленное имя**, которое drizzle-kit
  генерирует сам. Оно гарантирует, что два разработчика, создавшие миграции
  одновременно, не назовут их одинаково.

**`--> statement-breakpoint`** — служебный комментарий-разделитель. Drizzle
использует его, чтобы понять, где заканчивается один SQL-оператор. `migrate()`
выполняет операторы по одному, и без разделителя он не смог бы разбить
многострочный файл на отдельные команды.

**`meta/_journal.json` — журнал:**

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    { "idx": 0, "version": "6", "when": 1790522808976, "tag": "0000_clammy_norrin_radd", "breakpoints": true }
  ]
}
```

Здесь видно: `idx` — номер, `tag` — имя файла без `.sql`, `when` — метка
времени создания. Именно **наличие записи в журнале** отличает «миграцию» от
«просто SQL-файла, лежащего в папке».

**`meta/0000_snapshot.json` — снимок.** Это полное состояние схемы после
применения миграции №0. Нужен именно он, чтобы `generate` мог вычислить
**разницу** со следующим состоянием `schema.ts`. Без снимка `generate` не знал
бы, что было «до».

### 16.4. `migrate()` — применение при старте

```ts
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
```

Что происходит:

1. `migrate()` читает содержимое `_journal.json`.
2. Смотрит во внутреннюю таблицу **`__drizzle_migrations`** — какие миграции
   уже применены (по `hash`).
3. Применяет **только те**, которых ещё нет.
4. **Записывает факт применения** в `__drizzle_migrations`.

Вызов стоит **внутри `createDatabase()`** — значит, миграции применяются при
**первом** обращении к базе, один раз за жизнь процесса. То есть база
автоматически «догоняет» код при старте. Это очень удобно для Docker: контейнер
поднялся — миграции применились.

**Что такое `__drizzle_migrations`.** Это обычная таблица, которую Drizzle
создаёт сам. Я реально её открыл — вот её содержимое:

```
tables: __drizzle_migrations, play_history, playback_state,
        playlist_tracks, playlists, sqlite_sequence, tracks

migrations: {
  id: null,
  hash: "de02196f728ae42f6198ea4c2bce256fc438dd7896497d430370101f56f023cd",
  created_at: 1790522808976
}
```

Три колонки:

| Колонка | Что хранит |
|---|---|
| `id` | Автоинкремент, служебный |
| `hash` | **SHA-256 содержимого файла миграции** |
| `created_at` | Когда миграция была применена |

**`hash` — самое интересное.** Он считается **от содержимого** файла. Если ты
**изменишь уже применённую миграцию**, хэш изменится, и Drizzle посчитает её
**новой** — и попытается применить повторно. Это обычно приводит к ошибке
«table already exists».

> **Золотое правило: никогда не правь уже применённые миграции.** Нужно
> изменить схему — создай **новую** миграцию. Именно поэтому `generate`
> нумерует файлы, а не перезаписывает их.

**`path.resolve(process.cwd(), "drizzle")`** — путь указывается **абсолютным**
сознательно. Рабочая папка в Docker (`/app`) может отличаться от локальной, и
относительный путь `"./drizzle"` однажды приведёт к «папка миграций не найдена».

### 16.5. Почему миграции коммитятся в git

В `.gitignore` у нас перечислено многое (`/data/`, `/music/*`, `.env`), но
**папка `drizzle/` — не там**. И это правильно.

**Миграции — это код, а не данные.** Они:

- описывают **структуру** базы, а не её содержимое;
- должны быть **одинаковыми** на всех машинах: ноутбук, CI, продакшен;
- служат **историей изменений** — по ним можно понять, как схема менялась.

**Что НЕ коммитится:**

| Путь | Почему |
|---|---|
| `/data/` | Сама база `music.db` — это данные, они пересоздаются сканером |
| `/music/*` | Твоя музыка, гигабайты, у каждого своя |
| `.env` | Секреты. Коммитится только `.env.example` как шаблон |

**Аналогия из твоего мира.** Папка `drizzle/` — это как **`dbt`-проект**: код
моделей, лежащий в git, который может воспроизвести одинаковую структуру на
любом окружении. А `/data/music.db` — это **материализованные в ClickHouse
таблицы**: результат выполнения, а не сам код. Результат не коммитят — его
**пересчитывают**.

### 16.6. Другие команды `drizzle-kit`

| Команда | Что делает | Когда использовать |
|---|---|---|
| `drizzle-kit generate` | Создать SQL-файл миграции из diff'а схемы | **Основной способ.** Всегда |
| `drizzle-kit migrate` | Применить миграции из CLI | Редко — у нас `migrate()` в коде |
| `drizzle-kit push` | Применить схему **напрямую**, без файлов | Быстрые эксперименты, прототипы |
| `drizzle-kit studio` | Поднять веб-интерфейс для просмотра данных | Посмотреть, что в базе |

**`push` — удобно, но опасно.** Он не создаёт файл миграции и не записывает в
`__drizzle_migrations`. Если ты будешь смешивать `push` и `generate`, история
миграций разъедется с реальной базой. **Для проекта правило простое:
используй `generate`, а `push` — только когда экспериментируешь на одноразовой
базе.**

У проекта есть ещё свой скрипт:

```jsonc
"db:reset": "rm -f data/music.db && echo 'База удалена. Перезапусти скан библиотеки.'"
```

Он работает именно потому, что **база — производная от файлов**. Удалил —
пересобрал сканером. Это архитектурное свойство, а не везение: файловая система
у нас источник правды.

---

## 17. Проблема N+1 и как её решает `inArray`

Это, пожалуй, **самая важная практическая тема** всего документа.

### 17.1. В чём проблема

Задача: показать треки плейлиста, в котором 100 песен.

**Наивный код:**

```ts
// ❌ 100 треков → 100 запросов к базе
async function listPlaylistTracksNaive(playlistId: number) {
  const rows = await db
    .select({ trackId: playlistTracks.trackId })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));

  const result = [];
  for (const row of rows) {
    const track = await getTrackRowById(row.trackId);   // ← ЗАПРОС В ЦИКЛЕ
    if (track) result.push(track);
  }
  return result;
}
```

Что происходит:

```sql
-- Запрос 1: получить список id
SELECT track_id FROM playlist_tracks WHERE playlist_id = 7;

-- Запросы 2..101: по одному на каждый трек
SELECT * FROM tracks WHERE id = 12 LIMIT 1;
SELECT * FROM tracks WHERE id = 47 LIMIT 1;
SELECT * FROM tracks WHERE id = 93 LIMIT 1;
-- ...и так 100 раз
```

**Итого: 1 + 100 = 101 запрос.** Отсюда и название — **N+1** (один плюс N).

**Почему это так больно.** Стоимость запроса складывается не из «сколько строк
прочитать» — SQLite с индексом по `id` находит строку мгновенно, —
а из **накладных расходов на каждый round-trip**: подготовить prepared statement,
выполнить, разобрать результат, переключить контекст. На ста запросах это
десятки миллисекунд вместо одной. Помножь на количество пользователей и
запросов в секунду — и получишь тысячи лишних операций.

**Особенно коварно то, что код выглядит нормально.** Цикл читается легко, и
проблему видно **только** если задуматься о количестве запросов.

### 17.2. Лекарство: один запрос с `IN`

```ts
export async function getTrackRowsByIds(ids: number[]): Promise<TrackRow[]> {
  if (ids.length === 0) return [];

  // -- SQL: SELECT * FROM tracks WHERE id IN (?, ?, ?)
  const rows = await db.select().from(tracks).where(inArray(tracks.id, ids));

  // SQL не обязан возвращать строки в порядке из списка IN — раскладываем
  // результат в Map («id → трек») и собираем массив заново в нужном порядке.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is TrackRow => row !== undefined);
}
```

```sql
select "id", "path", "filename", "search_text", "title", "artist", "album",
       "album_artist", "genre", "year", "track_number", "duration", "size",
       "mtime", "is_favorite", "cover_file", "created_at", "updated_at"
from "tracks"
where "tracks"."id" in (?, ?, ?, ?, ...)
```

**Один запрос вместо 101.** Разница на порядок.

### 17.3. Деталь, из-за которой такие запросы ломаются на практике

> **SQL не обязан возвращать строки в порядке из списка `IN`.**

Это не придирка, а **гарантия SQL-стандарта**: без `ORDER BY` порядок строк
**не определён**. Оптимизатор вправе вернуть их как удобно — например, в
порядке индекса, а не в порядке твоего массива.

**А нам нужно сохранить порядок плейлиста.** Решение — восстановить его в
JavaScript:

```ts
// 1. Превращаем массив строк в словарь «id → строка»
const byId = new Map(rows.map((row) => [row.id, row]));

// 2. Идём по ИСХОДНОМУ списку id (в нужном порядке) и берём строки из словаря
return ids.map((id) => byId.get(id))
          .filter((row): row is TrackRow => row !== undefined);
```

**Почему `Map`, а не перебор массива.** `Map.get(id)` — это операция с
**константным** временем (по сути хэш-таблица). Поиск в массиве через `.find()`
перебирал бы элементы, и весь цикл стал бы `O(n²)` — на сотнях треков это уже
заметно.

**Что делает `.filter((row): row is TrackRow => row !== undefined)`.** Это
**type guard**. `byId.get(id)` может вернуть `undefined` (если трека нет в
базе). TypeScript знает тип как `TrackRow | undefined`. Предикат `row is TrackRow`
сообщает компилятору: «после этого фильтра в массиве только `TrackRow`». Без
него тип результата был бы `(TrackRow | undefined)[]`, и пришлось бы ставить
`!` в каждом месте использования.

**Итог:** мы делаем 2 запроса вместо 101, и при этом **порядок плейлиста
сохранён точно**. Это и есть «делать правильно».

### 17.4. Тот же приём в других местах проекта

**Сканер — не спрашивать базу про каждый файл.** `getTrackIndexByPath`
делает **один** запрос и строит `Map` «путь → служебные поля»:

```ts
const rows = await db
  .select({ id: tracks.id, path: tracks.path, mtime: tracks.mtime, size: tracks.size })
  .from(tracks);

return new Map(rows.map((row) => [row.path, { id: row.id, mtimeMs: row.mtime.getTime(), size: row.size }]));
```

```sql
select "id", "path", "mtime", "size" from "tracks"
```

Дальше сканер обходит файлы на диске и **заглядывает в эту карту** — без единого
запроса на файл. Если бы мы делали `SELECT` на каждый файл, скан 10 000 песен
превратился бы в 10 000 запросов.

### 17.5. Особая осторожность с `NOT IN`

В `deleteTracksMissingFromDisk` есть комментарий, который стоит прочитать
целиком — это **пример того, как НЕ надо делать**:

> Соблазнительно написать один запрос:
> `DELETE FROM tracks WHERE path NOT IN (...список всех файлов...)`
> Но у SQLite есть лимит на количество параметров в одном запросе. Если разбить
> список на части и выполнить `NOT IN` для каждой части, получится **ХУЖЕ**:
> первый же запрос удалит все треки, которых нет в первой части, то есть
> **половину живой библиотеки**.

Разберём почему это катастрофа. Пусть на диске 1000 файлов, режем на 2 части по
500. Первый запрос:

```sql
DELETE FROM tracks WHERE path NOT IN (первые 500 путей)
```

Он удалит **все треки из второй половины** — потому что их нет в списке из
первых 500. Это не «удалить лишнее», это «удалить половину библиотеки».

**Как правильно:**

```ts
// 1. Лёгкий запрос: только id + path
const knownRows = await db.select({ id: tracks.id, path: tracks.path }).from(tracks);

// 2. Разницу множеств считаем в JavaScript — это быстро и безопасно
const onDisk = new Set(existingPaths);
const orphanIds = knownRows.filter((row) => !onDisk.has(row.path)).map((row) => row.id);
if (orphanIds.length === 0) return 0;

// 3. Удаляем строго по списку id, порезав его на порции
let removed = 0;
const CHUNK_SIZE = 500;
for (let index = 0; index < orphanIds.length; index += CHUNK_SIZE) {
  const chunk = orphanIds.slice(index, index + CHUNK_SIZE);
  const deleted = await db.delete(tracks).where(inArray(tracks.id, chunk)).returning({ id: tracks.id });
  removed += deleted.length;
}
```

```sql
-- шаг 1: один лёгкий запрос
select "id", "path" from "tracks"

-- шаг 3: удаление порциями, строго по известным id
delete from "tracks" where "tracks"."id" in (?, ?, ?, ...) returning "id"
```

Три урока из этого куска:

1. **`Set` вместо массива.** `onDisk.has(path)` — константное время.
   `existingPaths.includes(path)` перебирал бы массив.
2. **Разницу множеств считаем в JS, а не в SQL.** `NOT IN` с большим списком —
   это минное поле.
3. **Порции по 500** — из-за лимита SQLite на число параметров
   (`SQLITE_MAX_VARIABLE_NUMBER`). Не бесконечный, но и не крошечный.

И ещё один защитный момент в самом начале функции:

```ts
if (existingPaths.length === 0) {
  // Музыкальной папки нет вообще или она пуста.
  // Удалять всю библиотеку в такой ситуации ОПАСНО — вероятнее всего,
  // пользователь просто забыл примонтировать папку. Поэтому ничего не делаем.
  return 0;
}
```

**Это защита от «тихой катастрофы».** Если в Docker забыли смонтировать
`/music`, `existingPaths` будет пуст — и наивный код стёр бы всю базу. Урок
общего характера: **операции удаления должны иметь защиту от пустого входа.**

---

## 18. Как посмотреть фактический SQL: `.toSQL()`

### 18.1. Простой способ

У любого запроса Drizzle есть метод **`.toSQL()`**:

```ts
const query = db
  .select()
  .from(tracks)
  .where(and(like(tracks.searchText, "%numb%"), eq(tracks.artist, "ATL")))
  .orderBy(asc(tracks.artist), asc(tracks.album), asc(tracks.trackNumber))
  .limit(1000)
  .offset(20);

const { sql, params } = query.toSQL();

console.log(sql);
console.log(params);
```

Что напечатается (это **реальный** вывод, я его запускал):

```
select "id", "path", "filename", "search_text", "title", "artist", "album",
       "album_artist", "genre", "year", "track_number", "duration", "size",
       "mtime", "is_favorite", "cover_file", "created_at", "updated_at"
from "tracks"
where ("tracks"."search_text" like ? and "tracks"."artist" = ?)
order by "tracks"."artist" asc, "tracks"."album" asc, "tracks"."track_number" asc
limit ? offset ?

params: ["%numb%", "ATL", 1000, 20]
```

**Ключевое наблюдение:** `.toSQL()` **не выполняет** запрос. Это чистое
построение текста. Ты можешь вызывать его в консоли, в отладочной функции,
в юнит-тесте — база при этом не трогается.

`.toSQL()` работает на **всех** видах запросов: `select`, `insert`, `update`,
`delete`. Вот, например, что выдаёт `update`:

```ts
db.update(tracks).set({ isFavorite: true, updatedAt: new Date(0) }).where(eq(tracks.id, 1)).toSQL();
```

```sql
update "tracks" set "is_favorite" = ?, "updated_at" = ? where "tracks"."id" = ?
-- params: [1, 0, 1]     ← true → 1, Date(0) → 0
```

Сразу видно **всё преобразование типов**: булев `true` стал `1`, дата стала
числом.

### 18.2. Зачем это нужно именно тебе

Три практические причины:

1. **Ты учишь SQL параллельно.** Видишь `eq(tracks.artist, "ATL")` → видишь
   `"tracks"."artist" = ?`. Связь закрепляется мгновенно.
2. **Отладка медленных запросов.** Прежде чем добавлять индекс, надо понять,
   **какой именно** запрос уходит в базу. `.toSQL()` отвечает на этот вопрос
   точно, без догадок.
3. **Проверка `EXPLAIN QUERY PLAN`.** Можно взять результат `.toSQL().sql`,
   подставить вместо `?` значения и прогнать через `EXPLAIN QUERY PLAN` — и
   увидеть, использует ли SQLite твой индекс:
   ```sql
   EXPLAIN QUERY PLAN
   SELECT * FROM tracks WHERE artist = 'ATL';
   -- SEARCH tracks USING INDEX tracks_artist_idx (artist=?)
   --                            ^^^^^^^^^^^^^^^^^^^ индекс работает!
   ```

### 18.3. Почему в проекте SQL есть в комментариях

В `track-queries.ts`, `playlist-queries.ts` и `history-queries.ts` рядом с
**каждым** запросом стоит комментарий вида:

```ts
/**
 * Возвращает строку базы целиком. ...
 */
export async function getTrackRowById(id: number): Promise<TrackRow | null> {
  // -- SQL: SELECT * FROM tracks WHERE id = ? LIMIT 1
  const rows = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
  return rows[0] ?? null;
}
```

Это решение **сделано осознанно**, и у него три причины:

**1. Документация на месте.** Читая код через полгода, ты не будешь вспоминать,
что делает `.leftJoin(...).groupBy(...)`. Ты просто прочитаешь SQL рядом — и
вспомнишь. В аналитике ты делаешь ровно то же: в dbt-модели над `SELECT` всегда
есть комментарий, зачем эта модель нужна.

**2. Обучение.** Автор проекта учит фронтенд с нуля. Каждая функция —
это **пара** «TypeScript ↔ SQL», и, читая файл сверху вниз, ты незаметно
учишь SQL-конструкции: `GROUP BY`, `COALESCE`, `LEFT JOIN`, `UPSERT`.
Это учебник, встроенный в код.

**3. Ревью и защита от сюрпризов.** Если кто-то (или ты сам) изменит цепочку
вызовов, комментарий со SQL перестанет совпадать с реальностью — и это заметят
на код-ревью. Комментарий становится **контрактом**.

**Тонкость честности:** в комментариях SQL записан в «человеческом» виде
(`SELECT *` вместо длинного перечисления колонок). Реальный SQL из `.toSQL()`
всегда перечисляет колонки явно. Это не ошибка — это упрощение ради
читаемости. Главное, чтобы **смысл** совпадал.

---

## 19. Сравнение с dbt: что общего и чем отличается

Твой основной курс — ClickHouse + SQL + dbt + BI. Давай явно сопоставим миры,
потому что **интуиция у тебя уже есть** — её надо только «переприцелить».

### 19.1. Что общего

| В dbt | В нашем проекте | Общая идея |
|---|---|---|
| Модель как `SELECT` | Функция в `*-queries.ts` | «Запрос — это именованная сущность, а не строчка в коде» |
| `{{ ref('stg_tracks') }}` | `import { tracks } from "@/lib/db/schema"` | Ссылаемся на таблицу по имени, а не по строке |
| `dbt test` на `unique` / `not_null` | `.primaryKey()` / `.notNull()` / `uniqueIndex` | Ограничения объявлены **декларативно**, а не проверяются руками |
| `dbt docs generate` | `$inferSelect` | Метаданные выводятся из описания — документация не расходится с кодом |
| Витрина `fct_listens` | `listTopTracks()` | «Из журнала событий — агрегированный результат» |
| Инкрементальная модель | `upsertTrack()` / `onConflictDoUpdate` | Не пересчитываем всё, а дописываем/обновляем |
| `sources.yml` | `schema.ts` | Единый источник правды о структуре данных |

Особенно близка тебе таблица **`play_history`**:

```ts
export const playHistory = sqliteTable("play_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: integer("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
  playedAt: integer("played_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
```

Это **таблица фактов** в миниатюре — ровно как `fct_*` в dbt. Append-only
(журнал только дописывается), события с меткой времени, ссылка на измерение
(`tracks`). А `listTopTracks()` — это уже почти витрина:

```ts
.groupBy(tracks.id)
.orderBy(desc(sql`COUNT(*)`))
```

Что в dbt записалось бы как:

```sql
-- models/marts/fct_listens.sql
SELECT track_id, COUNT(*) AS play_count, MAX(played_at) AS last_played_at
FROM {{ ref('stg_play_history') }}
GROUP BY track_id
```

**Логика идентична.** Разница только в объёме: у нас сотни строк, в ClickHouse —
миллиарды.

### 19.2. Чем отличается — принципиально

| | dbt (аналитика) | Drizzle (наше приложение) |
|---|---|---|
| **Направление** | **Трансформация** данных | **Хранение и доступ** к данным |
| **Читатель** | Аналитик / BI-инструмент | Пользовательский интерфейс, здесь и сейчас |
| **Латентность** | Секунды-минуты, батч по расписанию | **Миллисекунды**, интерактивно |
| **Модель данных** | Денормализованные витрины (star schema) | **Нормализованная** OLTP-схема |
| **Запросы** | Преимущественно `SELECT`, тяжёлые агрегаты | `SELECT`, `INSERT`, `UPDATE`, `DELETE` — всё подряд |
| **Объёмы** | Миллиарды строк | Сотни-тысячи строк |
| **Движок** | ClickHouse / Snowflake / BigQuery | SQLite, встроенный в процесс |
| **Типы** | Схема описана в DDL на сервере | Схема описана в **TypeScript**, из неё выводятся типы |
| **Ошибка = ?** | Упавший ночной запуск, данные пересчитают | **Пользователь видит пустой экран** |
| **Транзакции** | Почти не нужны (append-only, перезапись партиции) | **Критичны** (изменяем живые данные, жонглируем порядком) |
| **Миграции** | `dbt run` пересоздаёт модели | `drizzle-kit generate` + `migrate()`, схема живёт годами |

**Самые важные различия — три.**

**1. Направление.** В dbt задача — **превратить** сырые данные в удобную для
BI форму. В приложении задача — **сохранить и достать** данные быстро и точно.
В dbt ты почти всегда *читаешь* и *создаёшь*. Здесь ты ещё и **изменяешь**:
`UPDATE is_favorite`, `DELETE` из плейлиста, `UPSERT` состояния плеера.

**2. Нормализация.** В аналитике витрины **денормализованы** специально: JOIN
на миллиардах строк дорог. В нашем проекте схема **нормализована**: плейлисты не
дублируют названия треков, а `playlist_tracks` хранит только ссылки. Почему так
можно? Потому что JOIN по 10 000 строк с индексом — это микросекунды.
**Структура диктуется не «правилами», а стоимостью операции.**

**3. Транзакции и живое состояние.** В dbt ночной пересчёт витрины — можно
упасть и перезапустить. В приложении — нет: если пользователь перетащил трек
в плейлисте, а транзакция откатилась наполовину, он увидит сломанный порядок
**немедленно**. Поэтому `db.transaction()` здесь — не экзотика, а рабочая
необходимость.

### 19.3. Как переиспользовать свою интуицию

Три переноса, которые сэкономят тебе время:

1. **`GROUP BY` + `COUNT` + `SUM` + `COALESCE` — у тебя уже в руках.**
   Раздел 13 ты прочитаешь почти без усилий. Единственная новость —
   `MAX(CASE WHEN ...)` и `SUM(CASE WHEN ...)` как «условная агрегация» —
   аналог `maxIf` / `countIf` из ClickHouse.

2. **Индексы — та же логика, что `ORDER BY` в `MergeTree`.** Индекс нужен там,
   где ты **фильтруешь и сортируешь**. В нашей схеме это `tracks.artist`,
   `tracks.album`, `tracks.created_at`, `playlist_tracks(playlist_id, position)`.
   Посмотри на `playlist_tracks_position_idx` — он составной, по
   `(playlist_id, position)`. Это ровно то же, что сортировочный ключ в
   ClickHouse: сначала «узкое» поле (по нему фильтруем), потом «широкое»
   (по нему сортируем).

3. **Миграции — это dbt-проект.** Код в git, воспроизводит структуру на любом
   окружении, а `/data/music.db` — материализация, которую не коммитят.

---

## 20. Шпаргалка: что нужно → как написать → какой SQL получится

Здесь собрано всё самое нужное. SQL приведён **как его реально генерирует
Drizzle** (я проверял через `.toSQL()`), с `?` вместо значений-параметров.

### 20.1. Чтение

| Что нужно | Drizzle | SQL |
|---|---|---|
| Все строки | `db.select().from(tracks)` | `select "id", "path", ... from "tracks"` |
| Равно | `.where(eq(tracks.artist, "ATL"))` | `where "tracks"."artist" = ?` |
| Несколько условий | `.where(and(eq(..), eq(..)))` | `where ("tracks"."a" = ? and "tracks"."b" = ?)` |
| Хотя бы одно | `.where(or(eq(..), eq(..)))` | `where ("tracks"."a" = ? or "tracks"."b" = ?)` |
| По шаблону | `.where(like(tracks.title, "%numb%"))` | `where "tracks"."title" like ?` |
| Из списка | `.where(inArray(tracks.id, ids))` | `where "tracks"."id" in (?, ?, ?)` |
| Не из списка | `.where(notInArray(tracks.id, ids))` | `where "tracks"."id" not in (?, ?)` |
| Сортировка | `.orderBy(asc(tracks.artist))` | `order by "tracks"."artist" asc` |
| Обратная сортировка | `.orderBy(desc(tracks.createdAt))` | `order by "tracks"."created_at" desc` |
| Несколько сортировок | `.orderBy(asc(a), asc(b))` | `order by a asc, b asc` |
| Ограничение | `.limit(100)` | `limit ?` |
| Пропустить N | `.offset(20)` | `offset ?` |
| Одна строка | `.limit(1)` → `rows[0] ?? null` | `limit ?` (`params: [1]`) |
| Только колонки | `.select({ id: tracks.id, path: tracks.path })` | `select "id", "path"` |
| Группировка | `.groupBy(tracks.artist)` | `group by "tracks"."artist"` |
| Одна строка (синхронно) | `.get()` | то же, но берётся первая строка |
| Весь массив (синхронно) | `.all()` | то же |

### 20.2. Агрегации

| Что нужно | Drizzle | SQL |
|---|---|---|
| Количество строк | `count()` | `count(*)` |
| Разные значения | `sql<number>\`COUNT(DISTINCT ${tracks.album})\`` | `COUNT(DISTINCT "album")` |
| Сумма | `sql<number>\`COALESCE(SUM(${tracks.duration}), 0)\`` | `COALESCE(SUM("duration"), 0)` |
| Максимум | `sql<number>\`MAX(${tracks.year})\`` | `MAX("year")` |
| Условный счёт | `sql<number>\`SUM(CASE WHEN ${tracks.isFavorite} = 1 THEN 1 ELSE 0 END)\`` | `SUM(CASE WHEN "is_favorite" = 1 THEN 1 ELSE 0 END)` |
| «Id любого с обложкой» | `sql<number \| null>\`MAX(CASE WHEN ${tracks.coverFile} IS NOT NULL THEN ${tracks.id} END)\`` | `MAX(CASE WHEN "cover_file" IS NOT NULL THEN "id" END)` |
| Сортировка по агрегату | `.orderBy(desc(sql\`COUNT(*)\`))` | `order by count(*) desc` |

### 20.3. Запись

| Что нужно | Drizzle | SQL |
|---|---|---|
| Вставить | `db.insert(playlists).values({...})` | `insert into "playlists" (...) values (...) ` |
| Вставить и получить строку | `.returning()` | `... returning "id", "name", ...` |
| Вставить и получить id | `.returning({ id: tracks.id })` | `... returning "id"` |
| Обновить | `db.update(tracks).set({...}).where(eq(..))` | `update "tracks" set ... where "tracks"."id" = ?` |
| Обновить без `WHERE` | ⚠️ не делай так никогда | `update "tracks" set ...` (все строки!) |
| Удалить | `db.delete(tracks).where(eq(..))` | `delete from "tracks" where ...` |
| Удалить всё | `db.delete(playHistory)` | `delete from "play_history"` |
| Удалить и узнать что | `.returning({ id: tracks.id })` | `delete from ... returning "id"` |
| UPSERT | `.onConflictDoUpdate({ target: tracks.path, set: {...} })` | `on conflict ("tracks"."path") do update set ...` |
| Игнор конфликта | `.onConflictDoNothing()` | `on conflict do nothing` |

### 20.4. Соединения и транзакции

| Что нужно | Drizzle | SQL |
|---|---|---|
| Внутреннее соединение | `.from(playlistTracks).innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))` | `from "playlist_tracks" inner join "tracks" on "tracks"."id" = "playlist_tracks"."track_id"` |
| Левое соединение | `.from(playlists).leftJoin(playlistTracks, eq(playlistTracks.playlistId, playlists.id))` | `from "playlists" left join "playlist_tracks" on ...` |
| Собрать колонки в объект | `.select({ track: tracks })` | `select "tracks"."id", "tracks"."path", ...` |
| Транзакция | `db.transaction((tx) => { ... })` | `BEGIN; ...; COMMIT;` |
| Выполнить в транзакции | `tx.update(...).set(...).where(...).run()` | `UPDATE ...;` |

### 20.5. Схема

| Что нужно | Drizzle | SQL |
|---|---|---|
| Таблица | `sqliteTable("tracks", { ... })` | `CREATE TABLE "tracks" (...)` |
| Целое | `integer("year")` | `"year" integer` |
| Строка | `text("title")` | `"title" text` |
| Дробное | `real("duration")` | `"duration" real` |
| Обязательное | `.notNull()` | `NOT NULL` |
| По умолчанию (в базе) | `.default(0)` | `DEFAULT 0` |
| По умолчанию (в JS) | `.$defaultFn(() => new Date())` | *(в SQL не появляется)* |
| Первичный ключ | `.primaryKey({ autoIncrement: true })` | `PRIMARY KEY AUTOINCREMENT NOT NULL` |
| Составной ключ | `(t) => [primaryKey({ columns: [t.a, t.b] })]` | `PRIMARY KEY("a", "b")` |
| Внешний ключ | `.references(() => playlists.id, { onDelete: "cascade" })` | `FOREIGN KEY (...) REFERENCES ... ON DELETE cascade` |
| Индекс | `(t) => [index("idx").on(t.artist)]` | `CREATE INDEX \`idx\` ON \`tracks\` (\`artist\`)` |
| Уникальный индекс | `(t) => [uniqueIndex("u").on(t.path)]` | `CREATE UNIQUE INDEX \`u\` ON \`tracks\` (\`path\`)` |
| Дата | `integer("at", { mode: "timestamp_ms" })` | `"at" integer` (миллисекунды) |
| Булево | `integer("flag", { mode: "boolean" })` | `"flag" integer` (0 или 1) |
| Тип строки | `typeof tracks.$inferSelect` | — (только TypeScript) |
| Тип для вставки | `typeof tracks.$inferInsert` | — (только TypeScript) |

### 20.6. Инструменты

| Что нужно | Команда / приём |
|---|---|
| Создать миграцию из diff схемы | `bunx drizzle-kit generate` |
| Применить миграции | Автоматически: `migrate(db, { migrationsFolder })` при старте |
| Посмотреть данные | `bunx drizzle-kit studio` |
| Узнать фактический SQL | `query.toSQL()` → `{ sql, params }` |
| Проверить, работает ли индекс | `EXPLAIN QUERY PLAN <sql>` |
| Удалить базу и начать заново | `bun run db:reset` |
| Проверить типы | `bun run typecheck` |
| Резервная копия базы | Скопировать папку `data/` целиком (в WAL есть `music.db-wal`) |

---

## 21. Итог: пять мыслей, которые стоит унести

1. **Drizzle — тонкая прослойка, а не чёрный ящик.** Один вызов = один
   предсказуемый SQL. Хочешь увидеть — `.toSQL()`.

2. **Схема в TypeScript — это единственный источник правды.** Из неё выводятся
   и SQL-миграции, и типы `$inferSelect` / `$inferInsert`. Никакого
   дублирования.

3. **Значения всегда уходят параметрами.** Именно поэтому SQL-инъекция в
   Drizzle-коде невозможна. `sql\`...\`` — это люк наружу, и в `${}` должны
   попадать только колонки, никогда — строки от пользователя.

4. **N+1 — главный практический враг.** `inArray` превращает 101 запрос в 1.
   А `Map` в JavaScript восстанавливает порядок, который SQL не гарантирует.

5. **SQL знать всё равно обязательно.** Всё, что ты умеешь в ClickHouse —
   `GROUP BY`, `COALESCE`, `CASE WHEN`, индексы, — работает здесь точно так же.
   ORM не отменяет SQL. Он даёт тебе типы и защиту от инъекций **поверх** него.

**Проект, к которому всё это относится:**

- `src/lib/db/schema.ts` — описание таблиц
- `src/lib/db/client.ts` — соединение, PRAGMA, миграции, Proxy-синглтон
- `src/lib/db/track-queries.ts` — запросы к трекам
- `src/lib/db/playlist-queries.ts` — JOIN'ы, транзакции, UPSERT
- `src/lib/db/history-queries.ts` — журнал событий и мини-витрины
- `src/lib/db/mappers.ts` — превращение строк базы в DTO
- `drizzle.config.ts` — настройки `drizzle-kit`
- `drizzle/` — сгенерированные SQL-миграции (коммитятся в git)
