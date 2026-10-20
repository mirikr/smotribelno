// Общие константы и функции. Подключается в content script, background, popup и дашборде.
/* exported TR */
const TR = (() => {
  const MAX_SCORE = 90;
  const SLIDER_MAX = 10;

  const DEFAULT_CRITERIA = [
    { id: 'interest', name: 'Интересность', hint: 'Насколько затянуло, не хотелось перематывать' },
    { id: 'value', name: 'Польза', hint: 'Узнал новое, есть что применить' },
    { id: 'delivery', name: 'Подача', hint: 'Структура, харизма автора, темп' },
    { id: 'quality', name: 'Качество', hint: 'Монтаж, звук, картинка' },
    { id: 'rewatch', name: 'Пересмотр', hint: 'Хочется пересмотреть или посоветовать' },
  ];

  // ---- Критерии по типу видео ----
  // Три общих критерия есть у каждого типа — по ним можно сравнивать видео разных типов.
  // «Свой» — набор из настроек; так же показываются оценки, поставленные до появления типов.
  const CATALOG = {
    interest: { name: 'Интересность', hint: 'Насколько затянуло, не хотелось перематывать' },
    quality: { name: 'Качество', hint: 'Монтаж, звук, картинка' },
    rewatch: { name: 'Пересмотр', hint: 'Хочется пересмотреть или посоветовать' },
    emotion: { name: 'Эмоции', hint: 'Смешно, трогательно, захватывает' },
    delivery: { name: 'Подача', hint: 'Структура, харизма автора, темп' },
    value: { name: 'Польза', hint: 'Узнал новое, есть что применить' },
    clarity: { name: 'Понятность', hint: 'Объяснено ясно, без воды' },
    melody: { name: 'Мелодия', hint: 'Цепляет, хочется переслушать' },
    perform: { name: 'Исполнение', hint: 'Голос, игра, звук' },
    truth: { name: 'Достоверность', hint: 'Факты проверены, источники названы' },
    depth: { name: 'Глубина', hint: 'Разобрано по существу, а не по верхам' },
    vibe: { name: 'Атмосфера', hint: 'Уютно, весело, хочется остаться' },
    host: { name: 'Ведущий', hint: 'Харизма, реакция, общение со зрителями' },
  };
  // Порядок не менять: по нему упакованы оценки в синхронизации
  const CATALOG_IDS = Object.keys(CATALOG);
  const COMMON_CRITERIA = ['interest', 'quality', 'rewatch'];
  const VIDEO_TYPES = [
    { id: 'fun', label: 'Развлечение', own: ['emotion', 'delivery'] },
    { id: 'learn', label: 'Обучение', own: ['value', 'clarity'] },
    { id: 'music', label: 'Музыка', own: ['melody', 'perform'] },
    { id: 'news', label: 'Новости и разборы', own: ['truth', 'depth'] },
    { id: 'stream', label: 'Стрим и летсплей', own: ['vibe', 'host'] },
    { id: 'custom', label: 'Свой', own: [] },
  ];
  const DEFAULT_TYPE = 'fun';
  const videoType = (id) => VIDEO_TYPES.find((t) => t.id === id) || VIDEO_TYPES[VIDEO_TYPES.length - 1];

  // Критерии типа: [{ id, name, hint, common }]
  function typeCriteria(type, settings) {
    const t = videoType(type);
    if (t.id === 'custom') return (settings?.criteria || DEFAULT_CRITERIA).map((c) => ({ ...c, common: false }));
    return [...t.own, ...COMMON_CRITERIA].map((id) => ({ id, ...CATALOG[id], common: COMMON_CRITERIA.includes(id) }));
  }

  // Название критерия по id: из каталога или из своего набора
  function critName(id, settings) {
    return (settings?.criteria || DEFAULT_CRITERIA).find((c) => c.id === id)?.name || CATALOG[id]?.name || 'Удалённый критерий';
  }

  // Тип оценки; у оценок без типа (поставленных раньше) — «Свой»
  const ratingType = (rating) => (rating ? (VIDEO_TYPES.some((t) => t.id === rating.type) ? rating.type : 'custom') : null);

  // Тип для видео: у оценённого — его тип; иначе тот, что ставили видео этого канала последним;
  // иначе последний выбранный вообще. Оценки без типа в подсказку не идут.
  function defaultType(videos, v) {
    if (v?.rating) return ratingType(v.rating);
    const ck = channelKey(v?.channelUrl);
    const nk = nameKey(v?.channel);
    let chan = null;
    let any = null;
    for (const x of Object.values(videos || {})) {
      const r = x.rating;
      if (!r?.type || !VIDEO_TYPES.some((t) => t.id === r.type)) continue;
      const at = r.updatedAt || 0;
      if (!any || at > any.at) any = { at, type: r.type };
      const same = (ck && channelKey(x.channelUrl) === ck) || (nk && nameKey(x.channel) === nk);
      if (same && (!chan || at > chan.at)) chan = { at, type: r.type };
    }
    return chan?.type || any?.type || DEFAULT_TYPE;
  }

  // Подсказка «откуда тип»: канал / последний выбор
  function typeSource(videos, v) {
    if (v?.rating) return 'rated';
    const ck = channelKey(v?.channelUrl);
    const nk = nameKey(v?.channel);
    const has = Object.values(videos || {}).some(
      (x) => x.rating?.type && ((ck && channelKey(x.channelUrl) === ck) || (nk && nameKey(x.channel) === nk))
    );
    return has ? 'channel' : 'last';
  }

  const DEFAULT_SETTINGS = {
    criteria: DEFAULT_CRITERIA,
    dailyLimitMin: 0, // 0 — без лимита
    autoWatchedPct: 90, // видео считается просмотренным с этого процента
    thumbBadges: true, // значки на миниатюрах
    panelCollapsed: false,
    shelfCollapsed: false, // подборка на главной свёрнута
    syncYoutubeWL: true, // добавлять сюда видео, сохранённые в «Смотреть позже» YouTube
    wlPriority: 2, // с каким приоритетом их добавлять
    homeShelf: 4, // сколько видео показывать над лентой на главной (0 — выкл)
    hideShortsNav: true, // убрать Shorts из левого меню YouTube
    subsSort: 'desc', // подписки в коротком меню: desc — лучшие сверху, asc — худшие, off — скрыть
    syncHistory: true, // подтягивать историю YouTube (просмотры с телефона и других устройств)
    compactGuide: true, // своё короткое левое меню: Главная, Подписки, Смотреть позже+, История, Понравившиеся
    gridCols: 4, // видео в ряду ленты YouTube (0 — как решит YouTube)
    syncDevices: true, // синхронизировать оценки, отзывы, «Смотреть позже+» и настройки между компьютерами (аккаунт Chrome)
    ambient: 'soft', // погружение на странице видео: off — выкл, soft — мягко, strong — сильно
    ytStars: true, // фон «Звёздный зал» на самом YouTube (в тёмной теме)
    ytLogo: true, // кнопка в логотипе YouTube — мягкий фиолетовый вместо красного
    askDropped: true, // спрашивать «почему бросили», когда уходите с видео, не досмотрев
    cleanupAt: 0, // когда последний раз разбирали «Смотреть позже+» (или отложили разбор)
    driveSync: false, // синхронизация с телефоном через Google Drive (у каждого компьютера своя — вход в Google)
  };

  // 3 — высокий, 2 — средний, 1 — низкий.
  // color — метка (точка, значок-лесенка) на тёмном фоне; tint + ink — плашка: тёмный фон и светлый текст (от 7.5:1).
  const PRIORITIES = {
    3: { label: 'Высокий', short: 'Важно', color: '#fca58a', tint: '#3a1d14', ink: '#fca58a' },
    2: { label: 'Средний', short: 'Средне', color: '#f5c55a', tint: '#352a12', ink: '#f5c55a' },
    1: { label: 'Низкий', short: 'Потом', color: '#93b4f9', tint: '#18233c', ink: '#93b4f9' },
  };

  // Значок-лесенка: 1–3 закрашенные полоски — приоритет читается и без цвета
  function prioGlyph(p, size = 12) {
    const bar = (x, y, h, on) => `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1" fill="currentColor"${on ? '' : ' opacity="0.3"'}/>`;
    return `<svg class="tr-glyph" width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">${bar(0, 8, 4, p >= 1)}${bar(4.5, 4, 8, p >= 2)}${bar(9, 0, 12, p >= 3)}</svg>`;
  }

  // Цвет оценки плавно идёт за баллом: красный → оранжевый → оливковый → зелёный → изумрудный.
  // Белый текст на любом цвете шкалы — не ниже 4.76:1.
  const SCORE_STOPS = [
    [0, [180, 35, 24]],
    [25, [194, 65, 12]],
    [45, [161, 92, 7]],
    [60, [107, 122, 15]],
    [72, [63, 125, 32]],
    [82, [21, 128, 61]],
    [89, [4, 120, 87]],
  ];
  function scoreColor(total) {
    const s = Math.max(0, Math.min(MAX_SCORE, Number(total) || 0));
    for (let i = 0; i < SCORE_STOPS.length - 1; i++) {
      const [a, ca] = SCORE_STOPS[i];
      const [b, cb] = SCORE_STOPS[i + 1];
      if (s <= b) {
        const t = (s - a) / (b - a);
        return `rgb(${ca.map((x, k) => Math.round(x + (cb[k] - x) * t)).join(', ')})`;
      }
    }
    return 'rgb(4, 120, 87)';
  }
  // Яркий цвет для полос и колец (не для текста): у идеальных 90 — светящийся изумруд
  const scoreMark = (total) => (total >= MAX_SCORE ? '#10b981' : scoreColor(total));

  // color у словесной оценки — цвет её середины, для точек в фильтрах
  const GRADES = [
    { min: 90, label: 'Идеально', color: '#10b981' },
    { min: 80, label: 'Шедевр', color: scoreColor(85) },
    { min: 65, label: 'Отлично', color: scoreColor(72) },
    { min: 50, label: 'Хорошо', color: scoreColor(57) },
    { min: 35, label: 'Средне', color: scoreColor(42) },
    { min: 0, label: 'Слабо', color: scoreColor(17) },
  ];

  function computeTotal(scores) {
    const vals = Object.values(scores || {}).filter((v) => typeof v === 'number');
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return Math.round((sum / (vals.length * SLIDER_MAX)) * MAX_SCORE);
  }

  // { label, min, color — фон значка (белый текст), mark — полосы и кольца, perfect — 90 из 90 }
  function grade(total) {
    if (total == null) return null;
    const g = GRADES.find((x) => total >= x.min);
    const perfect = total >= MAX_SCORE;
    return { ...g, color: perfect ? '#047857' : scoreColor(total), mark: scoreMark(total), perfect };
  }

  // ---- Иконки каналов ----
  // Хранятся в 'c:icons': { ключ: { src, at } | { failAt } }. Ключи — путь канала (/@адрес, /channel/UC…)
  // и имя ('n:имя'): у одного канала встречаются обе ссылки, а у старой истории бывает только имя.
  const ICONS_KEY = 'c:icons';
  const ICON_RETRY_MS = 7 * 86400000;
  // Неудачи до 18.10.2026 — это окно согласия на cookie вместо страницы канала, а не отсутствие иконки:
  // их не учитываем, чтобы все такие каналы перепроверились
  const ICON_FAIL_SINCE = Date.UTC(2026, 9, 18, 12);
  const iconFailed = (e) => !!(e?.failAt && e.failAt > ICON_FAIL_SINCE && Date.now() - e.failAt < ICON_RETRY_MS);

  function channelKey(url) {
    if (!url) return '';
    try {
      const parts = decodeURIComponent(new URL(url, 'https://www.youtube.com').pathname).split('/').filter(Boolean);
      if (!parts.length) return '';
      // @адрес не зависит от регистра, а id канала (/channel/UC…) — зависит
      return parts[0].startsWith('@') ? '/' + parts[0].toLowerCase() : '/' + parts.slice(0, 2).join('/');
    } catch {
      return '';
    }
  }
  const nameKey = (name) => (name && name.trim() ? 'n:' + name.trim().toLowerCase() : '');

  function channelIcon(icons, url, name) {
    const a = icons?.[channelKey(url)];
    if (a?.src) return a.src;
    return icons?.[nameKey(name)]?.src || '';
  }

  // Ссылка на картинку с серверов YouTube — другие адреса не сохраняем
  function safeIconSrc(src) {
    let s = String(src || '').trim();
    if (s.startsWith('//')) s = 'https:' + s;
    return /^https:\/\/(yt\d\.ggpht\.com|yt\d\.googleusercontent\.com|lh\d\.googleusercontent\.com)\//.test(s) ? s : '';
  }

  function parseVideoId(url) {
    if (!url) return null;
    let u;
    try {
      u = new URL(url, 'https://www.youtube.com');
    } catch {
      return null;
    }
    const ok = (id) => (id && /^[\w-]{11}$/.test(id) ? id : null);
    if (u.hostname === 'youtu.be') return ok(u.pathname.slice(1, 12));
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    if (u.pathname === '/watch') return ok(u.searchParams.get('v'));
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
    return m ? ok(m[2]) : null;
  }

  function thumbUrl(id) {
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }
  // Крупное превью (большая карточка «Продолжить», билет оценки): 1280×720, если у видео его нет — на ступень ниже.
  // Лестница: maxresdefault → hq720 → sddefault → hqdefault; следующую ступень даёт thumbFallback (YouTube отвечает 404).
  const THUMB_STEPS = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];
  // Какая ступень у ролика есть, запоминаем (в окне расширения и на телефоне): иначе при каждой перерисовке
  // браузер снова просит отсутствующее 720p, получает ошибку и превью моргает, перескакивая на запасное
  const HQ_KEY = 'tr-thumb-hq';
  let hqBest = null;
  function hqMap() {
    if (hqBest) return hqBest;
    try {
      hqBest = JSON.parse(localStorage.getItem(HQ_KEY) || '{}') || {};
    } catch {
      hqBest = {};
    }
    return hqBest;
  }
  let hqSaveTimer = 0;
  function hqRemember(id, step) {
    const m = hqMap();
    if (m[id] === step) return;
    m[id] = step;
    clearTimeout(hqSaveTimer);
    hqSaveTimer = setTimeout(() => {
      try {
        const keys = Object.keys(m);
        if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete m[k];
        localStorage.setItem(HQ_KEY, JSON.stringify(m));
      } catch {
        // не критично: просто снова переберём ступени
      }
    }, 500);
  }
  function thumbHQ(id) {
    let step = 'maxresdefault';
    try {
      if (typeof localStorage !== 'undefined') step = hqMap()[id] || step;
    } catch {
      // нет доступа к памяти страницы — начинаем с лучшего
    }
    return `https://i.ytimg.com/vi/${id}/${step}.jpg`;
  }
  function thumbFallback(src) {
    const m = String(src || '').match(/^(https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/)(\w+)\.jpg/);
    const i = m ? THUMB_STEPS.indexOf(m[2]) : -1;
    return i >= 0 && i < THUMB_STEPS.length - 1 ? `${m[1]}${THUMB_STEPS[i + 1]}.jpg` : null;
  }
  // Подменять недоступное крупное превью на следующее (один обработчик на документ: у страниц расширения нет инлайн-скриптов)
  function watchThumbFallback(doc = document) {
    doc.addEventListener(
      'error',
      (e) => {
        const img = e.target;
        if (img?.tagName !== 'IMG') return;
        const next = thumbFallback(img.currentSrc || img.src);
        if (!next) return;
        const m = next.match(/\/vi\/([\w-]{11})\/(\w+)\.jpg/);
        if (m) hqRemember(m[1], m[2]);
        img.src = next;
      },
      true
    );
    // maxresdefault иногда отдаётся заглушкой 120×90 без ошибки — тоже идём ниже
    doc.addEventListener(
      'load',
      (e) => {
        const img = e.target;
        if (img?.tagName === 'IMG' && img.naturalWidth && img.naturalWidth <= 120 && /\/(maxresdefault|hq720)\.jpg/.test(img.src)) {
          const next = thumbFallback(img.src);
          const m = next?.match(/\/vi\/([\w-]{11})\/(\w+)\.jpg/);
          if (m) hqRemember(m[1], m[2]);
          if (next) img.src = next;
        }
      },
      true
    );
  }

  function watchUrl(id) {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  function dateKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // «1 ч 23 мин», «12 мин», «40 с»
  function fmtSpent(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return `${sec} с`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} ч ${mm} мин` : `${h} ч`;
  }

  // «1:02:03» — для длительности ролика
  function fmtClock(sec) {
    if (!sec || !isFinite(sec)) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  // Все сохранённые видео: { id: video }
  async function getAllVideos() {
    const all = await chrome.storage.local.get(null);
    const out = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith('v:')) out[k.slice(2)] = v;
    return out;
  }

  // Непросмотренные видео из «Смотреть позже+»: сначала важные, внутри — свежие
  // Порядок «Смотреть позже+»: по важности, внутри блока — свой порядок, который задали перетаскиванием
  // (later.order: 1, 2, 3…). Добавленное после этого — сверху блока, новое выше.
  // Порядок «Смотреть позже+»: закреплённые — первыми (последнее закреплённое — выше), дальше по важности
  // и своему порядку в блоке
  function laterCmp(a, b) {
    const pa = a.later.pinned || 0;
    const pb = b.later.pinned || 0;
    if (pa !== pb) return pb - pa; // закреплённые в одну секунду — дальше по важности
    const oa = a.later.order != null;
    const ob = b.later.order != null;
    return b.later.priority - a.later.priority || oa - ob || (oa ? a.later.order - b.later.order : b.later.addedAt - a.later.addedAt);
  }
  function laterQueue(videos) {
    return Object.values(videos)
      .filter((v) => v.later && !v.watchedAt)
      .sort(laterCmp);
  }

  // Начатое, но не досмотренное видео — его нужно «продолжить».
  // Из списка «Смотреть позже+» — всегда; остальные — если смотрели от минуты за последние 2 недели.
  const RESUME_DAYS = 14;
  function isStarted(v, autoPct = 90) {
    const w = v.watch;
    const p = w?.position;
    if (v.watchedAt || v.resumeHidden || !w || !(p >= 0.03) || p * 100 >= autoPct) return false;
    const remote = w.remote && p >= 0.05 && !looksLive(v); // начато на телефоне или другом устройстве
    if ((w.real || 0) < 30 && !remote) return false;
    return !!v.later || (((w.real || 0) >= 60 || remote) && Date.now() - (w.lastAt || 0) < RESUME_DAYS * 86400000);
  }

  // Трансляции и премьеры: прогресс в истории YouTube у них ненадёжный
  // (смотрели вживую — полоска стоит в конце записи, хотя посмотрели 20 минут)
  const LIVE_TITLE_RE = /стрим|stream|трансляци|прямой эфир|\bв эфире\b|премьер|premiere|\blive\b/i;
  function looksLive(v) {
    return !!v?.live || LIVE_TITLE_RE.test(v?.title || '');
  }

  // Верхняя граница оценки времени по одному видео за день, если смотрели не здесь
  function remoteCap(v) {
    if (looksLive(v)) return 30 * 60;
    if ((v?.duration || 0) >= 2 * 3600) return 60 * 60;
    return Infinity;
  }

  // ---- «Не досмотрел» ----
  // Брошенное видео: начали всерьёз (от минуты), ушли раньше 60% и не возвращались 3 дня.
  // Причина — сигнал о канале: «досматриваете N%» и почему бросаете.
  const DROP_MAX = 0.6;
  const DROP_DAYS = 3;
  const DROP_REASONS = [
    { id: 'boring', label: 'Скучно' },
    { id: 'bait', label: 'Не то, что обещали' },
    { id: 'long', label: 'Слишком затянуто' },
    { id: 'quality', label: 'Плохо снято или звук' },
    { id: 'mood', label: 'Не под настроение' },
    { id: 'none', label: 'Без причины' },
  ];
  const dropReason = (id) => DROP_REASONS.find((r) => r.id === id) || DROP_REASONS[DROP_REASONS.length - 1];
  const maxPos = (v) => Math.max(v?.watch?.maxProgress || 0, v?.watch?.position || 0);

  function isDropCandidate(v, now = Date.now()) {
    if (!v || v.dropped || v.rating || v.watchedAt || v.noRate || v.later || v.short || looksLive(v)) return false;
    const w = v.watch;
    if (!w || (w.real || 0) < 60) return false;
    const p = maxPos(v);
    if (!(p >= 0.03) || p >= DROP_MAX) return false;
    return now - (w.lastAt || 0) > DROP_DAYS * 86400000;
  }

  // Просмотрено (здесь или на другом устройстве), но ещё не оценено. Брошенные — отдельно.
  function awaitingRating(v) {
    if (v.rating || v.noRate || v.dropped || isDropCandidate(v)) return false;
    return !!(v.watchedAt || (v.watch?.real || 0) >= 60);
  }

  // ---- Уборка «Смотреть позже+» раз в две недели ----
  const CLEANUP_DAYS = 14;
  function staleLater(videos, now = Date.now()) {
    const lim = CLEANUP_DAYS * 86400000;
    return Object.values(videos)
      .filter((v) => v.later && !v.watchedAt && now - (v.later.addedAt || now) > lim && !(now - (v.later.keptAt || 0) < lim) && !isStarted(v))
      .sort((a, b) => a.later.addedAt - b.later.addedAt);
  }

  // Последний просмотр был не в этом браузере (телефон, ТВ, другой компьютер)
  function fromOtherDevice(v) {
    return !!v.watch?.remote;
  }

  function startedVideos(videos, autoPct) {
    return Object.values(videos)
      .filter((v) => isStarted(v, autoPct))
      .sort((a, b) => (b.watch.lastAt || 0) - (a.watch.lastAt || 0));
  }

  // Что смотреть дальше: сначала начатые, потом «Смотреть позже+» по важности
  function watchNext(videos, autoPct) {
    const started = startedVideos(videos, autoPct);
    const ids = new Set(started.map((v) => v.id));
    return [...started, ...laterQueue(videos).filter((v) => !ids.has(v.id))];
  }

  // Ссылка с места, где остановились (чуть раньше — 5 секунд на «вспомнить»)
  function resumeUrl(v) {
    const p = v.watch?.position;
    if (!v.duration || !(p >= 0.03) || p >= 0.98) return watchUrl(v.id);
    return `${watchUrl(v.id)}&t=${Math.max(0, Math.floor(p * v.duration) - 5)}s`;
  }

  // ---- Слияние записей двух устройств (телефон ↔ компьютер, позже — Google Drive) ----
  // У каждой части записи своё время изменения: оценка, «позже», отзыв с моментами, «просмотрено», «бросили».
  // Побеждает более поздняя правка, удаления тоже переносятся. Время просмотра — большее из двух.
  const MOBILE_APP = 'Smotribelno-mobile';
  function mergeNewer(cur, inc) {
    const copy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
    if (!cur) return copy(inc);
    if (!inc) return cur;
    const v = { ...cur };
    for (const f of ['title', 'channel', 'channelUrl', 'duration', 'short', 'live']) if (v[f] == null && inc[f] != null) v[f] = inc[f];
    const part = (has, hasTs, delKey) => {
      const a = Math.max(hasTs(cur), cur[delKey] || 0);
      const b = Math.max(hasTs(inc), inc[delKey] || 0);
      if (!(b > a)) return;
      if (inc[has]) {
        v[has] = copy(inc[has]);
        delete v[delKey];
      } else {
        delete v[has];
        v[delKey] = inc[delKey];
      }
    };
    part('rating', (x) => x.rating?.updatedAt || 0, 'ratingDel');
    part('later', (x) => x.later?.updatedAt || x.later?.addedAt || 0, 'laterDel');
    part('dropped', (x) => x.dropped?.at || 0, 'droppedDel');
    part('star', (x) => x.star?.at || 0, 'starDel'); // звезда ролику на аллее славы
    if ((inc.noteAt || 0) > (cur.noteAt || 0)) {
      v.noteAt = inc.noteAt;
      if (inc.note) v.note = inc.note;
      else delete v.note;
      if (inc.moments?.length) v.moments = copy(inc.moments);
      else delete v.moments;
    }
    // «Не оценивать» и «не предлагать продолжить» — без времени изменения: раз поставили, не снимаем
    for (const f of ['noRate', 'resumeHidden']) if (inc[f] && !cur[f]) v[f] = inc[f];
    const wa = Math.max(cur.watchedAt || 0, cur.watchedUpd || 0);
    const wb = Math.max(inc.watchedAt || 0, inc.watchedUpd || 0);
    if (wb > wa) {
      v.watchedAt = inc.watchedAt || null;
      if (inc.watchedUpd) v.watchedUpd = inc.watchedUpd;
    }
    // Плейлисты видео: весь набор {плейлист: место в нём} со своим временем изменения
    if ((inc.plAt || 0) > (cur.plAt || 0)) {
      v.plAt = inc.plAt;
      if (inc.pl && Object.keys(inc.pl).length) v.pl = copy(inc.pl);
      else delete v.pl;
    }
    if (inc.watch) {
      const a = cur.watch || {};
      const b = inc.watch;
      const later = (b.lastAt || 0) > (a.lastAt || 0) ? b : a;
      v.watch = { ...a, real: Math.max(a.real || 0, b.real || 0), maxProgress: Math.max(a.maxProgress || 0, b.maxProgress || 0), position: later.position ?? a.position ?? b.position, lastAt: Math.max(a.lastAt || 0, b.lastAt || 0) || undefined };
    }
    return v;
  }

  // ---- Плейлисты ----
  // Список плейлистов — в chrome.storage.local['playlists'] = { lists: { id: { name, emoji, createdAt, updatedAt, del? } } }
  // (удалённый остаётся «надгробием» del, чтобы удаление доехало до других устройств).
  // Что в плейлисте — в записи самого видео: v.pl = { id плейлиста: место (1, 2, 3…) }, v.plAt — время изменения.
  // Так состав едет вместе с видео той же синхронизацией, что оценки и «позже».
  const PLAYLISTS_KEY = 'playlists';
  const PLAYLIST_EMOJI = ['🎬', '🍿', '📚', '🎧', '🎮', '💡', '🧠', '🔥', '🍳', '✈️', '💪', '😂', '🎵', '🧪', '⚽', '🌙'];
  const isPlaylistId = (id) => /^[a-z0-9]{4,16}$/.test(id || '');
  function newPlaylistId() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(-12);
  }
  function playlistList(store) {
    return Object.entries(store?.lists || {})
      .filter(([id, p]) => isPlaylistId(id) && p && !p.del)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  // Видео плейлиста по порядку
  function playlistItems(videos, plId) {
    return Object.values(videos || {})
      .filter((v) => v?.pl && plId in v.pl)
      .sort((a, b) => a.pl[plId] - b.pl[plId] || (a.title || '').localeCompare(b.title || ''));
  }
  // Сводка: сколько видео, общая длительность, сколько просмотрено, средняя оценка
  function playlistSummary(items) {
    const rated = items.filter((v) => v.rating);
    return {
      count: items.length,
      duration: items.reduce((s, v) => s + (v.duration || 0), 0),
      left: items.filter((v) => !v.watchedAt).reduce((s, v) => s + (v.duration || 0) * (1 - Math.min(v.watch?.position || 0, 1)), 0),
      watched: items.filter((v) => v.watchedAt).length,
      avg: rated.length ? Math.round(rated.reduce((s, v) => s + v.rating.total, 0) / rated.length) : null,
    };
  }
  // Что смотреть дальше: первое непросмотренное после текущего видео (или с начала)
  function playlistNext(videos, plId, afterId) {
    const items = playlistItems(videos, plId);
    const from = afterId ? items.findIndex((v) => v.id === afterId) + 1 : 0;
    return [...items.slice(from), ...items.slice(0, Math.max(0, from - 1))].find((v) => !v.watchedAt && v.id !== afterId) || null;
  }
  // Списки двух устройств: у каждого плейлиста побеждает более поздняя правка (переименование, значок, удаление)
  // Каналы плейлиста — по порядку добавления
  function playlistChannels(list) {
    return Object.values(list?.channels || {}).sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.name).localeCompare(String(b.name), 'ru'));
  }
  function mergePlaylists(a, b) {
    const out = { lists: {} };
    const la = a?.lists || {};
    const lb = b?.lists || {};
    for (const id of new Set([...Object.keys(la), ...Object.keys(lb)])) {
      if (!isPlaylistId(id)) continue;
      const x = la[id];
      const y = lb[id];
      const t = (p) => Math.max(p?.updatedAt || 0, p?.del || 0, p?.createdAt || 0);
      const w = !x ? y : !y ? x : t(y) > t(x) ? y : x;
      if (w) out.lists[id] = JSON.parse(JSON.stringify(w));
    }
    return out;
  }

  // ---- Аллея славы: звезда любимым каналам ----
  // chrome.storage.local['fame'] = { stars: { ключ: { name, url, at } } }, ключ — название канала в нижнем регистре.
  // Снятая звезда остаётся «надгробием» { del }, чтобы снятие доехало до других устройств.
  const FAME_KEY = 'fame';
  const fameKey = (name) =>
    String(name || '')
      .trim()
      .toLowerCase();
  function fameStar(store, name) {
    const s = store?.stars?.[fameKey(name)];
    return s && !s.del && s.name ? s : null;
  }
  function fameList(store) {
    return Object.values(store?.stars || {})
      .filter((s) => s && !s.del && s.name)
      .sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  function mergeFame(a, b) {
    const out = { stars: {} };
    const sa = a?.stars || {};
    const sb = b?.stars || {};
    const t = (s) => Math.max(s?.at || 0, s?.del || 0);
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (!k || k.length > 200) continue;
      const x = sa[k];
      const y = sb[k];
      const w = !x ? y : !y ? x : t(y) > t(x) ? y : x;
      if (w) out.stars[k] = JSON.parse(JSON.stringify(w));
    }
    return out;
  }
  // Значок жанра на звезде, как эмблемы на голливудской аллее: маски, книга, пластинка, микрофон, геймпад, кинокамера
  const FAME_EMBLEMS = {
    fun: '<path d="M3 5.5c2.6 1 5.4 1 8 0V11a4 4 0 0 1-8 0z"/><path d="M13 8.5c2.6 1 5.4 1 8 0V14a4 4 0 0 1-8 0z"/><path d="M5.2 10.6c.8.9 2.8.9 3.6 0M15.2 15.9c.8-.9 2.8-.9 3.6 0"/>',
    learn: '<path d="M3.5 5.5c2.7-1 5.6-.8 8.5 1 2.9-1.8 5.8-2 8.5-1v13c-2.7-1-5.6-.8-8.5 1-2.9-1.8-5.8-2-8.5-1z"/><path d="M12 6.5v13"/>',
    music: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.8a6.2 6.2 0 0 1 6.2 6.2" opacity=".6"/>',
    news: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    stream: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.5 3a2.5 2.5 0 0 1-4.3 1.3L15 15H9l-1.2 1.8a2.5 2.5 0 0 1-4.3-1.3l-.5-3A4 4 0 0 1 7 8z"/><path d="M8 10.8v3M6.5 12.3h3M15.5 11.8h.01M17.5 13.3h.01"/>',
    custom: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/><circle cx="7" cy="5" r="1.6"/><circle cx="11.5" cy="5" r="1.6"/>',
  };
  function fameEmblem(type, size = 22) {
    const p = FAME_EMBLEMS[type] || FAME_EMBLEMS.custom;
    return `<svg class="fame-emblem" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }
  // Имя на звезде уменьшается, пока целиком не влезет в свою полосу (и по ширине, и по строкам) — не выходит за звезду.
  // Вызывать, когда звёзды уже видны (нужны размеры).
  function fitFameNames(root) {
    for (const el of root?.querySelectorAll?.('.fs-name') || []) {
      const w = el.closest('.fame-star')?.clientWidth;
      if (!w || !el.clientHeight) continue;
      let n = (parseFloat(getComputedStyle(el).fontSize) / w) * 100;
      for (let i = 0; i < 14 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && n > 2.2; i++) {
        n *= 0.9;
        el.style.setProperty('--n', n.toFixed(2) + 'cqw');
      }
    }
  }

  // Звезда вблизи: крупно на весь экран, по звезде можно водить лупой (мышкой или пальцем — лупа над пальцем).
  // star — разметка звезды (.fame-star), actions — кнопки и ссылки: { label, href, target, onClick, primary }.
  // extra — дополнительный блок под подписью (у ролика: превью и цифры с YouTube); его можно дозаполнить позже через .fz-extra
  function fameCloseup({ star, title, sub = '', extra = '', actions = [] }) {
    // прошлую карточку закрываем как положено — вместе с её обработчиком клавиш
    const prev = document.querySelector('.fame-zoom');
    if (prev?._close) prev._close();
    else prev?.remove();
    // лупа — только с мышью; на сенсорном экране звезда просто крупно
    const lensOn = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const box = document.createElement('div');
    box.className = 'fame-zoom';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    box.innerHTML = `<div class="fz-inner">
      <button type="button" class="fz-close" aria-label="Закрыть">✕</button>
      <div class="fz-stage">${star}<div class="fz-lens" aria-hidden="true"></div></div>
      <div class="fz-title">${escH(title)}</div>
      ${sub ? `<div class="fz-sub">${sub}</div>` : ''}
      ${extra ? `<div class="fz-extra">${extra}</div>` : ''}
      <div class="fz-actions"></div>
      ${lensOn ? '<div class="fz-hint">Нажмите на звезду и ведите — лупа покажет детали</div>' : ''}
    </div>`;
    const acts = box.querySelector('.fz-actions');
    for (const a of actions.filter((x) => x && x.label)) {
      const el = document.createElement(a.href ? 'a' : 'button');
      el.className = 'btn' + (a.primary ? ' primary' : '');
      el.textContent = a.label;
      if (a.href) {
        el.href = a.href;
        if (a.target) {
          el.target = a.target;
          el.rel = 'noopener';
        }
      } else el.type = 'button';
      el.addEventListener('click', (e) => {
        if (a.onClick) {
          e.preventDefault();
          close();
          a.onClick();
        } else if (!a.target) close();
      });
      acts.appendChild(el);
    }
    (document.fullscreenElement || document.body).appendChild(box); // аллея на весь экран — карточка поверх неё
    const stage = box.querySelector('.fz-stage');
    if (!lensOn) stage.classList.add('no-lens');
    const lens = box.querySelector('.fz-lens');
    const starEl = stage.querySelector('.fame-star');
    const zoomed = starEl.cloneNode(true);
    zoomed.classList.add('fz-zoomed');
    lens.appendChild(zoomed);
    requestAnimationFrame(() => {
      fitFameNames(stage);
      zoomed.querySelectorAll('.fs-name').forEach((n, i) => n.style.setProperty('--n', stage.querySelectorAll('.fs-name')[i]?.style.getPropertyValue('--n') || ''));
    });
    const K = 2.6;
    const show = (cx, cy, touch) => {
      const r = starEl.getBoundingClientRect();
      const x = cx - r.left;
      const y = cy - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) return lens.classList.remove('on');
      lens.classList.add('on');
      const L = lens.offsetWidth;
      // над пальцем, чтобы он не закрывал то, что увеличено
      lens.style.transform = `translate(${x - L / 2}px, ${y - L / 2 - (touch ? L * 0.85 : 0)}px)`;
      zoomed.style.width = r.width + 'px';
      zoomed.style.transform = `translate(${L / 2 - x * K}px, ${L / 2 - y * K}px) scale(${K})`;
    };
    // лупа — только пока нажата кнопка мыши; просто наведение её не показывает
    let pressed = false;
    stage.addEventListener('pointermove', (e) => pressed && show(e.clientX, e.clientY, e.pointerType === 'touch'));
    stage.addEventListener('pointerdown', (e) => {
      if (!lensOn || e.button > 0) return;
      e.preventDefault();
      pressed = true;
      try {
        stage.setPointerCapture?.(e.pointerId); // палец или мышь уехали за звезду — лупа всё равно ведёт
      } catch {
        // захват не удался — не страшно
      }
      show(e.clientX, e.clientY, e.pointerType === 'touch');
    });
    const hide = () => {
      pressed = false;
      lens.classList.remove('on');
    };
    stage.addEventListener('pointerup', hide);
    stage.addEventListener('pointercancel', hide);
    stage.addEventListener('lostpointercapture', hide);
    function close() {
      document.removeEventListener('keydown', onKey);
      box.classList.add('closing');
      setTimeout(() => box.remove(), 200);
    }
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    box._close = () => {
      document.removeEventListener('keydown', onKey);
      box.remove();
    };
    box.addEventListener('click', (e) => (e.target === box || e.target.closest('.fz-close')) && close());
    box.querySelector('.fz-close').focus();
    return box;
  }

  // ---- Оформление аллеи: ночная сцена над бульваром и фонари ----
  // Холм с белыми буквами на опорах (как знаменитая надпись на холмах Голливуда), лучи прожекторов, пальмы
  function fameSceneHtml(sub = '') {
    const word = 'СМОТРИБЕЛЬНО';
    const x0 = 196;
    const step = 34;
    const letters = [...word]
      .map((ch, i) => {
        const x = x0 + i * step;
        const y = 108 + [0, -3, 1, -2, 2, -1, 3, -2, 0, 2, -3, 1][i]; // буквы стоят чуть вразнобой, как на настоящем холме
        const r = [-2, 1, -1, 2, 0, -2, 1, 2, -1, 0, 2, -1][i];
        return `<g transform="rotate(${r} ${x + 14} ${y})"><path class="fs-legs" d="M${x + 6} ${y + 2}v14M${x + 22} ${y + 2}v14M${x + 6} ${y + 9}l16 6"/><text x="${x}" y="${y}">${ch}</text></g>`;
      })
      .join('');
    const palm = (x, s, flip) =>
      `<g class="fs-palm" transform="translate(${x} 200) scale(${flip ? -s : s} ${s})"><path d="M0 0 C 4 -40 10 -80 22 -118" class="trunk"/><g transform="translate(22 -118)"><path d="M0 0 q -24 -10 -48 6"/><path d="M0 0 q -18 -22 -40 -22"/><path d="M0 0 q 2 -26 -8 -40"/><path d="M0 0 q 20 -20 40 -16"/><path d="M0 0 q 26 -4 44 14"/><path d="M0 0 q 14 10 22 32"/></g></g>`;
    return `<div class="fame-scene" aria-hidden="true">
      <span class="fs-beam b1"></span><span class="fs-beam b2"></span><span class="fs-beam b3"></span>
      <svg class="fs-svg" viewBox="0 0 800 200" preserveAspectRatio="xMidYMax slice">
        <path class="fs-hill2" d="M0 200 L0 140 Q 90 104 190 118 T 380 100 T 600 114 T 800 96 L800 200 Z"/>
        <g class="fs-sign">${letters}</g>
        <path class="fs-hill" d="M0 200 L0 162 Q 120 120 250 132 T 520 124 T 800 150 L800 200 Z"/>
        ${palm(40, 0.9, false)}${palm(110, 0.62, true)}${palm(740, 0.95, true)}${palm(680, 0.6, false)}
      </svg>
      <div class="fs-title"><span class="fs-t">Аллея славы</span>${sub ? `<span class="fs-s">${sub}</span>` : ''}</div>
    </div>`;
  }
  // Старинный уличный фонарь — по краям тротуара; свет мягко «дышит»
  const FAME_LAMP = `<span class="fame-lamp" aria-hidden="true"><svg viewBox="0 0 40 160"><path class="lp-post" d="M20 160V46M14 160h12M16 150h8"/><path class="lp-arm" d="M20 52c0-10 9-12 12-8"/><path class="lp-head" d="M10 46h20l-3-18H13z"/><circle class="lp-bulb" cx="20" cy="38" r="5"/></svg><span class="lp-glow"></span></span>`;

  // Дорога у бульвара: две полосы, изредка проезжают машины с фарами (верхняя полоса — вправо, нижняя — влево)
  const FAME_CAR = `<svg class="car" viewBox="0 0 60 22" aria-hidden="true"><path class="car-body" d="M3 16c0-4 3-6 7-6.5l7-1c4-4.5 8-5.5 14-5.5h7c6 0 9 2.5 12 6l5 1.2c2.4.6 3.5 2.6 3.5 5.8v1H3z"/><path class="car-win" d="M20 8.6c3-3 6.4-3.8 11-3.8h5.5c3.6 0 6 1.6 8 3.8z"/><rect class="car-tail" x="2.4" y="10.6" width="2.6" height="2.4" rx="1"/><circle class="car-head" cx="58.6" cy="12" r="1.6"/><circle class="car-wheel" cx="15" cy="17.5" r="3.6"/><circle class="car-wheel" cx="46" cy="17.5" r="3.6"/></svg>`;
  const FAME_ROAD = `<span class="fame-road" aria-hidden="true"><span class="lane r l1">${FAME_CAR}</span><span class="lane l l2">${FAME_CAR}</span><span class="lane r l3">${FAME_CAR}</span></span>`;
  // Сколько звёзд в ряд: тротуар ровно по ширине звёзд (сколько помещается между фонарями), без пустого хвоста.
  // CSS сам такое не умеет (ширина по содержимому + перенос строк), поэтому считаем; вызывать после показа и при смене размера окна.
  function fitFameWalks(root, tileW = 230, lampsW = 100) {
    for (const b of root?.querySelectorAll?.('.boulevard') || []) {
      const walk = b.querySelector('.fame-walk');
      const n = walk?.children.length || 0;
      const avail = (b.parentElement?.clientWidth || 0) - lampsW;
      if (!walk || !n || avail <= 0) continue;
      walk.style.setProperty('--cols', String(Math.max(1, Math.min(n, Math.floor(avail / tileW)))));
    }
  }
  // Бульвар целиком: фонарь, тротуар со звёздами, фонарь, ниже дорога
  const fameBoulevard = (tiles) => `<div class="boulevard">${FAME_LAMP}<div class="fame-walk">${tiles}</div>${FAME_LAMP}${FAME_ROAD}</div>`;

  // ---- Прогулка по аллее: звёзды лежат на тротуаре и уходят вдаль, листание — шаги вперёд ----
  // items по порядку: { star, title, sub } — звезда; { sign } — табличка-перекрёсток на обочине.
  // onOpen(item) — нажали на звезду или «Рассмотреть». Состояние (где стоим) переживает перерисовку.
  // racers — каналы для забега за ремонтом ([{ name, icon }] или функция, которая их вернёт); без них — каналы со звёздами.
  const W3_TILT = 62; // наклон тротуара, градусов (вид с аллеи)
  const W3_TILT_TOP = 30; // вид сверху: камера поднята, на звёзды смотрим почти сверху
  function fameWalk(host, { items, onOpen, lite = false, racers = null }) {
    const liteAsked = lite; // для пересборки при смене ширины
    if (!host) return;
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const sig = items.map((it) => it.sign || it.title + '|' + (it.sub || '')).join('¦');
    if (host._sig === sig && host.firstChild) return; // то же самое — не перестраиваем, прогулка продолжается с того же места
    host._sig = sig;
    // слабое устройство: совсем слабое — без машин, послабее — без мерцаний и «дышащего» света
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    if (cores <= 2 || mem <= 2) lite = true;
    const lowfx = lite || cores <= 4 || mem <= 4;
    const firstShow = !host._shown; // заставка «Аллея готовится» — только при первом показе
    host._shown = true;
    // телефон (узкий экран): только вид сверху, а над улицей — полоса с горой СМОТРИБЕЛЬНО целиком
    const hostW = host.clientWidth || innerWidth;
    const phone = hostW > 0 && hostW < 620;
    const D = 300; // шаг между звёздами
    const START = 240;
    const rows = [];
    let z = START;
    for (const it of items) {
      rows.push({ ...it, z });
      z += it.sign ? 200 : D;
    }
    // Конец аллеи — ремонт: пустые места под будущие звёзды, заграждения и табличка. Дороги свободны — машины едут дальше.
    const zb = z + 480; // линия заграждений
    const maxPos = Math.max(0, zb - START - 300);
    // FAR — сколько улицы впереди показываем (дальше — скрыто, там же едут машины). Дорога всегда длиннее
    // этого отрезка, даже у конца аллеи: машины уходят в туман над асфальтом, а не едут по воздуху.
    const FAR = 4400;
    const LEN = Math.max(zb + 1500, maxPos + FAR + 900);
    // Улица поперёк (px) — зеркальная относительно тротуара: дома | обочина | дорога в две полосы | газон с фонарями
    // и пальмами | тротуар со звёздами | газон | дорога | обочина | дома. Всё считается от этих ширин.
    // Раскладка — по постоянному «зерну»: улица не меняется.
    const SIDE = 70;
    const ROAD = 300;
    const GRASS = 50;
    const WALK = 460;
    const W = 2 * (SIDE + ROAD + GRASS) + WALK; // вся ширина улицы между домами
    const C = W / 2; // середина тротуара — по центру взгляда
    const xRoadL = SIDE;
    const xGrassL = xRoadL + ROAD;
    const xWalk = xGrassL + GRASS;
    const xGrassR = xWalk + WALK;
    const xRoadR = xGrassR + GRASS;
    const xSideR = xRoadR + ROAD;
    const lampL = xGrassL + GRASS / 2;
    const lampR = xGrassR + GRASS / 2;
    let seed = 20261019;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let side = '';
    for (let y = 120; y < LEN - 300; y += 520) {
      side += `<div class="w3-pool" style="bottom:${y - 60}px;left:${lampL}px"></div><div class="w3-pool" style="bottom:${y - 60}px;left:${lampR}px"></div>`;
      side += `<div class="w3-bb w3-lamp" style="bottom:${y}px;left:${lampL}px">${FAME_LAMP}</div><div class="w3-bb w3-lamp" style="bottom:${y}px;left:${lampR}px">${FAME_LAMP}</div>`;
    }
    // пальмы — на обоих газонах, вперемежку
    for (let y = 380, i = 0; y < LEN - 300; y += 640, i++) side += `<div class="w3-bb w3-palm${i % 2 ? ' small' : ''}" style="bottom:${y}px;left:${i % 2 ? lampR + 2 : lampL - 2}px"></div>`;
    // Дома Лас-Вегаса: каждый дом выглядит по своей вывеске — казино, театр, кино, отель, бар, радио, диско, шоу
    // или обычный дом с окнами. Вывеска — часть стены, поэтому уходит в перспективу вместе с домом.
    // Координаты фасада: x — высота над землёй (0 — тротуар, H — крыша), y — вдоль улицы (0…L).
    const WALLS = ['#4a1f4f', '#1f3f5a', '#5a3a1f', '#3a2a5f', '#5a1f35', '#1f4a45'];
    const TRIMS = ['#ff5fa2', '#5fe1ff', '#ffc85f', '#b28bff', '#ff6b5f', '#5fffb0'];
    // side — цвет торца дома (его видно со стороны зрителя)
    const KINDS = {
      casino: { words: ['КАЗИНО', 'ДЖЕКПОТ', '777', 'РОЯЛЬ', 'БИНГО'], trim: ['#ffc85f', '#ff6b5f'], side: '#4a0c18' },
      theater: { words: ['ТЕАТР'], trim: ['#ffe2a8'], side: '#3e352a' },
      cinema: { words: ['КИНО'], trim: ['#5fe1ff', '#ff5fa2'], side: '#0f2f35' },
      hotel: { words: ['ОТЕЛЬ', 'МОТЕЛЬ'], trim: ['#5fffb0', '#ff9ad5'], side: '#22313d' },
      bar: { words: ['БАР'], trim: ['#ff8a3d'], side: '#3e1c14' },
      radio: { words: ['РАДИО'], trim: ['#7fb2ff'], side: '#101d3d' },
      disco: { words: ['ДИСКО'], trim: ['#d58bff'], side: '#200b30' },
      show: { words: ['ШОУ'], trim: ['#ff5fa2'], side: '#420a2c' },
    };
    const KIND_POOL = ['casino', 'casino', 'theater', 'cinema', 'hotel', 'bar', 'radio', 'disco', 'show', 'plain', 'plain'];
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const rect = (x, y, w, h, fill, more = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${more}/>`;
    const bulbs = (pts) => pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ffe9a8"/>`).join('');
    const rowY = (x, y0, y1, step) => Array.from({ length: Math.max(0, Math.floor((y1 - y0) / step) + 1) }, (_, i) => [x, y0 + i * step]);
    const rowX = (y, x0, x1, step) => Array.from({ length: Math.max(0, Math.floor((x1 - x0) / step) + 1) }, (_, i) => [x0 + i * step, y]);
    const grad = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
    const lit = (p) => (rnd() < p ? (rnd() < 0.5 ? '#ffd27a' : '#ffb85c') : '#120f17');
    // обычные окна: сетка, часть горит
    const windows = (H, L, p = 0.38) => {
      let r = '';
      for (let x = 30; x < H - 34; x += 44) for (let y = 14; y < L - 24; y += 38) r += rect(x, y, 22, 18, lit(p), ' rx="2"');
      return r;
    };
    const starPts = (x, y, s) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const q = i % 2 ? s * 0.42 : s;
        return `${(x + q * Math.cos(a)).toFixed(1)},${(y + q * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
    const FACADE = {
      // казино: красно-золотой фасад, золотые пилястры, окна-ромбы, рамка из лампочек по крыше, арочный вход
      casino: (H, L) => {
        let r = grad('#7a1424', '#3a0812');
        for (let y = 18; y < L - 10; y += 62) r += rect(0, y, H - 14, 8, '#c9963f');
        for (let x = 96; x < H - 30; x += 40) for (let y = 49; y < L - 20; y += 62) r += `<polygon points="${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}" fill="${rnd() < 0.7 ? '#ffd27a' : '#5a1020'}"/>`;
        r += rect(H - 14, 0, 14, L, '#c9963f') + bulbs(rowY(H - 7, 8, L - 8, 14));
        const c = L / 2;
        r += `<path d="M0 ${c - 46} H66 A46 46 0 0 1 66 ${c + 46} H0 Z" fill="#ffd27a"/><path d="M0 ${c - 34} H60 A34 34 0 0 1 60 ${c + 34} H0 Z" fill="#b8442a"/>`;
        r += bulbs(Array.from({ length: 11 }, (_, i) => [66 + 46 * Math.cos(-Math.PI / 2 + (i * Math.PI) / 10), c + 46 * Math.sin(-Math.PI / 2 + (i * Math.PI) / 10)]));
        return r + rect(0, 0, 6, L, '#c9963f');
      },
      // театр: светлый камень с рустом, высокие арочные окна над портиком, афиши у входа (портик — объёмный)
      theater: (H, L) => {
        let r = grad('#8a7a62', '#5a4d3c');
        for (let x = 24; x < H - 10; x += 26) r += rect(x, 0, 2, L, '#6e604d');
        for (let y = 26; y < L - 36; y += 46) {
          if (H * 0.62 + 70 < H - 16) r += `<path d="M${Math.round(H * 0.62)} ${y} H${Math.round(H * 0.62) + 54} A11 11 0 0 1 ${Math.round(H * 0.62) + 54} ${y + 22} H${Math.round(H * 0.62)} Z" fill="${lit(0.75)}"/>`;
          if (rnd() < 0.7) r += rect(28, y + 4, 40, 26, '#e4d4ac') + rect(32, y + 8, 32, 18, pick(['#7a2a2a', '#2a4a6a', '#5a3a6a']));
        }
        return r + rect(H - 16, 0, 16, L, '#b3a385');
      },
      // кино: большая светящаяся вывеска-марки с лампочками, рамки афиш, неоновые полосы
      cinema: (H, L, trim) => {
        let r = grad('#14424a', '#0b2226');
        for (let y = 30; y < L - 10; y += 72) r += rect(0, y, H - 10, 3, trim);
        for (let y = 24; y < L - 10; y += 48) r += rect(120, y, H - 140, 6, '#1d5a63');
        for (let y = 18; y < L - 50; y += 64) r += rect(10, y, 50, 36, '#c9963f') + rect(14, y + 4, 42, 28, pick(['#7a2a3a', '#2a3a7a', '#2a6a4a', '#6a4a2a']));
        for (let x = 150; x < H - 30; x += 44) for (let y = 20; y < L - 24; y += 44) if (rnd() < 0.3) r += rect(x, y, 18, 16, '#ffd27a');
        return r;
      },
      // отель / мотель: пастельный фасад, ровные ряды окон, балконные перила, двери с тёплым светом внизу
      hotel: (H, L) => {
        let r = grad(pick(['#2f6f73', '#8a4a68', '#4a5f8a']), '#1a2430');
        for (let x = 52; x < H - 26; x += 40) {
          for (let y = 14; y < L - 24; y += 34) r += rect(x, y, 22, 20, lit(0.5), ' rx="2"');
          r += rect(x - 6, 6, 3, L - 12, '#e8dfc6');
        }
        for (let y = 20; y < L - 30; y += 60) r += rect(0, y, 34, 20, '#ffd27a');
        return r;
      },
      // бар: кирпич, маленькие тёплые окна-арки у тротуара
      bar: (H, L) => {
        let r = grad('#5c2a1f', '#3a1812');
        for (let x = 0; x < H; x += 12) r += rect(x, 0, 1.5, L, '#2e130d');
        for (let y = 20; y < L - 50; y += 72) r += `<path d="M0 ${y} H40 A16 16 0 0 1 40 ${y + 32} H0 Z" fill="#ff9a4a"/>`;
        for (let x = 90; x < H - 30; x += 46) for (let y = 30; y < L - 30; y += 58) if (rnd() < 0.4) r += rect(x, y, 16, 14, '#ffb85c');
        return r;
      },
      // радио: тёмно-синий ар-деко, вертикальные линии, ступенчатый верх, холодный свет в окнах
      radio: (H, L) => {
        let r = grad('#15284f', '#0b1530');
        for (let y = 16; y < L - 10; y += 34) r += rect(0, y, H - 34, 2, '#7fb2ff') + rect(0, y + 6, H - 34, 1, '#4a6fae');
        r += rect(H - 34, L * 0.12, 16, L * 0.76, '#1d3366') + rect(H - 18, L * 0.3, 18, L * 0.4, '#24407d');
        for (let x = 40; x < H - 50; x += 30) for (let y = 24; y < L - 20; y += 34) if (rnd() < 0.35) r += rect(x, y, 14, 10, '#cfe3ff');
        return r;
      },
      // диско: разноцветная мозаика из плиток и зеркальный шар
      disco: (H, L) => {
        let r = grad('#2a0f3d', '#170824');
        const P = ['#ff5fa2', '#5fe1ff', '#ffc85f', '#b28bff', '#5fffb0'];
        for (let x = 60; x < H - 10; x += 18) for (let y = 6; y < L - 10; y += 18) if (rnd() < 0.55) r += rect(x, y, 14, 14, pick(P), ' opacity=".75"');
        const cx = H * 0.7;
        r += `<circle cx="${cx}" cy="${L / 2}" r="26" fill="#d8d8e6"/>`;
        for (let k = -2; k <= 2; k++) r += rect(cx - 26, L / 2 + k * 9, 52, 1.5, '#8a8aa0') + rect(cx + k * 9, L / 2 - 26, 1.5, 52, '#8a8aa0');
        return r + rect(0, 0, 50, L, '#1b0a28') + bulbs(rowY(46, 10, L - 10, 16));
      },
      // шоу: малиновый фасад с золотыми звёздами и рамкой из лампочек по краю
      show: (H, L) => {
        let r = grad('#5c0f3c', '#2e0820');
        for (let i = 0; i < Math.round((H * L) / 9000); i++) r += `<polygon points="${starPts(60 + rnd() * (H - 90), 20 + rnd() * (L - 40), 6 + rnd() * 8)}" fill="#e9c46a"/>`;
        r += bulbs(rowY(H - 8, 8, L - 8, 14)) + bulbs(rowX(8, 10, H - 14, 14)) + bulbs(rowX(L - 8, 10, H - 14, 14));
        return r + rect(0, L * 0.3, 40, L * 0.4, '#ffd27a');
      },
      plain: (H, L) => windows(H, L),
      // задний ряд — высокие тёмные дома, огней меньше
      back: (H, L) => rect(0, 0, H, L, '#17131f') + windows(H, L, 0.22),
    };
    const wallSvg = (kind, H, L, trim) =>
      // в атрибуте style — только одинарные кавычки, а в самой картинке — двойные (они кодируются)
      `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${H}" height="${L}">${FACADE[kind](H, L, trim)}</svg>`)}')`;
    // Объёмные детали домов — по типу, как у настоящих: у театра портик с колоннами, ступенями и фронтоном
    // (Пале Гарнье, Метрополитен), у казино козырёк на лампочках, вертикальная вывеска и корона на крыше
    // (Фримонт-стрит, «Золотой самородок»), у кино треугольная марки и вертикальное «КИНО» (Парамаунт),
    // у отеля балконы и вывеска на крыше, у радио ступенчатая башня ар-деко с антенной (Радио-Сити),
    // у бара полосатая маркиза, у шоу высокий пилон, у диско козырёк и зеркальный шар,
    // у обычных домов карниз, пожарные лестницы и водонапорные баки на крышах, как в Нью-Йорке.
    // Координаты: u — вынос от фасада к улице (u < 0 — над самим домом), y — вдоль улицы внутри дома
    // (0 — дальний край, L — ближний к зрителю), z — высота. Видны верх, сторона к улице и ближний торец.
    const tone = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
    };
    const BULB_ROW = 'radial-gradient(circle,#ffe9a8 0 2.4px,rgba(255,233,168,.25) 3.4px,transparent 4.5px)';
    const WTOWER = `url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="96"><path d="M12 96 L15 52 M44 96 L41 52 M24 96 L25 52 M32 96 L31 52 M13 82 H43 M14 68 H42" stroke="#241c17" stroke-width="3" fill="none"/><rect x="8" y="22" width="40" height="32" fill="#6b4a32"/><path d="M8 30 H48 M8 40 H48 M8 50 H48" stroke="#3a281c" stroke-width="2"/><rect x="8" y="22" width="12" height="32" fill="#000" opacity=".28"/><polygon points="5,23 28,4 51,23" fill="#3a2a22"/><polygon points="5,23 28,4 20,23" fill="#000" opacity=".25"/></svg>')}')`;
    const BALL = `url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="96"><rect x="28" y="56" width="4" height="40" fill="#3a3342"/><circle cx="30" cy="30" r="27" fill="#c9c9d8"/><g stroke="#7a7a92" stroke-width="1.4" fill="none"><ellipse cx="30" cy="30" rx="27" ry="9"/><ellipse cx="30" cy="30" rx="27" ry="19"/><ellipse cx="30" cy="30" rx="9" ry="27"/><ellipse cx="30" cy="30" rx="19" ry="27"/><path d="M3 30 H57 M30 3 V57"/></g><circle cx="21" cy="20" r="6" fill="#fff" opacity=".8"/><circle cx="40" cy="38" r="3" fill="#ff9ad5"/><circle cx="18" cy="40" r="3" fill="#5fe1ff"/></svg>')}')`;
    const deco = (sideCls, kind, H, L, D, trim) => {
      const s = sideCls === 'l' ? 1 : -1;
      const R = Math.round;
      const lx = (u0, u1) => (s > 0 ? u0 : -u1);
      const top = (u0, u1, y0, y1, z, bg, more = '') => `<i class="w3-f" style="left:${R(lx(u0, u1))}px;width:${R(u1 - u0)}px;top:${R(y0)}px;height:${R(y1 - y0)}px;transform:translateZ(${R(z)}px);background:${bg}${more}"></i>`;
      const side = (u, y0, y1, z0, z1, bg, more = '') => `<i class="w3-f" style="left:${R(s * u)}px;width:${R(z1 - z0)}px;top:${R(y0)}px;height:${R(y1 - y0)}px;transform-origin:0 50%;transform:translateZ(${R(z0)}px) rotateY(-90deg);background:${bg}${more}"></i>`;
      const near = (u0, u1, y, z0, z1, bg, inner = '', cls = '') => `<i class="w3-f${cls}" style="left:${R(lx(u0, u1))}px;width:${R(u1 - u0)}px;top:${R(y - (z1 - z0))}px;height:${R(z1 - z0)}px;transform-origin:50% 100%;transform:translateZ(${R(z0)}px) rotateX(-90deg);background:${bg}">${inner}</i>`;
      // коробка: верх, сторона к улице, ближний торец; цвета — светлее сверху, темнее у торца
      const box = (u0, u1, y0, y1, z0, z1, c, o = {}) =>
        (o.noTop ? '' : top(u0, u1, y0, y1, z1, o.t || tone(c, 0.16))) + side(u1, y0, y1, z0, z1, o.s || c) + near(u0, u1, y1, z0, z1, o.n || tone(c, -0.3), o.inner || '', o.cls || '');
      // стоячая картинка на крыше (бак, шар) — всегда лицом к зрителю
      const bb = (u, y, z, w, h, img) => `<div class="w3-bb w3-roofbb" style="left:${R(s * u - w / 2)}px;top:${R(y - h)}px;width:${w}px;height:${h}px;background-image:${img};transform:translateZ(${R(z)}px) rotateX(calc(var(--tilt, 62) * -1deg))"></div>`;
      const cornice = (c) => box(2, 14, 0, L, H - 16, H, c, { t: tone(c, 0.3) }) + box(2, 8, 0, L, H - 26, H - 16, tone(c, -0.2), { noTop: true });
      const blade = (u0, u1, y, z0, z1, word, bg) =>
        box(u0, u1, y - 10, y, z0, z1, tone(bg, -0.2), { n: `${BULB_ROW} left top/12px 12px repeat-y,${BULB_ROW} right top/12px 12px repeat-y,linear-gradient(${bg},${tone(bg, -0.35)})`, inner: `<b>${word}</b>`, cls: ' w3-blade' });
      const zMax = (z) => Math.min(z, 410);
      let r = '';
      if (kind === 'theater') {
        const a = L * 0.1, b = L * 0.9, P = 34, E = R(H * 0.5);
        const stone = '#cbbd9f';
        for (let k = 0; k < 3; k++) r += box(2, P + 20 - k * 7, a - 10 + k * 4, b + 10 - k * 4, k * 7, k * 7 + 7, tone(stone, -0.08 * k));
        const n = Math.max(4, R((b - a) / 52));
        for (let i = 0; i < n; i++) {
          const y = a + 6 + ((b - a - 28) * i) / (n - 1);
          r += box(P - 14, P + 2, y, y + 16, 21, E - 22, '#d9cdb0', { noTop: true, s: 'linear-gradient(180deg,#8f816a,#f2e8cc 45%,#a89a80)', n: 'linear-gradient(90deg,#8f816a,#e8dcbe 50%,#7d705b)' });
        }
        r += box(2, P + 6, a - 4, b + 4, E - 22, E, '#e2d6b8', { inner: '', n: `repeating-linear-gradient(90deg,#b9ab8e 0 3px,#e2d6b8 3px 12px)` });
        const ph = Math.min(56, (b - a) * 0.2, H * 0.16), mid = (a + b) / 2;
        r += side(P + 6, a - 4, b + 4, E, E + ph, 'linear-gradient(90deg,#efe4c8 0 9px,#b9ab8e 9px)', ';clip-path:polygon(0 0,100% 50%,0 100%)');
        const run = b + 4 - mid, len = Math.hypot(run, ph), ang = (Math.atan2(ph, run) * 180) / Math.PI;
        r += `<i class="w3-f" style="left:${R(lx(0, P + 8))}px;width:${P + 8}px;top:${R(mid)}px;height:${R(len)}px;transform-origin:50% 0;transform:translateZ(${R(E + ph)}px) rotateX(${(-ang).toFixed(1)}deg);background:linear-gradient(180deg,#6e604d,#8f7f66)"></i>`;
        // над залом — сценическая коробка, как у настоящих театров
        r += box(-D * 0.8, -D * 0.2, L * 0.25, L * 0.75, H, zMax(H + 44), '#7a6c56', { t: '#4a4036' });
      } else if (kind === 'casino') {
        const c = L / 2;
        r += box(2, 54, c - 66, c + 66, 118, 132, '#c9963f', { s: `${BULB_ROW} center/100% 12px repeat-y,linear-gradient(90deg,#8a5a1f,#e0b45a)`, n: `${BULB_ROW} left center/12px 100% repeat-x,#9a6a26`, t: '#5a1020' });
        for (const y of [c - 60, c + 52]) r += box(44, 52, y, y + 8, 0, 118, '#c9963f', { noTop: true });
        r += blade(10, 62, L * 0.86, R(H * 0.3), zMax(H + 54), pick(['КАЗИНО', '777', 'ДЖЕКПОТ']), '#a0182c');
        r += box(-D * 0.8, -D * 0.15, L * 0.22, L * 0.78, H, H + 30, '#7a1424', { n: `${BULB_ROW} left center/12px 100% repeat-x,#5a0c18` });
        r += box(-D * 0.65, -D * 0.3, L * 0.36, L * 0.64, H + 30, zMax(H + 56), '#c9963f', { t: '#ffd27a' });
      } else if (kind === 'cinema') {
        const a = L * 0.2, b = L * 0.8;
        const board = `${BULB_ROW} left center/12px 12px repeat-y,${BULB_ROW} right center/12px 12px repeat-y,repeating-linear-gradient(180deg,#2a2530 0 8px,transparent 8px 13px) left 32% top 0/9px 100% no-repeat,repeating-linear-gradient(180deg,#2a2530 0 6px,transparent 6px 14px) left 66% top 0/9px 100% no-repeat,#f4efe6`;
        r += box(2, 60, a, b, 66, 104, '#f4efe6', { s: board, n: `${BULB_ROW} left top/12px 12px repeat-x,${BULB_ROW} left bottom/12px 12px repeat-x,linear-gradient(${trim},${tone(trim, -0.4)})`, t: '#1e1b22' });
        r += box(2, 56, a, b, 104, 110, trim, { t: tone(trim, -0.2) });
        r += blade(12, 50, L / 2 + 5, 112, zMax(H + 46), 'КИНО', '#14424a');
      } else if (kind === 'hotel') {
        if (!lowfx)
          for (let z = 48; z < H - 40; z += 40) {
            r += top(2, 16, L * 0.06, L * 0.94, z, '#d8cfb6');
            r += side(16, L * 0.06, L * 0.94, z, z + 12, 'linear-gradient(90deg,transparent 9px,#e8dfc6 9px),repeating-linear-gradient(180deg,#e8dfc6 0 2px,transparent 2px 9px)');
          }
        r += box(-D + 14, -10, L - 24, L - 18, H, H + 8, '#2a2431');
        r += near(-D + 14, -10, L - 22, H + 8, H + 56, 'rgba(10,8,14,.9)', `<b>${pick(KINDS.hotel.words)}</b>`, ' w3-roofsign');
        r += cornice('#e8dfc6');
      } else if (kind === 'radio') {
        const lines = (c) => `repeating-linear-gradient(90deg,${c} 0 6px,${tone(c, 0.18)} 6px 8px)`;
        r += box(-D * 0.92, -D * 0.08, L * 0.12, L * 0.88, H, H + 30, '#1d3366', { n: lines('#15284f') });
        r += box(-D * 0.78, -D * 0.22, L * 0.26, L * 0.74, H + 30, H + 56, '#24407d', { n: lines('#1d3366') });
        r += box(-D * 0.62, -D * 0.38, L * 0.4, L * 0.6, H + 56, H + 76, '#2c4d94', { n: lines('#24407d') });
        r += box(-D * 0.52, -D * 0.48, L / 2 - 3, L / 2 + 3, H + 76, zMax(H + 140), '#9aa6c0', { noTop: true });
        r += near(-D * 0.5 - 5, -D * 0.5 + 5, L / 2 + 4, zMax(H + 140) - 2, zMax(H + 140) + 8, '#ff3b3b', '', ' w3-beacon');
        r += blade(8, 48, L * 0.88, R(H * 0.3), H - 14, 'РАДИО', '#15284f');
      } else if (kind === 'bar') {
        const z0 = 74, z1 = 54, U = 30, ang = (Math.atan2(z0 - z1, U) * 180) / Math.PI, len = Math.hypot(U, z0 - z1);
        const stripes = `repeating-linear-gradient(180deg,${trim} 0 14px,#f2e6cf 14px 28px)`;
        r += `<i class="w3-f" style="left:${s > 0 ? 2 : -2 - R(len)}px;width:${R(len)}px;top:${R(L * 0.06)}px;height:${R(L * 0.88)}px;transform-origin:${s > 0 ? '0' : '100%'} 50%;transform:translateZ(${z0}px) rotateY(${(s * ang).toFixed(1)}deg);background:${stripes}"></i>`;
        r += side(U + 2, L * 0.06, L * 0.94, z1 - 10, z1, stripes);
        r += cornice('#3e1c14');
        if (rnd() < 0.6) r += bb(-D * 0.5, L * (0.4 + rnd() * 0.4), H, 56, 96, WTOWER);
      } else if (kind === 'disco') {
        r += box(2, 56, L * 0.32, L * 0.68, 70, 84, '#1b0a28', { s: `linear-gradient(90deg,${trim} 0 3px,#1b0a28 3px calc(100% - 3px),${trim} 0)`, n: `linear-gradient(${trim} 0 3px,#1b0a28 3px calc(100% - 3px),${trim} 0)`, t: '#2a0f3d' });
        r += box(-D * 0.8, -D * 0.2, L * 0.3, L * 0.7, H, H + 18, '#2a0f3d', { n: `linear-gradient(90deg,#ff5fa2,#5fe1ff,#ffc85f,#b28bff)` });
        r += bb(-D * 0.5, L * 0.55, H + 18, 60, 96, BALL);
      } else if (kind === 'show') {
        r += box(2, 42, L * 0.28, L * 0.72, 44, 56, '#ff5fa2', { s: `${BULB_ROW} center/100% 12px repeat-y,#c2306e`, n: `${BULB_ROW} left center/12px 100% repeat-x,#9a1f56` });
        for (const u of [20, 34]) r += box(u - 3, u + 3, L * 0.9 - 6, L * 0.9, 0, 40, '#c9c9d8', { noTop: true });
        r += box(10, 46, L * 0.9 - 14, L * 0.9, 40, zMax(H + 70), '#5c0f3c', {
          n: `${BULB_ROW} left top/12px 12px repeat-y,${BULB_ROW} right top/12px 12px repeat-y,radial-gradient(circle at 30% 20%,#e9c46a 0 4px,transparent 5px) 0 0/22px 26px,linear-gradient(#8a1a5c,#3a0626)`,
          inner: '<b>ШОУ</b>',
          cls: ' w3-blade',
        });
      } else {
        // обычный дом: карниз, у некоторых — пожарная лестница, на крыше — бак или вентиляция
        r += cornice('#3a3342');
        if (!lowfx && rnd() < 0.45) {
          const y0 = 14 + 38 * Math.floor(rnd() * Math.max(1, (L - 140) / 38));
          for (let z = 70; z < H - 40; z += 44) {
            r += top(2, 18, y0 - 6, y0 + 66, z, '#2a2431');
            r += side(18, y0 - 6, y0 + 66, z, z + 13, 'linear-gradient(90deg,transparent 10px,#3b3444 10px),repeating-linear-gradient(180deg,#3b3444 0 2px,transparent 2px 8px)');
          }
        }
        if (rnd() < 0.5) r += bb(-D * (0.3 + rnd() * 0.4), L * (0.3 + rnd() * 0.5), H, 56, 96, WTOWER);
        else if (rnd() < 0.6) r += box(-D * 0.7, -D * 0.4, L * 0.4, L * 0.55, H, H + 18, '#4a4452');
      }
      return r;
    };
    // Передний ряд — дома с глубиной: фасад к улице, крыша и торец со стороны зрителя (дом «протянут» вбок от улицы).
    // Задний ряд — выше и проще, только фасады: закрывает пустоту за передними домами. На телефоне (lite) его нет.
    let houses = '';
    for (const [sideCls, x] of [['l', 0], ['r', W]]) {
      const out = sideCls === 'l' ? -1 : 1; // наружу от улицы
      for (let y = 40, n = 0; y < LEN - 200; n++) {
        const L = 240 + Math.round(rnd() * 220);
        let H = 170 + Math.round(rnd() * 190);
        const D = 130 + Math.round(rnd() * 70);
        const kind = pick(KIND_POOL);
        if (kind === 'theater') H = Math.max(H, 270);
        if (kind === 'radio') H = Math.min(H, 260);
        const K = KINDS[kind];
        const trim = K ? pick(K.trim) : pick(TRIMS);
        const wall = WALLS[n % WALLS.length];
        // вывеска на фасаде — по типу дома: у казино и шоу повыше, у остальных на среднем этаже
        const sign =
          K && !['cinema', 'hotel', 'radio', 'show'].includes(kind)
            ? `<span class="w3-fsign" style="left:${Math.round(H * (kind === 'casino' ? 0.66 : kind === 'theater' ? 0.86 : 0.5 + rnd() * 0.12))}px;top:${Math.round(L * (0.35 + rnd() * 0.3))}px"><b>${pick(K.words)}</b></span>`
            : '';
        houses += `<div class="w3-bld ${sideCls}" style="left:${x}px;bottom:${y}px;height:${L}px;--h:${H}px;--d:${D}px;--side:${K ? K.side : wall};--trim:${trim}"><div class="w3-wall ${sideCls}" style="width:${H}px;height:${L}px;--wall:${wall};background-image:${wallSvg(kind, H, L, trim)}">${sign}</div><i class="w3-roof"></i><i class="w3-endf"></i>${deco(sideCls, kind, H, L, D, trim)}</div>`;
        y += L + 18 + Math.round(rnd() * 40);
      }
      if (!lite)
        for (const [off, h0, h1, y0, gap] of [
          [250, 280, 400, 0, 12],
          [470, 340, 430, 150, 30],
        ])
          for (let y = y0; y < LEN - 200; ) {
            const L = 260 + Math.round(rnd() * 300);
            const H = h0 + Math.round(rnd() * (h1 - h0)); // выше передних домов, но ниже верхней границы экрана
            const D = 160 + Math.round(rnd() * 60);
            houses += `<div class="w3-bld ${sideCls} w3-back" style="left:${x + out * off}px;bottom:${y}px;height:${L}px;--h:${H}px;--d:${D}px;--side:#1d1926;--trim:#2c2636"><div class="w3-wall ${sideCls} w3-back" style="width:${H}px;height:${L}px;background-image:${wallSvg('back', H, L)}"></div><i class="w3-roof"></i>${off < 400 ? '<i class="w3-endf"></i>' : ''}</div>`;
            y += L + gap + Math.round(rnd() * gap);
          }
    }
    // Ретро-машины 50-х: одна стоячая картинка на машину, объём нарисован прямыми линиями — торец кузова,
    // крышка багажника (или капот) и кабина сужаются вдаль. От нас — корма с плавниками и красными фонарями,
    // навстречу — морда с решёткой и фарами. Лёгкие для браузера; на телефоне (lite) машин нет.
    const CAR_COLORS = ['#b8323f', '#2a8a8f', '#d9c48f', '#5a7fbf', '#8c4a9c'];
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
    };
    const retroCar = (come, c) => {
      const p = (pts, fill) => `<polygon points="${pts}" fill="${fill}"/>`;
      const r = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
      const chrome = '#dcd6ca';
      const lamp = come ? '#fff4cc' : '#ff3d3d';
      const glow = come ? 'rgba(255,236,170,.45)' : 'rgba(255,61,61,.42)';
      let s = r(14, 86, 22, 22, '#0b0a0e') + r(114, 86, 22, 22, '#0b0a0e') + r(17, 98, 16, 3, '#cfc8bb') + r(117, 98, 16, 3, '#cfc8bb'); // колёса с белой боковиной
      s += p('22,44 128,44 142,62 8,62', shade(c, 0.3)); // багажник / капот — видно сверху
      s += p('6,62 144,62 146,90 4,90', shade(c, -0.2)); // торец кузова
      s += r(6, 62, 138, 4, shade(c, 0.08)); // ребро
      s += come
        ? p('6,62 32,62 28,53 10,53', shade(c, 0.16)) + p('144,62 118,62 122,53 140,53', shade(c, 0.16)) // крылья над фарами
        : p('6,62 22,62 13,36', shade(c, 0.12)) + p('144,62 128,62 137,36', shade(c, 0.12)); // плавники
      s += p('30,44 120,44 106,18 44,18', shade(c, -0.06)); // кабина
      s += p('38,42 112,42 101,22 49,22', 'rgba(150,190,255,.5)'); // стекло
      s += p('44,18 106,18 100,10 50,10', shade(c, 0.42)); // крыша
      s += r(2, 82, 146, 7, chrome); // бампер
      if (come) {
        s += r(6, 63, 34, 17, glow) + r(110, 63, 34, 17, glow);
        s += r(10, 66, 12, 10, lamp) + r(25, 67, 9, 8, lamp) + r(128, 66, 12, 10, lamp) + r(116, 67, 9, 8, lamp);
        s += r(44, 66, 62, 14, '#1a1720');
        for (let x = 48; x < 104; x += 7) s += r(x, 67, 1.5, 12, chrome); // решётка
        s += p('72,44 78,44 75,37', chrome); // фигурка на капоте
      } else {
        s += r(6, 63, 28, 17, glow) + r(116, 63, 28, 17, glow);
        s += r(10, 67, 20, 9, lamp) + r(120, 67, 20, 9, lamp);
        s += r(36, 72, 78, 1.5, chrome) + r(64, 70, 22, 10, '#e8dfc6'); // молдинг и номер
      }
      return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 110" width="150" height="110">${s}</svg>`)}')`;
    };
    // полосы: на правой дороге — от нас (780) и навстречу (925), на левой — навстречу; две машины в одной полосе
    // едут с одной скоростью через полцикла — не наезжают друг на друга
    const lanes = [
      [xRoadR + ROAD * 0.25, false, 9.4, 0],
      [xRoadR + ROAD * 0.75, true, 7.4, -2.5],
      [xRoadL + ROAD * 0.25, true, 10.5, -5.8],
      [xRoadR + ROAD * 0.25, false, 9.4, -4.7],
    ];
    // Машины ездят по всей улице сами по себе — с постоянной скоростью, как бы быстро ни листали аллею.
    // Время из lanes — за отрезок видимости (FAR); на всю улицу — во столько же раз дольше, а машин в полосе
    // столько, чтобы плотность движения была прежней. Позади камеры и дальше видимого машина скрыта
    // (иначе вблизи «камеры» браузер растягивал бы её в огромную картинку — аллея подтормаживала).
    const CAR_SPAN = LEN + 640; // от 320px позади начала улицы до 320px за её концом
    const carK = Math.max(1, Math.min(3, Math.round(CAR_SPAN / (FAR + 640))));
    const carList = lanes.flatMap(([left, come, t], li) =>
      Array.from({ length: carK }, (_, j) => {
        const T = (t * CAR_SPAN) / (FAR + 640);
        return { left, come, T, d: -(((li * 0.37 + j / carK) % 1) * T), color: CAR_COLORS[(li + j) % CAR_COLORS.length] };
      })
    );
    const cars = lite
      ? ''
      : `<div class="w3-traffic" style="--len:${LEN}px">${carList
          .map((c) => `<div class="w3-car ${c.come ? 'come' : 'away'}" style="--d:${c.d.toFixed(2)}s;--t:${c.T.toFixed(2)}s;left:${c.left}px"><div class="w3-bb w3-rc" style="background-image:${retroCar(c.come, c.color)}"></div></div>`)
          .join('')}</div>`;
    // Дальний город у подножия холма: силуэты домов с редкими огнями — связывают улицу и гору
    function cityImg() {
      let r = '';
      for (let x = 0; x < 800; ) {
        const w = 18 + Math.round(rnd() * 30);
        const h = 16 + Math.round(rnd() * 46);
        r += `<rect x="${x}" y="${80 - h}" width="${w}" height="${h}" fill="#251a31"/>`;
        for (let wy = 84 - h; wy < 76; wy += 7) for (let wx = x + 4; wx < x + w - 4; wx += 6) if (rnd() < 0.28) r += `<rect x="${wx}" y="${wy}" width="2" height="3" fill="#ffcf7a" opacity=".7"/>`;
        x += w + 2;
      }
      return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 80" preserveAspectRatio="none">${r}</svg>`)}')`;
    }
    // Ремонт в конце тротуара: две пустые «формы» под звёзды (пунктир), конусы, полосатые заграждения и табличка
    function roadworks() {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const R = i % 2 ? 50 : 122;
        return `${(130 + R * Math.cos(a)).toFixed(1)},${(132 + R * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      const mold = `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 250"><polygon points="${pts}" fill="rgba(233,196,106,.06)" stroke="#e9c46a" stroke-opacity=".55" stroke-width="5" stroke-dasharray="16 11" stroke-linejoin="round"/><text x="130" y="142" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="20" fill="#e9c46a" fill-opacity=".6">СКОРО</text></svg>`)}')`;
      const barrier = `url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 74"><rect x="12" y="24" width="7" height="50" fill="#9a958c"/><rect x="111" y="24" width="7" height="50" fill="#9a958c"/><rect x="2" y="12" width="126" height="22" fill="#f4efe6"/><polygon points="2,12 20,12 2,34" fill="#e0453a"/><polygon points="34,12 52,12 30,34 12,34" fill="#e0453a"/><polygon points="66,12 84,12 62,34 44,34" fill="#e0453a"/><polygon points="98,12 116,12 94,34 76,34" fill="#e0453a"/><polygon points="128,12 128,34 108,34" fill="#e0453a"/><rect x="2" y="44" width="126" height="10" fill="#f4efe6"/><rect x="58" y="2" width="14" height="10" fill="#ffae2e"/></svg>')}')`;
      const cone = `url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56"><polygon points="16,2 24,2 34,50 6,50" fill="#ff7a1a"/><polygon points="13,18 27,18 29,28 11,28" fill="#f4efe6"/><rect x="1" y="49" width="38" height="7" fill="#2a2630"/></svg>')}')`;
      let s = `<div class="w3-mold" style="bottom:${z}px;left:${C}px;transform:translateX(-34px);background-image:${mold}"></div>`;
      s += `<div class="w3-mold" style="bottom:${z + 300}px;left:${C}px;transform:translateX(34px);background-image:${mold}"></div>`;
      for (const x of [C - 180, C - 60, C + 60, C + 180]) s += `<div class="w3-bb w3-cone" style="bottom:${zb - 70}px;left:${x}px;background-image:${cone}"></div>`;
      for (const x of [C - 140, C, C + 140]) s += `<div class="w3-bb w3-barrier" style="bottom:${zb}px;left:${x}px;background-image:${barrier}"><i></i></div>`;
      s += `<div class="w3-bb w3-works" style="bottom:${zb + 70}px;left:${C}px"><div><b>Ремонт аллеи</b><span>Скоро здесь появятся новые звёзды</span></div></div>`;
      return s;
    }
    // на телефоне баннер с горой — отдельной карточкой над экраном (в самом экране только вид сверху)
    host.innerHTML = `${phone ? `<div class="w3-banner">${fameSceneHtml('')}</div>` : ''}<div class="w3${lite ? ' lite' : ''}${lowfx ? ' lowfx' : ''}${phone ? ' phone' : ''}${firstShow ? ' loading' : ''}" style="--len:${LEN}px">
      <div class="w3-sky">${fameSceneHtml('').replace('xMidYMax slice', 'xMidYMid slice') /* полоса неба низкая — гору по центру, чтобы буквы не обрезались */}<div class="w3-city" style="background-image:${cityImg()}"></div></div>
      <div class="w3-view">
        <div class="w3-move">
          <div class="w3-floor" style="height:${LEN}px;width:${W}px">
            <div class="w3-side l" style="left:0;width:${SIDE}px"></div><div class="w3-road left" style="left:${xRoadL}px;width:${ROAD}px"><span class="w3-dash"></span></div><div class="w3-grass" style="left:${xGrassL}px;width:${GRASS}px"></div><div class="w3-walkway" style="left:${xWalk}px;width:${WALK}px"></div><div class="w3-grass right" style="left:${xGrassR}px;width:${GRASS}px"></div><div class="w3-road" style="left:${xRoadR}px;width:${ROAD}px"><span class="w3-dash"></span></div><div class="w3-side" style="left:${xSideR}px;width:${SIDE}px"></div>
            ${rows
              .map((r, i) =>
                r.sign
                  ? // уличный указатель на перекрёстке: столб и объёмная табличка с названием бульвара, повёрнутая к тротуару
                    `<div class="w3-bb w3-post" style="bottom:${r.z}px;left:${xGrassR - 70}px"><i class="w3-pole"></i><i class="w3-finial"></i><span class="w3-plate a"><small>${escH(r.sign.split(' ')[0])}</small> ${escH(r.sign.split(' ').slice(1).join(' '))}<i class="pl-l"></i><i class="pl-r"></i><i class="pl-back"></i></span></div>`
                  : `<button type="button" class="w3-star${i % 2 ? ' alt' : ''}" style="bottom:${r.z}px;left:${C}px" data-w3="${i}" aria-label="${escH(r.title)} — рассмотреть">${r.star}</button>`
              )
              .join('')}
            ${roadworks()}
          </div>
        </div>
        <div class="w3-fog"></div>
      </div>
      <div class="w3-ctl"><span class="w3-hint">Листайте, чтобы идти по аллее</span>${rows.filter((r) => r.sign).map((r) => `<button type="button" class="btn small w3-jump" data-jump="${r.z}">${escH(r.sign).replace(/^(\S+\s)/, '<span class="w3-jpre">$1</span>')}</button>`).join('')}${phone ? '' : '<button type="button" class="btn small w3-cam" aria-pressed="false" title="Посмотреть на аллею сверху"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 15l8 4 8-4M4 10l8 4 8-4-8-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="w3-cam-t">Вид сверху</span></button><button type="button" class="btn small w3-full" title="На весь экран" aria-label="На весь экран"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'}<button type="button" class="btn small w3-auto">▶ Прогуляться</button></div>
      <div class="w3-hud">
        <div class="w3-cap" aria-live="polite"></div>
        <div class="w3-prog"><span></span></div>
      </div>
      ${firstShow ? '<div class="w3-load" aria-hidden="true"><span class="w3-load-star">★</span><b>Аллея готовится…</b><i class="w3-load-bar"><i></i></i></div>' : ''}
    </div>`;
    const w3 = host.querySelector('.w3');
    const view = w3.querySelector('.w3-view');
    const move = w3.querySelector('.w3-move');
    const floor = w3.querySelector('.w3-floor');
    const cap = w3.querySelector('.w3-cap');
    const prog = w3.querySelector('.w3-prog span');
    const autoBtn = w3.querySelector('.w3-auto');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pos = Math.min(host._pos || 0, maxPos);
    let target = pos;
    let raf = 0;
    // Камера: вид с аллеи или сверху — угол плавно меняется; выбор переживает перерисовку
    const camBtn = w3.querySelector('.w3-cam');
    let topView = phone || !!host._top;
    let tilt = topView ? W3_TILT_TOP : W3_TILT;
    let tiltShown = null;
    const setCam = (on) => {
      topView = on;
      if (!phone) host._top = on;
      w3.classList.toggle('w3-topview', on); // не «top»: так называется шапка страницы
      if (!camBtn) return;
      camBtn.setAttribute('aria-pressed', String(on));
      camBtn.querySelector('.w3-cam-t').textContent = on ? 'Вид с аллеи' : 'Вид сверху';
      camBtn.title = on ? 'Вернуться на аллею' : 'Посмотреть на аллею сверху';
    };
    setCam(topView);
    let auto = false;
    let shown = -2;
    // Размер меряем только при изменении окна, а не каждый кадр
    let sc = 1;
    const measure = () => {
      const w = w3.clientWidth || 760;
      // на телефоне — крупнее; на компьютере — не больше обычного размера, чтобы дома не заслоняли гору
      sc = w < 620 ? w / 520 : Math.min(1, w / 760);
      // горизонт — на 15% высоты под полосой кнопок; область улицы начинается выше (от полосы кнопок),
      // чтобы высокие дома не срезались ровной линией, а плавно растворялись над горизонтом
      const bar = w3.querySelector('.w3-ctl')?.offsetHeight || 52;
      w3.style.setProperty('--vshift', `${Math.round(((w3.clientHeight || 600) - bar) * 0.15)}px`);
    };
    measure();
    // Показываем только ближнюю часть улицы: что позади или слишком далеко — скрыто и не рисуется.
    // Сама дорога тянется до горизонта, а даль прячет дымка — никаких щитов-задников.
    // Показанное не прячется сразу, как только выйдет из окна, а держится с большим запасом (KEEP):
    // браузеру не приходится снова и снова рисовать одни и те же дома, когда ходишь туда-сюда, —
    // каждый дом рисуется один раз и дальше просто стоит. Прячется только то, что далеко позади или впереди.
    const NEAR = 450;
    const KEEP = 1600;
    const DETAIL = 2400;
    let cull = [];
    let traffic = null;
    let bucket = null;
    const collect = () => {
      cull = [...floor.children]
        .filter((el) => el.style.bottom)
        .map((el) => {
          const a = parseFloat(el.style.bottom);
          return { el, a, b: a + (parseFloat(el.style.height) || 260), on: true, deco: el.querySelector(':scope > .w3-f, :scope > .w3-roofbb') ? true : null };
        });
      traffic = [...floor.querySelectorAll('.w3-car')].map((el) => ({ el, come: el.classList.contains('come'), on: true, anim: null }));
      bucket = null;
    };
    let carsAt = -1e9;
    // где сейчас каждая машина (по ходу её анимации): позади камеры и дальше видимого — скрыта
    // Анимацию каждой машины находим один раз: поиск заново на каждом кадре заставлял браузер
    // пересчитывать стили всей улицы.
    const carsNow = () => {
      if (!traffic) return;
      carsAt = pos;
      for (const c of traffic) {
        if (!c.anim) c.anim = c.el.getAnimations?.().find((x) => /w3-(away|come)/.test(x.animationName || '')) || null;
        const p = c.anim?.effect?.getComputedTiming?.().progress;
        if (p == null) continue;
        const z = c.come ? LEN + 320 - p * CAR_SPAN : -320 + p * CAR_SPAN;
        const on = z > pos - 260 && z < pos + FAR;
        if (on !== c.on) {
          c.on = on;
          c.el.style.visibility = on ? '' : 'hidden';
        }
      }
    };
    const cullNow = () => {
      const k = Math.round(pos / 120);
      if (k === bucket) return;
      bucket = k;
      for (const c of cull) {
        // показать — как только подошли к окну; спрятать — только когда ушли далеко за его край
        const on = c.on ? c.b > pos - NEAR - KEEP && c.a < pos + FAR + KEEP : c.b > pos - NEAR && c.a < pos + FAR;
        if (on !== c.on) {
          c.on = on;
          c.el.style.display = on ? '' : 'none';
        }
        // детали дома — только в ближних DETAIL px (тоже с запасом, чтобы не мигали на границе)
        if (c.deco !== null) {
          const d = c.deco ? c.a < pos + DETAIL + 500 : c.a < pos + DETAIL;
          if (d !== c.deco) {
            c.deco = d;
            c.el.classList.toggle('w3-far', !d);
          }
        }
      }
    };
    const apply = () => {
      host._pos = pos;
      cullNow();
      // сверху камера подходит ближе, чтобы надписи на звёздах читались (на телефоне — ещё ближе)
      const zoom = 1 + ((phone ? 1.2 : 0.9) - 1) * ((W3_TILT - tilt) / (W3_TILT - W3_TILT_TOP));
      floor.style.transform = `translateX(-50%) scale(${(sc * zoom).toFixed(4)}) rotateX(${tilt.toFixed(2)}deg) translateY(${pos}px)`;
      // стоящие предметы (фонари, пальмы, указатели, машины) поворачиваются на тот же угол — стоят ровно
      if (tilt !== tiltShown) w3.style.setProperty('--tilt', (tiltShown = tilt).toFixed(2));
      if (Math.abs(pos - carsAt) > 80) carsNow(); // машины проверяем, когда заметно сдвинулись (и по таймеру)
      move.style.transform = reduce ? '' : `translateY(${(Math.sin(pos / 85) * 1.8).toFixed(2)}px)`; // покачивание шага
      prog.style.width = maxPos ? `${((pos / maxPos) * 100).toFixed(1)}%` : '0%';
      // у какой звезды стоим: ближайшая впереди, в «зоне взгляда»
      let best = -1;
      let bd = Infinity;
      rows.forEach((r, i) => {
        if (r.sign) return;
        // сверху «зона взгляда» дальше по тротуару: камера смотрит вниз, ближняя часть внизу экрана
        const d = r.z - pos - (170 + ((W3_TILT - tilt) / (W3_TILT - W3_TILT_TOP)) * 60);
        if (d > -140 && Math.abs(d) < bd) {
          bd = Math.abs(d);
          best = i;
        }
      });
      if (best !== shown) {
        shown = best;
        const r = rows[best];
        cap.innerHTML = r ? `<b>★ ${escH(r.title)}</b>${r.sub ? `<span>${r.sub}</span>` : ''}<button type="button" class="btn small w3-look" data-w3="${best}">Рассмотреть</button>` : '<b>Ремонт аллеи</b><span>Скоро здесь появятся новые звёзды: ставьте их любимым каналам и роликам</span><button type="button" class="btn small primary w3-rungo" title="Мини-игра: забег от машин с аватарками каналов">🏃 Прорваться</button>';
        floor.querySelectorAll('.w3-star.near').forEach((s) => s.classList.remove('near'));
        floor.querySelector(`.w3-star[data-w3="${best}"]`)?.classList.add('near');
      }
    };
    const tick = () => {
      raf = 0;
      if (auto) {
        target = Math.min(maxPos, target + 1.6);
        if (target >= maxPos) setAuto(false);
      }
      pos += (target - pos) * (reduce ? 1 : 0.12);
      const tiltTo = topView ? W3_TILT_TOP : W3_TILT;
      tilt = reduce || Math.abs(tiltTo - tilt) < 0.05 ? tiltTo : tilt + (tiltTo - tilt) * 0.1;
      apply();
      if (auto || Math.abs(target - pos) > 0.3 || tilt !== tiltTo) raf = requestAnimationFrame(tick);
    };
    // на весь экран (браузер может не разрешить — тогда просто ничего не происходит)
    w3.querySelector('.w3-full')?.addEventListener('click', () => {
      const p = document.fullscreenElement ? document.exitFullscreen?.() : w3.requestFullscreen?.();
      p?.catch?.(() => {});
    });
    camBtn?.addEventListener('click', () => {
      setCam(!topView);
      bucket = null;
      if (!raf) raf = requestAnimationFrame(tick);
    });
    const go = (d) => {
      target = Math.max(0, Math.min(maxPos, target + d));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    function setAuto(on) {
      auto = on;
      autoBtn.textContent = on ? '❚❚ Стоп' : '▶ Прогуляться';
      if (on && target >= maxPos) target = pos = 0; // дошли до конца — с начала
      if (on && !raf) raf = requestAnimationFrame(tick);
    }
    autoBtn.addEventListener('click', () => setAuto(!auto));
    // Забег за ремонтом: на время игры аллея спрятана под холстом и стоит (анимации на паузе, машины не считаются)
    let gaming = false;
    const startRun = () => {
      if (gaming) return;
      setAuto(false);
      cancelAnimationFrame(raf);
      raf = 0;
      gaming = true;
      w3.classList.add('w3-game');
      host.classList.add('w3-gaming');
      let list = typeof racers === 'function' ? racers() : racers;
      if (!list?.length) list = rows.filter((r) => r.kind === 'ch' && r.name).map((r) => ({ name: r.name }));
      fameRun(w3, {
        racers: list,
        lowfx,
        onExit: () => {
          gaming = false;
          w3.classList.remove('w3-game');
          host.classList.remove('w3-gaming');
          measure();
          bucket = null;
          apply();
          w3.focus({ preventScroll: true });
        },
      });
    };
    // переход сразу на нужный бульвар
    w3.addEventListener('click', (e) => {
      if (e.target.closest('.w3-rungo')) return startRun();
      const j = e.target.closest('[data-jump]');
      if (!j) return;
      setAuto(false);
      target = Math.max(0, Math.min(maxPos, Number(j.dataset.jump) - START + 30));
      if (!raf) raf = requestAnimationFrame(tick);
    });
    // Шаги — колесом и свайпом в любом месте рамки (небо, гора, подпись), а не только по тротуару:
    // иначе на телефоне свайп мимо тротуара листал всю страницу. Свайп, начатый на кнопке, — это нажатие.
    w3.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (gaming) return;
        setAuto(false);
        go(e.deltaY * (e.deltaMode === 1 ? 30 : 1) * 0.9);
      },
      { passive: false }
    );
    let lastY = null;
    let moved = 0;
    w3.addEventListener('pointerdown', (e) => {
      moved = 0;
      if (gaming || e.target.closest('.w3-ctl, .w3-cap .btn')) return;
      lastY = e.clientY;
      setAuto(false);
    });
    w3.addEventListener('pointermove', (e) => {
      if (lastY == null || (e.pointerType === 'mouse' && !e.buttons)) return;
      const dy = lastY - e.clientY;
      lastY = e.clientY;
      moved += Math.abs(dy);
      go(dy * 1.7);
    });
    const up = () => (lastY = null);
    w3.addEventListener('pointerup', up);
    w3.addEventListener('pointercancel', up);
    w3.addEventListener('pointerleave', up);
    w3.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w3]');
      if (!b || moved > 8) return; // это был шаг, а не нажатие
      onOpen?.(rows[Number(b.dataset.w3)]);
    });
    w3.tabIndex = 0;
    w3.addEventListener('keydown', (e) => {
      if (gaming) return;
      const k = { ArrowUp: 1, KeyW: 1, ArrowDown: -1, KeyS: -1, PageDown: 3, PageUp: -3 }[e.code];
      if (!k) return;
      e.preventDefault();
      setAuto(false);
      go(k * 220);
    });
    // Постепенная сборка: сначала тротуар и звёзды, потом дома с фонарями, потом машины — в паузах между кадрами,
    // чтобы даже слабое устройство не подвисало; заставка уходит, когда всё на месте
    collect();
    requestAnimationFrame(apply);
    const strips = floor.querySelector('.w3-side:not(.l)'); // последняя полоса улицы: всё остальное — поверх неё
    const stages = [houses + side, cars];
    const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 160 }) : setTimeout(f, 40));
    const nextStage = () => {
      if (!w3.isConnected) return;
      const html = stages.shift();
      if (html) strips.insertAdjacentHTML('afterend', html);
      collect();
      apply();
      if (stages.length) return idle(nextStage);
      const load = w3.querySelector('.w3-load');
      if (!load) return;
      let done = false;
      const reveal = () => {
        if (done) return;
        done = true;
        w3.classList.remove('loading');
        setTimeout(() => load.remove(), 450);
      };
      requestAnimationFrame(() => requestAnimationFrame(reveal)); // после того как сцена нарисована
      setTimeout(reveal, 1500); // страховка: кадры могут не идти (вкладка в фоне)
    };
    idle(nextStage);
    clearInterval(host._cars);
    if (!lite) host._cars = setInterval(() => (!w3.isConnected ? clearInterval(host._cars) : gaming || carsNow()), 200);
    // аллея не на экране (другая вкладка, прокрутили) — все анимации на паузе
    host._io?.disconnect();
    host._ro?.disconnect();
    if (window.IntersectionObserver) {
      host._io = new IntersectionObserver(([e]) => w3.classList.toggle('w3-off', !e.isIntersecting));
      host._io.observe(w3);
    }
    if (window.ResizeObserver) {
      host._ro = new ResizeObserver(() => {
        // окно растянули или сузили через ширину телефона — собираем аллею заново в нужном виде
        const hw = host.clientWidth;
        if (hw > 0 && hw < 620 !== phone) {
          host._sig = '';
          return fameWalk(host, { items, onOpen, lite: liteAsked, racers });
        }
        measure();
        bucket = null;
        if (!gaming) apply();
      });
      host._ro.observe(w3);
    }
    if (!host._resizeBound) {
      host._resizeBound = true;
      addEventListener('resize', () => host.isConnected && host.querySelector('.w3-floor') && (host._sig = '', 0));
    }
  }

  // ---- Забег за ремонтом: мини-игра в конце аллеи ----
  // Человечек прорывает заграждение и бежит, пока его не выбьет машина (или заграждение) с аватаркой канала.
  // Три полосы: левая дорога, тротуар, правая дорога. Один <canvas> поверх аллеи — сама аллея на это время
  // спрятана и стоит. Псевдо-3D, как в старых раннерах: точка (x, высота, z) → экран через перспективу.
  // Всё, что видно, нарисовано заранее (машины с аватарками, человечек, дома, фонари, небо) — в кадре только drawImage.
  // Физика — фиксированным шагом; машины, монетки и обломки — из пулов, в кадре новые объекты не создаются.
  const RUN_BEST = 'fameRunBest';
  // рекорд: без n — прочитать, с n — записать. В расширении — chrome.storage.local, на телефоне — localStorage
  async function runBest(n) {
    try {
      const st = globalThis.chrome?.storage?.local;
      if (n == null) return (st ? (await st.get(RUN_BEST))[RUN_BEST] : Number(localStorage.getItem('smotribelno:' + RUN_BEST))) || 0;
      if (st) await st.set({ [RUN_BEST]: n });
      else localStorage.setItem('smotribelno:' + RUN_BEST, String(n));
    } catch {
      // хранилище недоступно (приватное окно) — рекорд живёт до закрытия
    }
    return n || 0;
  }
  // racers: [{ name, icon }] — каналы для машин; lowfx — слабое устройство; onExit() — вернулись на аллею
  function fameRun(box, { racers = [], lowfx = false, onExit } = {}) {
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const RC = racers.filter((r) => r && String(r.name || '').trim()).slice(0, 16);
    if (!RC.length) RC.push({ name: 'Смотрибельно' });
    const wrap = document.createElement('div');
    wrap.className = 'w3-run';
    wrap.innerHTML = '<canvas></canvas><button type="button" class="wr-x" aria-label="Вернуться на аллею" title="Вернуться на аллею (Esc)">✕</button><div class="wr-over" hidden></div>';
    box.appendChild(wrap);
    const cv = wrap.querySelector('canvas');
    const ctx = cv.getContext('2d', { alpha: false });
    const over = wrap.querySelector('.wr-over');
    const touch = matchMedia('(pointer: coarse)').matches;
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      return c;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rint = (n) => Math.floor(rnd() * n);
    const lerp = (a, b, t) => a + (b - a) * t;
    const FONT = 'Manrope, system-ui, -apple-system, "Segoe UI", sans-serif';
    const PI2 = Math.PI * 2;
    const poly = (g, pts, fill) => {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
    };

    // ---- мир: метры. Полосы по x: −LANE, 0, +LANE; камера в ZP м позади человечка ----
    const LANE = 2.6;
    const ZP = 6;
    const FAR = 150;
    const STEP = 1 / 120;
    const V0 = 14;
    const VMAX = 40;
    const G = 25;
    const JUMP = 9;
    const ROLL = 0.6;

    // ---- аватарки: круг с картинкой канала, если её нет — инициалы ----
    const PAL = ['#b8323f', '#2a8a8f', '#c9a45f', '#5a7fbf', '#8c4a9c', '#c26a2e', '#3f8f5a', '#a8326e'];
    const initials = (name) =>
      String(name)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] || '')
        .join('')
        .toUpperCase() || '?';
    const avaOf = (i, img) => {
      const c = mk(128, 128);
      const g = c.getContext('2d');
      g.beginPath();
      g.arc(64, 64, 60, 0, PI2);
      g.fillStyle = PAL[i % PAL.length];
      g.fill();
      g.save();
      g.clip();
      if (img) {
        const s = Math.max(120 / img.naturalWidth, 120 / img.naturalHeight);
        g.drawImage(img, 64 - (img.naturalWidth * s) / 2, 64 - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      } else {
        const t = initials(RC[i].name);
        g.fillStyle = '#fff';
        g.font = `800 ${t.length > 1 ? 50 : 64}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(t, 64, 68);
      }
      g.restore();
      g.lineWidth = 6;
      g.strokeStyle = '#f4efe6';
      g.stroke();
      return c;
    };
    // Машина 50-х навстречу (как на аллее): решётка, фары, на крыше — круглая табличка с аватаркой канала
    const CAR_W = 2.3;
    const carOf = (i) => {
      const k = 256 / 150;
      const c = mk(256, 140 * k);
      const g = c.getContext('2d');
      g.scale(k, k);
      g.translate(0, 30);
      const col = PAL[i % PAL.length];
      const r = (x, y, w, h, f) => {
        g.fillStyle = f;
        g.fillRect(x, y, w, h);
      };
      const chrome = '#dcd6ca';
      r(14, 86, 22, 22, '#0b0a0e');
      r(114, 86, 22, 22, '#0b0a0e');
      poly(g, [22, 44, 128, 44, 142, 62, 8, 62], shade(col, 0.3));
      poly(g, [6, 62, 144, 62, 146, 90, 4, 90], shade(col, -0.2));
      r(6, 62, 138, 4, shade(col, 0.08));
      poly(g, [6, 62, 32, 62, 28, 53, 10, 53], shade(col, 0.16));
      poly(g, [144, 62, 118, 62, 122, 53, 140, 53], shade(col, 0.16));
      poly(g, [30, 44, 120, 44, 106, 18, 44, 18], shade(col, -0.06));
      poly(g, [38, 42, 112, 42, 101, 22, 49, 22], 'rgba(150,190,255,.55)');
      poly(g, [44, 18, 106, 18, 100, 10, 50, 10], shade(col, 0.42));
      r(2, 82, 146, 7, chrome);
      r(6, 63, 34, 17, 'rgba(255,236,170,.45)');
      r(110, 63, 34, 17, 'rgba(255,236,170,.45)');
      for (const x of [10, 128]) r(x, 66, 12, 10, '#fff4cc');
      for (const x of [25, 116]) r(x, 67, 9, 8, '#fff4cc');
      r(44, 66, 62, 14, '#1a1720');
      for (let x = 48; x < 104; x += 7) r(x, 67, 1.5, 12, chrome);
      // стойка таблички и сама табличка
      r(72, 2, 6, 9, '#2a2630');
      g.drawImage(ava[i], 75 - 25, -26, 50, 50);
      return c;
    };
    // Заграждение пониже — перепрыгнуть; табличка с аватаркой канала-«подрядчика» посередине
    const LOW_W = 2.4;
    const lowSp = (() => {
      const c = mk(260, 112);
      const g = c.getContext('2d');
      g.scale(2, 2);
      g.fillStyle = '#9a958c';
      g.fillRect(12, 20, 7, 36);
      g.fillRect(111, 20, 7, 36);
      g.fillStyle = '#f4efe6';
      g.fillRect(2, 8, 126, 22);
      g.fillStyle = '#e0453a';
      for (let x = -14; x < 130; x += 32) poly(g, [x + 16, 8, x + 34, 8, x + 12, 30, x - 6, 30], '#e0453a');
      g.clearRect(0, 8, 2, 22);
      g.clearRect(128, 8, 2, 22);
      g.fillStyle = '#f4efe6';
      g.fillRect(2, 38, 126, 9);
      g.fillStyle = '#ffae2e';
      g.fillRect(4, 2, 10, 6);
      g.fillRect(116, 2, 10, 6);
      return c;
    })();
    // Шлагбаум — только прокатиться под ним; табличка с аватаркой сверху
    const HIGH_W = 2.4;
    const highSp = (() => {
      const c = mk(260, 240);
      const g = c.getContext('2d');
      g.scale(2, 2);
      g.fillStyle = '#4a4552';
      g.fillRect(4, 30, 8, 90);
      g.fillRect(118, 30, 8, 90);
      g.fillStyle = '#ffae2e';
      g.beginPath();
      g.arc(8, 28, 5, 0, PI2);
      g.arc(122, 28, 5, 0, PI2);
      g.fill();
      g.fillStyle = '#f4efe6';
      g.fillRect(0, 54, 130, 14);
      for (let x = -6; x < 130; x += 22) poly(g, [x + 8, 54, x + 18, 54, x + 10, 68, x, 68], '#e0453a');
      g.fillStyle = '#2a2630';
      g.fillRect(62, 22, 6, 32);
      return c;
    })();
    // заграждение «Ремонт аллеи» из конца аллеи — его человечек и прорывает
    const gateSp = (() => {
      const c = mk(260, 148);
      const g = c.getContext('2d');
      g.scale(2, 2);
      g.fillStyle = '#9a958c';
      g.fillRect(12, 24, 7, 50);
      g.fillRect(111, 24, 7, 50);
      g.fillStyle = '#f4efe6';
      g.fillRect(2, 12, 126, 22);
      for (let x = -14; x < 130; x += 32) poly(g, [x + 16, 12, x + 34, 12, x + 12, 34, x - 6, 34], '#e0453a');
      g.clearRect(0, 12, 2, 22);
      g.clearRect(128, 12, 2, 22);
      g.fillStyle = '#f4efe6';
      g.fillRect(2, 44, 126, 10);
      g.fillStyle = '#ffae2e';
      g.fillRect(58, 2, 14, 10);
      return c;
    })();
    const coinSp = (() => {
      const c = mk(64, 64);
      const g = c.getContext('2d');
      g.beginPath();
      g.arc(32, 32, 29, 0, PI2);
      g.fillStyle = '#c9963f';
      g.fill();
      g.beginPath();
      g.arc(32, 32, 23, 0, PI2);
      g.fillStyle = '#ffd56a';
      g.fill();
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const q = i % 2 ? 6.5 : 15;
        g.lineTo(32 + q * Math.cos(a), 33 + q * Math.sin(a));
      }
      g.fillStyle = '#c9963f';
      g.fill();
      return c;
    })();
    // звёзды-«формы» на тротуаре, как в конце аллеи (вид сверху; в кадре сплющиваются перспективой)
    const moldSp = (() => {
      const c = mk(128, 128);
      const g = c.getContext('2d');
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const q = i % 2 ? 24 : 58;
        g.lineTo(64 + q * Math.cos(a), 68 + q * Math.sin(a));
      }
      g.closePath();
      g.fillStyle = 'rgba(233,196,106,.08)';
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(233,196,106,.45)';
      g.setLineDash([9, 7]);
      g.stroke();
      return c;
    })();
    const lampSp = (() => {
      const c = mk(96, 400);
      const g = c.getContext('2d');
      if (!lowfx) {
        const gr = g.createRadialGradient(48, 62, 2, 48, 62, 46);
        gr.addColorStop(0, 'rgba(255,214,140,.75)');
        gr.addColorStop(1, 'rgba(255,214,140,0)');
        g.fillStyle = gr;
        g.fillRect(0, 10, 96, 104);
      }
      g.fillStyle = '#2a2630';
      g.fillRect(44, 70, 8, 330);
      g.fillRect(34, 384, 28, 16);
      poly(g, [30, 76, 66, 76, 60, 44, 36, 44], '#2a2630');
      g.beginPath();
      g.arc(48, 62, 9, 0, PI2);
      g.fillStyle = '#ffe2a0';
      g.fill();
      return c;
    })();
    const palmSp = (() => {
      const c = mk(200, 360);
      const g = c.getContext('2d');
      g.lineCap = 'round';
      g.strokeStyle = '#3a2a22';
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(100, 360);
      g.bezierCurveTo(104, 280, 110, 180, 118, 90);
      g.stroke();
      g.strokeStyle = '#1f5a3a';
      g.lineWidth = 9;
      for (const [x, y] of [[-70, 10], [-54, -26], [-12, -50], [40, -38], [70, 0], [36, 40], [-36, 36]]) {
        g.beginPath();
        g.moveTo(118, 90);
        g.quadraticCurveTo(118 + x * 0.55, 90 + y - 26, 118 + x, 90 + y);
        g.stroke();
      }
      return c;
    })();
    // Дома Лас-Вегаса по сторонам — фасады к зрителю, по 8 видов: стена, окна, неоновая вывеска, витрина внизу
    const WALLS = ['#4a1f4f', '#1f3f5a', '#5a3a1f', '#3a2a5f', '#5a1f35', '#1f4a45', '#2a3350', '#4f2a2a'];
    const TRIMS = ['#ff5fa2', '#5fe1ff', '#ffc85f', '#b28bff', '#ff6b5f', '#5fffb0', '#7fb2ff', '#ff8a3d'];
    const WORDS = ['КАЗИНО', 'КИНО', 'ОТЕЛЬ', 'БАР', 'ТЕАТР', 'ДИСКО', 'ШОУ', 'РАДИО'];
    const BLD_W = 7;
    const bld = WALLS.map((wall, i) => {
      const H = 300 + rint(5) * 40;
      const c = mk(200, H);
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 200, 0);
      gr.addColorStop(0, shade(wall, 0.12));
      gr.addColorStop(1, shade(wall, -0.35));
      g.fillStyle = gr;
      g.fillRect(0, 0, 200, H);
      g.fillStyle = TRIMS[i];
      g.fillRect(0, 0, 200, 6);
      for (let y = 78; y < H - 70; y += 30) for (let x = 16; x < 184; x += 34) {
        g.fillStyle = rnd() < 0.38 ? (rnd() < 0.5 ? '#ffd27a' : '#ffb85c') : '#120f17';
        g.fillRect(x, y, 20, 16);
      }
      // неоновая вывеска
      g.fillStyle = 'rgba(10,8,14,.85)';
      g.fillRect(14, 18, 172, 46);
      g.font = `800 ${WORDS[i].length > 5 ? 30 : 36}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = TRIMS[i];
      g.shadowBlur = 12;
      g.fillStyle = TRIMS[i];
      g.fillText(WORDS[i], 100, 43);
      g.shadowBlur = 0;
      // витрина и дверь
      g.fillStyle = shade(wall, -0.5);
      g.fillRect(0, H - 62, 200, 62);
      g.fillStyle = '#ffcf7a';
      g.fillRect(12, H - 52, 70, 40);
      g.fillRect(118, H - 52, 70, 40);
      g.fillStyle = '#2a1a12';
      g.fillRect(88, H - 56, 24, 56);
      return c;
    });

    // ---- аватарки грузим сразу; пока не загрузилась — инициалы, потом машина перерисовывается ----
    const ava = RC.map((_, i) => avaOf(i, null));
    const carSp = RC.map((_, i) => carOf(i));
    const avaOk = RC.map(() => false);
    RC.forEach((rc, i) => {
      if (!rc.icon) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => {
        if (!img.naturalWidth) return;
        ava[i] = avaOf(i, img);
        carSp[i] = carOf(i);
        avaOk[i] = true;
      };
      img.src = rc.icon;
    });

    // ---- экран: размеры, перспектива, небо и человечек — пересобираются при смене размера ----
    let W = 0;
    let H = 0;
    let Q = 1;
    let hy = 0; // горизонт
    let F = 1; // фокус: пикселей на метр на расстоянии 1 м
    let CH = 3; // высота камеры
    let sky = null;
    let skyX = 0;
    let haze = null;
    let pl = null; // кадры человечка
    let PW = 0;
    let PHt = 0;
    let shadowSp = null;
    let hudFont = '';
    let hudSmall = '';
    const layout = () => {
      W = Math.max(240, wrap.clientWidth || 640);
      H = Math.max(240, wrap.clientHeight || 480);
      Q = lowfx ? 0.75 : Math.min(devicePixelRatio || 1, 2);
      Q = Math.min(Q, Math.sqrt(2600000 / (W * H))); // огромный экран — не больше ~2,6 млн точек: кадр успевает
      cv.width = Math.round(W * Q);
      cv.height = Math.round(H * Q);
      hy = H * (W < H ? 0.22 : 0.3);
      const span = Math.min(W * 0.84, H * 1.3); // три полосы — по ширине экрана у человечка
      F = (span * ZP) / (3 * LANE);
      CH = ((H * 0.84 - hy) * ZP) / F;
      // небо: градиент, прожекторы, холм с надписью СМОТРИБЕЛЬНО, дальний город на горизонте
      const BW = W * 1.3;
      sky = mk(BW * Q, hy * Q + 2);
      skyX = (W - BW) / 2;
      const g = sky.getContext('2d');
      g.scale(Q, Q);
      const gr = g.createLinearGradient(0, 0, 0, hy);
      gr.addColorStop(0, '#0b0816');
      gr.addColorStop(0.7, '#2a1838');
      gr.addColorStop(1, '#4a2550');
      g.fillStyle = gr;
      g.fillRect(0, 0, BW, hy + 2);
      g.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 0; i < 70; i++) g.fillRect(rnd() * BW, rnd() * hy * 0.6, 1.2, 1.2);
      if (!lowfx)
        for (const [x, a] of [[0.25, -0.35], [0.7, 0.3]]) {
          g.save();
          g.translate(BW * x, hy);
          g.rotate(a);
          const bg = g.createLinearGradient(0, 0, 0, -hy * 1.2);
          bg.addColorStop(0, 'rgba(196,181,253,.28)');
          bg.addColorStop(1, 'rgba(196,181,253,0)');
          g.fillStyle = bg;
          g.beginPath();
          g.moveTo(-6, 0);
          g.lineTo(6, 0);
          g.lineTo(40, -hy * 1.2);
          g.lineTo(-40, -hy * 1.2);
          g.fill();
          g.restore();
        }
      const hill = (y0, amp, col) => {
        g.beginPath();
        g.moveTo(0, hy + 2);
        for (let x = 0; x <= BW; x += BW / 24) g.lineTo(x, y0 - amp * (0.5 + 0.5 * Math.sin(x / (BW / 5.3) + y0)));
        g.lineTo(BW, hy + 2);
        g.fillStyle = col;
        g.fill();
      };
      hill(hy * 0.66, hy * 0.18, '#211630');
      // надпись на холме
      const word = 'СМОТРИБЕЛЬНО';
      const fs = Math.min(hy * 0.16, W / 22);
      g.font = `800 ${fs}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const step = fs * 0.95;
      for (let i = 0; i < word.length; i++) {
        const x = BW / 2 + (i - (word.length - 1) / 2) * step;
        const y = hy * 0.6 + [0, -2, 1, -1, 2, -1, 2, -2, 0, 1, -2, 1][i] * fs * 0.06;
        g.fillStyle = '#e8e2f0';
        g.fillText(word[i], x, y);
      }
      hill(hy * 0.84, hy * 0.1, '#1a1226');
      for (let x = 0; x < BW; ) {
        const w = 14 + rnd() * 26;
        const h = hy * (0.04 + rnd() * 0.12);
        g.fillStyle = '#251a31';
        g.fillRect(x, hy - h, w, h + 2);
        g.fillStyle = 'rgba(255,207,122,.7)';
        for (let wy = hy - h + 3; wy < hy - 3; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (rnd() < 0.25) g.fillRect(wx, wy, 1.6, 2.2);
        x += w + 2;
      }
      // дымка у горизонта — одна заранее заготовленная полоса
      haze = ctx.createLinearGradient(0, hy - H * 0.04, 0, hy + H * 0.14);
      haze.addColorStop(0, 'rgba(74,37,80,0)');
      haze.addColorStop(0.3, 'rgba(74,37,80,.8)');
      haze.addColorStop(1, 'rgba(74,37,80,0)');
      // человечек — всегда на одном расстоянии от камеры, поэтому его кадры рисуются сразу в нужном размере
      PHt = (1.8 * F) / ZP;
      PW = PHt * 0.9;
      pl = mk(PW * Q * 9, PHt * 1.1 * Q);
      const p = pl.getContext('2d');
      p.scale(Q, Q);
      for (let fr = 0; fr < 9; fr++) {
        p.save();
        p.translate(fr * PW + PW / 2 - PHt / 2, PHt * 0.05);
        p.scale(PHt / 100, PHt / 100);
        runner(p, fr);
        p.restore();
      }
      shadowSp = mk(PW * Q, PHt * 0.3 * Q);
      const s = shadowSp.getContext('2d');
      s.scale(Q, Q);
      s.fillStyle = 'rgba(0,0,0,.4)';
      s.beginPath();
      s.ellipse(PW / 2, PHt * 0.15, PW * 0.34, PHt * 0.07, 0, 0, PI2);
      s.fill();
      const hs = Math.round(Math.max(16, Math.min(30, W / 26)));
      hudFont = `800 ${hs}px ${FONT}`;
      hudSmall = `700 ${Math.round(hs * 0.55)}px ${FONT}`;
    };
    // Человечек со спины (в единицах: рост 100). Кадры 0–5 — бег, 6 — прыжок, 7 — перекат, 8 — сбит
    function runner(p, fr) {
      const skin = '#e0a982';
      const shirt = '#7c3aed';
      const jeans = '#2b3a67';
      const shoe = '#f4efe6';
      p.lineCap = 'round';
      p.lineJoin = 'round';
      const limb = (x0, y0, x1, y1, w, c) => {
        p.strokeStyle = c;
        p.lineWidth = w;
        p.beginPath();
        p.moveTo(x0, y0);
        p.lineTo(x1, y1);
        p.stroke();
      };
      const dot = (x, y, r, c) => {
        p.fillStyle = c;
        p.beginPath();
        p.arc(x, y, r, 0, PI2);
        p.fill();
      };
      if (fr === 7) {
        // перекат — клубком у земли
        dot(50, 84, 20, shirt);
        p.strokeStyle = '#a78bfa';
        p.lineWidth = 3;
        p.beginPath();
        p.arc(50, 84, 13, 0.4, 2.6);
        p.stroke();
        dot(50, 68, 10, '#3a2418');
        p.fillStyle = '#e9c46a';
        p.beginPath();
        p.arc(50, 66, 10, Math.PI, PI2);
        p.fill();
        limb(36, 100, 44, 102, 7, shoe);
        limb(56, 102, 64, 100, 7, shoe);
        return;
      }
      const a = (fr / 6) * PI2;
      const jump = fr === 6 || fr === 8;
      const bob = jump ? 0 : Math.abs(Math.sin(a)) * 2.5;
      const up = (k) => Math.max(0, k) * 16;
      // ноги
      if (jump) {
        limb(44, 60, 38, 74, 9, jeans);
        limb(38, 74, 42, 88, 9, jeans);
        limb(56, 60, 62, 76, 9, jeans);
        limb(62, 76, 60, 90, 9, jeans);
        limb(39, 90, 45, 90, 8, shoe);
        limb(57, 92, 63, 92, 8, shoe);
      } else {
        const lL = up(Math.sin(a));
        const lR = up(-Math.sin(a));
        limb(44, 60 - bob, 43, 97 - lL, 9.5, jeans);
        limb(56, 60 - bob, 57, 97 - lR, 9.5, jeans);
        limb(40, 99 - lL, 47, 99 - lL, lL > 4 ? 9 : 7, shoe);
        limb(53, 99 - lR, 60, 99 - lR, lR > 4 ? 9 : 7, shoe);
      }
      // руки
      const sw = jump ? 0 : Math.sin(a) * 9;
      const ay = 30 - bob;
      if (fr === 8) {
        limb(37, ay + 4, 22, ay - 14, 7, shirt);
        limb(63, ay + 4, 78, ay - 14, 7, shirt);
        dot(21, ay - 16, 4, skin);
        dot(79, ay - 16, 4, skin);
      } else if (jump) {
        limb(37, ay + 4, 25, ay - 6, 7, shirt);
        limb(63, ay + 4, 75, ay - 6, 7, shirt);
        dot(24, ay - 8, 4, skin);
        dot(76, ay - 8, 4, skin);
      } else {
        limb(37, ay + 4, 30, ay + 22 + sw, 7, shirt);
        limb(63, ay + 4, 70, ay + 22 - sw, 7, shirt);
        dot(30, ay + 25 + sw, 4, skin);
        dot(70, ay + 25 - sw, 4, skin);
      }
      // туловище и рюкзак
      p.fillStyle = shirt;
      p.beginPath();
      p.roundRect ? p.roundRect(35, ay, 30, 34, 8) : p.rect(35, ay, 30, 34);
      p.fill();
      p.fillStyle = '#5b21b6';
      p.fillRect(35, ay + 26, 30, 5);
      p.fillStyle = '#e9c46a';
      p.beginPath();
      p.roundRect ? p.roundRect(41, ay + 5, 18, 20, 5) : p.rect(41, ay + 5, 18, 20);
      p.fill();
      p.fillStyle = '#c9963f';
      p.fillRect(41, ay + 12, 18, 3);
      // голова: волосы и кепка козырьком назад
      dot(50, ay - 11, 11, '#3a2418');
      dot(39, ay - 10, 3, skin);
      dot(61, ay - 10, 3, skin);
      p.fillStyle = '#e9c46a';
      p.beginPath();
      p.arc(50, ay - 13, 11.5, Math.PI, PI2);
      p.fill();
      p.fillRect(44, ay - 4, 12, 4);
    }

    // ---- состояние игры ----
    // предметы: kind 1 — машина, 2 — низкое заграждение, 3 — шлагбаум, 4 — монетка, 5 — заграждение ремонта
    const pool = Array.from({ length: 160 }, () => ({ on: false, kind: 0, lane: 0, wz: 0, row: 0, vc: 0, len: 0, r: 0, y: 0, z: 0 }));
    const bits = Array.from({ length: 20 }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, a: 0, va: 0, w: 0, h: 0, c: '' }));
    const act = new Array(pool.length); // видимые в этом кадре, по удалению
    let phase = 'intro'; // intro → run → hit → over; paused — отдельным флагом
    let paused = false;
    let t = 0;
    let tRun = 0;
    let dist = 0;
    let v = 0;
    let lane = 1;
    let px = 0;
    let py = 0;
    let vy = 0;
    let roll = 0;
    let camX = 0;
    let coins = 0;
    let nextRow = 0;
    let killer = 0;
    let hitT = 0;
    let shake = 0;
    let best = 0;
    let broke = false;
    runBest().then((b) => (best = Math.max(best, b)));
    const take = () => {
      for (const o of pool) if (!o.on) return o;
      return null;
    };
    const put = (kind, ln, wz, r, extra = 0) => {
      const o = take();
      if (!o) return null;
      o.on = true;
      o.kind = kind;
      o.lane = ln;
      o.wz = o.row = wz;
      o.r = r;
      o.vc = kind === 1 ? extra : 0;
      o.y = kind === 4 ? extra : 0;
      o.len = kind === 1 ? 3.9 : kind === 4 ? 0.6 : 0.4;
      return o;
    };
    const diff = () => Math.min(1, Math.max(0, (v - V0) / (VMAX - V0)));
    // Ряд препятствий. Всегда остаётся проходимая полоса: свободная или такая, что перепрыгнуть/прокатиться
    function spawnRow(wz) {
      const d = diff();
      const r = () => rint(RC.length);
      const bar = (ln) => put(rnd() < 0.5 ? 2 : 3, ln, wz, r());
      const road = (ln) => (rnd() < 0.6 + 0.25 * d ? put(1, ln, wz, r(), 5 + 9 * d + rnd() * 3) : bar(ln));
      const block = (ln) => (ln === 1 ? bar(ln) : road(ln));
      const free = rint(3);
      if (tRun > 8 && d > 0.35 && rnd() < 0.14) {
        // поперёк всей улицы — только заграждения: прыгать или катиться; над низким — дуга из монеток
        for (let ln = 0; ln < 3; ln++) {
          const o = bar(ln);
          if (o?.kind === 2 && ln === free) for (let i = 0; i < 5; i++) put(4, ln, wz - 4 + i * 2, 0, 0.7 + 1.3 * Math.sin((Math.PI * i) / 4));
        }
        return;
      }
      if (tRun > 6 && rnd() < 0.12 + 0.55 * d) {
        for (let ln = 0; ln < 3; ln++) if (ln !== free) block(ln);
      } else block((free + 1 + rint(2)) % 3);
      if (rnd() < 0.55) for (let i = 0; i < 5; i++) put(4, free, wz + 3 + i * 2.4, 0, 0.75);
    }
    function reset() {
      for (const o of pool) o.on = false;
      for (const b of bits) b.on = false;
      phase = 'intro';
      t = tRun = dist = v = px = py = vy = roll = camX = coins = shake = 0;
      lane = 1;
      broke = false;
      nextRow = 44;
      for (let ln = 0; ln < 3; ln++) put(5, ln, 7, 0);
      over.hidden = true;
      over.innerHTML = '';
    }
    // обломки заграждения, которое прорвал человечек
    function smash(o) {
      o.on = false;
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i];
        b.on = true;
        b.x = (o.lane - 1) * LANE + (rnd() - 0.5) * 2.2;
        b.y = 0.4 + rnd() * 0.8;
        b.z = o.wz;
        b.vx = (rnd() - 0.5) * 6;
        b.vy = 3 + rnd() * 6;
        b.vz = 4 + rnd() * 10;
        b.a = rnd() * PI2;
        b.va = (rnd() - 0.5) * 16;
        b.w = 0.25 + rnd() * 0.5;
        b.h = 0.12 + rnd() * 0.12;
        b.c = i % 3 ? '#f4efe6' : '#e0453a';
      }
      shake = lowfx ? 0 : 0.25;
    }
    function crash(o) {
      phase = 'hit';
      hitT = 0;
      killer = o.r;
      shake = lowfx ? 0 : 0.45;
      vy = 6;
    }
    function step(dt) {
      t += dt;
      if (phase === 'hit') {
        hitT += dt;
        vy -= G * dt;
        py = Math.max(0, py + vy * dt);
        shake = Math.max(0, shake - dt);
        if (hitT > 0.7) gameOver();
        return;
      }
      if (phase === 'intro') {
        v = t < 0.45 ? 0 : Math.min(V0, v + (V0 / 0.8) * dt);
        if (dist > 8.5) phase = 'run';
      } else {
        tRun += dt;
        v = V0 + (VMAX - V0) * (1 - Math.exp(-tRun / 110)); // скорость растёт плавно и упирается в предел
      }
      dist += v * dt;
      const tx = (lane - 1) * LANE;
      const mv = (LANE / 0.13) * dt;
      px = Math.abs(tx - px) <= mv ? tx : px + Math.sign(tx - px) * mv;
      if (py > 0 || vy > 0) {
        vy -= G * dt;
        py += vy * dt;
        if (py <= 0) py = vy = 0;
      }
      if (roll > 0) roll -= dt;
      camX += (px * 0.55 - camX) * Math.min(1, dt * 7);
      shake = Math.max(0, shake - dt);
      if (phase === 'run') while (nextRow < dist + 120) {
        spawnRow(nextRow);
        const d = diff();
        nextRow += Math.max(14, v * lerp(1.7, 0.85, d) + rnd() * v * 0.35);
      }
      const p0 = dist - 0.35;
      const p1 = dist + 0.35;
      for (const o of pool) {
        if (!o.on) continue;
        // машина подъезжает к своему ряду ровно тогда, когда до него добегает человечек
        if (o.kind === 1) o.wz = o.row + (o.vc * (o.row - dist)) / Math.max(v, 1);
        if (o.wz < dist - ZP - 6) {
          o.on = false;
          continue;
        }
        if (o.wz > p1 || o.wz + o.len < p0) continue;
        const lx = (o.lane - 1) * LANE;
        if (o.kind === 4) {
          if (Math.abs(px - lx) < LANE * 0.5 && Math.abs(py + 0.9 - o.y) < 1.3) {
            o.on = false;
            coins++;
          }
          continue;
        }
        if (Math.abs(px - lx) > LANE * 0.62) continue;
        if (o.kind === 5) {
          smash(o);
          broke = true;
          continue;
        }
        if (o.kind === 2 && py > 1.0) continue;
        if (o.kind === 3 && roll > 0) continue;
        return crash(o);
      }
      for (const b of bits) {
        if (!b.on) continue;
        b.vy -= G * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        b.a += b.va * dt;
        if (b.y < 0) {
          b.y = 0;
          b.vy *= -0.3;
          b.vx *= 0.6;
          b.vz *= 0.6;
        }
        if (b.z < dist - ZP) b.on = false;
      }
    }
    const score = () => Math.floor(dist) + coins * 10;

    // ---- кадр ----
    const fogA = (z) => (z > FAR * 0.55 ? Math.max(0, 1 - (z - FAR * 0.55) / (FAR * 0.45)) : 1);
    // перспектива: метры (x, высота y, z от камеры) → точки экрана
    const SX = (x, z) => W / 2 + ((x - camX) * F) / z;
    const SY = (y, z) => hy + ((CH - y) * F) / z;
    const ZN = 0.9;
    const band = (x0, x1, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(SX(x0, ZN), SY(0, ZN));
      ctx.lineTo(SX(x1, ZN), SY(0, ZN));
      ctx.lineTo(SX(x1, FAR), SY(0, FAR));
      ctx.lineTo(SX(x0, FAR), SY(0, FAR));
      ctx.fill();
    };
    function draw() {
      const cz = dist - ZP; // где камера
      ctx.setTransform(Q, 0, 0, Q, 0, 0);
      if (shake > 0) ctx.translate((rnd() - 0.5) * 14 * shake, (rnd() - 0.5) * 14 * shake);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#16121c';
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.drawImage(sky, 0, 0, sky.width, sky.height, skyX - camX * 6, 0, sky.width / Q, sky.height / Q);
      // земля: полосы улицы трапециями от ближнего края до горизонта
      band(-30, 30, '#1c1722');
      band(-7.6, 7.6, '#2b2531');
      band(-3.95, 3.95, '#221f29');
      band(-1.4, 1.4, '#7d7387');
      band(-1.25, 1.25, '#3b2d3c');
      // разметка на дорогах и швы плитки на тротуаре едут навстречу — видно скорость
      ctx.fillStyle = 'rgba(244,239,230,.55)';
      ctx.beginPath();
      for (let wz = Math.ceil((cz + 1) / 6) * 6; wz < cz + 70; wz += 6) {
        const z0 = wz - cz;
        const z1 = z0 + 2.2;
        for (let x = -2.675; x < 3; x += 5.35) {
          ctx.moveTo(SX(x - 0.08, z0), SY(0, z0));
          ctx.lineTo(SX(x + 0.08, z0), SY(0, z0));
          ctx.lineTo(SX(x + 0.08, z1), SY(0, z1));
          ctx.lineTo(SX(x - 0.08, z1), SY(0, z1));
        }
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let wz = Math.ceil((cz + 1) / 2.5) * 2.5; wz < cz + 45; wz += 2.5) {
        const z = wz - cz;
        const y = SY(0, z);
        ctx.moveTo(SX(-1.25, z), y);
        ctx.lineTo(SX(1.25, z), y);
      }
      ctx.stroke();
      for (let wz = Math.ceil((cz + 2) / 11) * 11; wz < cz + 80; wz += 11) {
        const z = wz - cz;
        const ya = SY(0, z + 1.1);
        const yb = SY(0, z - 1.1);
        const w = (2 * F) / z;
        ctx.globalAlpha = fogA(z);
        ctx.drawImage(moldSp, SX(0, z) - w / 2, ya, w, yb - ya);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = haze;
      ctx.fillRect(0, hy - H * 0.04, W, H * 0.18);
      // обочины, по дальности: дальний дом, фонарь/пальма, дом поближе…
      const BS = 8;
      const kF = Math.floor((cz + FAR) / BS);
      const kN = Math.ceil((cz + 1.2) / BS);
      const nearBig = W * 1.5;
      for (let k = kF; k >= kN - 1; k--) {
        const zl = k * BS + 4 - cz;
        if (zl > 1.2 && zl < FAR) {
          ctx.globalAlpha = fogA(zl);
          const sp = k & 1 ? lampSp : palmSp;
          const hgt = k & 1 ? 4.2 : 6;
          const wdt = (hgt * sp.width) / sp.height;
          for (let s = -1; s <= 1; s += 2) {
            const x = s * (k & 1 ? 4.3 : 5.6);
            const l = SX(x - wdt / 2, zl);
            const r = SX(x + wdt / 2, zl);
            if (r < 0 || l > W || r - l > nearBig) continue;
            const top = SY(hgt, zl);
            ctx.drawImage(sp, l, top, r - l, SY(0, zl) - top);
          }
        }
        const zb = k * BS - cz;
        if (zb > 1.2 && zb < FAR) {
          ctx.globalAlpha = fogA(zb);
          for (let s = -1; s <= 1; s += 2) {
            const sp = bld[(k * 5 + (s > 0 ? 3 : 0) + (k >> 2)) & 7];
            const x = s * 11.2;
            const l = SX(x - BLD_W / 2, zb);
            const r = SX(x + BLD_W / 2, zb);
            if (r < 0 || l > W) continue;
            const top = SY((BLD_W * sp.height) / sp.width, zb);
            ctx.drawImage(sp, l, top, r - l, SY(0, zb) - top);
          }
        }
      }
      // предметы на полосах — от дальних к ближним; человечек — на своём месте в этом порядке
      let n = 0;
      for (const o of pool) {
        if (!o.on) continue;
        o.z = o.wz - cz;
        if (o.z < 0.8 || o.z > FAR) continue;
        let j = n++;
        while (j > 0 && act[j - 1].z < o.z) {
          act[j] = act[j - 1];
          j--;
        }
        act[j] = o;
      }
      let manDrawn = false;
      for (let i = 0; i < n; i++) {
        const o = act[i];
        if (!manDrawn && o.z < ZP) {
          drawMan();
          manDrawn = true;
        }
        const z = o.z;
        const lx = (o.lane - 1) * LANE;
        const sc = F / z;
        const bot = SY(0, z);
        const xc = SX(lx, z);
        ctx.globalAlpha = fogA(z);
        if (o.kind === 1) {
          const sp = carSp[o.r];
          const w = CAR_W * sc;
          const h = (w * sp.height) / sp.width;
          ctx.drawImage(sp, xc - w / 2, bot - h, w, h);
        } else if (o.kind === 2 || o.kind === 5) {
          const sp = o.kind === 2 ? lowSp : gateSp;
          const w = LOW_W * sc;
          const h = (w * sp.height) / sp.width;
          ctx.drawImage(sp, xc - w / 2, bot - h, w, h);
          if (o.kind === 2) {
            const a = 0.5 * sc;
            ctx.drawImage(ava[o.r], xc - a / 2, bot - h * 0.95, a, a);
          }
        } else if (o.kind === 3) {
          const w = HIGH_W * sc;
          const h = (w * highSp.height) / highSp.width;
          ctx.drawImage(highSp, xc - w / 2, bot - h, w, h);
          const a = 0.62 * sc;
          ctx.drawImage(ava[o.r], xc - a / 2, bot - h - a * 0.25, a, a);
        } else {
          const a = 0.6 * sc;
          const bob = Math.sin(t * 6 + o.row) * 0.08;
          ctx.drawImage(coinSp, xc - a / 2, SY(o.y + bob, z) - a / 2, a, a);
        }
      }
      ctx.globalAlpha = 1;
      if (!manDrawn) drawMan();
      for (const b of bits) {
        if (!b.on) continue;
        const z = b.z - cz;
        if (z < 0.6) continue;
        const sc = F / z;
        ctx.setTransform(Q, 0, 0, Q, 0, 0);
        ctx.translate(SX(b.x, z), SY(b.y, z));
        ctx.rotate(b.a);
        ctx.fillStyle = b.c;
        ctx.fillRect((-b.w * sc) / 2, (-b.h * sc) / 2, b.w * sc, b.h * sc);
      }
      ctx.setTransform(Q, 0, 0, Q, 0, 0);
      hud();
    }
    function drawMan() {
      const x = SX(px, ZP);
      const g0 = SY(0, ZP);
      ctx.drawImage(shadowSp, x - PW / 2, g0 - PHt * 0.15, PW, PHt * 0.3);
      let fr = 0;
      if (phase === 'hit') fr = 8;
      else if (roll > 0) fr = 7;
      else if (py > 0.02) fr = 6;
      else if (v > 0.5) fr = Math.floor(t * (5 + v * 0.55)) % 6;
      const yb = SY(py, ZP);
      const sw = pl.width / 9;
      if (phase === 'hit') {
        ctx.save();
        ctx.translate(x, yb - PHt * 0.5);
        ctx.rotate(Math.min(1, hitT * 3) * 1.2);
        ctx.drawImage(pl, fr * sw, 0, sw, pl.height, -PW / 2, -PHt * 0.6, PW, PHt * 1.1);
        ctx.restore();
        return;
      }
      ctx.drawImage(pl, fr * sw, 0, sw, pl.height, x - PW / 2, yb - PHt * 1.02, PW, PHt * 1.1);
    }
    function hud() {
      const s = score();
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = hudFont;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText(String(s), 18, 16);
      ctx.fillStyle = '#f2d68a';
      ctx.fillText(String(s), 16, 14);
      const fs = parseFloat(hudFont.split(' ')[1]);
      ctx.font = hudSmall;
      ctx.drawImage(coinSp, 16, 20 + fs, fs * 0.62, fs * 0.62);
      ctx.fillStyle = '#f4efe6';
      ctx.fillText(`${coins}   ·   рекорд ${Math.max(best, 0)}`, 22 + fs * 0.62, 22 + fs);
      if (phase === 'intro' || tRun < 3.5) {
        const a = phase === 'intro' ? 1 : Math.max(0, 1 - (tRun - 2.5));
        if (a > 0) {
          ctx.globalAlpha = a;
          ctx.textAlign = 'center';
          ctx.font = hudSmall;
          const tip = touch ? 'Свайп ← → — полоса · ↑ — прыжок · ↓ — перекат' : 'A / D — полоса · W или пробел — прыжок · S — перекат';
          const tw = ctx.measureText(tip).width + 28;
          ctx.fillStyle = 'rgba(17,15,22,.78)';
          ctx.fillRect(W / 2 - tw / 2, H - fs * 2.6, tw, fs * 1.5);
          ctx.fillStyle = '#f2d68a';
          ctx.fillText(tip, W / 2, H - fs * 2.6 + fs * 0.4);
          if (phase === 'intro' && !broke) {
            ctx.font = hudFont;
            ctx.fillStyle = '#f4efe6';
            ctx.fillText('Прорываемся!', W / 2, hy + (H - hy) * 0.12);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---- цикл: один requestAnimationFrame, физика шагами по 1/120 с ----
    let raf = 0;
    let last = 0;
    let acc = 0;
    const frame = (now) => {
      raf = 0;
      if (!wrap.isConnected) return destroy();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!paused && phase !== 'over') {
        acc += dt;
        while (acc >= STEP) {
          step(STEP);
          acc -= STEP;
          if (phase === 'over') break;
        }
      }
      draw();
      if (!paused && phase !== 'over') raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (raf) return;
      last = 0;
      acc = 0;
      raf = requestAnimationFrame(frame);
    };
    async function gameOver() {
      phase = 'over';
      const s = score();
      const prev = best;
      if (s > best) best = s;
      const rc = RC[killer] || RC[0];
      const pic = rc.icon && avaOk[killer] ? `<img src="${escH(rc.icon)}" alt="" referrerpolicy="no-referrer">` : escH(initials(rc.name));
      over.innerHTML = `<div class="wr-card" role="dialog" aria-label="Забег окончен">
        <span class="wr-ava" style="background:${PAL[killer % PAL.length]}">${pic}</span>
        <span class="wr-k">Вас выбил канал</span>
        <b class="wr-name">${escH(rc.name)}</b>
        <div class="wr-sc"><span><small>счёт</small><b>${s}</b></span><span><small>монетки</small><b>${coins}</b></span><span><small>рекорд</small><b>${best}</b></span></div>
        ${s > prev && prev > 0 ? '<span class="wr-new">★ Новый рекорд!</span>' : ''}
        <div class="wr-acts"><button type="button" class="btn primary wr-again">Ещё раз</button><button type="button" class="btn wr-back">На аллею</button></div>
        <span class="wr-tip">${touch ? '' : 'Пробел — ещё раз · Esc — на аллею'}</span>
      </div>`;
      over.hidden = false;
      over.querySelector('.wr-again').focus();
      if (s > prev) best = await runBest(s);
    }
    function again() {
      reset();
      paused = false;
      run();
    }
    function setPause(on) {
      if (phase === 'over' || paused === on) return;
      paused = on;
      if (on) {
        over.innerHTML = '<div class="wr-card wr-pause"><b class="wr-name">Пауза</b><div class="wr-acts"><button type="button" class="btn primary wr-go">Продолжить</button><button type="button" class="btn wr-back">На аллею</button></div></div>';
        over.hidden = false;
        over.querySelector('.wr-go').focus();
      } else {
        over.hidden = true;
        run();
      }
    }
    // ---- управление: клавиши и свайпы ----
    const left = () => phase !== 'hit' && (lane = Math.max(0, lane - 1));
    const right = () => phase !== 'hit' && (lane = Math.min(2, lane + 1));
    const jump = () => {
      if (phase === 'hit' || py > 0.02) return;
      vy = JUMP;
      roll = 0;
    };
    const duck = () => {
      if (phase === 'hit') return;
      if (py > 0.02) vy = -16; // в воздухе — быстро вниз
      roll = ROLL;
    };
    const onKey = (e) => {
      if (!wrap.isConnected) return destroy();
      const c = e.code;
      if (c === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return destroy();
      }
      const game = { KeyA: left, ArrowLeft: left, KeyD: right, ArrowRight: right, KeyW: jump, ArrowUp: jump, Space: jump, KeyS: duck, ArrowDown: duck }[c];
      if (!game && c !== 'KeyP' && c !== 'Enter') return;
      if (e.target.closest?.('button') && (c === 'Enter' || c === 'Space') && !over.hidden) return; // нажатие кнопки на карточке
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'over') return (c === 'Space' || c === 'Enter') && again();
      if (c === 'KeyP') return setPause(!paused);
      if (paused) return (c === 'Space' || c === 'Enter') && setPause(false);
      game?.();
    };
    document.addEventListener('keydown', onKey, true);
    let sx0 = 0;
    let sy0 = 0;
    let swiping = false;
    cv.addEventListener('pointerdown', (e) => {
      sx0 = e.clientX;
      sy0 = e.clientY;
      swiping = true;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!swiping) return;
      const dx = e.clientX - sx0;
      const dy = e.clientY - sy0;
      const m = Math.max(24, Math.min(W, H) * 0.05);
      if (Math.abs(dx) < m && Math.abs(dy) < m) return;
      swiping = false; // один свайп — одно действие
      if (paused || phase === 'over') return;
      if (Math.abs(dx) > Math.abs(dy)) (dx < 0 ? left : right)();
      else (dy < 0 ? jump : duck)();
    });
    const stopSwipe = () => (swiping = false);
    cv.addEventListener('pointerup', stopSwipe);
    cv.addEventListener('pointercancel', stopSwipe);
    over.addEventListener('click', (e) => {
      if (e.target.closest('.wr-again')) again();
      else if (e.target.closest('.wr-go')) setPause(false);
      else if (e.target.closest('.wr-back')) destroy();
    });
    wrap.querySelector('.wr-x').addEventListener('click', () => destroy());
    // вкладку свернули — пауза, а не забег вслепую
    const onVis = () => document.hidden && phase !== 'over' && setPause(true);
    document.addEventListener('visibilitychange', onVis);
    let ro = null;
    if (window.ResizeObserver) {
      let pend = false;
      ro = new ResizeObserver(() => {
        if (pend) return;
        pend = true;
        requestAnimationFrame(() => {
          pend = false;
          if (Math.abs(wrap.clientWidth - W) < 1 && Math.abs(wrap.clientHeight - H) < 1) return;
          layout();
          if (!raf) draw();
        });
      });
      ro.observe(wrap);
    }
    let gone = false;
    function destroy() {
      if (gone) return;
      gone = true;
      cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVis);
      ro?.disconnect();
      wrap.remove();
      onExit?.();
    }
    layout();
    reset();
    run();
    wrap.tabIndex = -1;
    wrap.focus({ preventScroll: true });
    return { destroy, wrap };
  }

  // Блок ролика в карточке звезды: крупное превью (ведёт на YouTube) и плитки с цифрами.
  // stats: { views, likes, date } или null — тогда плитки «загружаются»; note — строка вместо плиток.
  const ytNum = (n) => (n == null ? '—' : new Intl.NumberFormat('ru', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
  const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function fameVideoTiles(stats = null, note = '') {
    const tile = (label, val) => `<span class="fz-tile"><b>${val}</b><small>${label}</small></span>`;
    if (note) return `<span class="fz-ytnote">${escAttr(note)}</span>`;
    if (!stats) return tile('просмотры', '<i class="fz-wait"></i>') + tile('лайки', '<i class="fz-wait"></i>');
    const date = stats.date ? new Date(stats.date).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\s*г\.$/, '') : '';
    return tile('просмотры', ytNum(stats.views)) + tile('лайки', ytNum(stats.likes)) + (date ? tile('вышло', escAttr(date)) : '');
  }
  function fameVideoExtra(id, { img, stats = null, note = '' } = {}) {
    return `<a class="fz-shot" href="${watchUrl(id)}" target="_blank" rel="noopener"><img src="${escAttr(img || thumbHQ(id))}" alt="Превью ролика"><span class="fz-play">▶</span></a><div class="fz-yt">${fameVideoTiles(stats, note)}</div>`;
  }
  // Ролики со звездой — по времени, когда дали звезду
  function starredVideos(videos) {
    return Object.values(videos || {})
      .filter((v) => v?.star)
      .sort((a, b) => (a.star.at || 0) - (b.star.at || 0));
  }
  // Размер букв имени на звезде (в долях ширины звезды) — по длине самого длинного слова и всего имени, чтобы слова не рвались
  function fameNameSize(name) {
    const longest = Math.max(...String(name).split(/\s+/).map((w) => w.length), 1);
    const total = String(name).length;
    return Math.min(7.2, 46 / Math.max(longest, 6), total > 20 ? 4.4 : total > 11 ? 5.4 : 7.2).toFixed(2) + 'cqw';
  }  // Жанр канала для значка — самый частый тип его оценок
  function fameType(videos, name) {
    const n = {};
    for (const v of Object.values(videos || {})) if (v.channel === name && v.rating) n[ratingType(v.rating)] = (n[ratingType(v.rating)] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'custom';
  }

  // ---- История YouTube: страница /feed/history общая для всех устройств аккаунта ----
  // Разбор нужен и вкладке YouTube, и фону расширения (он читает историю сам, без открытой вкладки).
  function initialDataFrom(html) {
    for (const marker of ['var ytInitialData = ', 'window["ytInitialData"] = ']) {
      const i = html.indexOf(marker);
      if (i < 0) continue;
      const start = i + marker.length;
      const end = html.indexOf(';<\/script>', start); // «<\/» — чтобы код можно было встроить в страницу
      if (end > start) return JSON.parse(html.slice(start, end));
    }
    return null;
  }

  const txt = (t) => (typeof t === 'string' ? t : t?.simpleText || t?.content || t?.runs?.map((r) => r.text).join('') || '');

  function deepFind(o, pred, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 30) return undefined;
    if (!Array.isArray(o) && pred(o)) return o;
    for (const k in o) {
      const r = deepFind(o[k], pred, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  function clockToSec(s) {
    const m = String(s || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    return m ? (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }

  const WEEKDAYS = [['воскресенье', 'sunday'], ['понедельник', 'monday'], ['вторник', 'tuesday'], ['среда', 'wednesday'], ['четверг', 'thursday'], ['пятница', 'friday'], ['суббота', 'saturday']];
  const MON_RU = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MON_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // «Сегодня», «Вчера», «Понедельник», «12 окт.», «Oct 12, 2025» → YYYY-MM-DD
  function historyDay(title) {
    const t = (title || '').toLowerCase().trim();
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (!t || /сегодня|today/.test(t)) return dateKey(d);
    if (/вчера|yesterday/.test(t)) {
      d.setDate(d.getDate() - 1);
      return dateKey(d);
    }
    const wd = WEEKDAYS.findIndex(([ru, en]) => t.startsWith(ru) || t.startsWith(en));
    if (wd >= 0) {
      d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7 || 7));
      return dateKey(d);
    }
    let day, mon, year;
    let m = t.match(/(\d{1,2})\s+([а-яё]+)\.?(?:\s+(\d{4}))?/);
    if (m) {
      day = +m[1];
      mon = MON_RU.findIndex((p) => m[2].startsWith(p));
      year = m[3] && +m[3];
    } else if ((m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/))) {
      mon = MON_EN.indexOf(m[1]);
      day = +m[2];
      year = m[3] && +m[3];
    }
    if (m && mon >= 0) {
      const x = new Date(year || d.getFullYear(), mon, day, 12);
      if (!year && x > d) x.setFullYear(x.getFullYear() - 1);
      return dateKey(x);
    }
    return null;
  }

  // Трансляция / премьера: значки «В эфире», «Трансляция закончилась…», «Streamed…», «Премьера…»
  const LIVE_MARK_RE = /трансляци|прямой эфир|в эфире|streamed|live stream|премьер|premiere|BADGE_STYLE_TYPE_LIVE|"LIVE"|"style":"LIVE"/i;
  const isLiveItem = (o) => LIVE_MARK_RE.test(JSON.stringify(o));

  function fromVideoRenderer(vr) {
    const owner = vr.ownerText || vr.longBylineText || vr.shortBylineText;
    const resume = deepFind(vr.thumbnailOverlays, (x) => typeof x.percentDurationWatched === 'number');
    return {
      id: vr.videoId,
      title: txt(vr.title),
      channel: txt(owner),
      channelUrl: owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '',
      avatar: deepFind(vr.channelThumbnailSupportedRenderers || vr.channelThumbnail, (x) => typeof x.url === 'string')?.url || '',
      duration: clockToSec(txt(vr.lengthText)),
      progress: resume ? resume.percentDurationWatched / 100 : null,
      live: isLiveItem(vr),
    };
  }

  function fromLockup(lv) {
    if (lv.contentType && !/VIDEO/.test(lv.contentType)) return null;
    const md = lv.metadata?.lockupMetadataViewModel;
    const part = md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0];
    const bar = deepFind(lv.contentImage, (x) => typeof x.startPercent === 'number');
    const badge = deepFind(lv.contentImage, (x) => typeof x.text === 'string' && /^\d+:\d{2}(:\d{2})?$/.test(x.text.trim()));
    return {
      id: lv.contentId,
      title: txt(md?.title),
      channel: txt(part?.text),
      channelUrl: deepFind(part, (x) => typeof x.canonicalBaseUrl === 'string')?.canonicalBaseUrl || '',
      avatar: deepFind(md?.image, (x) => typeof x.url === 'string')?.url || '',
      duration: clockToSec(badge?.text),
      progress: bar ? bar.startPercent / 100 : null,
      live: isLiveItem(lv),
    };
  }

  function historyItems(root) {
    const out = [];
    const seen = new Set();
    const push = (it, day) => {
      if (!it?.id || !/^[\w-]{11}$/.test(it.id) || seen.has(it.id)) return;
      seen.add(it.id);
      out.push({ ...it, day });
    };
    (function walk(o, day) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        for (const x of o) walk(x, day);
        return;
      }
      if (o.itemSectionRenderer) {
        const sec = o.itemSectionRenderer;
        const head = deepFind(sec.header, (x) => typeof x.simpleText === 'string' || typeof x.content === 'string' || Array.isArray(x.runs));
        walk(sec.contents, historyDay(txt(head)) || day);
        return;
      }
      if (o.reelShelfRenderer) return; // Shorts в истории пропускаем
      if (o.videoRenderer?.videoId) return push(fromVideoRenderer(o.videoRenderer), day);
      if (o.lockupViewModel?.contentId) return push(fromLockup(o.lockupViewModel), day);
      for (const k in o) walk(o[k], day);
    })(root, dateKey());
    return out;
  }

  // Страница истории → [{ id, title, channel, channelUrl, avatar, duration, progress, live, day }] или null, если не прочиталась
  function parseHistoryPage(html) {
    const data = initialDataFrom(html);
    return data ? historyItems(data) : null;
  }

  // ---- Синхронизация через Google Drive (расширение ↔ телефон) ----
  // Один файл smotribelno.json в скрытой папке приложения на Диске пользователя (appDataFolder):
  // приложению виден только он. Вход — OAuth 2.0 (токен на час), клиент «Веб-приложение» из Google Cloud
  // пользователя; расширение и телефон должны использовать один и тот же клиент — иначе папки приложения разные.
  // Client ID «Веб-приложения» из Google Cloud (проект Smotribelno). Не секрет — виден в коде сайта.
  // Адреса возврата в клиенте: https://mirikr.github.io/smotribelno/ и https://cmlcimgiapgbmebablclaadioipbfkde.chromiumapp.org/
  const GOOGLE_CLIENT_ID = '440091117815-s0dqu2jsomao1ps8blqf2gn57s9ipgq7.apps.googleusercontent.com';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE_FILE = 'smotribelno.json';
  const DRIVE_APP = 'Smotribelno-drive';
  const SYNC_FIELDS = ['id', 'title', 'channel', 'channelUrl', 'duration', 'short', 'live', 'rating', 'ratingDel', 'later', 'laterDel', 'note', 'noteAt', 'moments', 'watchedAt', 'watchedUpd', 'watchedBy', 'dropped', 'droppedDel', 'noRate', 'resumeHidden', 'pl', 'plAt', 'star', 'starDel'];

  // В файл на Диске — только то, что нужно другому устройству; статистика по дням остаётся на месте
  function slimVideo(v) {
    const o = {};
    for (const k of SYNC_FIELDS) if (v[k] != null) o[k] = v[k];
    if (v.watch) {
      const w = { real: v.watch.real, position: v.watch.position, maxProgress: v.watch.maxProgress, lastAt: v.watch.lastAt, remote: v.watch.remote };
      for (const k of Object.keys(w)) if (w[k] == null) delete w[k];
      o.watch = w;
    }
    return o;
  }
  // Ещё — просмотренное за 60 дней без оценки («Ждут оценки») и брошенное без причины: их тоже разбирают с телефона
  const recentlyWatched = (v) => Date.now() - Math.max(v.watchedAt || 0, v.watch?.lastAt || 0) < 60 * 86400000;
  const worthSyncing = (v) =>
    !!(v && (v.rating || v.later || v.note || v.moments?.length || v.dropped || v.ratingDel || v.laterDel || v.droppedDel || isStarted(v) || ((awaitingRating(v) || isDropCandidate(v)) && recentlyWatched(v)) || (v.pl && Object.keys(v.pl).length) || Date.now() - (v.plAt || 0) < 60 * 86400000 || v.star || v.starDel));

  // Сравнение без учёта порядка полей
  function stableJson(o) {
    if (Array.isArray(o)) return '[' + o.map(stableJson).join(',') + ']';
    if (o && typeof o === 'object') {
      return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableJson(o[k])).join(',') + '}';
    }
    return JSON.stringify(o);
  }

  // Адрес входа Google: response_type=token — токен приходит в #фрагменте адреса возврата
  function googleAuthUrl({ redirectUri, interactive, state, hint }) {
    const q = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      response_type: 'token',
      redirect_uri: redirectUri,
      scope: DRIVE_SCOPE,
      include_granted_scopes: 'true',
      prompt: interactive ? 'select_account' : 'none',
    });
    if (state) q.set('state', state);
    if (hint) q.set('login_hint', hint);
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
  }
  function parseAuthFragment(url) {
    const h = new URLSearchParams(String(url).split('#')[1] || '');
    if (h.get('error')) return { error: h.get('error') };
    const token = h.get('access_token');
    return token ? { token, exp: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000 - 60000, state: h.get('state') } : null;
  }

  async function driveFetch(token, url, opts = {}, fetchFn = fetch) {
    const r = await fetchFn(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (r.status === 401 || r.status === 403) {
      const e = new Error(r.status === 401 ? 'Нужно войти в Google снова' : 'Google не дал доступ к Диску');
      e.auth = true;
      throw e;
    }
    if (!r.ok) throw new Error('Google Drive ответил ' + r.status);
    return r;
  }

  // Одна синхронизация: прочитать файл, слить с локальным, вернуть что поменять здесь, записать файл, если он устарел.
  // local — { id: видео }. Возвращает { changes: { id: видео }, uploaded, total }.
  // stats — сводка статистики с компьютера (время по дням и каналам, иконки каналов): телефон её только читает
  // и при записи файла сохраняет как есть.
  async function driveSync(token, local, { settings, stats, playlists, fame, fetchFn = fetch } = {}) {
    const api = 'https://www.googleapis.com/drive/v3/files';
    const list = await (await driveFetch(token, `${api}?spaces=appDataFolder&fields=files(id,modifiedTime)&q=${encodeURIComponent(`name='${DRIVE_FILE}'`)}`, {}, fetchFn)).json();
    const fileId = list.files?.[0]?.id || null;
    const remote = fileId ? await (await driveFetch(token, `${api}/${fileId}?alt=media`, {}, fetchFn)).json().catch(() => ({})) : {};
    const rv = remote?.app === DRIVE_APP && remote.videos && typeof remote.videos === 'object' ? remote.videos : {};
    const changes = {};
    const next = {};
    let remoteChanged = !fileId;
    for (const id of new Set([...Object.keys(local), ...Object.keys(rv)])) {
      if (!/^[\w-]{11}$/.test(id)) continue;
      const l = local[id];
      const r = rv[id];
      const merged = mergeNewer(l, r ? { ...r, id } : r);
      if (!merged) continue;
      if (l && stableJson(merged) !== stableJson(l)) changes[id] = merged;
      else if (!l && worthSyncing(merged)) changes[id] = merged;
      if (worthSyncing(merged)) {
        next[id] = slimVideo(merged);
        if (!r || stableJson(next[id]) !== stableJson(r)) remoteChanged = true;
      } else if (r) remoteChanged = true;
    }
    if (settings?.criteria && stableJson(settings.criteria) !== stableJson(remote.settings?.criteria)) remoteChanged = true;
    if (stats && stableJson(stats) !== stableJson(remote.stats)) remoteChanged = true;
    // Список плейлистов: сливаем по каждому плейлисту; null — у устройства его нет (старая версия), не трогаем
    const outPlaylists = playlists || remote.playlists ? mergePlaylists(playlists, remote.playlists) : null;
    if (outPlaylists && stableJson(outPlaylists) !== stableJson(remote.playlists || null)) remoteChanged = true;
    const playlistsChanged = !!(outPlaylists && playlists !== undefined && stableJson(outPlaylists) !== stableJson(playlists || { lists: {} }));
    // Аллея славы — так же, по каждому каналу
    const outFame = fame || remote.fame ? mergeFame(fame, remote.fame) : null;
    if (outFame && stableJson(outFame) !== stableJson(remote.fame || null)) remoteChanged = true;
    const fameChanged = !!(outFame && fame !== undefined && stableJson(outFame) !== stableJson(fame || { stars: {} }));
    // Свой набор критериев с другого устройства — подписи для старых оценок
    const remoteCriteria = remote.settings?.criteria || null;
    const outStats = stats || remote.stats || null;
    if (remoteChanged) {
      const body = JSON.stringify({ app: DRIVE_APP, version: 1, updatedAt: Date.now(), settings: { criteria: settings?.criteria || remoteCriteria || DEFAULT_CRITERIA }, stats: outStats, playlists: outPlaylists, fame: outFame, videos: next });
      if (fileId) {
        await driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, fetchFn);
      } else {
        const boundary = 'smotribelno' + Date.now();
        const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
        const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
        await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }, fetchFn);
      }
    }
    return { changes, uploaded: remoteChanged, total: Object.keys(next).length, remoteCriteria, remoteStats: outStats, playlists: playlistsChanged ? outPlaylists : null, fame: fameChanged ? outFame : null };
  }

  // Отправка операции в background (он сериализует все записи)
  async function send(type, payload = {}) {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (!res?.ok) throw new Error(res?.error || 'Смотрибельно: нет ответа от background');
    return res.result;
  }

  return {
    MAX_SCORE,
    SLIDER_MAX,
    DEFAULT_CRITERIA,
    DEFAULT_SETTINGS,
    CATALOG,
    CATALOG_IDS,
    COMMON_CRITERIA,
    VIDEO_TYPES,
    DEFAULT_TYPE,
    videoType,
    typeCriteria,
    critName,
    ratingType,
    defaultType,
    typeSource,
    ICONS_KEY,
    ICON_RETRY_MS,
    iconFailed,
    channelKey,
    nameKey,
    channelIcon,
    safeIconSrc,
    PRIORITIES,
    prioGlyph,
    scoreColor,
    scoreMark,
    GRADES,
    computeTotal,
    grade,
    parseVideoId,
    thumbUrl,
    watchUrl,
    dateKey,
    fmtSpent,
    fmtClock,
    getSettings,
    getAllVideos,
    laterQueue,
    isStarted,
    awaitingRating,
    DROP_MAX,
    DROP_REASONS,
    dropReason,
    maxPos,
    isDropCandidate,
    CLEANUP_DAYS,
    staleLater,
    looksLive,
    remoteCap,
    fromOtherDevice,
    startedVideos,
    watchNext,
    resumeUrl,
    MOBILE_APP,
    mergeNewer,
    GOOGLE_CLIENT_ID,
    DRIVE_SCOPE,
    slimVideo,
    worthSyncing,
    stableJson,
    googleAuthUrl,
    parseAuthFragment,
    driveSync,
    laterCmp,
    FAME_KEY,
    fameKey,
    fameStar,
    fameList,
    mergeFame,
    fameEmblem,
    fameType,
    fameNameSize,
    starredVideos,
    fitFameNames,
    fameCloseup,
    fameVideoExtra,
    fameVideoTiles,
    parseHistoryPage,
    fameSceneHtml,
    FAME_LAMP,
    fameBoulevard,
    fitFameWalks,
    fameWalk,
    fameRun,
    thumbHQ,
    thumbFallback,
    watchThumbFallback,
    PLAYLISTS_KEY,
    PLAYLIST_EMOJI,
    isPlaylistId,
    newPlaylistId,
    playlistList,
    playlistItems,
    playlistSummary,
    playlistNext,
    mergePlaylists,
    playlistChannels,
    send,
  };
})();
