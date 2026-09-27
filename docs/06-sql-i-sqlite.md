# 06. SQL и SQLite: база данных, которая живёт в одном файле

Эта глава — про слой данных. Она написана с расчётом, что ты уже знаешь SQL
(у тебя это основная тема), поэтому упор сделан не на «что такое SELECT»,
а на **отличия SQLite**, **подводные камни**, которые встретились в проекте,
и на связь с миром ClickHouse/dbt.

---

## 1. Что такое SQLite и чем он не является

**SQLite — это не сервер.** Это библиотека, которая читает и пишет один
обычный файл на диске.

| | SQLite | PostgreSQL / MySQL / ClickHouse |
| --- | --- | --- |
| Что это | библиотека внутри процесса | отдельный сервер |
| Где данные | один файл (`data/music.db`) | файлы на сервере + процесс |
| Подключение | открыть файл | TCP-соединение, логин, пароль |
| Установка | не нужна | нужна |
| Пользователи и права | нет (права — на уровне файла ОС) | есть |
| Одновременная запись | одна за раз (вся база блокируется) | много |
| Размер | комфортно до гигабайт | терабайты и больше |
| Сеть | нет | есть |

Почему для этого проекта выбран именно SQLite: библиотека на 5 тысяч песен
весит десять-двадцать мегабайт метаданных, читает её один человек
с одного компьютера. Поднимать ради этого серверный процесс — тратить
ресурсы, ничего не получая. По ТЗ нужно «лёгкое и быстрое» — SQLite
это ровно оно.

**Важное следствие:** нет пользователей и прав. Отсюда и решение с токеном
доступа в главе [05](05-http-range-streaming.md) вместо нормальной авторизации.

---

## 2. Схема проекта: настоящий DDL

Файл `drizzle/0000_*.sql` — это сгенерированный SQL. Он же и есть «истина»
о структуре базы. Вот он, сжатый до сути:

```sql
CREATE TABLE tracks (
    id            integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    path          text NOT NULL UNIQUE,            -- абсолютный путь к файлу
    filename      text NOT NULL,
    title         text NOT NULL,
    artist        text NOT NULL,
    album         text NOT NULL,
    album_artist  text NOT NULL,
    genre         text NOT NULL,
    year          integer NOT NULL DEFAULT 0,
    track_number  integer NOT NULL DEFAULT 0,
    duration      real NOT NULL DEFAULT 0,         -- секунды, дробное
    size          integer NOT NULL DEFAULT 0,      -- байты
    mtime         integer NOT NULL,                -- время изменения, unix-мс
    is_favorite   integer NOT NULL DEFAULT 0,      -- boolean = 0/1
    cover_file    text,
    search_text   text NOT NULL DEFAULT '',        -- для поиска в нижнем регистре
    created_at    integer NOT NULL,
    updated_at    integer NOT NULL
);

CREATE TABLE playlists (
    id          integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name        text NOT NULL,
    description text,
    created_at  integer NOT NULL
);

CREATE TABLE playlist_tracks (
    playlist_id integer NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    integer NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    added_at    integer NOT NULL,
    PRIMARY KEY (playlist_id, track_id)               -- составной ключ
);

CREATE TABLE play_history (
    id        integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    track_id  integer NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at integer NOT NULL
);

CREATE TABLE playback_state (
    id         integer PRIMARY KEY NOT NULL,          -- всегда 1
    track_id   integer REFERENCES tracks(id) ON DELETE SET NULL,
    position   real NOT NULL DEFAULT 0,
    updated_at integer NOT NULL
);
```

### Что здесь стоит заметить

**Типы данных в SQLite почти условны.** SQLite динамически типизирован:
в колонку `integer` технически можно положить строку. Ограничения накладывает
не база, а приложение и Drizzle. Это важное отличие от PostgreSQL, где типы
проверяются строго.

**`AUTOINCREMENT` — почти не нужен.** В SQLite `INTEGER PRIMARY KEY` и так
становится псевдонимом для `rowid` — внутреннего номера строки. Ключевое
слово `AUTOINCREMENT` добавляет лишь одно: запрет повторно использовать
удалённые id. Обычно это не нужно, но и не мешает.

**Нет типа `boolean`.** Логическое значение хранится как `0`/`1`. Drizzle
прячет это через `mode: "boolean"` — в TypeScript видишь честные `true`/`false`
(см. главу [07](07-drizzle-orm.md)).

**Нет типа `date`.** Мы храним unix-время в миллисекундах целым числом.
Причины:

* сравнение и сортировка по числу — самые быстрые операции;
* нет возни с часовыми поясами при хранении;
* форматирование в местное время делается уже в браузере.

**Правило, которое стоит запомнить: в базе храни момент времени в UTC
(или unix-время), а форматируй его только при показе.**

---

## 3. `UNIQUE` и `UPSERT` — сердце сканера

Колонка `path` объявлена как `NOT NULL UNIQUE`. Уникальность — не украшение,
а рабочий механизм.

Сканер не знает, видел ли он файл раньше. Он просто пытается вставить запись,
а если такой путь уже есть — обновляет:

```sql
INSERT INTO tracks (path, title, artist, ...)
VALUES ('/music/ATL - Ящик.mp3', 'Ящик', 'ATL', ...)
ON CONFLICT (path) DO UPDATE SET
    title      = excluded.title,
    artist     = excluded.artist,
    updated_at = excluded.updated_at;
```

**`excluded`** — специальное ключевое слово SQLite, означающее «значение,
которое я пытался вставить». То есть `excluded.title` — это новое значение
из `VALUES`, а `tracks.title` — то, что уже лежит в таблице.

Такая конструкция называется **UPSERT** (update + insert). Она делает
сканирование идемпотентным: запускаешь сколько угодно раз — дубликатов
не появится.

Тонкость, которая есть в проекте: в `DO UPDATE` **не перечислен**
`is_favorite`. Избранное ставит пользователь, и скан не должен его сбрасывать.
Это правило «пользовательские данные не трогает автоматика» — оно важнее
любой оптимизации.

---

## 4. `LIKE` и кириллица: главный подводный камень проекта

Вот запрос, который должен находить песню по части названия:

```sql
SELECT * FROM tracks WHERE title LIKE '%атл%';
```

Он **не найдёт** песню с названием «АТЛ».

Причина: в SQLite оператор `LIKE` регистронезависим **только для латиницы**.
Для этого в него встроена упрощённая функция понижения регистра, которая
знает только ASCII. Чтобы `LIKE` работал с Unicode, SQLite должен быть собран
с библиотекой ICU — а это есть далеко не везде.

Ещё интереснее, что `lower()` в SQLite тоже работает только с ASCII:

```sql
SELECT lower('АТЛ');   -- вернёт 'АТЛ', а не 'атл'
```

### Как это решено в проекте

При сканировании формируется отдельная колонка `search_text` — склейка всех
текстовых полей, приведённая к нижнему регистру **средствами JavaScript**,
который Unicode знает прекрасно:

```ts
// src/lib/scanner/index.ts
function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}
```

Получается строка вида:

```
ящик atl ящик atl ящик atl - ящик mp3
```

А поиск превращается в один простой `LIKE` уже без всяких преобразований:

```sql
SELECT * FROM tracks WHERE search_text LIKE '%атл%';
```

Оба операнда заранее в нижнем регистре — значит, регистрозависимое сравнение
работает корректно для любого языка.

**Это классическая денормализация:** мы сознательно дублируем данные
в другом виде, чтобы запрос стал простым и быстрым. Плата — немного места
на диске и необходимость поддерживать колонку в актуальном состоянии.

Бонус: поиск идёт по ОДНОЙ колонке вместо четырёх `OR`-условий. И `title`,
и `artist`, и `album`, и имя файла — всё уже склеено.

### Почему индекс здесь не поможет

```sql
CREATE INDEX idx ON tracks(search_text);   -- ❌ бесполезно для LIKE '%...%'
```

Индекс — это упорядоченная структура (в SQLite — B-дерево). Он умеет быстро
отвечать на вопросы «начинается с...» (`LIKE 'атл%'`) и «равно чему-то».
Но шаблон с ведущим `%` означает «найди подстроку в любом месте строки» —
никакой порядок сортировки тут не помогает, придётся читать всю таблицу.

Для полнотекстового поиска по подстрокам в SQLite есть **FTS5** — отдельный
виртуальный модуль с индексом по словам. Это отличное упражнение на будущее
(см. главу [13](13-chto-dalshe.md)), но для библиотеки в тысячи треков
обычного `LIKE` достаточно: полный проход по 5 000 коротких строк занимает
единицы миллисекунд.

---

## 5. JOIN: три примера из проекта

### INNER JOIN — история прослушиваний

В журнале лежит только `track_id`. Чтобы показать название и исполнителя,
нужно соединить с таблицей треков:

```sql
SELECT ph.played_at, t.*
FROM play_history ph
JOIN tracks t ON t.id = ph.track_id
ORDER BY ph.played_at DESC
LIMIT 50;
```

`JOIN` без уточнения — это `INNER JOIN`: остаются только строки, для которых
нашлась пара в обеих таблицах. Здесь это правильно: если трек удалён,
каскад уже убрал и записи журнала, «сирот» не бывает.

### LEFT JOIN — плейлисты с количеством треков

```sql
SELECT p.id, p.name, COUNT(pt.track_id) AS track_count
FROM playlists p
LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
GROUP BY p.id;
```

Почему `LEFT`, а не обычный `JOIN`: пустой плейлист не имеет ни одной пары
в `playlist_tracks`, и обычный `JOIN` просто **выбросил бы его из результата**.
А нам он нужен — пользователь его только что создал и хочет видеть.

`LEFT JOIN` говорит: «возьми все строки из левой таблицы, а если пары справа
нет — подставь NULL».

Дальше начинается тонкость с `COUNT`. Если написать `COUNT(*)`, то для
пустого плейлиста посчитается одна строка (строка плейлиста с NULL-ами
справа) и счётчик покажет `1` вместо `0`:

```sql
COUNT(*)          -- пустой плейлист → 1  ❌ неправильно
COUNT(pt.track_id) -- пустой плейлист → 0  ✅ NULL не считается
```

Потому что `COUNT(колонка)` **игнорирует NULL**, а `COUNT(*)` считает строки.
Это правило стоит запомнить: оно одинаково работает во всех СУБД.

### JOIN с порядком — треки плейлиста

```sql
SELECT t.*
FROM playlist_tracks pt
JOIN tracks t ON t.id = pt.track_id
WHERE pt.playlist_id = 3
ORDER BY pt.position ASC;
```

Здесь важна сортировка **по `position`**, а не по `id`: пользователь может
перетащить трек наверх, и порядок изменится, а `id` — нет.

---

## 6. GROUP BY и агрегаты

### Простая агрегация: список альбомов

```sql
SELECT
    album,
    album_artist,
    COUNT(*)                       AS track_count,
    COALESCE(SUM(duration), 0)     AS total_duration,
    MAX(year)                      AS year
FROM tracks
GROUP BY album, album_artist
ORDER BY album_artist, album;
```

Три вещи, на которые стоит посмотреть:

1. **`GROUP BY` по ДВУМ полям.** Бывает, что два разных исполнителя выпустили
   альбом с одинаковым названием («Greatest Hits» — вечная классика).
   Группировка по паре не даст им склеиться.
2. **`COALESCE(SUM(...), 0)`.** `SUM` по пустой группе возвращает `NULL`,
   а `COALESCE` подменяет его нулём. В `GROUP BY` пустых групп не бывает,
   но привычка полезна — пригодится в подзапросах.
3. **Правило SQL:** в `SELECT` при `GROUP BY` могут быть только
   сгруппированные колонки и агрегатные функции. Всё остальное — либо
   оберни в `MAX()`/`MIN()`, либо добавь в `GROUP BY`. SQLite это правило
   почти не проверяет (и молча вернёт произвольное значение), а PostgreSQL
   выдаст ошибку. Не полагайся на снисходительность SQLite.

### Условная агрегация: `COUNT(DISTINCT ...)`

```sql
SELECT
    artist,
    COUNT(*)                  AS track_count,
    COUNT(DISTINCT album)     AS album_count
FROM tracks
GROUP BY artist;
```

`COUNT(DISTINCT album)` считает не строки, а **разные значения**. Если
у исполнителя 12 песен, но всего 2 альбома — вернёт 2.

### Условная агрегация через `CASE WHEN`

Статистика библиотеки считается одним запросом:

```sql
SELECT
    COUNT(*)                                                      AS total_tracks,
    COUNT(DISTINCT artist)                                        AS total_artists,
    COUNT(DISTINCT album)                                         AS total_albums,
    COALESCE(SUM(duration), 0)                                    AS total_duration,
    COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) AS favorite_count
FROM tracks;
```

Последняя строка — приём, который стоит запомнить:

```
SUM(CASE WHEN условие THEN 1 ELSE 0 END)
```

Это «сколько раз условие оказалось истинным» за один проход по таблице.
Полный аналог `COUNT(*) FILTER (WHERE ...)` в PostgreSQL и ClickHouse.

---

## 6.1. ⚠ Что хранить в колонке пути: урок на реальном баге

В проекте была колонка `tracks.path` с **абсолютным** путём к файлу:

```
локальный запуск:  /home/august/.../music/ATL - Ящик.mp3
запуск в Docker:   /music/ATL - Ящик.mp3
```

Выглядит нормально, пока не вспомнить: **база-то одна**. Она лежит в томе
`./data`, который монтируется и в Docker, и используется локально.

Что произошло:

1. Просканировал библиотеку локально → в базе пути `/home/august/...`
2. Запустил тот же проект через `docker compose up` → внутри контейнера
   таких путей **нет**
3. Открыл плеер → на каждый трек приходит
   `GET /api/tracks/6/stream 404`, а в браузере —
   `play() отклонён: NotSupportedError`

То есть музыка просто перестала играть, причём «на пустом месте»: файлы
на месте, база на месте, а вместе они не работают.

**Как исправлено.** В базе теперь хранится путь **относительно** папки
с музыкой:

```
"ATL - Ящик.mp3"
"ATL/Ящик/01 - Трек.mp3"
```

Абсолютный путь собирается в момент обращения:

```ts
// src/lib/config.ts
export function resolveMusicPath(relativePath: string): string {
  return path.join(MUSIC_DIR, relativePath);
}
```

Что это даёт:

* одна и та же база работает локально, в Docker и на другом компьютере —
  достаточно, чтобы папка с музыкой была примонтирована;
* том `./data` действительно становится переносимым;
* база перестаёт зависеть от конкретной машины.

### Как починить уже испорченную базу

Если в базе остались абсолютные пути, удалять её не обязательно — вместе
с ней пропадут плейлисты и история (у них `ON DELETE CASCADE`). В проекте
есть разовая функция починки — она отрезает известный корень от пути
и сохраняет id треков:

```ts
// src/lib/db/track-queries.ts
export async function repairAbsolutePaths(): Promise<number>
```

Вызывается автоматически при сканировании. Проверено на реальной базе:

```
[player] Починено старых путей: 3 (абсолютные → относительные)
→ скан: { filesFound: 3, skipped: 3 }   ← пути уже правильные
→ стрим: 206 на всех трёх треках
```

> **Правило, которое стоит унести.** В базе храни то, что **не меняется
> при переносе**. Абсолютный путь меняется всегда — он зависит от машины,
> от точки монтирования, от операционной системы. Относительный путь
> внутри библиотеки остаётся тем же везде.
>
> Это частный случай общего принципа: **не храни вычисляемое или зависящее
> от окружения** — вычисляй его в момент использования.

---

## 7. Индексы: когда помогают, когда мешают

Индекс — это как алфавитный указатель в конце книги. Без него, чтобы найти
всё про «ATL», база честно прочитает все строки. С индексом — прыгнет сразу
в нужное место.

В проекте индексы такие:

```sql
CREATE UNIQUE INDEX tracks_path_unique ON tracks (path);
CREATE INDEX tracks_artist_idx  ON tracks (artist);
CREATE INDEX tracks_album_idx   ON tracks (album);
CREATE INDEX tracks_created_idx ON tracks (created_at);
CREATE INDEX playlist_tracks_position_idx ON playlist_tracks (playlist_id, position);
CREATE INDEX play_history_played_at_idx   ON play_history (played_at);
```

Что за чем:

* **`path`** — уникальный, потому что это ключ для UPSERT при сканировании;
* **`artist`, `album`** — по ним фильтруем и группируем;
* **`created_at`** — сортировка «недавно добавленные» (самая частая);
* **`(playlist_id, position)`** — составной: сначала по плейлисту, потом
  по позиции. Такой индекс обслуживает запрос «треки плейлиста в порядке»;
* **`played_at`** — история всегда читается «последние N», то есть
  `ORDER BY ... DESC LIMIT`.

### Чем платим

Индекс занимает место и **замедляет вставку** (при каждой вставке нужно
обновить и дерево). Поэтому индексы делают только там, где реально ищут.
Индексировать всё подряд — типичная ошибка новичка.

### Как проверить, работает ли индекс

В SQLite есть замечательная команда:

```sql
EXPLAIN QUERY PLAN
SELECT * FROM tracks WHERE artist = 'ATL';
```

Вывод:

```
SEARCH tracks USING INDEX tracks_artist_idx (artist=?)
```

Слово `SEARCH` — индекс используется. А если увидишь:

```
SCAN tracks
```

— значит база читает всю таблицу. Для маленьких таблиц это нормально
и даже быстрее (индекс — дополнительная работа). Но для больших `SCAN`
в запросе, который выполняется часто, — сигнал задуматься.

Попробуй сравнить:

```sql
EXPLAIN QUERY PLAN SELECT * FROM tracks WHERE title = 'Ящик';        -- SCAN
EXPLAIN QUERY PLAN SELECT * FROM tracks WHERE artist = 'ATL';        -- SEARCH ... USING INDEX
EXPLAIN QUERY PLAN SELECT * FROM tracks WHERE search_text LIKE '%атл%';  -- SCAN (индекс не поможет, см. раздел 4)
```

---

## 8. Транзакции: «всё или ничего»

В проекте транзакция используется при изменении порядка треков
(`reorderPlaylistTracks` в `src/lib/db/playlist-queries.ts`).

Задача: пользователь перетащил трек, нужно обновить `position` у нескольких
строк.

```sql
UPDATE playlist_tracks SET position = 0 WHERE playlist_id = 3 AND track_id = 7;
UPDATE playlist_tracks SET position = 1 WHERE playlist_id = 3 AND track_id = 2;
UPDATE playlist_tracks SET position = 2 WHERE playlist_id = 3 AND track_id = 9;
```

Если между первым и вторым запросом что-то пойдёт не так (ошибка, отключение
питания), плейлист останется в **полу-изменённом** состоянии: часть треков
с новыми номерами, часть со старыми. Порядок превратится в кашу,
и разбираться будет неприятно.

Транзакция решает это:

```sql
BEGIN;
UPDATE ...;
UPDATE ...;
UPDATE ...;
COMMIT;      -- или ROLLBACK, если что-то пошло не так
```

Все изменения внутри применяются как **одна неделимая операция**: либо
целиком, либо никак. Это буква «A» в аббревиатуре ACID — **Atomicity**
(атомарность).

Остальные три буквы, для полноты:

* **C**onsistency — согласованность: база переходит из одного корректного
  состояния в другое;
* **I**solation — изоляция: параллельные транзакции не мешают друг другу
  (в SQLite с WAL — на уровне читателей и писателя);
* **D**urability — долговечность: после `COMMIT` данные не потеряются даже
  при отключении питания.

---

## 9. Внешние ключи и каскады

```sql
track_id integer NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
```

`REFERENCES` — это **внешний ключ**: «значение обязано существовать
в таблице `tracks`». Попытка добавить трек в несуществующий плейлист
будет отклонена базой.

`ON DELETE CASCADE` — «удалили родителя, удали и потомков». Удалил трек
из библиотеки — строки в `playlist_tracks` и `play_history` исчезли сами.
Без этого в базе остались бы «сироты».

### Ловушка, о которой не знают

**В SQLite внешние ключи по умолчанию ВЫКЛЮЧЕНЫ.** Это историческое решение
ради совместимости со старыми версиями. Пока не выполнишь

```sql
PRAGMA foreign_keys = ON;
```

— каскады просто не работают, и в базе спокойно появятся ссылки в никуда.

В проекте это включено при открытии каждого соединения
(`src/lib/db/client.ts`). Если однажды увидишь «странно, каскад не сработал» —
первым делом проверяй этот PRAGMA.

Единственное исключение в схеме — `playback_state.track_id` с
`ON DELETE SET NULL`. Логика другая: если трек удалили, состояние плеера
не должно исчезать целиком, достаточно обнулить ссылку. Запрос с `INNER JOIN`
тогда просто ничего не найдёт, и блок «продолжить слушать» не покажется.

---

## 10. WAL: как читать и писать одновременно

В обычном режиме (`journal_mode = DELETE`) SQLite блокирует **всю базу**
на время записи. Читатели стоят в очереди и ждут.

В режиме **WAL** (Write-Ahead Logging — журнал упреждающей записи) изменения
пишутся в отдельный файл-журнал, а читатели продолжают читать предыдущую
согласованную версию страниц.

Результат: можно одновременно читать список треков и записывать историю
прослушиваний. Для веб-приложения это критично.

```sql
PRAGMA journal_mode = WAL;
```

В `src/lib/db/client.ts` при открытии соединения задаются четыре PRAGMA:

| PRAGMA | Значение | Зачем |
| --- | --- | --- |
| `journal_mode = WAL` | WAL | параллельное чтение и запись |
| `foreign_keys = ON` | вкл | чтобы работали каскады (см. выше) |
| `busy_timeout = 5000` | 5000 мс | если база занята — подождать, а не падать с ошибкой |
| `synchronous = NORMAL` | NORMAL | безопасный компромисс между скоростью и надёжностью |

WAL оставляет рядом с базой ещё два файла: `music.db-wal` и `music.db-shm`.
Это нормально, они часть механизма.

---

## 11. Проблема N+1 запросов

Классическая ошибка:

```ts
// ❌ 100 треков в плейлисте → 100 запросов к базе
const tracks = [];
for (const id of playlistTrackIds) {
  tracks.push(await getTrackRowById(id));
}
```

Это называется **N+1**: один запрос за списком + N запросов за деталями.

Правильно — один запрос с `IN`:

```sql
SELECT * FROM tracks WHERE id IN (1, 5, 9, 12, ...);
```

```ts
// ✅ один запрос
const rows = await db.select().from(tracks).where(inArray(tracks.id, ids));
```

Функция `getTrackRowsByIds` в `src/lib/db/track-queries.ts` делает именно это.

**И тут есть тонкость, которую легко пропустить:** SQL **не обязан**
возвращать строки в том порядке, в котором они перечислены в `IN`. Он вернёт
их так, как удобнее оптимизатору. А нам нужен порядок плейлиста. Поэтому
результат раскладывается в `Map` и собирается заново:

```ts
const byId = new Map(rows.map((row) => [row.id, row]));
return ids.map((id) => byId.get(id)).filter((row) => row !== undefined);
```

Это отличный пример того, что SQL — декларативный язык: ты описываешь **что**
нужно, а не **в каком порядке** это будет получено.

---

## 12. Работа с NULL

`NULL` в SQL — это не «ноль» и не «пустая строка». Это «значение неизвестно».
И ведёт он себя непривычно:

```sql
SELECT NULL = NULL;        -- NULL, а не true!
SELECT NULL <> NULL;       -- тоже NULL
SELECT 1 + NULL;           -- NULL
```

Поэтому:

* сравнение с `NULL` делается через `IS NULL` / `IS NOT NULL`,
  а не через `= NULL`;
* агрегатные функции **игнорируют NULL** (`SUM`, `AVG`, `COUNT(колонка)`),
  но `COUNT(*)` считает строки;
* для подстановки значения есть `COALESCE(a, b, c)` — вернёт первое не-NULL.

В проекте NULL появляется в `cover_file` (обложки может не быть),
`playlists.description` и `playback_state.track_id`. Везде мы обрабатываем
его явно — либо через `COALESCE` в SQL, либо через `?? 0` / `!= null`
в TypeScript. См. `src/lib/db/mappers.ts`.

---

## 13. Связь с ClickHouse и dbt: что общего и что разного

Ты учишь ClickHouse и dbt параллельно, и здесь есть о чём подумать.

### Общее

* **SQL — один язык.** `SELECT`, `WHERE`, `GROUP BY`, `JOIN`, `CASE WHEN` —
  те же самые слова и та же семантика. Навык переносится напрямую.
* **Логика витрин одинаковая.** Запрос `listTopTracks` из
  `src/lib/db/history-queries.ts`:

  ```sql
  SELECT t.*, COUNT(*) AS play_count
  FROM play_history ph
  JOIN tracks t ON t.id = ph.track_id
  GROUP BY t.id
  ORDER BY play_count DESC
  LIMIT 10
  ```

  В dbt это была бы модель:

  ```sql
  -- models/marts/fct_listens.sql
  SELECT
      track_id,
      COUNT(*)        AS play_count,
      MAX(played_at)  AS last_played_at
  FROM {{ ref('stg_play_history') }}
  GROUP BY track_id
  ```

  Ровно та же агрегация, только с `ref()` и материализацией.

* **`play_history` — это таблица фактов.** Append-only: записи только
  добавляются, никогда не обновляются. Так устроены событийные таблицы
  в аналитике, и именно поэтому они так удобны.

### Разное

| | SQLite / этой проект | ClickHouse |
| --- | --- | --- |
| Назначение | транзакционная работа (OLTP) | аналитика (OLAP) |
| Хранение | построчное (row-oriented) | поколоночное (column-oriented) |
| Типичный запрос | «дай мне трек №5» | «посчитай среднее по 100 млн строк» |
| Агрегации | быстро на тысячах строк | молниеносно на миллиардах |
| Обновление одной строки | обычное дело | нештатная операция |
| Сортировка | индекс B-дерево | `ORDER BY` в движке + разреженный индекс |
| Движок | один, встроенный | `MergeTree` и его семейство |
| Индексы | B-tree | первичный ключ + skip-индексы (другая логика!) |

Практический вывод: **индексы в ClickHouse работают не так, как в SQLite.**
Ты не «создаёшь индекс по колонке», а проектируешь `ORDER BY` в движке
таблицы и понимаешь, какие запросы он ускоряет. Если будешь переносить
интуицию из SQLite в ClickHouse — она частично не сработает.

Ещё одно отличие: в ClickHouse `COUNT(*)` — дешёвая операция над метаданными
частей, а в SQLite — реальный проход (если нет подходящего индекса).

### Что можно сделать на стыке

В главе [13](13-chto-dalshe.md) разбирается идея: выгружать `play_history`
из SQLite в ClickHouse и строить dbt-модели поверх реальных данных. Тогда
у тебя будет **настоящий end-to-end конвейер** на своих же данных:

```
SQLite (OLTP)  →  выгрузка  →  ClickHouse  →  dbt  →  BI-дашборд
```

Это сильная история для портфолио: не «учебный датасет про продажи кофе»,
а собственные данные, которые ты сам произвёл и сам осмыслил.

---

## 14. Практика: поработать с базой руками

Лучший способ понять — потрогать. Запусти интерактивную консоль:

```bash
bun -e '
  const { Database } = require("bun:sqlite");
  const db = new Database("data/music.db", { readonly: true });
  console.log(db.query("SELECT id, title, artist FROM tracks LIMIT 5").all());
'
```

Или через `sqlite3`, если он установлен:

```bash
sqlite3 data/music.db
sqlite> .tables
sqlite> .schema tracks
sqlite> SELECT artist, COUNT(*) FROM tracks GROUP BY artist ORDER BY 2 DESC;
sqlite> EXPLAIN QUERY PLAN SELECT * FROM tracks WHERE artist = 'ATL';
sqlite> .quit
```

Задания по возрастанию сложности:

1. Вывести все треки длиннее 4 минут, отсортированные по убыванию длины.
2. Посчитать среднюю длительность трека по каждому исполнителю, округлив
   до целых секунд (`ROUND(AVG(duration))`).
3. Найти альбомы, где больше трёх треков (`GROUP BY` + `HAVING`).
   Чем `HAVING` отличается от `WHERE`, и почему для агрегатов нужен именно он?
4. Вывести исполнителей, у которых нет ни одного альбома с известным
   названием (`album = 'Unknown'`) — попробуй через `NOT EXISTS` и через
   `LEFT JOIN ... IS NULL`. Что быстрее и почему?
5. Для каждого трека вывести дату последнего прослушивания, включая треки,
   которые не слушали ни разу (`LEFT JOIN` + `MAX`).
6. Написать запрос «топ-3 исполнителя по количеству прослушиваний за всё
   время» — история + треки + `GROUP BY` + `LIMIT 3`.
7. Добавить индекс, который ускорит запрос из пункта 6, и проверить
   результат через `EXPLAIN QUERY PLAN`.

---

## 15. Шпаргалка

| Нужно | SQL |
| --- | --- |
| Выбрать с фильтром | `SELECT ... FROM t WHERE ...` |
| Сортировка | `ORDER BY col DESC` |
| Ограничение | `LIMIT 50 OFFSET 100` |
| Поиск по подстроке | `WHERE col LIKE '%text%'` |
| Регистронезависимо в SQLite | хранить `lower`-версию отдельной колонкой (см. §4) |
| Проверка на NULL | `WHERE col IS NULL` |
| Значение по умолчанию | `COALESCE(col, 0)` |
| Соединение | `JOIN` / `LEFT JOIN ... ON ...` |
| Агрегация | `GROUP BY col` + `COUNT/SUM/AVG/MIN/MAX` |
| Фильтр агрегатов | `HAVING COUNT(*) > 3` |
| Уникальные значения | `COUNT(DISTINCT col)` |
| Условный подсчёт | `SUM(CASE WHEN cond THEN 1 ELSE 0 END)` |
| Вставка-или-обновление | `INSERT ... ON CONFLICT (col) DO UPDATE SET x = excluded.x` |
| Ничего не делать при конфликте | `ON CONFLICT DO NOTHING` |
| Внешний ключ | `REFERENCES table(id) ON DELETE CASCADE` |
| Транзакция | `BEGIN; ... COMMIT;` |
| Включить каскады | `PRAGMA foreign_keys = ON` |
| Быстрый режим журнала | `PRAGMA journal_mode = WAL` |
| Посмотреть план запроса | `EXPLAIN QUERY PLAN SELECT ...` |

---

## 16. Что почитать

* [SQLite — документация](https://www.sqlite.org/docs.html) — на удивление
  короткая и понятная.
* [SQLite — Query Planning](https://www.sqlite.org/queryplanner.html) —
  как база выбирает способ выполнения запроса. Многое проясняет про индексы.
* [SQLite — WAL mode](https://www.sqlite.org/wal.html)
* [SQLite — Foreign Keys](https://www.sqlite.org/foreignkeys.html) —
  включая раздел про то, почему они выключены по умолчанию.
* [Use The Index, Luke!](https://use-the-index-luke.com/) — лучший
  в интернете материал про индексы. Написан для PostgreSQL, но принципы общие.
* Следующая глава: [07. Drizzle ORM](07-drizzle-orm.md) — как всё это
  пишется на TypeScript.
