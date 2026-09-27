// ============================================================================
// scripts/check-loops.mjs — ПРОВЕРКА «НЕ ЗАЦИКЛИЛАСЬ ЛИ СТРАНИЦА».
// ----------------------------------------------------------------------------
// Запускает headless-браузер, открывает страницу, ждёт несколько секунд
// и считает, сколько раз браузер обратился к серверу за это время.
//
// ── ЗАЧЕМ ЭТО НУЖНО ───────────────────────────────────────────────────────
// Однажды в проекте был баг: страница запрашивалась у сервера БЕСКОНЕЧНО,
// примерно раз в секунду, с одним и тем же адресом. Внешне всё выглядело
// нормально — а сервер молотил вхолостую.
//
// Ни `curl`, ни чтение кода такую ошибку не находят: запросы генерирует
// БРАУЗЕР, выполняя JavaScript. Поэтому нужен настоящий браузер.
//
// ЗАПУСК (нужен браузер — ставится один раз, ~115 МБ):
//     bun add -d playwright && bunx playwright install chromium
//     bun run check:loops
//
// Playwright намеренно НЕ входит в зависимости проекта: это тяжёлый пакет
// со своим браузером, а проект должен оставаться лёгким. Ставь его только
// тогда, когда действительно нужно проверить поведение в браузере.
//
// Ожидаемый результат: за 6 секунд — 1 запрос страницы (первая загрузка)
// плюс, возможно, несколько служебных (`_next/...`, фавикон).
// Главное — число запросов ОДНОЙ И ТОЙ ЖЕ страницы не должно расти.
// ============================================================================

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const WATCH_MS = Number(process.env.WATCH_MS ?? 6000);

// Страницы, которые проверяем. Именно они раньше попадали в цикл.
const PAGES = ["/", "/?search=%D1%8F%D1%89%D0%B8%D0%BA", "/history", "/playlists"];

// ── ВТОРАЯ ЧАСТЬ ПРОВЕРКИ: ВЗАИМОДЕЙСТВИЕ ──────────────────────────────────
// Первая версия этого скрипта просто открывала страницы — и НЕ находила баг.
// Причина: цикл запускался только после того, как пользователь НАЧИНАЛ ПЕЧАТАТЬ
// в поле поиска: именно тогда эффект менял URL, URL менял зависимость эффекта,
// и всё зацикливалось.
//
// Вывод: тест, который ничего не нажимает, проверяет только половину
// приложения. Настоящая проверка должна имитировать действия пользователя.
const TYPING_SCENARIOS = [
  { label: 'печать в поиске: "ящик"', text: "ящик" },
  { label: 'печать и очистка поиска', text: "атл", thenClear: true },
  // Сценарий с играющей музыкой — воспроизводит условия из реального лога.
  { label: 'МУЗЫКА ИГРАЕТ + печать', text: "ящик", withPlayback: true },
];

const browser = await chromium.launch();
let failures = 0;

for (const path of PAGES) {
  const page = await browser.newPage();

  // ── ЧТО ИМЕННО СЧИТАЕМ (важная деталь методики) ──────────────────────────
  // Первая версия этого скрипта считала только запросы типа "document" —
  // то есть полные загрузки страницы. И она НЕ НАШЛА баг.
  //
  // Причина: Next.js при мягкой навигации (router.replace) НЕ перезагружает
  // документ. Он отправляет запрос за RSC-данными — это обычный fetch,
  // который сервер в логе показывает как «GET /?search=...».
  //
  // Поэтому считаем ВСЕ обращения браузера к серверу и отбрасываем только
  // статику (_next/static, картинки, шрифты).
  const documentRequests = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    const isStatic = url.pathname.startsWith("/_next/") || url.pathname.startsWith("/favicon");
    if (!isStatic) {
      documentRequests.push({ url: request.url(), at: Date.now() });
    }
  });

  const startedAt = Date.now();
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });

  // После загрузки просто ждём. Если в коде есть цикл — он себя проявит.
  await page.waitForTimeout(WATCH_MS);

  const afterLoad = documentRequests.filter((r) => r.at > startedAt + 1500).length;
  const total = documentRequests.length;

  const status = afterLoad === 0 ? "✅" : "❌";
  if (afterLoad !== 0) failures += 1;

  console.log(
    `${status} ${path.padEnd(34)} всего навигаций: ${total}, ` +
      `ПОВТОРНЫХ после загрузки: ${afterLoad}`,
  );

  await page.close();
}

// ---------------------------------------------------------------------------
// ПРОВЕРКА ВЗАИМОДЕЙСТВИЯ: печатаем в поле поиска и смотрим, успокоится ли
// страница. Именно этот сценарий воспроизводил прежний бесконечный цикл.
// ---------------------------------------------------------------------------
for (const scenario of TYPING_SCENARIOS) {
  const page = await browser.newPage();
  const navigations = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    const isStatic = url.pathname.startsWith("/_next/") || url.pathname.startsWith("/favicon");
    if (!isStatic) navigations.push(request.url());
  });

  await page.goto(`${BASE}`, { waitUntil: "load" });

  // ── ВАЖНО: ЗАПУСКАЕМ МУЗЫКУ ───────────────────────────────────────────────
  // В логе, где был замечен цикл, рядом стояли запросы PUT /api/playback-state —
  // значит, музыка играла. А при воспроизведении провайдер плеера обновляет
  // состояние 60 раз в секунду (requestAnimationFrame). Это единственное
  // существенное отличие работающего плеера от просто открытой страницы,
  // поэтому проверять надо именно с включённым звуком.
  if (scenario.withPlayback) {
    // Первая строка списка — это и есть «включить музыку».
    const firstRow = page.locator(".track-row").first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForTimeout(1500);
    }
  }

  // Находим поле поиска по подписи для скринридеров (она у нас есть).
  // ── ПОЧЕМУ НЕ fill(), А keyboard.type() ──────────────────────────────────
  // Метод fill() выставляет значение поля напрямую и рассылает одно событие
  // input. В первой версии теста этого оказалось НЕДОСТАТОЧНО: React-обработчик
  // onChange не срабатывал, поиск не уходил в URL, и баг просто не проявлялся.
  //
  // keyboard.type() печатает по одной клавише — точно так же, как человек.
  // Для тестов React-приложений это надёжнее.
  const input = page.getByLabel("Поиск по библиотеке");
  await input.click();
  await page.keyboard.type(scenario.text, { delay: 40 });

  // Ждём, пока дебаунс (300 мс) отработает и URL обновится.
  await page.waitForTimeout(1200);

  if (scenario.thenClear) {
    // Очищаем так же «по-человечески»: выделить всё и удалить.
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(1200);
  }

  // Отмечаем момент «пользователь закончил». Всё, что случится ПОСЛЕ, —
  // это уже самопроизвольные перезапросы, то есть цикл.
  const quietStartedAt = Date.now();
  const before = navigations.length;
  await page.waitForTimeout(5000);
  const extra = navigations.length - before;

  const status = extra === 0 ? "✅" : "❌";
  if (extra !== 0) failures += 1;

  console.log(
    `${status} ${scenario.label.padEnd(34)} всего навигаций: ${navigations.length}, ` +
      `ПОСЛЕ ввода: ${extra}`,
  );

  // Печатаем сами адреса — так видно, ЧТО именно запрашивалось.
  if (process.env.SHOW_URLS === "1") {
    for (const url of navigations) console.log(`      → ${url}`);
  }

  void quietStartedAt;
  await page.close();
}

await browser.close();

console.log("");
if (failures === 0) {
  console.log("✅ ЦИКЛОВ НЕТ: ни одна страница не перезапрашивает себя повторно.");
  process.exit(0);
} else {
  console.log(`❌ НАЙДЕН ЦИКЛ на ${failures} стр. — см. вывод выше.`);
  process.exit(1);
}
