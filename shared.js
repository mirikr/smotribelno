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

  // ---- Свои наборы, кроме основного «Свой» ----
  // settings.customSets = [{ id: 'u-…', label, criteria: [{ id, name, hint }], at, deleted? }].
  // Каждый набор — ещё один тип оценки (после «Свой»). Удалённый набор остаётся в настройках с deleted:
  // его оценки не теряют подписи, но выбрать его для новой оценки уже нельзя.
  const USER_SET_RE = /^u-[a-z0-9]{2,12}$/;
  const MAX_USER_SETS = 8;
  let userSets = [];
  let userSetsKey = '[]';
  const cleanSets = (sets) =>
    (Array.isArray(sets) ? sets : [])
      .filter((s) => s && USER_SET_RE.test(s.id) && Array.isArray(s.criteria))
      .map((s) => ({ ...s, criteria: s.criteria.filter((c) => c && typeof c.id === 'string' && c.id) }));
  // Подключить наборы из настроек: после этого они есть в VIDEO_TYPES (для кнопок выбора типа)
  function useSettings(settings) {
    const sets = cleanSets(settings?.customSets);
    const key = JSON.stringify(sets);
    if (key === userSetsKey) return;
    userSetsKey = key;
    userSets = sets;
    for (let i = VIDEO_TYPES.length - 1; i >= 0; i--) if (VIDEO_TYPES[i].user) VIDEO_TYPES.splice(i, 1);
    const at = VIDEO_TYPES.findIndex((t) => t.id === 'custom') + 1;
    VIDEO_TYPES.splice(at, 0, ...sets.filter((s) => !s.deleted).map((s) => ({ id: s.id, label: s.label || 'Свой набор', own: [], user: true })));
  }
  const userSet = (id, settings) => {
    if (settings) useSettings(settings);
    return userSets.find((s) => s.id === id) || null;
  };
  // Свой ли это тип (в том числе набор с другого устройства, который сюда ещё не дошёл)
  const isTypeId = (id) => VIDEO_TYPES.some((t) => t.id === id) || USER_SET_RE.test(String(id || ''));
  const videoType = (id) => {
    const t = VIDEO_TYPES.find((x) => x.id === id);
    if (t) return t;
    if (USER_SET_RE.test(String(id || ''))) {
      const s = userSets.find((x) => x.id === id);
      return { id, label: s ? `${s.label || 'Свой набор'} (удалён)` : 'Свой набор', own: [], user: true };
    }
    return VIDEO_TYPES.find((x) => x.id === 'custom');
  };

  // Критерии типа: [{ id, name, hint, common }]
  function typeCriteria(type, settings) {
    if (settings) useSettings(settings);
    const t = videoType(type);
    if (t.id === 'custom') return (settings?.criteria || DEFAULT_CRITERIA).map((c) => ({ ...c, common: false }));
    if (t.user) return (userSet(t.id)?.criteria || []).map((c) => ({ ...c, common: false }));
    return [...t.own, ...COMMON_CRITERIA].map((id) => ({ id, ...CATALOG[id], common: COMMON_CRITERIA.includes(id) }));
  }

  // Название критерия по id: из каталога, из своего набора или из своих наборов
  function critName(id, settings) {
    if (settings) useSettings(settings);
    return (
      (settings?.criteria || DEFAULT_CRITERIA).find((c) => c.id === id)?.name ||
      CATALOG[id]?.name ||
      userSets.flatMap((s) => s.criteria).find((c) => c.id === id)?.name ||
      'Удалённый критерий'
    );
  }

  // Свои наборы с двух устройств: по каждому набору — более свежий (at); удалённые тоже переносятся
  function mergeSets(a, b) {
    const out = new Map();
    for (const s of [...cleanSets(b), ...cleanSets(a)]) {
      const cur = out.get(s.id);
      if (!cur || (s.at || 0) >= (cur.at || 0)) out.set(s.id, s);
    }
    return [...out.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || String(x.id).localeCompare(String(y.id)));
  }

  // Тип оценки; у оценок без типа (поставленных раньше) — «Свой»
  const ratingType = (rating) => (rating ? (isTypeId(rating.type) ? rating.type : 'custom') : null);

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
    customSets: [], // свои наборы кроме основного «Свой»: [{ id: 'u-…', label, criteria, at, createdAt, deleted? }]
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
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    useSettings(s);
    return s;
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
  function fameWalk(host, { items, onOpen, lite = false, racers = null, onBuilt = null, _now = false }) {
    const liteAsked = lite; // для пересборки при смене ширины
    if (!host) return;
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const sig = items.map((it) => it.sign || it.title + '|' + (it.sub || '')).join('¦');
    if (host._sig === sig && host.firstChild) return; // то же самое — не перестраиваем, прогулка продолжается с того же места
    // Сначала — заставка «Аллея готовится», и только когда она уже на экране — тяжёлая сборка улицы.
    // Иначе страница просто замирала на время сборки, и раздел открывался рывком.
    if (!_now) {
      const token = (host._build = {});
      host._sig = null;
      host.innerHTML = `<div class="w3 loading${(host.clientWidth || innerWidth) < 620 ? ' phone' : ''}"><div class="w3-load" aria-hidden="true"><span class="w3-load-star">★</span><b>Аллея готовится…</b><i class="w3-load-bar"><i></i></i></div></div>`;
      const build = () => {
        if (host._build !== token || !host.isConnected) return;
        host._build = null;
        fameWalk(host, { items, onOpen, lite, racers, onBuilt, _now: true });
        fitFameNames(host); // длинные имена — мельче, чтобы не выходили за звезду
        onBuilt?.();
      };
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(build, 0)));
      setTimeout(build, 400); // страховка: кадры могут не идти (вкладка в фоне)
      return;
    }
    host._sig = sig;
    // слабое устройство: совсем слабое — без машин, послабее — без мерцаний и «дышащего» света
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    if (cores <= 2 || mem <= 2) lite = true;
    const lowfx = lite || cores <= 4 || mem <= 4;
    const firstShow = !host._shown || _now; // заставка «Аллея готовится» — пока собирается улица
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
            houses += `<div class="w3-bld ${sideCls} w3-back" style="left:${x + out * off}px;bottom:${y}px;height:${L}px;--h:${H}px;--d:${D}px;--side:#1d1926;--trim:#2c2636"><div class="w3-wall ${sideCls} w3-back" style="width:${H}px;height:${L}px;background-image:${wallSvg('back', H, L)}"></div><i class="w3-roof"></i><i class="w3-endf"></i></div>`;
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
      <div class="w3-ctl"><span class="w3-hint"${phone ? '' : ' title="Колесо мыши, стрелки ↑ ↓ — идти; ← → — к соседней звезде; + и − — приблизить или отдалить"'}>${phone ? 'Ведите пальцем, чтобы идти' : 'Листайте, чтобы идти по аллее'}</span>${rows.filter((r) => r.sign).map((r) => `<button type="button" class="btn small w3-jump" data-jump="${r.z}">${escH(r.sign).replace(/^(\S+\s)/, '<span class="w3-jpre">$1</span>')}</button>`).join('')}${phone ? '' : '<button type="button" class="btn small w3-cam" aria-pressed="false" title="Посмотреть на аллею сверху"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 15l8 4 8-4M4 10l8 4 8-4-8-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="w3-cam-t">Вид сверху</span></button><button type="button" class="btn small w3-zoom" data-zoom="1" title="Приблизить (+)" aria-label="Приблизить">+</button><button type="button" class="btn small w3-zoom" data-zoom="-1" title="Отдалить (−)" aria-label="Отдалить">−</button><button type="button" class="btn small w3-full" title="На весь экран" aria-label="На весь экран"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'}<button type="button" class="btn small w3-auto">▶ Прогуляться</button></div>
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
    // приближение клавишами + и − (и кнопками) — плавно, в пределах; переживает перерисовку
    const ZMIN = 0.75;
    const ZMAX = 1.6;
    let uz = host._zoom || 1;
    let uzTo = uz;
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
    // У какой звезды стоим: ближайшая впереди, в «зоне взгляда» (-1 — звёзды позади, впереди ремонт).
    // Сверху «зона взгляда» дальше по тротуару: камера смотрит вниз, ближняя часть внизу экрана.
    const starIdx = rows.map((r, i) => (r.sign ? -1 : i)).filter((i) => i >= 0);
    const lookAt = (t) => 170 + ((W3_TILT - t) / (W3_TILT - W3_TILT_TOP)) * 60;
    const starAt = (p, t) => {
      let best = -1;
      let bd = Infinity;
      for (const i of starIdx) {
        const d = rows[i].z - p - lookAt(t);
        if (d > -140 && Math.abs(d) < bd) {
          bd = Math.abs(d);
          best = i;
        }
      }
      return best;
    };
    const apply = () => {
      host._pos = pos;
      cullNow();
      // сверху камера подходит ближе, чтобы надписи на звёздах читались (на телефоне — ещё ближе)
      const zoom = 1 + ((phone ? 1.2 : 0.9) - 1) * ((W3_TILT - tilt) / (W3_TILT - W3_TILT_TOP));
      floor.style.transform = `translateX(-50%) scale(${(sc * zoom * uz).toFixed(4)}) rotateX(${tilt.toFixed(2)}deg) translateY(${pos}px)`;
      // стоящие предметы (фонари, пальмы, указатели, машины) поворачиваются на тот же угол — стоят ровно
      if (tilt !== tiltShown) w3.style.setProperty('--tilt', (tiltShown = tilt).toFixed(2));
      if (Math.abs(pos - carsAt) > 80) carsNow(); // машины проверяем, когда заметно сдвинулись (и по таймеру)
      move.style.transform = reduce ? '' : `translateY(${(Math.sin(pos / 85) * 1.8).toFixed(2)}px)`; // покачивание шага
      prog.style.width = maxPos ? `${((pos / maxPos) * 100).toFixed(1)}%` : '0%';
      const best = starAt(pos, tilt);
      if (best !== shown) {
        shown = best;
        const r = rows[best];
        // стрелки — к соседней звезде; за последней — ремонт
        const steps = `<button type="button" class="btn small w3-step" data-step="-1" aria-label="Предыдущая звезда" title="Предыдущая звезда (←)"${best === starIdx[0] ? ' disabled' : ''}>‹</button><button type="button" class="btn small w3-step" data-step="1" aria-label="Следующая звезда" title="Следующая звезда (→)"${best === -1 ? ' disabled' : ''}>›</button>`;
        cap.innerHTML = r
          ? `<b>★ ${escH(r.title)}</b>${r.sub ? `<span>${r.sub}</span>` : ''}<div class="w3-acts">${steps}<button type="button" class="btn small w3-look" data-w3="${best}">Рассмотреть</button></div>`
          : `<b>Ремонт аллеи</b><span>Скоро здесь появятся новые звёзды: ставьте их любимым каналам и роликам</span><div class="w3-acts">${steps}<button type="button" class="btn small primary w3-rungo" title="Мини-игра: забег от машин с аватарками каналов">🏃 Прорваться</button></div>`;
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
      uz = reduce || Math.abs(uzTo - uz) < 0.002 ? uzTo : uz + (uzTo - uz) * 0.15;
      apply();
      if (auto || Math.abs(target - pos) > 0.3 || tilt !== tiltTo || uz !== uzTo) raf = requestAnimationFrame(tick);
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
    // приблизить (dir > 0) или отдалить; прогулка при этом не останавливается
    const zoomBy = (dir) => {
      uzTo = Math.max(ZMIN, Math.min(ZMAX, uzTo * (dir > 0 ? 1.15 : 1 / 1.15)));
      host._zoom = uzTo;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // к соседней звезде: от той, к которой уже идём (несколько нажатий подряд — несколько звёзд)
    const step = (dir) => {
      setAuto(false);
      const t = topView ? W3_TILT_TOP : W3_TILT;
      const cur = starAt(target, t);
      const k = cur === -1 ? starIdx.length : starIdx.indexOf(cur);
      const n = k + dir;
      if (n < 0 || (cur === -1 && dir > 0)) return;
      target = n >= starIdx.length ? maxPos : Math.max(0, Math.min(maxPos, rows[starIdx[n]].z - lookAt(t)));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // Забег за ремонтом. На время игры 3D-сцена (небо и улица) снимается со страницы — игре ничего не мешает.
    // После игры страница просто перезагружается, как будто вкладку открыли заново, и аллея начинается с начала:
    // браузер рисует тяжёлую 3D-сцену с чистого листа, без остатков игры и без дорисовки сцены задом наперёд.
    // Приложение на телефоне по метке в sessionStorage снова откроет аллею (в расширении это делает #fame в адресе).
    let gaming = false;
    const startRun = () => {
      if (gaming) return;
      setAuto(false);
      cancelAnimationFrame(raf);
      raf = 0;
      gaming = true;
      for (const el of [w3.querySelector('.w3-sky'), view, w3.querySelector('.w3-load')]) el?.remove();
      w3.classList.remove('loading');
      w3.classList.add('w3-game');
      host.classList.add('w3-gaming');
      // на телефоне игра — на весь экран (по стилям — поверх всего; где браузер умеет — ещё и без его полос)
      if (phone) w3.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
      let list = typeof racers === 'function' ? racers() : racers;
      if (!list?.length) list = rows.filter((r) => r.kind === 'ch' && r.name).map((r) => ({ name: r.name }));
      fameRun(w3, {
        racers: list,
        // упрощать игру — только на действительно слабом устройстве, а не просто на телефоне
        lowfx: cores <= 4 || mem <= 4,
        onExit: () => {
          if (!w3.isConnected) return; // аллею за время игры уже пересобрали — перезагружать незачем
          try {
            sessionStorage.setItem('smotribelno:reopen', 'fame');
          } catch {
            // хранилище недоступно — откроется главная, не страшно
          }
          location.reload();
        },
      });
    };
    // переход сразу на нужный бульвар
    w3.addEventListener('click', (e) => {
      if (e.target.closest('.w3-rungo')) return startRun();
      const st = e.target.closest('[data-step]');
      if (st) return step(Number(st.dataset.step));
      const zb = e.target.closest('[data-zoom]');
      if (zb) return zoomBy(Number(zb.dataset.zoom));
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
      const sd = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
      if (sd) {
        e.preventDefault();
        return step(sd);
      }
      // + и − (и на основной клавиатуре: «=» — это «+» без Shift)
      const zd = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 }[e.code];
      if (zd && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        return zoomBy(zd);
      }
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
          return fameWalk(host, { items, onOpen, lite: liteAsked, racers, onBuilt });
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
  // ---- Банк монет, гардероб и гараж — на всех устройствах ----
  // Банк не хранит одно число (два устройства задвоили бы его при слиянии):
  // 'fameWallet' = { earned: { устройство: сколько всего собрано там }, bought: { вещь: { item, cost, at } } },
  // баланс = Σearned − Σcost. Каждое устройство растит только свой счётчик, поэтому слияние — максимум по устройству.
  // 'fameDev' — номер этого устройства, на другие устройства не уезжает. Старое число 'fameRunCoins' один раз
  // становится earned['old…'] с номером из самих старых данных: если переезд одновременно сделают две части
  // расширения (вкладка и фон), они запишут одно и то же, а не два счётчика.
  // Хранится там же, где рекорд: chrome.storage.local, на телефоне — localStorage.
  const RUN_BANK = 'fameRunCoins';
  const WALLET = 'fameWallet';
  const RUN_DEV = 'fameDev';
  const LOOKS_KEY = 'fameLooks';
  const OWNED_KEY = 'fameOwned';
  async function wardRead(k) {
    try {
      const st = globalThis.chrome?.storage?.local;
      return st ? (await st.get(k))[k] : JSON.parse(localStorage.getItem('smotribelno:' + k) || 'null');
    } catch {
      return null;
    }
  }
  async function wardWrite(k, v) {
    try {
      const st = globalThis.chrome?.storage?.local;
      if (st) return await st.set({ [k]: v });
      localStorage.setItem('smotribelno:' + k, JSON.stringify(v));
      // на телефоне — знак «гардероб поменялся»: приложение отправит его на Диск
      globalThis.dispatchEvent?.(new CustomEvent('smotribelno:wardrobe', { detail: k }));
    } catch {
      // хранилище недоступно (приватное окно) — изменения живут до закрытия
    }
  }
  // все записи банка и гардероба идут по очереди, чтобы две подряд не потеряли друг друга
  let wardQ = Promise.resolve();
  const wardDo = (fn) => {
    const p = wardQ.then(fn);
    wardQ = p.catch(() => {});
    return p;
  };
  // номер устройства — один на страницу (повторные вызовы ждут первый)
  let devP = null;
  const runDevice = () =>
    (devP ||= (async () => {
      const v = await wardRead(RUN_DEV);
      if (typeof v === 'string' && /^[\w-]{4,40}$/.test(v)) return v;
      const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await wardWrite(RUN_DEV, id);
      return id;
    })());
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const okKey = (k) => !!k && k.length <= 200 && k !== '__proto__';
  function walletOf(w) {
    const out = { earned: {}, bought: {} };
    if (!isObj(w)) return out;
    for (const [d, n] of Object.entries(isObj(w.earned) ? w.earned : {})) if (okKey(d) && Number.isFinite(n) && n > 0) out.earned[d] = Math.round(n);
    for (const [id, b] of Object.entries(isObj(w.bought) ? w.bought : {})) {
      if (okKey(id) && isObj(b) && Number.isFinite(b.cost) && b.cost >= 0) out.bought[id] = { item: String(b.item || id).slice(0, 200), cost: Math.round(b.cost), at: Number(b.at) || 0 };
    }
    return out;
  }
  function walletBalance(w) {
    const x = walletOf(w);
    let n = 0;
    for (const e of Object.values(x.earned)) n += e;
    for (const b of Object.values(x.bought)) n -= b.cost;
    return Math.max(0, n);
  }
  // слияние банков: собранное — максимум по устройству, покупки — объединение (одна вещь — одна покупка, ранняя)
  function mergeWallet(a, b) {
    const x = walletOf(a);
    const y = walletOf(b);
    const out = { earned: { ...x.earned }, bought: { ...x.bought } };
    for (const [d, n] of Object.entries(y.earned)) out.earned[d] = Math.max(out.earned[d] || 0, n);
    for (const [id, p] of Object.entries(y.bought)) {
      const q = out.bought[id];
      if (!q || p.at < q.at || (p.at === q.at && stableJson(p) < stableJson(q))) out.bought[id] = p;
    }
    return out;
  }
  // банк этого устройства; при первом чтении старое число монет переезжает в earned['old' + номер старых данных]
  async function walletLoad() {
    const w = await wardRead(WALLET);
    if (isObj(w)) return walletOf(w);
    const old = Math.round(Number(await wardRead(RUN_BANK)) || 0);
    let h = 2166136261;
    for (const c of `${old}|${Number(await wardRead(RUN_BEST)) || 0}|${stableJson(await wardRead(OWNED_KEY))}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const out = { earned: old > 0 ? { ['old' + h.toString(36)]: old } : {}, bought: {} };
    await wardWrite(WALLET, out);
    return out;
  }
  // Банк монет: всё, что собрано во всех забегах, минус покупки. add — сколько положить, без add — прочитать баланс.
  function runBank(add = 0) {
    return wardDo(async () => {
      const w = await walletLoad();
      if (add > 0) {
        const d = await runDevice();
        w.earned[d] = (w.earned[d] || 0) + Math.round(add);
        await wardWrite(WALLET, w);
      }
      return walletBalance(w);
    });
  }
  // списать монеты за вещь item (покупка в гардеробе): вернёт остаток, или −1, если монет не хватает.
  // Вещь, уже купленная здесь или на другом устройстве, второй раз не оплачивается.
  function runSpend(cost, item) {
    return wardDo(async () => {
      const w = await walletLoad();
      const id = String(item || 'x' + Date.now().toString(36));
      if (w.bought[id]) return walletBalance(w);
      if (!(cost >= 0) || walletBalance(w) < cost) return -1;
      w.bought[id] = { item: id, cost: Math.round(cost), at: Date.now() };
      await wardWrite(WALLET, w);
      return walletBalance(w);
    });
  }
  // из двух записей — с более новым at; при равном — одна и та же на обоих устройствах
  const newerOf = (l, r) => {
    const a = Number(l.at) || 0;
    const b = Number(r.at) || 0;
    return b > a || (b === a && stableJson(r) > stableJson(l)) ? r : l;
  };
  // Образы каналов: по каналу — где at новее; за кого играем — что выбрано позже (playerAt)
  function cleanLook(o) {
    const out = {};
    for (const [k, v] of Object.entries(isObj(o) ? o : {})) if (okKey(k) && ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    return out;
  }
  function mergeLooks(a, b) {
    const x = isObj(a) ? a : {};
    const y = isObj(b) ? b : {};
    // при равном времени (у образов до синхронизации его нет) — выбранный канал, а не «никто»; дальше — по имени,
    // чтобы оба устройства выбрали одно и то же
    const pk = (o) => [Number(o.playerAt) || 0, typeof o.player === 'string' ? 1 : 0, String(o.player || '')];
    const [ax, bx] = [pk(x), pk(y)];
    const p = bx[0] !== ax[0] ? (bx[0] > ax[0] ? y : x) : bx[1] !== ax[1] ? (bx[1] > ax[1] ? y : x) : bx[2] > ax[2] ? y : x;
    const player = typeof p.player === 'string' && okKey(p.player) ? p.player : null;
    const out = { player, playerName: player && typeof p.playerName === 'string' ? p.playerName.slice(0, 200) : null, playerAt: Number(p.playerAt) || 0, ch: {} };
    const cx = isObj(x.ch) ? x.ch : {};
    const cy = isObj(y.ch) ? y.ch : {};
    for (const k of new Set([...Object.keys(cx), ...Object.keys(cy)])) {
      if (!okKey(k)) continue;
      const l = isObj(cx[k]) ? cx[k] : null;
      const r = isObj(cy[k]) ? cy[k] : null;
      const w = !l ? r : !r ? l : newerOf(l, r);
      if (w) out.ch[k] = { name: String(w.name || k).slice(0, 200), runner: cleanLook(w.runner), car: cleanLook(w.car), at: Number(w.at) || 0 };
    }
    return out;
  }
  // купленные вещи — объединение, время покупки — раннее
  function mergeOwned(a, b) {
    const out = {};
    for (const o of [a, b]) for (const [k, t] of Object.entries(isObj(o) ? o : {})) if (okKey(k) && Number.isFinite(t)) out[k] = k in out ? Math.min(out[k], t) : t;
    return out;
  }
  // Всё вместе — для Диска и файла обмена: { looks, owned, wallet, best }
  function mergeWardrobe(a, b) {
    return {
      looks: mergeLooks(a?.looks, b?.looks),
      owned: mergeOwned(a?.owned, b?.owned),
      wallet: mergeWallet(a?.wallet, b?.wallet),
      best: Math.max(Math.round(Number(a?.best) || 0), Math.round(Number(b?.best) || 0)),
    };
  }
  const wardrobeRead = async () => ({ looks: await wardRead(LOOKS_KEY), owned: await wardRead(OWNED_KEY), wallet: await walletLoad(), best: Number(await wardRead(RUN_BEST)) || 0 });
  // гардероб этого устройства целиком (для Диска и файла обмена)
  const wardrobeGet = () => wardDo(async () => mergeWardrobe(await wardrobeRead(), null));
  // пришло с другого устройства: слить с тем, что лежит здесь прямо сейчас, и записать изменившееся.
  // Вернёт true, если здесь что-то поменялось.
  function wardrobeApply(inc) {
    if (!isObj(inc)) return Promise.resolve(false);
    return wardDo(async () => {
      const cur = await wardrobeRead();
      const was = mergeWardrobe(cur, null);
      const m = mergeWardrobe(cur, inc);
      const put = [];
      if (stableJson(m.looks) !== stableJson(was.looks)) put.push(wardWrite(LOOKS_KEY, m.looks));
      if (stableJson(m.owned) !== stableJson(was.owned)) put.push(wardWrite(OWNED_KEY, m.owned));
      if (stableJson(m.wallet) !== stableJson(was.wallet)) put.push(wardWrite(WALLET, m.wallet));
      if (m.best > was.best) put.push(runBest(m.best));
      await Promise.all(put);
      return put.length > 0;
    });
  }
  // racers: [{ name, icon, tier, dressed }] — каналы для машин, до 48; tier — откуда канал: 'star' — со звездой на аллее,
  // 'top' — из лучших по оценкам, 'time' — из самых просматриваемых; dressed — наряженный в гараже (на будущее).
  // lowfx — слабое устройство; onExit() — вернулись на аллею
  function fameRun(box, { racers = [], lowfx = false, onExit } = {}) {
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const RC = racers.filter((r) => r && String(r.name || '').trim()).slice(0, 48);
    if (!RC.length) RC.push({ name: 'Смотрибельно' });
    const wrap = document.createElement('div');
    wrap.className = 'w3-run';
    wrap.innerHTML = '<canvas></canvas><button type="button" class="wr-x" aria-label="Вернуться на аллею" title="Вернуться на аллею (Esc)">✕</button><div class="wr-over" hidden></div>';
    box.appendChild(wrap);
    const cv = wrap.querySelector('canvas');
    const ctx = cv.getContext('2d', { alpha: false }); // каждый кадр закрашен целиком — прозрачность не нужна
    const over = wrap.querySelector('.wr-over');
    const touch = matchMedia('(pointer: coarse)').matches;
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      return c;
    };
    // каждый запуск — свой: другие каналы на машинах, другой порядок домов
    let seed = (Math.random() * 4294967296) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rint = (n) => Math.floor(rnd() * n);
    const lerp = (a, b, t) => a + (b - a) * t;
    // Машины идут из перемешанного «мешка»: в нём каждый канал столько раз, каков его вес — со звездой ×3,
    // лучшие по оценкам ×2, просматриваемые ×1, наряженные +3. Так все каналы мелькают, звёздные — чаще, подряд не повторяются
    let bag = [];
    let lastR = -1;
    const nextRacer = () => {
      if (!bag.length) {
        bag = RC.flatMap((r, i) => Array((r.tier === 'star' ? 3 : r.tier === 'top' ? 2 : 1) + (r.dressed ? 3 : 0)).fill(i));
        for (let i = bag.length - 1; i > 0; i--) {
          const j = rint(i + 1);
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      let k = bag.length - 1;
      if (bag[k] === lastR && k > 0) k = rint(k);
      lastR = bag.splice(k, 1)[0];
      return lastR;
    };
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
    // Машина канала навстречу — из его гаража (модель, покраска, украшения; пока не наряжена — седан своего цвета),
    // на табличке аватарка канала. 150 единиц рисунка = ширина машины CAR_W
    const CAR_W = 2.3;
    const CARS = RC.map((r) => DRESS.carDefault(r.name));
    const carOf = (i) => {
      const k = 256 / 150;
      const c = mk(256, 156 * k);
      const g = c.getContext('2d');
      g.scale(k, k);
      g.translate(0, 46);
      DRESS.drawCar(g, CARS[i], 0, ava[i], DRESS.initials(RC[i].name));
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
    // Шлагбаум — высокая рама 3 м, широкий щит в жёлто-чёрную полоску висит над землёй, снизу просвет:
    // сразу видно, что только прокатиться под ним. Стрелки вниз по бокам, аватарка канала — на щите.
    // Единица — 2,4 м / 130; земля — y = 164, щит — от 0,95 до 2,5 м
    const HIGH_W = 2.4;
    const HIGH_AVA = 93 / 164; // высота середины щита — доля высоты картинки
    const highSp = (() => {
      const c = mk(260, 328);
      const g = c.getContext('2d');
      g.scale(2, 2);
      // столбы с мигалками
      g.fillStyle = '#4a4552';
      g.fillRect(3, 10, 9, 154);
      g.fillRect(118, 10, 9, 154);
      g.fillStyle = '#2a2630';
      g.fillRect(0, 158, 15, 6);
      g.fillRect(115, 158, 15, 6);
      g.fillStyle = '#ffae2e';
      g.beginPath();
      g.arc(7.5, 8, 6, 0, PI2);
      g.arc(122.5, 8, 6, 0, PI2);
      g.fill();
      // щит в полоску
      g.fillStyle = '#ffc83d';
      g.fillRect(8, 29, 114, 84);
      g.save();
      g.beginPath();
      g.rect(8, 29, 114, 84);
      g.clip();
      for (let x = -90; x < 130; x += 26) poly(g, [x, 113, x + 13, 113, x + 97, 29, x + 84, 29], '#1d1a22');
      g.restore();
      g.lineWidth = 3;
      g.strokeStyle = '#f4efe6';
      g.strokeRect(9.5, 30.5, 111, 81);
      // стрелки вниз — «под ним»
      for (const x of [26, 104]) {
        g.fillStyle = 'rgba(20,16,26,.85)';
        g.beginPath();
        g.arc(x, 71, 13, 0, PI2);
        g.fill();
        poly(g, [x - 7, 65, x + 7, 65, x + 7, 67, x, 75, x - 7, 67], '#ffc83d');
        poly(g, [x - 7, 72, x + 7, 72, x + 7, 74, x, 82, x - 7, 74], '#ffc83d');
      }
      // тень под щитом — просвет у земли
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(12, 113, 106, 4);
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
    // Сад между тротуаром и домами: лиственное дерево, куст, две клумбы, скамейка у тротуара, пятно света под фонарём
    const treeSp = (() => {
      const c = mk(220, 340);
      const g = c.getContext('2d');
      g.fillStyle = '#3a2a22';
      g.fillRect(100, 200, 20, 140);
      poly(g, [100, 250, 82, 214, 88, 210, 104, 240], '#3a2a22');
      for (const [x, y, r, col] of [[110, 150, 92, '#1d4a31'], [60, 170, 58, '#1f5236'], [160, 168, 58, '#1f5236'], [110, 92, 64, '#256140'], [76, 120, 44, '#2a6b47'], [146, 118, 44, '#2a6b47']]) {
        g.beginPath();
        g.arc(x, y, r, 0, PI2);
        g.fillStyle = col;
        g.fill();
      }
      g.fillStyle = 'rgba(255,214,140,.16)'; // тёплый отсвет фонарей сверху
      g.beginPath();
      g.arc(96, 80, 34, 0, PI2);
      g.fill();
      return c;
    })();
    const bushSp = (() => {
      const c = mk(180, 110);
      const g = c.getContext('2d');
      for (const [x, y, r, col] of [[50, 72, 38, '#1d4a31'], [130, 72, 38, '#1d4a31'], [90, 60, 46, '#235a3b'], [62, 52, 28, '#2a6b47'], [118, 50, 28, '#2a6b47']]) {
        g.beginPath();
        g.arc(x, y, r, 0, PI2);
        g.fillStyle = col;
        g.fill();
      }
      for (const [x, y] of [[60, 40], [96, 30], [126, 46], [80, 62], [112, 66]]) {
        g.beginPath();
        g.arc(x, y, 5, 0, PI2);
        g.fillStyle = '#ff9ad5';
        g.fill();
      }
      return c;
    })();
    const flowerOf = (cols) => {
      const c = mk(260, 100);
      const g = c.getContext('2d');
      g.fillStyle = '#8a8094';
      g.beginPath();
      g.roundRect(4, 54, 252, 40, 14);
      g.fill();
      g.fillStyle = '#3a2a22';
      g.beginPath();
      g.roundRect(12, 50, 236, 30, 12);
      g.fill();
      for (let x = 20, i = 0; x < 240; x += 14, i++) {
        const y = 28 + (i % 3) * 4;
        g.fillStyle = '#2a6b47';
        g.fillRect(x, y + 2, 4, 30);
        g.beginPath();
        g.arc(x + 2, y, 8, 0, PI2);
        g.fillStyle = cols[i % cols.length];
        g.fill();
        g.beginPath();
        g.arc(x + 2, y, 3, 0, PI2);
        g.fillStyle = '#ffe9a8';
        g.fill();
      }
      return c;
    };
    const flowerSp = [flowerOf(['#ff5fa2', '#ffc85f', '#f4efe6']), flowerOf(['#e0453a', '#b28bff', '#ffc85f'])];
    const benchSp = (() => {
      const c = mk(180, 100);
      const g = c.getContext('2d');
      g.fillStyle = '#2a2630';
      for (const x of [20, 150]) g.fillRect(x, 40, 10, 60);
      g.fillStyle = '#8a5a2b';
      for (const y of [8, 26, 52]) g.fillRect(6, y, 168, 12);
      g.fillStyle = '#6b4424';
      g.fillRect(6, 64, 168, 6);
      return c;
    })();
    const poolSp = (() => {
      const c = mk(128, 128);
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(255,214,140,.38)');
      gr.addColorStop(1, 'rgba(255,214,140,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return c;
    })();
    // Дома Лас-Вегаса по сторонам — плоские, но у каждого свой силуэт и свои детали, как у домов на аллее:
    // театр — корпус с фронтоном, крылья пониже, портик с колоннами; казино — башня с уступами, вертикальная вывеска,
    // козырёк на лампочках, корона; кино — ар-деко со скруглённым верхом, марки и вертикальное «КИНО»; отель —
    // узкая высотка с надстройкой, балконами и вывеской на крыше; радио — ступенчатый зиккурат с антенной; бар —
    // фальшфасад с изогнутым верхом и полосатой маркизой; шоу — арка и пилон со звездой; диско — купол и зеркальный
    // шар; обычные дома — с трубой и баком, скошенной крышей или двускатным фронтоном. Вне силуэта — прозрачно.
    // Рисуются один раз при старте (200 точек = 7 м); что торчит над крышей — в той же картинке, сверху.
    const WALLS = ['#4a1f4f', '#1f3f5a', '#5a3a1f', '#3a2a5f', '#5a1f35', '#1f4a45', '#2a3350', '#4f2a2a'];
    const TRIMS = ['#ff5fa2', '#5fe1ff', '#ffc85f', '#b28bff', '#ff6b5f', '#5fffb0', '#7fb2ff', '#ff8a3d'];
    const BLD_W = 7;
    const BWP = 200;
    const LIT = () => (rnd() < 0.5 ? '#ffd27a' : '#ffb85c');
    const facade = (kind, wall, trim) => {
      const TOP = { theater: 40, casino: 52, cinema: 66, hotel: 64, radio: 128, bar: 28, show: 104, disco: 40, brick: 82, office: 50, shop: 36 }[kind] || 0;
      const H = ({ theater: 300, casino: 340, cinema: 300, hotel: 400, radio: 300, bar: 240, show: 320, disco: 280, brick: 330, office: 420, shop: 260 }[kind] || 300) + rint(3) * 20;
      const c = mk(BWP, TOP + H);
      const g = c.getContext('2d');
      g.translate(0, TOP); // y = 0 — линия крыши, выше — минус; y = H — тротуар
      const R = (x, y, w, h, f) => {
        g.fillStyle = f;
        g.fillRect(x, y, w, h);
      };
      const lin = (x0, y0, x1, y1, a, b) => {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, a);
        gr.addColorStop(1, b);
        return gr;
      };
      const dot = (x, y, r, f) => {
        g.beginPath();
        g.arc(x, y, r, 0, PI2);
        g.fillStyle = f;
        g.fill();
      };
      const wins = (x0, y0, x1, y1, w, h, sx, sy, p, off = '#120f17') => {
        for (let y = y0; y + h <= y1; y += sy) for (let x = x0; x + w <= x1; x += sx) R(x, y, w, h, rnd() < p ? LIT() : off);
      };
      const bulbs = (x0, y0, x1, y1, step) => {
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
        for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 2.4, '#ffe9a8');
      };
      const neon = (t, x, y, size, col) => {
        g.font = `800 ${size}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = col;
        g.shadowBlur = 10;
        g.fillStyle = col;
        g.fillText(t, x, y);
        g.shadowBlur = 0;
      };
      const text = (t, x, y, size, col) => {
        g.font = `800 ${size}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = col;
        g.fillText(t, x, y);
      };
      const vneon = (t, x, y0, step, size, col) => [...t].forEach((ch, i) => neon(ch, x, y0 + i * step, size, col));
      const star = (x, y, r, f) => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const q = i % 2 ? r * 0.42 : r;
          g.lineTo(x + q * Math.cos(a), y + q * Math.sin(a));
        }
        g.closePath();
        g.fillStyle = f;
        g.fill();
      };
      // силуэт по точкам (ломаная) — для clip и обводки
      const outline = (pts) => () => {
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.closePath();
      };
      // Дом: силуэт (shape), всё внутри — по силуэту (body), обводка, потом то, что торчит наружу (extra)
      const house = (shape, body, extra) => {
        g.save();
        shape();
        g.clip();
        body();
        // лёгкий свет сверху и тень снизу — плоский дом, но не плоская заливка
        R(0, -TOP, BWP, H + TOP, lin(0, -TOP, 0, H, 'rgba(255,255,255,.06)', 'rgba(0,0,0,.22)'));
        g.restore();
        shape();
        g.lineJoin = 'round';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(8,6,12,.55)';
        g.stroke();
        extra?.();
      };
      const fill = (a, b) => R(0, -TOP, BWP, H + TOP, lin(0, 0, BWP, 0, a, b));

      if (kind === 'theater') {
        // корпус с фронтоном посередине, крылья ниже, портик с колоннами и ступенями
        const P = H - 200;
        house(
          outline([0, H, 0, 70, 34, 70, 34, 4, 100, -34, 166, 4, 166, 70, 200, 70, 200, H]),
          () => {
            fill('#ddd0b4', '#9c8c72');
            for (let y = 80; y < P; y += 14) R(0, y, BWP, 1.5, 'rgba(90,75,55,.35)');
            poly(g, [44, 4, 156, 4, 100, -24], '#cbbd9f');
            dot(100, -8, 9, '#ffd27a');
            R(34, 4, 132, 8, '#ece2c8');
            R(0, 70, 34, 8, '#ece2c8');
            R(166, 70, 34, 8, '#ece2c8');
            for (const x of [46, 86, 126])
              for (let y = 26; y + 46 < P; y += 64) {
                const f = rnd() < 0.7 ? LIT() : '#2a2018';
                R(x, y + 12, 26, 34, f);
                dot(x + 13, y + 12, 13, f);
              }
            for (const x of [8, 174]) for (let y = 92; y + 30 < P; y += 50) R(x, y, 18, 28, rnd() < 0.6 ? LIT() : '#2a2018');
            poly(g, [4, P + 50, 196, P + 50, 100, P], '#e8dcbe');
            poly(g, [26, P + 44, 174, P + 44, 100, P + 12], '#cbbd9f');
            R(4, P + 50, 192, 16, '#e2d6b8');
            text('ТЕАТР', 100, P + 58, 13, '#5a4a36');
            R(10, P + 66, 180, H - P - 96, 'rgba(40,28,20,.65)');
            R(84, H - 90, 32, 60, '#ffcf7a');
            for (const x of [30, 128]) R(x, H - 104, 24, 34, '#c9963f'), R(x + 3, H - 101, 18, 28, x < 100 ? '#7a2a2a' : '#2a4a6a');
            for (let i = 0; i < 6; i++) {
              const x = 14 + i * 31;
              R(x, P + 70, 12, H - P - 100, lin(x, 0, x + 12, 0, '#a89a80', '#f4ead0'));
              R(x - 3, P + 66, 18, 5, '#ece2c8');
              R(x - 3, H - 32, 18, 4, '#ece2c8');
            }
            for (let k = 0; k < 3; k++) R(2 + k * 6, H - 28 + k * 9, BWP - 4 - k * 12, 10, shade('#cbbd9f', -0.1 * k));
          }
        );
      } else if (kind === 'casino') {
        // башня с уступами, окна-ромбы, корона, вертикальная вывеска, козырёк на лампочках, арка входа
        house(
          outline([0, H, 0, 96, 22, 96, 22, 34, 52, 34, 52, 0, 148, 0, 148, 34, 178, 34, 178, 96, 200, 96, 200, H]),
          () => {
            fill('#8a1828', '#3a0812');
            for (let y = 20; y < H - 100; y += 62) R(0, y, BWP, 6, '#c9963f');
            for (let y = 50; y < H - 110; y += 62)
              for (let x = 66; x < 186; x += 30) poly(g, [x, y - 10, x + 10, y, x, y + 10, x - 10, y], rnd() < 0.7 ? '#ffd27a' : '#5a1020');
            R(0, H - 100, BWP, 22, '#c9963f');
            R(0, H - 78, BWP, 6, 'rgba(0,0,0,.35)');
            g.beginPath();
            g.moveTo(84, H);
            g.lineTo(84, H - 40);
            g.arc(116, H - 40, 32, Math.PI, 0);
            g.lineTo(148, H);
            g.fillStyle = '#ffd27a';
            g.fill();
            R(98, H - 46, 36, 46, '#b8442a');
          },
          () => {
            poly(g, [58, 0, 142, 0, 150, -34, 126, -14, 100, -46, 74, -14, 50, -34], '#e0b45a');
            R(58, -8, 84, 8, '#c9963f');
            for (const [x, y, f] of [[100, -32, '#ff5fa2'], [76, -10, '#5fe1ff'], [124, -10, '#5fffb0']]) dot(x, y, 5, f);
            R(4, 40, 40, 200, '#a0182c');
            R(4, 40, 40, 4, '#c9963f');
            R(4, 236, 40, 4, '#c9963f');
            bulbs(8, 48, 8, 232, 12);
            bulbs(40, 48, 40, 232, 12);
            vneon('КАЗИНО', 24, 64, 32, 24, '#ffe08a');
            bulbs(6, H - 89, 194, H - 89, 12);
          }
        );
      } else if (kind === 'cinema') {
        // ар-деко: скруглённый верх с выступом посередине, марки с лампочками, вертикальное «КИНО»
        house(
          () => {
            g.beginPath();
            g.moveTo(8, H);
            g.lineTo(8, 50);
            g.arcTo(8, 10, 48, 10, 40);
            g.lineTo(70, 10);
            g.lineTo(70, -14);
            g.arcTo(70, -24, 80, -24, 10);
            g.lineTo(120, -24);
            g.arcTo(130, -24, 130, -14, 10);
            g.lineTo(130, 10);
            g.lineTo(152, 10);
            g.arcTo(192, 10, 192, 50, 40);
            g.lineTo(192, H);
            g.closePath();
          },
          () => {
            fill('#17505a', '#0b2226');
            for (let y = 30; y < H - 140; y += 54) R(0, y, BWP, 3, trim);
            for (let x = 30; x < 180; x += 20) R(x, 14, 2, H - 160, 'rgba(255,255,255,.06)');
            wins(18, 44, 76, H - 150, 16, 14, 24, 30, 0.35);
            wins(126, 44, 190, H - 150, 16, 14, 24, 30, 0.35);
            R(8, H - 70, BWP, 70, '#0b1a1e');
            for (const x of [14, 150]) R(x, H - 66, 36, 52, '#c9963f'), R(x + 4, H - 62, 28, 44, rnd() < 0.5 ? '#7a2a3a' : '#2a3a7a');
            R(70, H - 64, 60, 64, '#ffcf7a');
          },
          () => {
            R(80, -62, 40, 210, '#1e1b22');
            bulbs(84, -56, 84, 142, 12);
            bulbs(116, -56, 116, 142, 12);
            vneon('КИНО', 100, -38, 44, 30, trim);
            // марки — треугольный козырёк с буквами и лампочками
            poly(g, [0, H - 136, 200, H - 136, 196, H - 82, 4, H - 82], '#f4efe6');
            R(0, H - 142, BWP, 8, trim);
            bulbs(8, H - 138, 192, H - 138, 12);
            bulbs(8, H - 80, 192, H - 80, 12);
            text('СЕАНС 19:00', 100, H - 118, 15, '#2a2530');
            text('ПРЕМЬЕРА', 100, H - 98, 15, '#2a2530');
          }
        );
      } else if (kind === 'hotel') {
        // узкая высотка с надстройкой: балконы, вывеска на стойках над крышей, козырёк у входа
        house(
          outline([22, H, 22, 0, 62, 0, 62, -26, 138, -26, 138, 0, 178, 0, 178, H]),
          () => {
            fill(shade(wall, 0.32), shade(wall, -0.25));
            R(62, -26, 76, 26, shade(wall, -0.1));
            for (let x = 70; x < 132; x += 16) R(x, -18, 10, 10, rnd() < 0.5 ? LIT() : '#1a1620');
            for (let y = 20; y < H - 80; y += 40)
              for (let x = 32; x < 170; x += 46) {
                R(x, y, 26, 22, rnd() < 0.5 ? LIT() : '#1a1620');
                R(x - 5, y + 24, 36, 3, '#e8dfc6');
                for (let b = x - 4; b < x + 32; b += 6) R(b, y + 26, 1.5, 9, '#e8dfc6');
                R(x - 5, y + 34, 36, 2, '#e8dfc6');
              }
            R(76, H - 58, 48, 58, '#ffcf7a');
          },
          () => {
            R(54, -34, 4, 10, '#2a2431');
            R(142, -34, 4, 10, '#2a2431');
            R(34, -62, 132, 30, 'rgba(10,8,14,.92)');
            neon('ОТЕЛЬ', 100, -47, 24, trim);
            poly(g, [56, H - 70, 144, H - 70, 150, H - 58, 50, H - 58], trim);
          }
        );
      } else if (kind === 'radio') {
        // зиккурат ар-деко: ступени к башне, пилястры, неон «РАДИО», антенна с красным огоньком
        house(
          outline([0, H, 0, 30, 24, 30, 24, 0, 50, 0, 50, -32, 74, -32, 74, -64, 126, -64, 126, -32, 150, -32, 150, 0, 176, 0, 176, 30, 200, 30, 200, H]),
          () => {
            fill('#1b3262', '#0b1530');
            for (let x = 10; x < BWP; x += 22) R(x, -64, 3, H + 64, '#24407d');
            for (const [x, w, y] of [[0, 200, 30], [24, 152, 0], [50, 100, -32], [74, 52, -64]]) R(x, y, w, 3, '#7fb2ff');
            wins(16, 78, 190, H - 60, 12, 10, 22, 26, 0.3, '#0d1a38');
            R(14, 36, 172, 34, 'rgba(8,12,26,.85)');
            neon('РАДИО', 100, 53, 26, '#7fb2ff');
            R(78, H - 54, 44, 54, '#cfe3ff');
          },
          () => {
            R(97, -124, 6, 60, '#9aa4b8');
            for (const y of [-112, -100, -88]) R(88, y, 24, 2, '#9aa4b8');
            dot(100, -124, 5, '#ff3d3d');
          }
        );
      } else if (kind === 'bar') {
        // фальшфасад с изогнутым верхом, кирпич, полосатая маркиза с фестоном, вывеска на кронштейне
        house(
          () => {
            g.beginPath();
            g.moveTo(0, H);
            g.lineTo(0, 44);
            g.lineTo(28, 44);
            g.lineTo(28, 16);
            g.quadraticCurveTo(100, -40, 172, 16);
            g.lineTo(172, 44);
            g.lineTo(200, 44);
            g.lineTo(200, H);
            g.closePath();
          },
          () => {
            fill('#6a3022', '#3a1812');
            for (let y = -20; y < H; y += 9) {
              R(0, y, BWP, 1.2, '#2e130d');
              for (let x = ((y + 20) / 9) % 2 ? 0 : 12; x < BWP; x += 24) R(x, y, 1.2, 9, '#2e130d');
            }
            R(60, -2, 80, 26, 'rgba(10,8,14,.85)');
            neon('БАР', 100, 11, 20, '#ff8a3d');
            wins(20, 50, 186, H - 120, 22, 26, 40, 46, 0.55, '#1e0f0b');
            R(10, H - 70, 120, 52, '#ff9a4a');
            for (let x = 40; x < 130; x += 30) R(x, H - 70, 2, 52, '#3a1812');
            R(144, H - 72, 40, 72, '#2a1a12');
          },
          () => {
            const ay = H - 108;
            for (let x = 0, i = 0; x < BWP; x += 20, i++) R(x, ay, 20, 24, i % 2 ? '#f4efe6' : trim);
            for (let x = 10, i = 0; x < BWP; x += 20, i++) {
              g.beginPath();
              g.arc(x, ay + 24, 10, 0, Math.PI);
              g.fillStyle = i % 2 ? '#f4efe6' : trim;
              g.fill();
            }
          }
        );
      } else if (kind === 'show') {
        // арка сверху, малиновый фасад со звёздами, лампочки по арке, пилон «ШОУ» со звездой
        house(
          () => {
            g.beginPath();
            g.moveTo(6, H);
            g.lineTo(6, 40);
            g.arc(76, 40, 70, Math.PI, 0);
            g.lineTo(146, H);
            g.closePath();
          },
          () => {
            fill('#7a1452', '#2e0820');
            for (let i = 0; i < 14; i++) star(20 + rnd() * 110, 0 + rnd() * (H - 100), 4 + rnd() * 6, '#e9c46a');
            R(16, H - 72, 120, 72, '#ffd27a');
            R(16, H - 80, 120, 8, '#ff5fa2');
          },
          () => {
            for (let i = 0; i <= 16; i++) dot(76 + 62 * Math.cos(Math.PI + (i * Math.PI) / 16), 40 + 62 * Math.sin(Math.PI + (i * Math.PI) / 16), 2.4, '#ffe9a8');
            R(150, -74, 42, H + 74, '#2e0820');
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(8,6,12,.55)';
            g.strokeRect(150, -74, 42, H + 74);
            bulbs(155, -66, 155, H - 20, 12);
            bulbs(187, -66, 187, H - 20, 12);
            vneon('ШОУ', 171, -44, 46, 32, '#ff5fa2');
            star(171, -88, 16, '#ffd56a');
          }
        );
      } else if (kind === 'disco') {
        // купол над фасадом, мозаика из цветных плиток, неон «ДИСКО», зеркальный шар над входом
        const P5 = ['#ff5fa2', '#5fe1ff', '#ffc85f', '#b28bff', '#5fffb0'];
        house(
          () => {
            g.beginPath();
            g.moveTo(0, H);
            g.lineTo(0, 40);
            g.lineTo(28, 40);
            g.arc(100, 40, 72, Math.PI, 0);
            g.lineTo(200, 40);
            g.lineTo(200, H);
            g.closePath();
          },
          () => {
            fill('#34124c', '#170824');
            g.globalAlpha = 0.8;
            for (let y = -30; y < H - 150; y += 16) for (let x = 6; x < 194; x += 16) if (rnd() < 0.5) R(x, y, 13, 13, P5[rint(5)]);
            g.globalAlpha = 1;
            R(10, 46, 180, 40, 'rgba(10,6,16,.9)');
            [...'ДИСКО'].forEach((ch, i) => neon(ch, 40 + i * 30, 66, 28, P5[i]));
            R(64, H - 74, 72, 74, '#b28bff');
            R(70, H - 68, 60, 68, '#ffd27a');
          },
          () => {
            R(99, H - 150, 2, 24, '#8a8aa0');
            dot(100, H - 104, 24, '#d8d8e6');
            g.strokeStyle = '#8a8aa0';
            g.lineWidth = 1.4;
            for (let k = -2; k <= 2; k++) {
              g.beginPath();
              g.ellipse(100, H - 104, 24, Math.abs(k) * 8 + 2, 0, 0, PI2);
              g.stroke();
              g.beginPath();
              g.ellipse(100, H - 104, Math.abs(k) * 8 + 2, 24, 0, 0, PI2);
              g.stroke();
            }
            dot(92, H - 112, 5, '#fff');
          }
        );
      } else if (kind === 'brick') {
        // доходный дом: труба, выступающий карниз, пожарная лестница, бак на крыше
        house(
          outline([12, H, 12, 0, 140, 0, 140, -30, 160, -30, 160, 0, 188, 0, 188, H]),
          () => {
            fill(shade(wall, 0.08), shade(wall, -0.4));
            R(140, -30, 20, 30, shade(wall, -0.25));
            wins(24, 26, 124, H - 60, 20, 24, 32, 44, 0.4);
            R(12, H - 50, BWP, 50, shade(wall, -0.5));
            R(80, H - 46, 36, 46, '#2a1a12');
            R(22, H - 40, 50, 28, LIT());
            R(126, H - 40, 52, 28, LIT());
          },
          () => {
            R(4, -2, 192, 10, shade(wall, 0.35));
            for (let x = 8; x < 192; x += 10) R(x, 8, 5, 5, shade(wall, 0.25));
            for (let y = 60; y < H - 50; y += 44) {
              R(118, y, 74, 3, '#1c1820');
              for (let x = 120; x < 192; x += 6) R(x, y - 12, 1.2, 12, '#1c1820');
              g.strokeStyle = '#1c1820';
              g.lineWidth = 2.4;
              g.beginPath();
              g.moveTo(124, y);
              g.lineTo(184, y + 44);
              g.stroke();
            }
            for (const x of [44, 52, 80, 88]) R(x, -24, 3, 22, '#241c17');
            R(40, -62, 52, 40, '#6b4a32');
            for (const y of [-54, -44, -34]) R(40, y, 52, 2, '#3a281c');
            poly(g, [36, -62, 96, -62, 66, -80], '#3a2a22');
          }
        );
      } else if (kind === 'office') {
        // высотка в стекле со скошенной крышей и антенной
        house(
          outline([18, H, 18, 26, 182, -24, 182, H]),
          () => {
            fill('#2d3a52', '#151c2a');
            for (let y = -24; y < H - 50; y += 22) {
              R(0, y + 17, BWP, 3, '#3c4c6a');
              for (let x = 22; x < 180; x += 23) R(x, y, 19, 16, rnd() < 0.3 ? '#cfe3ff' : rnd() < 0.3 ? LIT() : '#1a2234');
            }
            R(0, H - 50, BWP, 50, '#10151f');
            R(60, H - 44, 80, 44, '#cfe3ff');
          },
          () => {
            R(166, -48, 3, 30, '#9aa4b8');
            dot(167.5, -48, 3.5, '#ff3d3d');
          }
        );
      } else {
        // дом с лавкой под двускатной крышей: окно-розетка во фронтоне, вывеска, маркиза, витрина
        house(
          outline([4, H, 4, 44, 100, -32, 196, 44, 196, H]),
          () => {
            fill(shade(wall, 0.18), shade(wall, -0.3));
            dot(100, 14, 14, rnd() < 0.6 ? LIT() : '#1a1620');
            R(4, 40, 192, 6, shade(wall, 0.4));
            wins(20, 62, 186, H - 110, 26, 30, 44, 48, 0.45);
            R(14, H - 58, 110, 50, LIT());
            R(140, H - 58, 40, 58, '#2a1a12');
          },
          () => {
            R(10, H - 104, 180, 28, '#f4efe6');
            text(['АПТЕКА', 'ЦВЕТЫ', 'КНИГИ', 'КОФЕ', 'ПЕКАРНЯ', 'МУЗЫКА'][rint(6)], 100, H - 90, 17, shade(trim, -0.45));
            poly(g, [0, H - 76, BWP, H - 76, BWP - 8, H - 60, 8, H - 60], trim);
          }
        );
      }
      return c;
    };
    const KINDS = ['theater', 'casino', 'cinema', 'hotel', 'radio', 'bar', 'show', 'disco', 'brick', 'brick', 'office', 'shop', 'shop'];
    const bld = KINDS.map((kind, i) => facade(kind, WALLS[i % WALLS.length], TRIMS[(i * 3) % TRIMS.length]));
    // порядок домов вдоль улицы: заранее и так, чтобы рядом не стояли два одинаковых
    const bldSeq = [];
    for (let i = 0; i < 64; i++) {
      let v;
      do v = rint(bld.length);
      while (v === bldSeq[i - 1] || v === bldSeq[i - 2]);
      bldSeq.push(v);
    }

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
        if (!img.naturalWidth || gone) return; // игру уже закрыли — машину не перерисовываем
        ava[i] = avaOf(i, img);
        carSp[i] = carOf(i);
        avaOk[i] = true;
      };
      img.src = rc.icon;
    });

    // Бегун — образ канала, за которого играем (выбирается в профиле канала), иначе стандартный курьер.
    // Образы читаются из хранилища, пока идёт вступление; машины и бегун потом перерисовываются один раз.
    let PLAYER = DRESS.DEF;
    let PNAME = '';
    let faceSp = null;
    DRESS.looksGet().then((d) => {
      if (gone) return;
      RC.forEach((r, i) => {
        const L = DRESS.lookOf(d, r.name);
        CARS[i] = L.car;
        r.dressed = L.dressed; // наряженные каналы чаще попадаются в забеге
        carSp[i] = carOf(i);
      });
      bag = [];
      if (d.player) {
        PLAYER = { ...DRESS.DEF, ...(d.ch[d.player]?.runner || {}) };
        PNAME = d.playerName || d.ch[d.player]?.name || '';
        if (W) buildPlayer();
      }
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
      // чёткость: на телефоне экран плотный — меньше 1,5 точки на пиксель уже заметно мылит
      Q = Math.min(devicePixelRatio || 1, lowfx ? 1.5 : 2);
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
      buildPlayer();
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
    // Кадры бегуна (из гардероба: 0–5 — бег, 6 — прыжок, 7 — перекат, 8 — сбит) и его портрет для угла экрана
    function buildPlayer() {
      pl = mk(PW * Q * 9, PHt * 1.1 * Q);
      const p = pl.getContext('2d');
      p.scale(Q, Q);
      for (let fr = 0; fr < 9; fr++) {
        p.save();
        p.translate(fr * PW + PW / 2 - PHt / 2, PHt * 0.05);
        p.scale(PHt / 100, PHt / 100);
        DRESS.runner(p, fr, PLAYER);
        p.restore();
      }
      const M = faceM();
      faceSp = mk(M * Q, M * Q);
      const f = faceSp.getContext('2d');
      f.scale(Q, Q);
      f.save();
      f.beginPath();
      f.arc(M / 2, M / 2, M / 2 - 2, 0, PI2);
      f.fillStyle = '#2a1838';
      f.fill();
      f.clip();
      f.translate(0, M * 0.06);
      f.scale(M / 100, M / 100);
      DRESS.portrait(f, { ...PLAYER, gesture: 'none' });
      f.restore();
      f.strokeStyle = '#f2d68a';
      f.lineWidth = 2.5;
      f.beginPath();
      f.arc(M / 2, M / 2, M / 2 - 2, 0, PI2);
      f.stroke();
    }
    const faceM = () => Math.round(Math.max(40, Math.min(64, W / 16)));
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
    let bank = 0; // монет в банке (до этого забега)
    let banked = false; // монеты этого забега уже в банке
    let saving = Promise.resolve(); // запись рекорда и банка — перед выходом дожидаемся
    runBest().then((b) => (best = Math.max(best, b)));
    runBank().then((b) => (bank = b));
    // монеты забега — в банк (один раз за забег)
    const deposit = () => {
      if (banked) return saving;
      banked = true;
      const add = coins;
      if (!add) return saving;
      bank += add;
      saving = Promise.all([saving, runBank(add)]).then(([, total]) => {
        if (total) bank = total;
        const el = over.querySelector('.wr-bank');
        if (el) el.textContent = bank;
      });
      return saving;
    };
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
      const r = nextRacer;
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
      banked = false;
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
      // улица поперёк: дорога | бордюр | тротуар из плитки | бортовой камень | газон с садом | площадь у домов
      band(-30, 30, '#1c1722');
      band(-9, 9, '#1d3a2a');
      band(-6.65, 6.65, '#6e6577');
      band(-6.5, 6.5, '#3d3242');
      band(-4.15, 4.15, '#8f8598');
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
        // плитка тротуаров по обе стороны дороги
        for (let sd = -1; sd <= 1; sd += 2) {
          ctx.moveTo(SX(sd * 4.15, z), y);
          ctx.lineTo(SX(sd * 6.5, z), y);
        }
      }
      // продольный стык плитки
      for (let sd = -1; sd <= 1; sd += 2) {
        ctx.moveTo(SX(sd * 5.3, ZN), SY(0, ZN));
        ctx.lineTo(SX(sd * 5.3, 45), SY(0, 45));
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
      // стоячая картинка на земле: x — середина, w — ширина, h — высота (метры)
      const stand = (sp, x, z, w, h) => {
        const l = SX(x - w / 2, z);
        const r = SX(x + w / 2, z);
        if (r < 0 || l > W || r - l > nearBig || r - l < 1) return;
        const top = SY(h, z);
        ctx.drawImage(sp, l, top, r - l, SY(0, z) - top);
      };
      for (let k = kF; k >= kN - 1; k--) {
        const odd = k & 1;
        // в каждом отрезке 8 м, от дальнего к ближнему: пальма/дерево, фонарь/скамейка, куст, клумба, дом
        const z6 = k * BS + 6 - cz;
        if (z6 > 1.2 && z6 < FAR) {
          ctx.globalAlpha = fogA(z6);
          for (let s = -1; s <= 1; s += 2) {
            if (odd) stand(palmSp, s * 7.9, z6, 3.2, 6);
            else stand(treeSp, s * 8, z6, 3.4, 5.2);
          }
        }
        const z4 = k * BS + 4 - cz;
        if (z4 > 1.2 && z4 < FAR) {
          ctx.globalAlpha = fogA(z4);
          if (odd) {
            if (!lowfx && z4 < 60)
              // пятно света под фонарём — лежит на тротуаре
              for (let s = -1; s <= 1; s += 2) {
                const ya = SY(0, z4 + 1.3);
                const yb = SY(0, Math.max(0.9, z4 - 1.3));
                const l = SX(s * 4.9 - 1.6, z4);
                ctx.drawImage(poolSp, l, ya, SX(s * 4.9 + 1.6, z4) - l, yb - ya);
              }
            for (let s = -1; s <= 1; s += 2) stand(lampSp, s * 4.5, z4, 0.98, 4.2);
          } else if (z4 < 70) for (let s = -1; s <= 1; s += 2) stand(benchSp, s * 6.05, z4, 1.6, 0.9);
        }
        const z2 = k * BS + 2.5 - cz;
        if (z2 > 1.2 && z2 < 80) {
          ctx.globalAlpha = fogA(z2);
          for (let s = -1; s <= 1; s += 2) stand(bushSp, s * 7.1, z2, 1.4, 0.85);
        }
        const z1 = k * BS + 1 - cz;
        if (z1 > 1.2 && z1 < 80) {
          ctx.globalAlpha = fogA(z1);
          for (let s = -1; s <= 1; s += 2) stand(flowerSp[(k + (s > 0 ? 1 : 0)) & 1], s * 8.1, z1, 2.3, 0.85);
        }
        const zb = k * BS - cz;
        if (zb > 1.2 && zb < FAR) {
          ctx.globalAlpha = fogA(zb);
          for (let s = -1; s <= 1; s += 2) {
            const sp = bld[bldSeq[(k * 2 + (s > 0 ? 1 : 0)) & 63]];
            const x = s * 12.6;
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
          ctx.drawImage(ava[o.r], xc - a / 2, bot - h * HIGH_AVA - a / 2, a, a);
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
      ctx.fillText(`${coins}   ·   в банке ${bank + (banked ? 0 : coins)}   ·   рекорд ${Math.max(best, 0)}`, 22 + fs * 0.62, 22 + fs);
      if (faceSp) {
        const M = faceM();
        ctx.drawImage(faceSp, W - 16 - M, 56, M, M);
        if (PNAME) {
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(244,239,230,.85)';
          ctx.fillText(PNAME.length > 22 ? PNAME.slice(0, 21) + '…' : PNAME, W - 16, 60 + M);
          ctx.textAlign = 'left';
        }
      }
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
      deposit();
      const rc = RC[killer] || RC[0];
      const pic = rc.icon && avaOk[killer] ? `<img src="${escH(rc.icon)}" alt="" referrerpolicy="no-referrer">` : escH(initials(rc.name));
      over.innerHTML = `<div class="wr-card" role="dialog" aria-label="Забег окончен">
        <span class="wr-ava" style="background:${PAL[killer % PAL.length]}">${pic}</span>
        <span class="wr-k">Вас выбил канал</span>
        <b class="wr-name">${escH(rc.name)}</b>
        <div class="wr-sc"><span><small>счёт</small><b>${s}</b></span><span><small>рекорд</small><b>${best}</b></span><span><small>монетки</small><b>+${coins}</b></span><span><small>в банке</small><b class="wr-bank">${bank}</b></span></div>
        ${s > prev && prev > 0 ? '<span class="wr-new">★ Новый рекорд!</span>' : ''}
        <div class="wr-acts"><button type="button" class="btn primary wr-again">Ещё раз</button><button type="button" class="btn wr-back">На аллею</button></div>
        <span class="wr-tip">${touch ? '' : 'Пробел — ещё раз · Esc — на аллею'}</span>
      </div>`;
      over.hidden = false;
      over.querySelector('.wr-again').focus();
      if (s > prev) saving = Promise.all([saving, runBest(s)]);
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
    async function destroy() {
      if (gone) return;
      gone = true;
      cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVis);
      ro?.disconnect();
      deposit(); // вышли посреди забега — собранные монеты всё равно в банк
      wrap.remove();
      // холсты отдаём сразу, не дожидаясь сборщика мусора
      for (const c of [cv, sky, pl, shadowSp, lowSp, highSp, gateSp, coinSp, moldSp, lampSp, palmSp, treeSp, bushSp, benchSp, poolSp, faceSp, ...flowerSp, ...ava, ...carSp, ...bld]) if (c) c.width = c.height = 0;
      // после выхода страница перезагружается — сначала дописываем рекорд и банк (но не дольше 1,5 с)
      await Promise.race([saving.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
      onExit?.();
    }
    layout();
    reset();
    run();
    wrap.tabIndex = -1;
    wrap.focus({ preventScroll: true });
    return { destroy, wrap };
  }

  // ---- Гардероб и гараж каналов ----
  // У каждого канала свой бегун (гардероб) и своя машина (гараж); за какого бегуна играть — выбирается в профиле
  // канала. Вещи покупаются за монеты из банка забега, один раз — и подходят любому каналу; цвета бесплатные.
  // Каталог, отрисовка (бегун со спины и лицом, 11 ретро-машин спереди), хранение и редактор — здесь, общие для
  // расширения и телефона. Рисуется тем же стилем, что игра; в игре бегун и машины собираются в картинки один раз.
  const DRESS = (() => {
    const PI2 = Math.PI * 2;
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
    };

    const PAL = {
      skin: ['#f6d6bd', '#f2c9a8', '#e9b896', '#e0a982', '#c98a5c', '#a0663e', '#6e4426', '#4a2c18'],
      hair: ['#1b1512', '#3a2418', '#5e3d24', '#8a5a2b', '#c08a4a', '#e8c26a', '#c0402e', '#6f6a70', '#a9a6ad', '#e8e2f0', '#5fe1ff', '#ff5fa2', '#7c3aed'],
      eye: ['#3a2a22', '#6b4a2a', '#2f6b8f', '#3f7a4a', '#7a7f88'],
      cloth: ['#7c3aed', '#e0453a', '#2a8a8f', '#e9c46a', '#b9874f', '#3f8f5a', '#2b3a67', '#f4efe6', '#8a8aa0', '#1d1a22', '#ff5fa2', '#5fe1ff'],
      accent: ['#f4efe6', '#e9c43a', '#e0453a', '#5fe1ff', '#1d1a22', '#ff5fa2', '#5fffb0'],
      metal: ['#2a2630', '#c9a86a', '#dcd6ca', '#e0453a', '#7c3aed', '#5fe1ff'],
    };
    const COLORS = {
      skin: ['Кожа', PAL.skin],
      hairColor: ['Волосы', PAL.hair],
      eyeColor: ['Глаза', PAL.eye],
      beardColor: ['Борода', PAL.hair],
      glassesColor: ['Оправа', PAL.metal],
      headColor: ['Убор', PAL.cloth],
      topColor: ['Верх', PAL.cloth],
      accent: ['Полоски и отделка', PAL.accent],
      neckColor: ['Шарф', PAL.cloth],
      bottomColor: ['Низ', PAL.cloth],
      shoesColor: ['Обувь', PAL.cloth],
      backColor: ['Вещь за спиной', PAL.cloth],
    };
    const GROUPS = {
      hair: { cat: 'head', label: 'Причёска', thumb: ['face', 50, 30, 76], colors: ['hairColor', 'skin'], items: [['short', 'Короткая', 0], ['fringe', 'Чёлка набок', 0], ['long', 'Длинная', 0], ['bob', 'Каре', 30], ['wavy', 'Волнистые', 40], ['tousled', 'Взъерошен­ные', 0], ['bun', 'Пучок', 30], ['curly', 'Кудри', 40], ['mohawk', 'Ирокез', 80], ['bald', 'Налысо', 0]] },
      brows: { cat: 'head', label: 'Брови и глаза', thumb: ['face', 50, 41, 34], colors: ['eyeColor'], items: [['normal', 'Обычные', 0], ['thick', 'Густые', 0], ['thin', 'Тонкие', 0], ['arched', 'Домиком', 20]] },
      beard: { cat: 'head', label: 'Борода и усы', thumb: ['face', 50, 54, 50], colors: ['beardColor'], items: [['none', 'Без бороды', 0], ['stubble', 'Щетина', 0], ['short', 'Короткая', 30], ['full', 'Окладистая', 60], ['mustache', 'Усы', 20], ['goatee', 'Эспаньолка', 40]] },
      details: { cat: 'head', label: 'Лицо', thumb: ['face', 50, 48, 46], items: [['none', 'Ничего', 0], ['freckles', 'Веснушки', 0], ['blush', 'Румянец', 0], ['mole', 'Родинка', 0], ['paint', 'Грим звезды', 60]] },
      glasses: { cat: 'head', label: 'Очки', thumb: ['face', 50, 43, 42], colors: ['glassesColor'], items: [['none', 'Без очков', 0], ['round', 'Круглые', 40], ['wire', 'Тонкие круглые', 60], ['square', 'Квадратные', 40], ['sun', 'Солнечные', 80], ['star', 'Звёздочки', 150]] },
      earrings: { cat: 'head', label: 'Уши', thumb: ['face', 30, 50, 34], items: [['none', 'Ничего', 0], ['stud', 'Гвоздик', 30], ['ring', 'Кольцо', 40]] },
      head: { cat: 'head', label: 'На голове', thumb: ['face', 50, 24, 86], colors: ['headColor'], items: [['none', 'Ничего', 0], ['cap', 'Кепка', 0], ['beanie', 'Шапка', 60], ['bandana', 'Бандана', 50], ['beret', 'Берет', 70], ['headphones', 'Наушники', 90], ['headset', 'Гарнитура', 120], ['cowboy', 'Ковбойская', 160], ['tophat', 'Цилиндр', 150], ['crown', 'Корона', 400], ['helmet', 'Шлем космонавта', 300]] },
      top: { cat: 'body', label: 'Верх', thumb: ['face', 50, 84, 60], colors: ['topColor', 'accent'], items: [['tee', 'Футболка', 0], ['stripes', 'Тельняшка', 60], ['jersey', 'Кибер­майка', 90], ['hoodie', 'Худи', 50], ['sweater', 'Свитер на молнии', 70], ['jacket', 'Куртка', 120], ['suit', 'Пиджак', 180], ['tux', 'Смокинг', 250]] },
      neck: { cat: 'body', label: 'Шея', thumb: ['face', 50, 74, 44], colors: ['neckColor'], items: [['none', 'Ничего', 0], ['scarf', 'Шарф', 40], ['chain', 'Цепочка', 80], ['medal', 'Медаль', 200]] },
      bottom: { cat: 'body', label: 'Низ', thumb: ['back', 50, 76, 56], colors: ['bottomColor'], items: [['jeans', 'Джинсы', 0], ['shorts', 'Шорты', 0], ['skirt', 'Юбка', 40], ['track', 'Спортивки', 70]] },
      shoes: { cat: 'body', label: 'Обувь', thumb: ['back', 50, 95, 30], colors: ['shoesColor'], items: [['sneakers', 'Кроссовки', 0], ['kedy', 'Кеды', 30], ['boots', 'Ботинки', 60]] },
      back: { cat: 'extra', label: 'За спиной', thumb: ['back', 50, 42, 84], colors: ['backColor'], items: [['none', 'Ничего', 0], ['backpack', 'Рюкзак', 0], ['guitar', 'Гитара', 120], ['skate', 'Скейт', 100], ['cape', 'Плащ', 200], ['wings', 'Крылья', 450], ['jetpack', 'Реактивный ранец', 500]] },
      gesture: { cat: 'extra', label: 'Жест на финише', thumb: ['face', 50, 50, 112], items: [['none', 'Без жеста', 0], ['wave', 'Помахать', 0], ['snap', 'Щелчки пальцами', 80]] },
    };
    // в кружке вещь должно быть видно: у причёсок снимаем головной убор, руки жеста — только в кружках жестов
    for (const [k, gr] of Object.entries(GROUPS)) gr.base = k === 'gesture' ? {} : k === 'hair' ? { head: 'none', gesture: 'none' } : { gesture: 'none' };
    const CATS = [['head', 'Голова'], ['body', 'Одежда'], ['extra', 'Аксессуары']];
    const DEF = { hair: 'short', hairColor: '#3a2418', brows: 'normal', eyeColor: '#3a2a22', beard: 'none', beardColor: '#3a2418', details: 'none', glasses: 'none', glassesColor: '#2a2630', earrings: 'none', head: 'cap', headColor: '#e9c46a', top: 'tee', topColor: '#7c3aed', accent: '#f4efe6', neck: 'none', neckColor: '#e0453a', bottom: 'jeans', bottomColor: '#2b3a67', shoes: 'sneakers', shoesColor: '#f4efe6', back: 'backpack', backColor: '#e9c46a', gesture: 'none', skin: '#e0a982' };
    const PRESETS = [
      ['Курьер', {}],
      ['Седина и борода', { hair: 'tousled', hairColor: '#a9a6ad', beard: 'short', beardColor: '#5d5a5f', head: 'none', top: 'sweater', topColor: '#b9874f', back: 'none', skin: '#e9b896', brows: 'thick' }],
      ['Каре и очки', { hair: 'bob', hairColor: '#5e3d24', glasses: 'wire', glassesColor: '#c9a86a', head: 'none', top: 'tee', topColor: '#1d1a22', bottomColor: '#1d1a22', back: 'none', skin: '#f2c9a8' }],
      ['Смокинг', { hair: 'wavy', hairColor: '#1b1512', brows: 'thick', head: 'none', top: 'tux', topColor: '#1d1a22', bottomColor: '#1d1a22', back: 'none', gesture: 'snap', skin: '#f2c9a8', shoes: 'boots', shoesColor: '#1d1a22' }],
      ['Киберспорт', { hair: 'fringe', hairColor: '#5e3d24', head: 'headset', headColor: '#1d1a22', top: 'jersey', topColor: '#1d1a22', accent: '#e9c43a', bottom: 'track', bottomColor: '#1d1a22', back: 'none', skin: '#f2c9a8' }],
      ['Рокер', { hair: 'mohawk', hairColor: '#ff5fa2', head: 'none', top: 'jacket', topColor: '#1d1a22', bottomColor: '#1d1a22', back: 'guitar', backColor: '#e0453a', shoes: 'boots', shoesColor: '#1d1a22', earrings: 'ring', neck: 'chain' }],
      ['Звезда аллеи', { hair: 'long', hairColor: '#e8c26a', head: 'crown', top: 'suit', topColor: '#e0453a', bottom: 'skirt', bottomColor: '#1d1a22', back: 'cape', backColor: '#e0453a', shoesColor: '#e9c46a', details: 'paint', glasses: 'star', glassesColor: '#e9c46a' }],
      ['Космонавт', { head: 'helmet', top: 'hoodie', topColor: '#f4efe6', bottom: 'track', bottomColor: '#8a8aa0', back: 'jetpack', shoes: 'boots', shoesColor: '#8a8aa0' }],
      ['Моряк', { hair: 'bun', hairColor: '#1b1512', head: 'beanie', headColor: '#e0453a', top: 'stripes', topColor: '#2b3a67', bottom: 'track', bottomColor: '#2b3a67', back: 'none', details: 'freckles' }],
      ['Ковбой', { hair: 'short', hairColor: '#8a5a2b', beard: 'mustache', beardColor: '#6b4424', head: 'cowboy', headColor: '#8a5a2b', top: 'jacket', topColor: '#b9874f', neck: 'scarf', neckColor: '#e0453a', shoes: 'boots', shoesColor: '#5a3a1f', back: 'none' }],
      ['Скейтер', { hair: 'curly', hairColor: '#1b1512', head: 'beret', headColor: '#e0453a', top: 'hoodie', topColor: '#3f8f5a', bottom: 'shorts', bottomColor: '#8a8aa0', shoes: 'kedy', shoesColor: '#f4efe6', back: 'skate', backColor: '#e9c46a', skin: '#a0663e' }],
      ['Ангел', { hair: 'long', hairColor: '#e8e2f0', head: 'none', top: 'tee', topColor: '#f4efe6', bottomColor: '#f4efe6', back: 'wings', backColor: '#f4efe6', details: 'blush', shoesColor: '#f4efe6' }],
    ];

    // общие кисти
    const kit = (p) => ({
      limb(x0, y0, x1, y1, w, c) {
        p.strokeStyle = c;
        p.lineWidth = w;
        p.beginPath();
        p.moveTo(x0, y0);
        p.lineTo(x1, y1);
        p.stroke();
      },
      line(pts, w, c) {
        p.strokeStyle = c;
        p.lineWidth = w;
        p.beginPath();
        p.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
        p.stroke();
      },
      dot(x, y, r, c) {
        p.fillStyle = c;
        p.beginPath();
        p.arc(x, y, r, 0, PI2);
        p.fill();
      },
      rr(x, y, w, h, r, c) {
        p.fillStyle = c;
        p.beginPath();
        p.roundRect(x, y, w, h, r);
        p.fill();
      },
      path(f, c) {
        p.fillStyle = c;
        p.beginPath();
        f();
        p.closePath();
        p.fill();
      },
      star(x, y, r, c) {
        p.fillStyle = c;
        p.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const q = i % 2 ? r * 0.42 : r;
          p.lineTo(x + q * Math.cos(a), y + q * Math.sin(a));
        }
        p.closePath();
        p.fill();
      },
    });

    // ---------- Бегун со спины, как в игре (рост 100). fr: 0–5 — бег, 6 — прыжок, 7 — перекат, 8 — сбит ----------
    function runner(p, fr, L) {
      const { limb, dot, rr, path } = kit(p);
      p.lineCap = 'round';
      p.lineJoin = 'round';
      const a = (fr / 6) * PI2;
      if (fr === 7) return rollBall(p, L);
      const jump = fr === 6 || fr === 8; // 8 — сбит: руки вверх
      const bob = jump ? 0 : Math.abs(Math.sin(a)) * 2.5;
      const up = (k) => Math.max(0, k) * 16;
      const ay = 30 - bob;
      const skin = L.skin;
      const pants = L.bottomColor;
      const top = L.topColor;
      const acc = L.accent;
      const bc = L.backColor;
      const long = !['tee', 'stripes', 'jersey'].includes(L.top);
      // ноги и обувь
      const legW = L.bottom === 'skirt' ? 7 : 9.5;
      const legC = L.bottom === 'shorts' || L.bottom === 'skirt' ? skin : pants;
      const leg = (x0, y0, x1, y1) => {
        limb(x0, y0, x1, y1, legW, legC);
        if (L.bottom === 'shorts') limb(x0, y0, x0 + (x1 - x0) * 0.4, y0 + (y1 - y0) * 0.4, 10.5, pants);
        if (L.bottom === 'track') limb(x0 + 3, y0, x1 + 3, y1, 1.6, acc);
      };
      const shoe = (x0, x1, y, lift) => {
        if (L.shoes === 'boots') limb((x0 + x1) / 2 - 1, y - 9, (x0 + x1) / 2 - 1, y - 1, 9.5, L.shoesColor);
        limb(x0, y, x1, y, lift ? 9 : 7, L.shoesColor);
        if (L.shoes === 'kedy') limb(x0, y + 3, x1, y + 3, 2.2, '#f4efe6');
        if (L.shoes === 'boots') limb(x0, y + 3, x1, y + 3, 2.4, '#1d1a22');
      };
      if (jump) {
        leg(44, 60, 38, 76);
        leg(38, 76, 42, 88);
        leg(56, 60, 62, 78);
        leg(62, 78, 60, 90);
        shoe(39, 45, 90, true);
        shoe(57, 63, 92, true);
      } else {
        const lL = up(Math.sin(a));
        const lR = up(-Math.sin(a));
        leg(44, 60 - bob, 43, 97 - lL);
        leg(56, 60 - bob, 57, 97 - lR);
        shoe(40, 47, 99 - lL, lL > 4);
        shoe(53, 60, 99 - lR, lR > 4);
      }
      if (L.bottom === 'skirt')
        path(() => {
          p.moveTo(36, ay + 26);
          p.lineTo(64, ay + 26);
          p.lineTo(69, ay + 44);
          p.lineTo(31, ay + 44);
        }, pants);
      // руки
      const sw = jump ? 0 : Math.sin(a) * 9;
      const arm = (x0, x1, y1) => {
        if (long) limb(x0, ay + 4, x1, y1, 7, top);
        else {
          limb(x0, ay + 4, x1, y1, 5.5, skin);
          limb(x0, ay + 4, x0 + (x1 - x0) * 0.35, ay + 4 + (y1 - ay - 4) * 0.35, 7.5, top);
        }
      };
      if (jump) {
        const u = fr === 8 ? 10 : 0;
        arm(37, 25 - u / 2, ay - 6 - u);
        arm(63, 75 + u / 2, ay - 6 - u);
        dot(24 - u / 2, ay - 8 - u, 4, skin);
        dot(76 + u / 2, ay - 8 - u, 4, skin);
      } else {
        arm(37, 30, ay + 22 + sw);
        arm(63, 70, ay + 22 - sw);
        dot(30, ay + 25 + sw, 4, skin);
        dot(70, ay + 25 - sw, 4, skin);
      }
      // туловище
      rr(35, ay, 30, 34, 8, top);
      if (L.top === 'stripes') for (let y = ay + 4; y < ay + 32; y += 6) rr(35, y, 30, 2.6, 1, acc);
      if (L.top === 'tee') rr(35, ay + 26, 30, 5, 2, shade(top, -0.2));
      if (L.top === 'hoodie') {
        rr(41, ay - 2, 18, 9, 4, shade(top, -0.2));
        rr(35, ay + 26, 30, 6, 3, shade(top, -0.15));
      }
      if (L.top === 'sweater') {
        rr(39, ay - 3, 22, 7, 3, shade(top, 0.12));
        for (let y = ay + 8; y < ay + 32; y += 5) rr(36, y, 28, 1.2, 0.5, shade(top, -0.12));
        rr(35, ay + 28, 30, 6, 3, shade(top, -0.18));
      }
      if (L.top === 'jacket') {
        rr(35, ay + 26, 30, 6, 2, shade(top, 0.25));
        rr(49, ay, 2, 30, 1, shade(top, 0.3));
        rr(38, ay - 1, 24, 5, 2, shade(top, 0.35));
      }
      if (L.top === 'suit' || L.top === 'tux') {
        rr(40, ay - 2, 20, 4, 2, '#f4efe6');
        if (L.top === 'tux')
          path(() => {
            p.moveTo(40, ay + 30);
            p.lineTo(50, ay + 30);
            p.lineTo(45, ay + 46);
            p.moveTo(50, ay + 30);
            p.lineTo(60, ay + 30);
            p.lineTo(55, ay + 46);
          }, top);
        else rr(35, ay + 28, 30, 4, 2, shade(top, -0.25));
      }
      if (L.top === 'jersey') {
        rr(35, ay, 7, 34, 3, acc);
        rr(58, ay, 7, 34, 3, acc);
        p.fillStyle = acc;
        p.font = '800 15px system-ui';
        p.textAlign = 'center';
        p.textBaseline = 'middle';
        p.fillText('7', 50, ay + 18);
      }
      // шея
      if (L.neck === 'scarf') {
        rr(38, ay - 3, 24, 6, 3, L.neckColor);
        rr(52, ay, 6, 20, 2, shade(L.neckColor, -0.12));
      }
      // за спиной — поверх тела: со спины мы смотрим прямо на спину
      if (L.back === 'cape') {
        // плащ от плеч до колен, низ колышется на бегу
        const w = Math.sin(a) * 3;
        path(() => {
          p.moveTo(36, ay + 1);
          p.lineTo(64, ay + 1);
          p.quadraticCurveTo(68, ay + 30, 71 + w, ay + 58);
          p.quadraticCurveTo(62, ay + 54, 56, ay + 60 - w);
          p.quadraticCurveTo(50, ay + 55, 44, ay + 60 + w);
          p.quadraticCurveTo(38, ay + 54, 29 - w, ay + 58);
          p.quadraticCurveTo(32, ay + 30, 36, ay + 1);
        }, bc);
        for (const x of [43, 50, 57]) limb(x, ay + 8, x + (x - 50) * 0.3, ay + 54, 1.2, shade(bc, -0.25));
        rr(37, ay - 2, 26, 6, 3, shade(bc, -0.15));
      }
      if (L.back === 'wings') {
        // крылья растут из лопаток и чуть машут на бегу
        const fl = Math.sin(a) * 4;
        for (const s of [-1, 1]) {
          path(() => {
            p.moveTo(50 + s * 4, ay + 8);
            p.quadraticCurveTo(50 + s * 36, ay - 24 - fl, 50 + s * 46, ay + 2 - fl);
            p.quadraticCurveTo(50 + s * 36, ay + 6, 50 + s * 40, ay + 18);
            p.quadraticCurveTo(50 + s * 26, ay + 16, 50 + s * 28, ay + 26);
            p.quadraticCurveTo(50 + s * 14, ay + 22, 50 + s * 4, ay + 20);
          }, bc);
          for (let i = 0; i < 3; i++) limb(50 + s * (14 + i * 9), ay + 4 - i * 4 - fl / 2, 50 + s * (16 + i * 9), ay + 18 - i * 2, 1, shade(bc, -0.25));
        }
      }
      if (L.back === 'backpack') {
        rr(41, ay + 5, 18, 20, 5, bc);
        rr(41, ay + 12, 18, 3, 1, shade(bc, -0.2));
      }
      if (L.back === 'jetpack') {
        // два баллона на лямках, пламя из сопел — поверх ног
        const fl = 10 + Math.abs(Math.sin(a * 2)) * 8;
        for (const x of [40, 60]) {
          path(() => {
            p.moveTo(x - 4.5, ay + 33);
            p.lineTo(x + 4.5, ay + 33);
            p.lineTo(x, ay + 33 + fl);
          }, '#ffae2e');
          path(() => {
            p.moveTo(x - 2.5, ay + 33);
            p.lineTo(x + 2.5, ay + 33);
            p.lineTo(x, ay + 26 + fl);
          }, '#fff2c0');
          rr(x - 6, ay + 1, 12, 30, 6, '#b8c0d0');
          rr(x - 6, ay + 1, 4, 30, 3, '#dfe4ee');
          rr(x - 6, ay + 8, 12, 3, 1, bc);
          rr(x - 4, ay + 29, 8, 5, 2, '#5a6274');
        }
        rr(45, ay + 10, 10, 12, 3, '#6a7488');
        dot(50, ay + 15, 2, '#ff3d3d');
      }
      if (L.back === 'guitar') {
        // по диагонали: гриф над правым плечом, корпус у левого бедра
        p.save();
        p.translate(48, ay + 20);
        p.rotate(0.55);
        rr(-2.5, -36, 5, 30, 2, '#5a3a1f');
        rr(-4.5, -42, 9, 8, 2, '#2a1a12');
        p.fillStyle = bc;
        p.beginPath();
        p.ellipse(0, 0, 8.5, 7, 0, 0, PI2);
        p.ellipse(0, 10, 11, 9, 0, 0, PI2);
        p.fill();
        dot(0, 4, 2.6, '#1d1a22');
        p.restore();
        limb(38, ay + 2, 60, ay + 30, 1.6, '#2a1a12'); // ремень
      }
      if (L.back === 'skate') {
        rr(42, ay - 2, 16, 40, 8, bc);
        rr(44, ay + 2, 12, 32, 6, shade(bc, -0.18));
        for (const y of [ay + 4, ay + 30]) dot(43, y, 2.4, '#f4efe6'), dot(57, y, 2.4, '#f4efe6');
      }
      // голова со спины
      const hy = ay - 11;
      const hc = L.hairColor;
      if (L.hair === 'long') rr(39, hy - 4, 22, 26, 8, hc);
      if (L.hair === 'bob') rr(37, hy - 6, 26, 19, 9, hc);
      dot(50, hy, 11, L.hair === 'bald' ? skin : hc);
      if (L.hair === 'bald') dot(46, hy - 4, 3, shade(skin, 0.25));
      if (L.hair !== 'bob') {
        dot(39, hy + 1, 3, skin);
        dot(61, hy + 1, 3, skin);
      }
      if (L.hair === 'curly') for (const [x, y] of [[41, hy - 6], [50, hy - 10], [59, hy - 6], [40, hy + 3], [60, hy + 3], [45, hy + 6], [55, hy + 6]]) dot(x, y, 5, hc);
      if (L.hair === 'bun') dot(50, hy - 13, 6, hc);
      if (L.hair === 'wavy') for (const [x, y, r] of [[40, hy + 6, 4], [46, hy + 9, 4], [54, hy + 9, 4], [60, hy + 6, 4], [43, hy - 9, 5], [52, hy - 11, 5], [59, hy - 7, 4]]) dot(x, y, r, hc);
      if (L.hair === 'tousled')
        path(() => {
          p.moveTo(38, hy - 1);
          p.quadraticCurveTo(36, hy - 10, 42, hy - 12);
          p.quadraticCurveTo(45, hy - 17, 51, hy - 15);
          p.quadraticCurveTo(57, hy - 17, 59, hy - 11);
          p.quadraticCurveTo(64, hy - 9, 62, hy - 1);
        }, hc);
      if (L.hair === 'mohawk' && L.head !== 'helmet') rr(46, hy - 20, 8, 22, 3, hc);
      const hcol = L.headColor;
      if (L.head === 'cap') {
        path(() => p.arc(50, hy - 2, 11.5, Math.PI, PI2), hcol);
        rr(44, hy + 6, 12, 4, 1, hcol);
      } else if (L.head === 'beanie') {
        path(() => p.arc(50, hy - 1, 12, Math.PI, PI2), hcol);
        rr(38, hy - 3, 24, 5, 2, shade(hcol, 0.3));
        dot(50, hy - 14, 4.5, '#f4efe6');
      } else if (L.head === 'bandana') {
        rr(38, hy - 7, 24, 6, 3, hcol);
        limb(50, hy - 3, 46, hy + 9, 3, hcol);
        limb(50, hy - 3, 55, hy + 8, 3, hcol);
      } else if (L.head === 'beret') {
        p.fillStyle = hcol;
        p.beginPath();
        p.ellipse(51, hy - 7, 14, 6, -0.15, 0, PI2);
        p.fill();
      } else if (L.head === 'cowboy') {
        p.fillStyle = shade(hcol, -0.2);
        p.beginPath();
        p.ellipse(50, hy - 4, 20, 5, 0, 0, PI2);
        p.fill();
        rr(41, hy - 18, 18, 14, 5, hcol);
      } else if (L.head === 'headphones' || L.head === 'headset') {
        p.strokeStyle = '#2a2630';
        p.lineWidth = 3;
        p.beginPath();
        p.arc(50, hy, 13, Math.PI * 1.05, Math.PI * 1.95);
        p.stroke();
        rr(34, hy - 4, 6, 11, 3, hcol);
        rr(60, hy - 4, 6, 11, 3, hcol);
      } else if (L.head === 'tophat') {
        rr(41, hy - 28, 18, 20, 2, '#2a2630');
        rr(41, hy - 13, 18, 3, 1, hcol);
        rr(36, hy - 9, 28, 4, 2, '#2a2630');
      } else if (L.head === 'crown') {
        path(() => {
          p.moveTo(40, hy - 6);
          p.lineTo(60, hy - 6);
          p.lineTo(62, hy - 18);
          p.lineTo(56, hy - 11);
          p.lineTo(50, hy - 21);
          p.lineTo(44, hy - 11);
          p.lineTo(38, hy - 18);
        }, '#e0b45a');
        dot(50, hy - 12, 2, '#ff5fa2');
      } else if (L.head === 'helmet') {
        dot(50, hy + 1, 15, 'rgba(207,227,255,.35)');
        p.strokeStyle = '#f4efe6';
        p.lineWidth = 2.5;
        p.beginPath();
        p.arc(50, hy + 1, 15, 0, PI2);
        p.stroke();
        rr(40, hy + 14, 20, 4, 2, '#9aa4b8');
      }
    }

    // перекат: клубок в цвет одежды, сверху голова с убором
    function rollBall(p, L) {
      const { limb, dot } = kit(p);
      p.lineCap = 'round';
      dot(50, 84, 20, L.topColor);
      p.strokeStyle = shade(L.topColor, 0.35);
      p.lineWidth = 3;
      p.beginPath();
      p.arc(50, 84, 13, 0.4, 2.6);
      p.stroke();
      if (L.back !== 'none') dot(50, 87, 8, L.backColor);
      dot(50, 68, 10, L.hair === 'bald' ? L.skin : L.hairColor);
      if (['cap', 'beanie', 'bandana', 'beret', 'cowboy', 'tophat', 'headphones', 'headset'].includes(L.head)) {
        p.fillStyle = L.head === 'tophat' ? '#2a2630' : L.headColor;
        p.beginPath();
        p.arc(50, 66, 10, Math.PI, PI2);
        p.fill();
      }
      if (L.head === 'crown') dot(50, 58, 4, '#e0b45a');
      limb(36, 100, 44, 102, 7, L.shoesColor);
      limb(56, 102, 64, 100, 7, L.shoesColor);
    }

    // ---------- Портрет лицом (по плечи, 100×100). blink — глаза закрыты, t — время для жестов ----------
    function portrait(p, L, blink = false, t = 0) {
      const { line, dot, rr, path, star } = kit(p);
      p.lineCap = 'round';
      p.lineJoin = 'round';
      const skin = L.skin;
      const hc = L.hairColor;
      const bc = L.beardColor;
      const top = L.topColor;
      const acc = L.accent;
      const shoulders = () => {
        p.moveTo(6, 100);
        p.quadraticCurveTo(8, 74, 34, 70);
        p.lineTo(66, 70);
        p.quadraticCurveTo(92, 74, 94, 100);
      };
      // за головой: крылья, длинные волосы, каре, капюшон
      if (L.back === 'wings')
        for (const s of [-1, 1])
          path(() => {
            p.moveTo(50 + s * 20, 78);
            p.quadraticCurveTo(50 + s * 52, 40, 50 + s * 50, 66);
            p.quadraticCurveTo(50 + s * 46, 80, 50 + s * 40, 90);
          }, L.backColor);
      if (L.hair === 'long' && L.head !== 'helmet') rr(26, 28, 48, 50, 18, hc);
      if (L.hair === 'bob')
        path(() => {
          p.moveTo(25, 60);
          p.quadraticCurveTo(20, 12, 50, 12);
          p.quadraticCurveTo(80, 12, 75, 60);
          p.quadraticCurveTo(70, 64, 66, 60);
          p.lineTo(34, 60);
          p.quadraticCurveTo(30, 64, 25, 60);
        }, shade(hc, -0.15));
      if (L.top === 'hoodie')
        path(() => {
          p.moveTo(24, 76);
          p.quadraticCurveTo(18, 30, 50, 22);
          p.quadraticCurveTo(82, 30, 76, 76);
        }, shade(top, -0.18));
      // плечи, шея, одежда
      path(shoulders, top);
      rr(42, 58, 16, 16, 6, shade(skin, -0.1));
      if (L.top === 'stripes') {
        p.save();
        path(shoulders, top);
        p.clip();
        for (let y = 74; y < 100; y += 6) rr(0, y, 100, 2.6, 1, acc);
        p.restore();
        line([40, 71, 50, 76, 60, 71], 3, acc);
      }
      if (L.top === 'tee') line([40, 71, 50, 76, 60, 71], 3, shade(top, -0.2));
      if (L.top === 'hoodie') {
        line([40, 72, 50, 78, 60, 72], 4, shade(top, -0.25));
        line([46, 77, 45, 92], 1.6, acc);
        line([54, 77, 55, 92], 1.6, acc);
      }
      if (L.top === 'sweater') {
        rr(37, 62, 26, 14, 6, shade(top, 0.1));
        line([50, 63, 50, 100], 1.8, '#d8d0bf');
        dot(50, 67, 1.8, '#d8d0bf');
        for (let x = 14; x < 90; x += 6) line([x, 84, x, 100], 0.8, shade(top, -0.12));
      }
      if (L.top === 'jersey') {
        line([40, 71, 50, 78, 60, 71], 3.2, acc);
        path(() => {
          p.moveTo(8, 94);
          p.quadraticCurveTo(13, 76, 30, 72);
          p.lineTo(33, 78);
          p.quadraticCurveTo(19, 82, 15, 98);
        }, acc);
        path(() => {
          p.moveTo(92, 94);
          p.quadraticCurveTo(87, 76, 70, 72);
          p.lineTo(67, 78);
          p.quadraticCurveTo(81, 82, 85, 98);
        }, acc);
        rr(58, 84, 10, 8, 2, acc);
      }
      if (L.top === 'jacket') {
        line([50, 72, 50, 100], 2, acc);
        path(() => {
          p.moveTo(36, 70);
          p.lineTo(46, 70);
          p.lineTo(42, 82);
        }, shade(top, 0.3));
        path(() => {
          p.moveTo(64, 70);
          p.lineTo(54, 70);
          p.lineTo(58, 82);
        }, shade(top, 0.3));
      }
      if (L.top === 'suit' || L.top === 'tux') {
        const tux = L.top === 'tux';
        path(() => {
          p.moveTo(40, 70);
          p.lineTo(60, 70);
          p.lineTo(50, tux ? 99 : 94);
        }, '#f4efe6');
        if (tux) {
          dot(50, 86, 1.2, '#c8c2b4');
          dot(50, 93, 1.2, '#c8c2b4');
        } else
          path(() => {
            p.moveTo(48, 74);
            p.lineTo(52, 74);
            p.lineTo(53, 90);
            p.lineTo(50, 94);
            p.lineTo(47, 90);
          }, acc);
        path(() => {
          p.moveTo(34, 71);
          p.lineTo(42, 70);
          p.lineTo(50, 100);
          p.lineTo(38, 86);
        }, shade(top, 0.22));
        path(() => {
          p.moveTo(66, 71);
          p.lineTo(58, 70);
          p.lineTo(50, 100);
          p.lineTo(62, 86);
        }, shade(top, 0.22));
        if (tux) {
          const bow = acc === '#f4efe6' ? '#0d0b10' : acc; // бабочка — цвет отделки (белая отделка — чёрная бабочка)
          path(() => {
            p.moveTo(50, 75);
            p.lineTo(40, 70);
            p.lineTo(40, 80);
          }, bow);
          path(() => {
            p.moveTo(50, 75);
            p.lineTo(60, 70);
            p.lineTo(60, 80);
          }, bow);
          rr(47.5, 72.5, 5, 5, 1.5, shade(bow, 0.2));
        }
      }
      // шея: шарф, цепочка, медаль
      if (L.neck === 'scarf') {
        rr(35, 62, 30, 11, 5, L.neckColor);
        rr(52, 66, 8, 24, 3, shade(L.neckColor, -0.12));
        for (let y = 80; y < 90; y += 3) line([52, y, 60, y], 0.8, shade(L.neckColor, 0.3));
      }
      if (L.neck === 'chain' || L.neck === 'medal') {
        p.strokeStyle = '#e0b45a';
        p.lineWidth = 1.6;
        p.beginPath();
        p.moveTo(40, 69);
        p.quadraticCurveTo(50, L.neck === 'medal' ? 86 : 82, 60, 69);
        p.stroke();
        if (L.neck === 'medal') {
          dot(50, 87, 6, '#e0b45a');
          star(50, 87, 4, L.neckColor);
        } else star(50, 79, 2.8, '#e0b45a');
      }
      if (L.back === 'backpack' || L.back === 'jetpack') {
        rr(14, 74, 6, 26, 3, L.back === 'jetpack' ? '#6a7488' : shade(L.backColor, -0.2));
        rr(80, 74, 6, 26, 3, L.back === 'jetpack' ? '#6a7488' : shade(L.backColor, -0.2));
      }
      if (L.back === 'cape') {
        rr(30, 68, 40, 5, 2, L.backColor);
        dot(36, 71, 3, '#e9c46a');
      }
      if (L.back === 'guitar') line([18, 100, 82, 66], 3, '#5a3a1f');
      if (L.back === 'skate') line([10, 96, 26, 64], 5, L.backColor);
      // жест: руки вверх и щелчки пальцами, как дирижёр, или машет рукой
      if (L.gesture === 'snap' || L.gesture === 'wave') {
        const bare = ['tee', 'stripes', 'jersey'].includes(L.top);
        const cuff = L.top === 'tux' || L.top === 'suit';
        const arm = (sx, ex, ey) => {
          line([sx, 86, sx + (ex - sx) * 0.4, 64, ex, ey + 8], 11, bare ? skin : top);
          if (bare) line([sx, 86, sx + (ex - sx) * 0.15, 78], 12, top);
          if (cuff) line([ex, ey + 15, ex, ey + 10], 11, '#f4efe6');
        };
        if (L.gesture === 'snap') {
          const k = Math.floor(t * 3) % 2;
          for (const [sx, ex, on] of [[17, 12, k === 0], [83, 88, k === 1]]) {
            arm(sx, ex, 34);
            dot(ex, 33, 6.5, skin);
            dot(ex + (ex < 50 ? 3.5 : -3.5), 27.5, 3, skin);
            if (on) for (const [dx, dy] of [[-8, -7], [0, -10], [8, -7]]) line([ex + dx * 0.55, 23 + dy * 0.55, ex + dx, 23 + dy], 1.6, '#f2d68a');
          }
        } else {
          arm(83, 86, 34);
          p.save();
          p.translate(86, 38);
          p.rotate(Math.sin(t * 7) * 0.35);
          rr(-6, -12, 12, 14, 5, skin);
          for (const x of [-5.5, -2.3, 0.9, 4.1]) rr(x, -19, 2.6, 9, 1.3, skin);
          p.restore();
        }
      }
      // уши, серьги, лицо
      dot(29, 46, 5, skin);
      dot(71, 46, 5, skin);
      if (L.earrings === 'stud') dot(29, 51, 1.8, '#e0b45a'), dot(71, 51, 1.8, '#e0b45a');
      if (L.earrings === 'ring') {
        p.strokeStyle = '#e0b45a';
        p.lineWidth = 1.4;
        for (const x of [29, 71]) {
          p.beginPath();
          p.arc(x, 54, 3, 0, PI2);
          p.stroke();
        }
      }
      p.fillStyle = skin;
      p.beginPath();
      p.ellipse(50, 44, 21, 25, 0, 0, PI2);
      p.fill();
      // детали лица
      if (L.details === 'freckles') for (const [x, y] of [[36, 50], [39, 52], [35, 54], [41, 55], [64, 50], [61, 52], [65, 54], [59, 55]]) dot(x, y, 0.9, shade(skin, -0.35));
      if (L.details === 'blush') {
        p.fillStyle = 'rgba(255,110,130,.35)';
        for (const x of [36, 64]) {
          p.beginPath();
          p.ellipse(x, 53, 5, 3, 0, 0, PI2);
          p.fill();
        }
      }
      if (L.details === 'mole') dot(59, 56, 1.3, shade(skin, -0.5));
      if (L.details === 'paint') {
        star(64, 50, 5, '#ff5fa2');
        dot(36, 52, 1.3, '#e9c46a');
        dot(33, 49, 1, '#e9c46a');
      }
      // борода — под чертами лица
      if (L.beard === 'stubble') {
        p.globalAlpha = 0.38;
        path(() => {
          p.moveTo(30, 44);
          p.quadraticCurveTo(31, 70, 50, 70);
          p.quadraticCurveTo(69, 70, 70, 44);
          p.quadraticCurveTo(66, 58, 50, 58);
          p.quadraticCurveTo(34, 58, 30, 44);
        }, bc);
        p.globalAlpha = 1;
      } else if (L.beard === 'short' || L.beard === 'full') {
        const d = L.beard === 'full' ? 8 : 0;
        path(() => {
          p.moveTo(29, 42);
          p.quadraticCurveTo(29, 72 + d, 50, 72 + d);
          p.quadraticCurveTo(71, 72 + d, 71, 42);
          p.quadraticCurveTo(68, 56, 60, 56);
          p.quadraticCurveTo(50, 52, 40, 56);
          p.quadraticCurveTo(32, 56, 29, 42);
        }, bc);
        p.globalAlpha = 0.35;
        for (const [x, y] of [[36, 62], [44, 66], [56, 66], [64, 62], [50, 70 + d / 2]]) line([x, y, x + 1, y + 4], 1, shade(bc, 0.45));
        p.globalAlpha = 1;
      } else if (L.beard === 'goatee') {
        path(() => {
          p.moveTo(44, 61);
          p.quadraticCurveTo(50, 74, 56, 61);
          p.quadraticCurveTo(50, 64, 44, 61);
        }, bc);
      }
      // брови, глаза, нос
      const br = L.hair === 'bald' ? bc : shade(hc, -0.2);
      const bw = { thick: 4, thin: 1.4, arched: 2.4 }[L.brows] || 2.6;
      const arch = L.brows === 'arched' ? 3 : 1;
      line([36, 37.5, 41, 37 - arch, 46, 36.5], bw, br);
      line([54, 36.5, 59, 37 - arch, 64, 37.5], bw, br);
      if (blink) {
        line([38, 43, 46, 43], 1.8, '#3a2418');
        line([54, 43, 62, 43], 1.8, '#3a2418');
      } else
        for (const x of [42, 58]) {
          p.fillStyle = '#fff';
          p.beginPath();
          p.ellipse(x, 43, 4.2, 2.8, 0, 0, PI2);
          p.fill();
          dot(x, 43, 2, L.eyeColor);
          dot(x + 0.8, 42.2, 0.7, '#fff');
        }
      line([50, 45, 48, 53, 51.5, 54], 1.6, shade(skin, -0.3));
      // усы и рот
      if (['mustache', 'short', 'full', 'goatee'].includes(L.beard))
        path(() => {
          p.moveTo(42, 59);
          p.quadraticCurveTo(46, 54, 50, 57);
          p.quadraticCurveTo(54, 54, 58, 59);
          p.quadraticCurveTo(50, 58, 42, 59);
        }, bc);
      p.strokeStyle = '#8a3f3f';
      p.lineWidth = 1.8;
      p.beginPath();
      p.arc(50, 58, 5, 0.2 * Math.PI, 0.8 * Math.PI);
      p.stroke();
      // причёска спереди
      if (L.hair === 'short' || L.hair === 'long' || L.hair === 'bun') {
        path(() => {
          p.moveTo(29, 42);
          p.quadraticCurveTo(27, 14, 50, 14);
          p.quadraticCurveTo(73, 14, 71, 42);
          p.lineTo(67, 32);
          p.quadraticCurveTo(50, 24, 33, 32);
        }, hc);
        if (L.hair === 'long') {
          rr(25, 32, 8, 42, 4, hc);
          rr(67, 32, 8, 42, 4, hc);
        }
        if (L.hair === 'bun') dot(50, 11, 8, hc);
      } else if (L.hair === 'fringe') {
        path(() => {
          p.moveTo(29, 42);
          p.quadraticCurveTo(27, 14, 50, 13);
          p.quadraticCurveTo(73, 14, 71, 42);
          p.quadraticCurveTo(68, 30, 62, 26);
          p.quadraticCurveTo(48, 30, 33, 36);
        }, hc);
        path(() => {
          p.moveTo(68, 22);
          p.quadraticCurveTo(50, 20, 33, 34);
          p.quadraticCurveTo(44, 30, 62, 28);
        }, shade(hc, -0.15));
      } else if (L.hair === 'bob') {
        path(() => {
          p.moveTo(28, 50);
          p.quadraticCurveTo(24, 16, 50, 14);
          p.quadraticCurveTo(76, 16, 72, 50);
          p.quadraticCurveTo(70, 36, 66, 30);
          p.quadraticCurveTo(62, 25, 59, 21);
          p.quadraticCurveTo(50, 30, 34, 34);
          p.quadraticCurveTo(30, 40, 28, 50);
        }, hc);
        path(() => {
          p.moveTo(24, 34);
          p.quadraticCurveTo(26, 54, 32, 62);
          p.quadraticCurveTo(33, 48, 31, 36);
        }, hc);
        path(() => {
          p.moveTo(76, 34);
          p.quadraticCurveTo(74, 54, 68, 62);
          p.quadraticCurveTo(67, 48, 69, 36);
        }, hc);
        p.globalAlpha = 0.35;
        line([59, 18, 44, 30], 1.2, shade(hc, 0.35));
        line([62, 20, 68, 34], 1.2, shade(hc, 0.35));
        p.globalAlpha = 1;
      } else if (L.hair === 'wavy') {
        path(() => {
          p.moveTo(27, 48);
          p.quadraticCurveTo(19, 22, 31, 12);
          p.quadraticCurveTo(41, 3, 53, 6);
          p.quadraticCurveTo(66, 3, 72, 13);
          p.quadraticCurveTo(81, 25, 73, 48);
          p.quadraticCurveTo(70, 32, 63, 27);
          p.quadraticCurveTo(52, 21, 41, 26);
          p.quadraticCurveTo(31, 31, 27, 48);
        }, hc);
        for (const [x, y, r] of [[26, 50, 4], [74, 50, 4], [24, 43, 3.5], [76, 43, 3.5], [29, 56, 3], [71, 56, 3]]) dot(x, y, r, hc);
        p.globalAlpha = 0.4;
        p.strokeStyle = shade(hc, 0.45);
        p.lineWidth = 1.3;
        for (const [x0, y0, x1, y1] of [[34, 15, 46, 21], [48, 10, 60, 16], [62, 11, 70, 22]]) {
          p.beginPath();
          p.moveTo(x0, y0);
          p.quadraticCurveTo((x0 + x1) / 2, y0 - 4, x1, y1);
          p.stroke();
        }
        p.globalAlpha = 1;
      } else if (L.hair === 'tousled') {
        path(() => {
          p.moveTo(28, 44);
          p.quadraticCurveTo(21, 26, 29, 17);
          p.quadraticCurveTo(29, 7, 39, 9);
          p.quadraticCurveTo(43, 2, 51, 5);
          p.quadraticCurveTo(59, 1, 64, 8);
          p.quadraticCurveTo(73, 8, 73, 18);
          p.quadraticCurveTo(79, 30, 72, 44);
          p.lineTo(68, 31);
          p.quadraticCurveTo(58, 33, 53, 25);
          p.quadraticCurveTo(45, 33, 32, 31);
        }, hc);
        path(() => {
          p.moveTo(54, 22);
          p.quadraticCurveTo(46, 30, 38, 34);
          p.quadraticCurveTo(44, 26, 48, 20);
        }, shade(hc, -0.12));
        p.globalAlpha = 0.5;
        for (const [x0, y0, x1, y1] of [[36, 12, 42, 26], [48, 8, 50, 22], [58, 10, 60, 24], [66, 16, 68, 30]]) line([x0, y0, x1, y1], 1.4, shade(hc, 0.35));
        p.globalAlpha = 1;
      } else if (L.hair === 'curly') {
        for (const [x, y] of [[32, 30], [30, 22], [36, 15], [44, 11], [52, 10], [60, 12], [66, 17], [70, 25], [69, 33], [40, 20], [50, 18], [60, 21]]) dot(x, y, 6.5, hc);
      } else if (L.hair === 'mohawk') {
        rr(45, 2, 10, 26, 4, hc);
      } else if (L.hair === 'bald') {
        dot(44, 26, 4, shade(skin, 0.3));
      }
      // очки
      if (L.glasses !== 'none') {
        const wire = L.glasses === 'wire';
        const fr = L.glassesColor;
        const w = wire ? 1.1 : 2;
        for (const x of [42, 58]) {
          p.fillStyle = L.glasses === 'sun' ? 'rgba(20,16,26,.9)' : 'rgba(207,227,255,.12)';
          p.strokeStyle = fr;
          p.lineWidth = w;
          p.beginPath();
          if (L.glasses === 'star') {
            star(x, 43, 9, fr);
            star(x, 43, 6, 'rgba(255,240,200,.35)');
            continue;
          }
          if (L.glasses === 'round' || wire) p.arc(x, 43, wire ? 7 : 6.5, 0, PI2);
          else p.roundRect(x - 7.5, 38, 15, 10, L.glasses === 'sun' ? 3 : 1.5);
          p.fill();
          p.stroke();
        }
        line([wire ? 49 : 48.5, 42, wire ? 51 : 51.5, 42], w, fr);
        line([29, 41, 35, 42], w, fr);
        line([71, 41, 65, 42], w, fr);
      }
      // головной убор
      const hcol = L.headColor;
      if (L.head === 'cap') {
        path(() => p.arc(50, 31, 22, Math.PI, PI2), hcol);
        p.fillStyle = shade(hcol, -0.2);
        p.beginPath();
        p.ellipse(50, 31, 27, 5, 0, 0, Math.PI);
        p.fill();
        dot(50, 9, 2.5, shade(hcol, -0.3));
      } else if (L.head === 'beanie') {
        path(() => p.arc(50, 33, 23, Math.PI, PI2), hcol);
        rr(26, 26, 48, 10, 4, shade(hcol, 0.3));
        dot(50, 8, 6, '#f4efe6');
      } else if (L.head === 'bandana') {
        rr(28, 20, 44, 9, 4, hcol);
        for (const x of [34, 42, 50, 58, 66]) dot(x, 24.5, 1.2, '#f4efe6');
        path(() => {
          p.moveTo(70, 22);
          p.lineTo(80, 16);
          p.lineTo(78, 28);
        }, shade(hcol, -0.15));
      } else if (L.head === 'beret') {
        p.fillStyle = hcol;
        p.beginPath();
        p.ellipse(54, 20, 26, 10, -0.12, 0, PI2);
        p.fill();
        rr(52, 6, 3, 6, 1.5, shade(hcol, -0.3));
      } else if (L.head === 'cowboy') {
        p.fillStyle = shade(hcol, -0.15);
        p.beginPath();
        p.ellipse(50, 24, 36, 7, 0, 0, PI2);
        p.fill();
        path(() => {
          p.moveTo(34, 24);
          p.quadraticCurveTo(32, 2, 44, 4);
          p.quadraticCurveTo(50, 9, 56, 4);
          p.quadraticCurveTo(68, 2, 66, 24);
        }, hcol);
        rr(34, 18, 32, 4, 1.5, shade(hcol, -0.4));
      } else if (L.head === 'headphones' || L.head === 'headset') {
        p.strokeStyle = '#2a2630';
        p.lineWidth = 3.5;
        p.beginPath();
        p.arc(50, 42, 27, Math.PI * 1.08, Math.PI * 1.92);
        p.stroke();
        rr(20, 36, 10, 18, 4, hcol);
        rr(70, 36, 10, 18, 4, hcol);
        if (L.head === 'headset') {
          p.strokeStyle = '#2a2630';
          p.lineWidth = 2.2;
          p.beginPath();
          p.moveTo(24, 53);
          p.quadraticCurveTo(26, 66, 40, 64);
          p.stroke();
          dot(41.5, 64, 3.8, '#2a2630');
        }
      } else if (L.head === 'tophat') {
        rr(36, -4, 28, 28, 2, '#2a2630');
        rr(36, 16, 28, 4, 1, hcol);
        rr(27, 21, 46, 6, 3, '#2a2630');
      } else if (L.head === 'crown') {
        path(() => {
          p.moveTo(34, 20);
          p.lineTo(66, 20);
          p.lineTo(70, 2);
          p.lineTo(60, 11);
          p.lineTo(50, -2);
          p.lineTo(40, 11);
          p.lineTo(30, 2);
        }, '#e0b45a');
        dot(50, 13, 2.5, '#ff5fa2');
        dot(38, 15, 1.8, '#5fe1ff');
        dot(62, 15, 1.8, '#5fffb0');
      } else if (L.head === 'helmet') {
        p.fillStyle = 'rgba(207,227,255,.22)';
        p.beginPath();
        p.arc(50, 44, 33, 0, PI2);
        p.fill();
        p.strokeStyle = '#f4efe6';
        p.lineWidth = 3;
        p.stroke();
        p.strokeStyle = 'rgba(255,255,255,.6)';
        p.lineWidth = 2;
        p.beginPath();
        p.arc(50, 44, 27, Math.PI * 1.15, Math.PI * 1.4);
        p.stroke();
        rr(32, 74, 36, 7, 3, '#9aa4b8');
      }
    }

    // ---------- Гараж: машина навстречу, как в игре ----------
    // Силуэты — по мотивам легендарных ретро-машин (вид спереди, 150×110, земля — y 108). У каждой модели:
    // колёса, кузов (body), кабина (cab — стекло и крыша; open — где кончается ветровое стекло у кабриолета),
    // где капот (hoodY — фигурка, полосы), где начинается морда (faceY — шашечки, пламя), где табличка канала (sy).
    const MODELS = {
      sedan: {
        name: 'Седан 50-х', price: 0, wheels: [[14, 86, 22, 22], [114, 86, 22, 22]], hoodY: 44, faceY: 62, sy: 10, open: 30,
        cab: [[30, 44, 120, 44, 106, 18, 44, 18], [38, 42, 112, 42, 101, 22, 49, 22], [44, 18, 106, 18, 100, 10, 50, 10]],
        body(K) {
          K.poly([22, 44, 128, 44, 142, 62, 8, 62], K.light);
          K.poly([6, 62, 144, 62, 146, 90, 4, 90], K.dark);
          K.r(6, 62, 138, 4, K.mid);
          K.r(2, 82, 146, 7, K.bumper);
          K.r(6, 63, 34, 17, K.halo);
          K.r(110, 63, 34, 17, K.halo);
          for (const x of [10, 128]) K.r(x, 66, 12, 10, K.lamp);
          for (const x of [25, 116]) K.r(x, 67, 9, 8, K.lamp);
          K.r(44, 66, 62, 14, '#1a1720');
          for (let x = 48; x < 104; x += 7) K.r(x, 67, 1.5, 12, K.chrome);
        },
      },
      cruiser: {
        name: 'Круизёр с панорамным стеклом', price: 220, wheels: [[10, 88, 24, 20], [116, 88, 24, 20]], hoodY: 48, faceY: 60, sy: 18, open: 34,
        cab: [[24, 48, 126, 48, 114, 24, 36, 24], [28, 46, 122, 46, 111, 27, 39, 27], [36, 24, 114, 24, 108, 18, 42, 18]],
        body(K) {
          K.poly([16, 48, 134, 48, 148, 60, 2, 60], K.light);
          K.poly([0, 60, 150, 60, 150, 84, 0, 84], K.dark);
          K.r(0, 60, 150, 3, K.mid);
          K.r(34, 64, 82, 14, '#1a1720');
          for (let x = 36; x < 116; x += 5) K.r(x, 64, 1.4, 14, K.chrome);
          K.r(34, 70, 82, 1.4, K.chrome);
          for (const x of [12, 24, 126, 138]) K.hl(x, 70, 5);
          K.r(-2, 80, 154, 8, K.bumper);
          K.dot(52, 84, 4.5, '#f4f1ea');
          K.dot(98, 84, 4.5, '#f4f1ea');
        },
      },
      coupe: {
        name: 'Купе с хромом', price: 180, wheels: [[14, 86, 22, 22], [114, 86, 22, 22]], hoodY: 46, faceY: 62, sy: 17, open: 32,
        cab: [[32, 46, 118, 46, 104, 24, 46, 24], [38, 44, 112, 44, 101, 27, 49, 27], [46, 24, 104, 24, 99, 17, 51, 17]],
        body(K) {
          K.poly([20, 46, 130, 46, 144, 62, 6, 62], K.light);
          for (const x of [56, 94]) K.poly([x - 2.5, 46, x + 2.5, 46, x, 39], K.chrome);
          K.poly([4, 62, 146, 62, 146, 88, 4, 88], K.dark);
          K.r(4, 62, 142, 3, K.mid);
          K.r(32, 66, 86, 14, '#e0b45a');
          for (let x = 34; x < 116; x += 6) K.r(x, 66, 1.2, 14, '#8a6a2a');
          for (const x of [18, 132]) {
            K.dot(x, 70, 9, K.chrome);
            K.hl(x, 71, 5.5);
          }
          K.r(0, 84, 150, 6, K.bumper);
          K.dot(40, 87, 3.5, '#f4f1ea');
          K.dot(110, 87, 3.5, '#f4f1ea');
        },
      },
      muscle: {
        name: 'Маслкар', price: 300, wheels: [[6, 84, 28, 24], [116, 84, 28, 24]], hoodY: 45, faceY: 64, sy: 29, open: 42,
        cab: [[36, 52, 114, 52, 104, 34, 46, 34], [42, 50, 108, 50, 100, 37, 50, 37], [46, 34, 104, 34, 100, 29, 50, 29]],
        body(K) {
          K.poly([12, 52, 138, 52, 146, 64, 4, 64], K.light);
          K.rr(60, 45, 30, 9, 2, K.darker);
          K.r(63, 47, 24, 3, '#141218');
          K.poly([4, 64, 146, 64, 146, 86, 4, 86], K.dark);
          K.r(8, 66, 134, 15, '#141218');
          for (const x of [20, 32, 118, 130]) K.hl(x, 73.5, 5);
          K.r(48, 72, 54, 2, K.chrome);
          K.r(2, 84, 146, 4, K.bumper);
        },
      },
      roadster: {
        name: 'Родстер', price: 260, wheels: [[12, 88, 22, 20], [116, 88, 22, 20]], hoodY: 46, faceY: 60, sy: 38, open: 38, alwaysOpen: true,
        body(K) {
          K.ell(75, 56, 52, 10, K.light);
          K.rr(4, 58, 142, 30, 14, K.dark);
          for (const x of [24, 126]) {
            K.ell(x, 66, 12, 7, K.chrome);
            K.ell(x, 66, 10, 5.5, K.lamp);
          }
          K.ell(75, 75, 17, 8, '#1a1720');
          K.r(58, 74, 34, 1.6, K.chrome);
          K.r(4, 86, 142, 4, K.bumper);
          K.poly([44, 50, 106, 50, 100, 38, 50, 38], K.glass);
          K.r(44, 48, 62, 2, K.chrome);
        },
      },
      sov: {
        name: 'Советский седан 70-х', price: 120, wheels: [[16, 88, 20, 20], [114, 88, 20, 20]], hoodY: 48, faceY: 60, sy: 15, open: 34,
        cab: [[28, 48, 122, 48, 114, 20, 36, 20], [34, 46, 116, 46, 109, 24, 41, 24], [36, 20, 114, 20, 110, 15, 40, 15]],
        body(K) {
          K.poly([14, 48, 136, 48, 142, 60, 8, 60], K.light);
          K.r(6, 60, 138, 26, K.dark);
          K.r(6, 60, 138, 3, K.mid);
          K.r(32, 63, 86, 18, K.chrome);
          for (let x = 34; x < 116; x += 5) K.r(x, 65, 2, 14, '#2a2630');
          for (const x of [19, 131]) K.hl(x, 72, 8);
          K.r(2, 86, 146, 5, K.bumper);
        },
      },
      kopeyka: {
        name: '«Копейка»', price: 80, wheels: [[22, 88, 18, 20], [110, 88, 18, 20]], hoodY: 50, faceY: 60, sy: 17,
        cab: [[34, 50, 116, 50, 108, 22, 42, 22], [40, 48, 110, 48, 103, 26, 47, 26], [42, 22, 108, 22, 104, 17, 46, 17]],
        body(K) {
          K.poly([22, 50, 128, 50, 134, 60, 16, 60], K.light);
          K.r(16, 60, 118, 26, K.dark);
          K.r(16, 60, 118, 3, K.mid);
          K.r(20, 64, 38, 15, '#2a2630');
          K.r(92, 64, 38, 15, '#2a2630');
          for (const x of [29, 47, 103, 121]) K.hl(x, 71.5, 5.5);
          K.r(60, 65, 30, 13, K.chrome);
          for (const y of [67, 71, 75]) K.r(61, y, 28, 1.6, '#2a2630');
          K.r(14, 86, 122, 4, K.bumper);
        },
      },
      pickup: {
        name: 'Пикап 50-х', price: 160, wheels: [[16, 90, 20, 18], [114, 90, 20, 18]], hoodY: 46, faceY: 60, sy: 7,
        cab: [[40, 48, 110, 48, 104, 12, 46, 12], [48, 40, 102, 40, 99, 16, 51, 16], [46, 12, 104, 12, 100, 7, 50, 7]],
        body(K) {
          K.ell(26, 72, 22, 18, K.col);
          K.ell(124, 72, 22, 18, K.col);
          K.hl(26, 64, 7);
          K.hl(124, 64, 7);
          K.rr(44, 48, 62, 40, 10, K.dark);
          K.rr(44, 46, 62, 14, 6, K.light);
          for (const y of [64, 70, 76]) K.r(48, y, 54, 3, K.chrome);
          K.dot(75, 57, 4, K.chrome);
          K.r(6, 88, 138, 6, K.bumper);
        },
        after(K) {
          K.r(74, 16, 2, 24, shade(K.col, -0.06)); // стекло из двух половинок
        },
      },
      mini: {
        name: '«Малютка»', price: 140, wheels: [[30, 90, 16, 18], [104, 90, 16, 18]], hoodY: 48, faceY: 58, sy: 17,
        body(K) {
          K.rr(36, 22, 78, 28, 6, shade(K.col, -0.06));
          K.rr(42, 26, 66, 20, 4, K.glass);
          K.rr(38, 17, 74, 6, 3, K.roofCol);
          K.poly([30, 48, 120, 48, 126, 58, 24, 58], K.light);
          K.rr(22, 56, 106, 34, 10, K.dark);
          for (const x of [36, 114]) K.hl(x, 68, 7);
          K.rr(56, 63, 38, 14, 6, K.chrome);
          for (let x = 60; x < 92; x += 6) K.r(x, 65, 1.6, 10, '#2a2630');
          K.r(24, 88, 102, 4, K.bumper);
        },
      },
      bus: {
        name: 'Микроавтобус хиппи', price: 240, wheels: [[18, 92, 20, 16], [112, 92, 20, 16]], hoodY: 50, faceY: 52, sy: 0,
        body(K) {
          K.rr(12, 0, 126, 56, 14, K.roofCol);
          K.rr(20, 8, 52, 30, 7, K.glass);
          K.rr(78, 8, 52, 30, 7, K.glass);
          K.rr(10, 50, 130, 42, 8, K.col);
          K.poly([44, 50, 106, 50, 75, 78], K.roofCol);
          K.dot(75, 60, 7.5, K.chrome);
          K.dot(75, 60, 5.5, K.roofCol);
          K.line([71, 57, 75, 64, 79, 57], 1.4, K.chrome);
          for (const x of [26, 124]) K.hl(x, 70, 7.5);
          K.r(6, 90, 138, 6, K.bumper);
        },
      },
      beetle: {
        name: '«Жук»', price: 200, wheels: [[22, 90, 18, 18], [110, 90, 18, 18]], hoodY: 54, faceY: 70, sy: 18,
        body(K) {
          K.ell(75, 44, 36, 26, shade(K.col, -0.06));
          K.rr(52, 30, 46, 20, 9, K.glass);
          K.ell(75, 22, 22, 6, K.roofCol);
          K.ell(32, 76, 22, 16, K.col);
          K.ell(118, 76, 22, 16, K.col);
          for (const x of [32, 118]) {
            K.ell(x, 62, 8, 9, K.chrome);
            K.ell(x, 62, 6.5, 7.5, K.lamp);
          }
          K.ell(75, 74, 30, 20, K.light);
          K.rr(70, 70, 10, 3, 1.5, K.chrome);
          K.r(12, 90, 126, 4, K.bumper);
          K.r(46, 84, 3, 10, K.bumper);
          K.r(101, 84, 3, 10, K.bumper);
        },
      },
    };
    const CPAL = ['#b8323f', '#e0453a', '#e9a23a', '#d9c48f', '#3f8f5a', '#2a8a8f', '#9fc8c0', '#5a7fbf', '#2b3a67', '#8c4a9c', '#ff5fa2', '#f4efe6', '#3a3342'];
    const CAR_COLORS = {
      color: ['Кузов', CPAL],
      color2: ['Крыша и верх', ['#f4efe6', '#1d1a22', '#e9c46a', '#5fe1ff', '#ff5fa2', '#3f8f5a']],
      stripeColor: ['Полосы', ['#f4efe6', '#1d1a22', '#e9c43a', '#e0453a', '#5fe1ff']],
      glowColor: ['Подсветка', ['#5fe1ff', '#ff5fa2', '#5fffb0', '#b28bff', '#ffae2e']],
      avaColor: ['Табличка', ['#2a8a8f', '#b8323f', '#5a7fbf', '#8c4a9c', '#3f8f5a']],
    };
    const CAR = {
      model: { cat: 'body', label: 'Модель', thumb: ['car', 75, 54, 176], items: Object.entries(MODELS).map(([id, m]) => [id, m.name, m.price]) },
      top: { cat: 'body', label: 'Крыша', thumb: ['car', 75, 30, 120], items: [['hard', 'Жёсткая', 0], ['open', 'Кабриолет', 150]] },
      paint: { cat: 'body', label: 'Покраска', thumb: ['car', 75, 54, 176], colors: ['color', 'color2'], items: [['one', 'Один цвет', 0], ['two', 'Двухцветная', 60], ['gold', 'Золото', 600]] },
      stripes: { cat: 'decor', label: 'Полосы', thumb: ['car', 75, 66, 120], colors: ['stripeColor'], items: [['none', 'Без полос', 0], ['race', 'Гоночные', 80], ['flames', 'Пламя', 160], ['checker', 'Шашечки', 90]] },
      glow: { cat: 'decor', label: 'Подсветка снизу', thumb: ['car', 75, 92, 110], colors: ['glowColor'], items: [['none', 'Нет', 0], ['on', 'Неон', 120]] },
      roof: { cat: 'decor', label: 'На крыше', thumb: ['car', 75, 0, 120], colors: ['avaColor'], items: [['sign', 'Табличка канала', 0], ['taxi', 'Такси', 100], ['flag', 'И флажок', 50], ['siren', 'И мигалка', 90]] },
      wheels: { cat: 'parts', label: 'Колёса', thumb: ['car', 25, 96, 34], items: [['white', 'Белые боковины', 0], ['black', 'Чёрные', 0], ['chrome', 'Хром', 70], ['gold', 'Золотые', 200]] },
      lights: { cat: 'parts', label: 'Фары', thumb: ['car', 30, 70, 60], items: [['warm', 'Тёплые', 0], ['white', 'Белые', 0], ['blue', 'Ледяные', 60], ['pink', 'Розовые', 60]] },
      mascot: { cat: 'parts', label: 'На капоте', thumb: ['car', 75, 46, 70], items: [['classic', 'Фигурка', 0], ['none', 'Ничего', 0], ['star', 'Звезда', 80], ['wings', 'Крылья', 150]] },
    };
    const CCATS = [['body', 'Кузов'], ['decor', 'Украшения'], ['parts', 'Детали']];
    const CAR_DEF0 = { model: 'sedan', top: 'hard', paint: 'one', stripes: 'none', glow: 'none', roof: 'sign', wheels: 'white', lights: 'warm', mascot: 'classic', color: '#b8323f', color2: '#f4efe6', stripeColor: '#f4efe6', glowColor: '#5fe1ff', avaColor: '#2a8a8f' };
    function drawCar(p, C, t = 0, ava = null, label = '') {
      const { dot, star, line } = kit(p);
      const M = MODELS[C.model] || MODELS.sedan;
      const poly = (pts, fill) => {
        p.beginPath();
        p.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
        p.closePath();
        p.fillStyle = fill;
        p.fill();
      };
      const r = (x, y, w, h, f) => {
        p.fillStyle = f;
        p.fillRect(x, y, w, h);
      };
      const gold = C.paint === 'gold';
      const col = gold ? '#e0b45a' : C.color;
      const lamp = { warm: '#fff4cc', white: '#f4f8ff', blue: '#9fd8ff', pink: '#ffc4e6' }[C.lights];
      const K = {
        poly,
        r,
        dot,
        line,
        col,
        light: shade(col, 0.3),
        mid: shade(col, 0.08),
        dark: shade(col, -0.2),
        darker: shade(col, -0.38),
        roofCol: C.paint === 'two' ? C.color2 : gold ? '#ffe08a' : shade(col, 0.42),
        chrome: '#dcd6ca',
        bumper: gold ? '#fff2c0' : '#dcd6ca',
        glass: 'rgba(150,190,255,.55)',
        lamp,
        halo: lamp + '73',
        rr(x, y, w, h, rad, f) {
          p.fillStyle = f;
          p.beginPath();
          p.roundRect(x, y, w, h, rad);
          p.fill();
        },
        ell(x, y, rx, ry, f) {
          p.fillStyle = f;
          p.beginPath();
          p.ellipse(x, y, rx, ry, 0, 0, PI2);
          p.fill();
        },
        hl(x, y, rad) {
          dot(x, y, rad + 2, '#dcd6ca');
          dot(x, y, rad, lamp);
          dot(x - rad * 0.3, y - rad * 0.3, rad * 0.3, '#fff');
        },
      };
      if (C.glow === 'on') {
        const gl = p.createRadialGradient(75, 104, 4, 75, 104, 90);
        gl.addColorStop(0, C.glowColor + 'cc');
        gl.addColorStop(1, 'rgba(0,0,0,0)');
        p.fillStyle = gl;
        p.fillRect(-20, 80, 190, 40);
      }
      for (const [x, y, w, h] of M.wheels) {
        r(x, y, w, h, '#0b0a0e');
        const cx = x + w / 2;
        const cy = y + h * 0.55;
        if (C.wheels === 'white') r(x + 3, cy, w - 6, 3, '#cfc8bb');
        if (C.wheels === 'chrome' || C.wheels === 'gold') {
          const a = C.wheels === 'gold' ? ['#e0b45a', '#ffe08a'] : ['#dcd6ca', '#8a8494'];
          r(cx - w * 0.32, cy - 4, w * 0.64, 9, a[0]);
          r(cx - 3, cy - 2, 6, 5, a[1]);
        }
      }
      // открытая машина: водитель виден — человечек в нашем стиле, в солнечных очках и рубашке цвета канала;
      // рисуется до кузова, капот закрывает его ниже плеч
      const open = M.alwaysOpen || (C.top === 'open' && M.open);
      if (open) {
        const s = 0.36;
        p.save();
        p.translate(75 - 50 * s, M.hoodY + 6 - 100 * s);
        p.scale(s, s);
        portrait(p, { ...DEF, hair: 'wavy', hairColor: '#3a2418', head: 'none', glasses: 'sun', glassesColor: '#1d1a22', top: 'tee', topColor: C.avaColor, back: 'none', gesture: 'none' }, false, t);
        p.restore();
      }
      M.body(K);
      // кабина: жёсткая крыша или кабриолет (у кого бывает)
      let sy = M.sy;
      if (M.cab) {
        const [cab, glass, roofPts] = M.cab;
        if (open) {
          p.save();
          p.beginPath();
          p.rect(-50, M.open, 250, 200);
          p.clip();
          poly(glass, 'rgba(150,190,255,.45)');
          p.restore();
          const xs = glass.filter((_, i) => i % 2 === 0);
          r(Math.min(...xs) + 4, M.open - 2, Math.max(...xs) - Math.min(...xs) - 8, 3, K.chrome); // рамка стекла
          sy = M.open;
        } else {
          poly(cab, shade(col, -0.06));
          poly(glass, K.glass);
          poly(roofPts, K.roofCol);
        }
      }
      M.after?.(K);
      // полосы, шашечки, пламя
      const sc = C.stripeColor;
      const fy = M.faceY;
      if (C.stripes === 'race') {
        r(62, M.hoodY, 8, fy - M.hoodY, sc);
        r(80, M.hoodY, 8, fy - M.hoodY, sc);
        r(63, fy, 6, 24, sc);
        r(81, fy, 6, 24, sc);
      } else if (C.stripes === 'flames') {
        for (const s of [-1, 1]) {
          p.save();
          p.translate(75, fy - 62);
          p.scale(s, 1);
          poly([-70, 70, -50, 64, -56, 72, -36, 66, -44, 76, -26, 74, -40, 84, -70, 84], '#ffae2e');
          poly([-70, 74, -56, 70, -58, 76, -44, 74, -52, 82, -70, 82], sc === '#f4efe6' ? '#e0453a' : sc);
          p.restore();
        }
      }
      if (C.stripes === 'checker' || C.roof === 'taxi') for (let i = 0; i < 8; i++) r(39 + i * 9, fy - 7, 9, 5, i % 2 ? '#1d1a22' : C.stripes === 'checker' ? sc : '#f4efe6');
      // фигурка на капоте
      const hy = M.hoodY;
      if (C.mascot === 'classic') poly([72, hy, 78, hy, 75, hy - 7], K.chrome);
      if (C.mascot === 'star') star(75, hy - 7, 7, '#e0b45a');
      if (C.mascot === 'wings') {
        poly([75, hy, 60, hy - 8, 66, hy], K.chrome);
        poly([75, hy, 90, hy - 8, 84, hy], K.chrome);
        dot(75, hy - 3, 3, '#e0b45a');
      }
      if (C.roof === 'taxi') {
        r(88, sy - 9, 26, 9, '#ffd56a');
        p.fillStyle = '#1d1a22';
        p.font = '800 6.5px system-ui';
        p.textAlign = 'center';
        p.textBaseline = 'middle';
        p.fillText('ТАКСИ', 101, sy - 4.5);
      }
      // табличка с аватаркой канала (у открытой машины — на стойке сбоку, чтобы не закрывать водителя)
      const ax = open ? 118 : 75;
      const ay = open ? M.hoodY - 4 : sy;
      r(ax - 3, ay - 10, 6, 10, '#2a2630');
      if (ava) p.drawImage(ava, ax - 15, ay - 39, 30, 30);
      else {
        dot(ax, ay - 24, 15, C.avaColor);
        p.strokeStyle = '#f4efe6';
        p.lineWidth = 2.5;
        p.beginPath();
        p.arc(ax, ay - 24, 15, 0, PI2);
        p.stroke();
        p.fillStyle = '#fff';
        p.font = '800 12px system-ui';
        p.textAlign = 'center';
        p.textBaseline = 'middle';
        p.fillText(label || '★', ax, ay - 23);
      }
      if (C.roof === 'flag') {
        r(132, sy - 30, 2, 40, '#9a958c');
        poly([134, sy - 30, 154, sy - 22 + Math.sin(t * 6) * 3, 134, sy - 14], '#e9c46a');
      }
      if (C.roof === 'siren') {
        const on = Math.floor(t * 4) % 2;
        r(40, sy - 8, 14, 8, on ? '#ff3d3d' : '#5a1010');
        r(96, sy - 8, 14, 8, on ? '#10205a' : '#3d6bff');
      }
    }

    // ---------- Хранение: образы каналов, купленные вещи, за кого играем ----------
    // 'fameLooks' = { player: ключ канала | null, playerName, playerAt, ch: { ключ: { name, runner: {отличия}, car: {отличия}, at } } }
    // 'fameOwned' = { 'runner.head.crown': когда куплено, … } — вещь покупается один раз и подходит любому каналу.
    // Хранится как банк монет (wardRead/wardWrite, общая очередь wardDo) и так же уезжает на другие устройства
    // (mergeWardrobe). Сброшенный образ остаётся с пустыми отличиями и новым at — чтобы сброс тоже доехал.
    const looksGet = () => wardRead(LOOKS_KEY).then((d) => mergeLooks(d, null));
    // изменить и записать по очереди, чтобы два сохранения подряд не потеряли друг друга
    const looksSave = (mut) =>
      wardDo(async () => {
        const d = await looksGet();
        mut(d);
        await wardWrite(LOOKS_KEY, d);
        return d;
      });
    // своё: купленное здесь и покупки из банка (в том числе с других устройств)
    const ownedGet = async () => {
      const o = mergeOwned(await wardRead(OWNED_KEY), null);
      for (const [id, b] of Object.entries(walletOf(await wardRead(WALLET)).bought)) if (!(id in o)) o[id] = b.at;
      return o;
    };
    const ownedAdd = (id) =>
      wardDo(async () => {
        const o = mergeOwned(await wardRead(OWNED_KEY), null);
        if (!(id in o)) o[id] = Date.now();
        await wardWrite(OWNED_KEY, o);
        return ownedGet();
      });
    const diffOf = (state, defs) => Object.fromEntries(Object.entries(state).filter(([k, v]) => v !== defs[k]));
    // машина канала по умолчанию — седан своего цвета (по имени), чтобы и ненаряженные каналы различались
    const carDefault = (name) => {
      let h = 0;
      for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return { ...CAR_DEF0, color: CPAL[h % CPAL.length], avaColor: ['#2a8a8f', '#b8323f', '#5a7fbf', '#8c4a9c', '#3f8f5a'][h % 5] };
    };
    // образ канала для игры: бегун и машина с учётом нарядов
    const lookOf = (d, name) => {
      const c = d?.ch?.[fameKey(name)];
      return { runner: { ...DEF, ...(c?.runner || {}) }, car: { ...carDefault(name), ...(c?.car || {}) }, dressed: !!(c && (Object.keys(c.runner || {}).length || Object.keys(c.car || {}).length)) };
    };
    // аватарка канала — круг с картинкой (или инициалами); картинку дорисует, когда загрузится
    const initials = (name) =>
      String(name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] || '')
        .join('')
        .toUpperCase() || '?';
    function avatar(name, icon, color = '#2a8a8f') {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d');
      const paint = (img) => {
        g.clearRect(0, 0, 96, 96);
        g.save();
        g.beginPath();
        g.arc(48, 48, 45, 0, PI2);
        g.fillStyle = color;
        g.fill();
        g.clip();
        if (img) {
          const s = Math.max(90 / img.naturalWidth, 90 / img.naturalHeight);
          g.drawImage(img, 48 - (img.naturalWidth * s) / 2, 48 - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
        } else {
          const t = initials(name);
          g.fillStyle = '#fff';
          g.font = `800 ${t.length > 1 ? 36 : 46}px Manrope, system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(t, 48, 51);
        }
        g.restore();
        g.lineWidth = 5;
        g.strokeStyle = '#f4efe6';
        g.beginPath();
        g.arc(48, 48, 45, 0, PI2);
        g.stroke();
      };
      paint(null);
      if (icon) {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => img.naturalWidth && paint(img);
        img.src = icon;
      }
      return c;
    }

    // ---------- Кружки гардероба и код образа ----------
    function thumbDraw(c, spec, draw) {
      const p = c.getContext('2d');
      const S = c.width;
      const [, cx, cy, size] = spec;
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.clearRect(0, 0, S, S);
      p.save();
      p.beginPath();
      p.arc(S / 2, S / 2, S / 2, 0, PI2);
      p.clip();
      p.fillStyle = '#2c2638';
      p.fillRect(0, 0, S, S);
      const k = S / size;
      p.translate(S / 2 - cx * k, S / 2 - cy * k);
      p.scale(k, k);
      draw(p);
      p.restore();
    }
    // Код: «СМБ1-»/«СМК1-» + по 3 знака на каждое отличие от стандарта (номер свойства, i — вещь по номеру,
    // p — цвет из палитры, h — свой цвет и ещё 6 знаков)
    const B36 = (n) => n.toString(36);
    function encode(prefix, state, defs, groups, colors) {
      return (
        prefix +
        Object.keys(defs)
          .map((k, i) => {
            const v = state[k];
            if (v === defs[k]) return '';
            if (groups[k]) return B36(i) + 'i' + B36(groups[k].items.findIndex(([id]) => id === v));
            const pi = colors[k]?.[1].indexOf(v);
            return B36(i) + (pi >= 0 ? 'p' + B36(pi) : 'h' + String(v).slice(1).toLowerCase());
          })
          .join('')
      );
    }
    function decode(prefix, raw, defs, groups, colors) {
      const at = raw.indexOf(prefix);
      if (at < 0) return null;
      const keys = Object.keys(defs);
      const body = raw.slice(at + prefix.length).replace(/\s+/g, '');
      const out = {};
      let bad = 0;
      for (let i = 0; i < body.length; ) {
        const k = keys[parseInt(body[i], 36)];
        const t = body[i + 1];
        const val = body.slice(i + 2, i + 2 + (t === 'h' ? 6 : 1));
        i += 2 + (t === 'h' ? 6 : 1);
        let v = null;
        if (k && t === 'i' && groups[k]) v = groups[k].items[parseInt(val, 36)]?.[0];
        if (k && t === 'p' && colors[k]) v = colors[k][1][parseInt(val, 36)];
        if (k && t === 'h' && colors[k] && /^[0-9a-f]{6}$/i.test(val)) v = '#' + val.toLowerCase();
        if (v) out[k] = v;
        else bad++;
      }
      return bad && bad * 3 >= body.length ? null : out;
    }

    // ---------- Редактор гардероба и гаража канала (в профиле канала) ----------
    // host — куда; channel: { name, icon }. Сохраняется само; «Играть за этот канал» выбирает бегуна для забега.
    // Вернёт { el, mount(host) } — профиль перерисовывается целиком, а редактор переносится в новую разметку
    // со всем состоянием (вкладки, примерка).
    const KINDS = {
      runner: { groups: GROUPS, cats: CATS, colors: COLORS, prefix: 'СМБ1-', noun: 'образа' },
      car: { groups: CAR, cats: CCATS, colors: CAR_COLORS, prefix: 'СМК1-', noun: 'машины' },
    };
    function editor(host, channel) {
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const key = fameKey(channel.name);
      const defs = { runner: DEF, car: carDefault(channel.name) };
      const S = { kind: 'runner', view: 'run', cat: { runner: 'head', car: 'body' }, runner: { ...DEF }, car: { ...defs.car }, owned: {}, bank: 0, player: null, pending: null };
      const ava = avatar(channel.name, channel.icon, defs.car.avaColor);
      const root = document.createElement('div');
      root.className = 'le';
      root.innerHTML = `<div class="le-top"><div class="le-seg le-kind" role="tablist"><button type="button" data-kind="runner" aria-pressed="true">Бегун</button><button type="button" data-kind="car" aria-pressed="false">Машина</button></div><button type="button" class="btn small le-play" aria-pressed="false">▶ Играть за этот канал</button></div>
        <div class="le-studio">
          <div class="le-stage">
            <div class="le-seg le-view"><button type="button" data-view="run" aria-pressed="true">На бегу</button><button type="button" data-view="face" aria-pressed="false">Лицом</button></div>
            <canvas class="le-cv" width="560" height="440" aria-label="Образ канала"></canvas>
            <div class="le-bank">В банке <b class="le-coins">…</b> монет<span class="le-cost"></span></div>
            <div class="le-buy" hidden></div>
            <div class="le-share"><button type="button" class="btn small" data-copy>Скопировать код</button><input type="text" spellcheck="false" placeholder="Вставьте код" aria-label="Код образа"><button type="button" class="btn small" data-apply>Применить</button><small aria-live="polite"></small></div>
          </div>
          <div class="le-side"><div class="le-seg le-cats"></div><div class="le-inv"></div><div class="le-presets-box"><h4>Готовые образы</h4><div class="le-presets"></div></div></div>
        </div>`;
      host.appendChild(root);
      const $ = (s) => root.querySelector(s);
      const cv = $('.le-cv');
      const g = cv.getContext('2d');
      const say = (t, cls = '') => {
        const m = $('.le-share small');
        m.textContent = t;
        m.className = cls;
      };
      const itemId = (kind, k, v) => `${kind}.${k}.${v}`;
      const priceOf = (kind, k, v) => KINDS[kind].groups[k]?.items.find(([id]) => id === v)?.[2] || 0;
      const owns = (kind, k, v) => !priceOf(kind, k, v) || !!S.owned[itemId(kind, k, v)];
      // что сохраняем: примерка (ещё не купленная вещь) не сохраняется
      const saved = (kind) => (S.pending?.kind === kind ? { ...S[kind], [S.pending.k]: S.pending.prev } : S[kind]);
      let saveT = 0;
      const save = () => {
        clearTimeout(saveT);
        saveT = setTimeout(
          () =>
            looksSave((d) => {
              const r = diffOf(saved('runner'), DEF);
              const c = diffOf(saved('car'), defs.car);
              // сброшенный образ остаётся пустым с новым временем — так сброс доедет до других устройств
              if (Object.keys(r).length || Object.keys(c).length || d.ch[key]) d.ch[key] = { name: channel.name, runner: r, car: c, at: Date.now() };
            }),
          250
        );
      };
      const cancelTry = () => {
        if (!S.pending) return;
        S[S.pending.kind][S.pending.k] = S.pending.prev;
        S.pending = null;
      };
      // ---- разметка гардероба ----
      const render = () => {
        const K = KINDS[S.kind];
        const st = S[S.kind];
        root.querySelectorAll('.le-kind [data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind)));
        $('.le-view').hidden = S.kind !== 'runner';
        root.querySelectorAll('.le-view [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
        $('.le-play').setAttribute('aria-pressed', String(S.player === key));
        $('.le-play').textContent = S.player === key ? '✓ Вы играете за этот канал' : '▶ Играть за этот канал';
        $('.le-coins').textContent = S.bank;
        $('.le-cats').innerHTML = K.cats.map(([id, name]) => `<button type="button" data-cat="${id}" aria-pressed="${S.cat[S.kind] === id}">${esc(name)}</button>`).join('');
        $('.le-inv').innerHTML = Object.entries(K.groups)
          .filter(([, gr]) => gr.cat === S.cat[S.kind])
          .map(
            ([k, gr]) => `<div><h4>${esc(gr.label)}</h4><div class="le-slots">${gr.items
              .map(([id, name, pr]) => {
                const own = owns(S.kind, k, id);
                return `<button type="button" class="le-slot${own ? '' : ' locked'}" data-k="${k}" data-v="${id}" aria-pressed="${st[k] === id}" title="${esc(name)}${pr ? (own ? ' · куплено' : ` · ${pr} монет`) : ''}"><canvas width="112" height="112"></canvas>${pr && !own ? `<span class="le-coin">${pr}</span>` : ''}<span class="le-nm">${esc(name)}</span></button>`;
              })
              .join('')}</div>${(gr.colors || [])
              .map(
                (ck) => `<div class="le-colors"><small>${esc(K.colors[ck][0])}</small>${K.colors[ck][1]
                  .map((col) => `<button type="button" class="le-sw" data-c="${ck}" data-v="${col}" aria-pressed="${st[ck] === col}" aria-label="${esc(K.colors[ck][0])} ${col}" style="background:${col}"></button>`)
                  .join('')}<label class="le-sw le-pick" title="Свой цвет" aria-pressed="${!K.colors[ck][1].includes(st[ck])}"><input type="color" data-c="${ck}" value="${st[ck]}" aria-label="${esc(K.colors[ck][0])}: свой цвет"></label></div>`
              )
              .join('')}</div>`
          )
          .join('');
        root.querySelectorAll('.le-inv .le-slot').forEach((b) => {
          const gr = K.groups[b.dataset.k];
          thumbDraw(b.querySelector('canvas'), gr.thumb, (p) =>
            S.kind === 'runner' ? drawPerson(p, gr.thumb[0], { ...st, ...(gr.base || {}), [b.dataset.k]: b.dataset.v }) : drawCar(p, { ...st, [b.dataset.k]: b.dataset.v }, 0, ava, initials(channel.name))
          );
        });
        $('.le-presets-box').hidden = S.kind !== 'runner';
        if (S.kind === 'runner' && !$('.le-presets').childElementCount) {
          $('.le-presets').innerHTML = PRESETS.map(([name], i) => `<button type="button" class="le-slot" data-p="${i}"><canvas width="112" height="112"></canvas><span class="le-nm">${esc(name)}</span></button>`).join('');
          root.querySelectorAll('[data-p]').forEach((b, i) => thumbDraw(b.querySelector('canvas'), ['face', 50, 46, 92], (p) => portrait(p, { ...DEF, ...PRESETS[i][1] }, false, 0.1)));
        }
        const buy = $('.le-buy');
        if (S.pending) {
          const P = S.pending;
          const short = P.price > S.bank;
          buy.hidden = false;
          buy.innerHTML = `<span>Примерка: <b>${esc(P.name)}</b> — ${P.price} монет${short ? ` · не хватает ${P.price - S.bank}` : ''}</span><button type="button" class="btn small primary" data-buy ${short ? 'disabled' : ''}>Купить</button><button type="button" class="btn small" data-unbuy>Снять</button>`;
        } else buy.hidden = true;
      };
      // применить набор вещей и цветов (код, готовый образ): некупленные вещи пропускаем
      const applySet = (kind, set) => {
        const st = S[kind];
        const need = [];
        for (const [k, v] of Object.entries(set)) {
          if (KINDS[kind].groups[k]) {
            if (owns(kind, k, v)) st[k] = v;
            else need.push(KINDS[kind].groups[k].items.find(([id]) => id === v)?.[1] || v);
          } else if (KINDS[kind].colors[k]) st[k] = v;
        }
        return need;
      };
      root.addEventListener('click', async (e) => {
        const t = e.target;
        const kb = t.closest('[data-kind]');
        if (kb) {
          cancelTry();
          S.kind = kb.dataset.kind;
          say('');
          return render();
        }
        const vb = t.closest('[data-view]');
        if (vb) {
          S.view = vb.dataset.view;
          return render();
        }
        const cb = t.closest('[data-cat]');
        if (cb) {
          S.cat[S.kind] = cb.dataset.cat;
          return render();
        }
        if (t.closest('.le-play')) {
          S.player = S.player === key ? null : key;
          looksSave((d) => {
            d.player = S.player;
            d.playerName = S.player ? channel.name : null;
            d.playerAt = Date.now();
          });
          return render();
        }
        const pb = t.closest('[data-p]');
        if (pb) {
          cancelTry();
          S.runner = { ...DEF };
          const need = applySet('runner', PRESETS[+pb.dataset.p][1]);
          say(need.length ? 'Ещё нужно купить: ' + need.join(', ') : 'Готовый образ надет', need.length ? '' : 'ok');
          save();
          return render();
        }
        const slot = t.closest('.le-slot[data-k]');
        if (slot) {
          const { k, v } = slot.dataset;
          cancelTry();
          if (owns(S.kind, k, v)) {
            S[S.kind][k] = v;
            save();
          } else {
            const it = KINDS[S.kind].groups[k].items.find(([id]) => id === v);
            S.pending = { kind: S.kind, k, v, prev: S[S.kind][k], price: it[2], name: it[1], id: itemId(S.kind, k, v) };
            S[S.kind][k] = v;
          }
          return render();
        }
        const sw = t.closest('button.le-sw');
        if (sw) {
          S[S.kind][sw.dataset.c] = sw.dataset.v;
          save();
          return render();
        }
        if (t.closest('[data-unbuy]')) {
          cancelTry();
          return render();
        }
        if (t.closest('[data-buy]') && S.pending) {
          const P = S.pending;
          const left = await runSpend(P.price, P.id);
          if (left < 0) {
            say('Не хватает монет — забег за ремонтом в конце аллеи их принесёт', 'bad');
            return;
          }
          S.bank = left;
          S.owned = await ownedAdd(P.id);
          S.pending = null;
          say('Куплено: ' + P.name, 'ok');
          save();
          return render();
        }
        if (t.closest('[data-copy]')) {
          const inp = $('.le-share input');
          const K = KINDS[S.kind];
          inp.value = encode(K.prefix, saved(S.kind), defs[S.kind], K.groups, K.colors);
          try {
            await navigator.clipboard.writeText(inp.value);
            say('Код скопирован — отправьте его другу', 'ok');
          } catch {
            inp.select();
            say('Код в поле — скопируйте его (Ctrl+C)');
          }
          return;
        }
        if (t.closest('[data-apply]')) applyCode();
      });
      const applyCode = () => {
        const raw = $('.le-share input').value.trim();
        const kind = raw.includes('СМК1-') ? 'car' : raw.includes('СМБ1-') ? 'runner' : null;
        if (!kind) return say(raw ? 'Это не код образа или машины' : 'Вставьте код', 'bad');
        const K = KINDS[kind];
        const set = decode(K.prefix, raw, defs[kind], K.groups, K.colors);
        if (!set) return say('Код повреждён — скопируйте его ещё раз', 'bad');
        cancelTry();
        S.kind = kind;
        S[kind] = { ...defs[kind] };
        const need = applySet(kind, set);
        say(need.length ? 'Применено; ещё нужно купить: ' + need.join(', ') : (kind === 'car' ? 'Машина' : 'Образ') + ' применён', need.length ? '' : 'ok');
        save();
        render();
      };
      $('.le-share input').addEventListener('keydown', (e) => e.key === 'Enter' && applyCode());
      root.addEventListener('input', (e) => {
        const i = e.target.closest('input[type=color]');
        if (i) S[S.kind][i.dataset.c] = i.value;
      });
      root.addEventListener('change', (e) => {
        if (!e.target.closest('input[type=color]')) return;
        save();
        render();
      });
      // ---- сцена: бегун на дороге (или лицом), машина в гараже ----
      const t0 = performance.now();
      let jumpAt = -9;
      cv.addEventListener('click', () => (jumpAt = (performance.now() - t0) / 1000));
      let raf = 0;
      const frame = (now) => {
        raf = 0;
        if (!root.isConnected) return;
        const t = (now - t0) / 1000;
        const W = cv.width;
        const H = cv.height;
        if (S.kind === 'car') drawGarage(g, W, H, S.car, t, ava, initials(channel.name));
        else drawStage(g, W, H, S.runner, t, S.view, jumpAt);
        raf = requestAnimationFrame(frame);
      };
      const start = () => !raf && (raf = requestAnimationFrame(frame));
      // ---- данные ----
      render();
      Promise.all([looksGet(), ownedGet(), runBank()]).then(([d, owned, bank]) => {
        const c = d.ch[key];
        S.runner = { ...DEF, ...(c?.runner || {}) };
        S.car = { ...defs.car, ...(c?.car || {}) };
        S.owned = owned;
        S.bank = bank;
        S.player = d.player;
        render();
      });
      start();
      return {
        el: root,
        mount(h) {
          if (root.parentNode !== h) h.appendChild(root);
          start();
          runBank().then((b) => {
            S.bank = b;
            $('.le-coins').textContent = b;
          });
        },
      };
    }
    // сцена бегуна: дорога и бегун со спины (с медальоном-лицом) или портрет лицом
    function drawStage(g, W, H, look, t, view, jumpAt) {
      const blink = t % 3.4 < 0.13;
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (view === 'face') {
        const bg = g.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.5, W * 0.7);
        bg.addColorStop(0, '#3d2152');
        bg.addColorStop(1, '#120e18');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        const S = H / 102;
        g.save();
        g.translate(W / 2 - 50 * S, H - 100 * S);
        g.scale(S, S);
        portrait(g, look, blink, t);
        g.restore();
        return;
      }
      const hy = H * 0.42;
      const sky = g.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, '#0b0816');
      sky.addColorStop(1, '#4a2550');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, hy);
      g.fillStyle = '#1c1722';
      g.fillRect(0, hy, W, H - hy);
      g.fillStyle = '#251a31';
      for (let i = 0, x = 0; x < W; i++) {
        const w = 40 + ((i * 37) % 50);
        const h = 40 + ((i * 53) % 100);
        g.fillRect(x, hy - h, w, h);
        x += w + 6;
      }
      const hx = W / 2;
      g.fillStyle = '#2b2531';
      g.beginPath();
      g.moveTo(hx - 30, hy);
      g.lineTo(hx + 30, hy);
      g.lineTo(W * 1.1, H);
      g.lineTo(-W * 0.1, H);
      g.fill();
      g.fillStyle = '#3b2d3c';
      g.beginPath();
      g.moveTo(hx - 8, hy);
      g.lineTo(hx + 8, hy);
      g.lineTo(W * 0.72, H);
      g.lineTo(W * 0.28, H);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.3)';
      g.lineWidth = 2;
      for (let k = 0; k < 14; k++) {
        const z = ((k + ((t * 3) % 1)) / 14) ** 2;
        const y = hy + (H - hy) * z;
        const half = 8 + (W * 0.22 - 8) * z;
        g.beginPath();
        g.moveTo(hx - half, y);
        g.lineTo(hx + half, y);
        g.stroke();
      }
      const jt = t - jumpAt;
      const jy = jt < 0.7 ? Math.sin((jt / 0.7) * Math.PI) * H * 0.17 : 0;
      const fr = jt < 0.7 ? 6 : Math.floor(t * 11) % 6;
      const S = H / 150;
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath();
      g.ellipse(W / 2, H * 0.92, 20 * S - jy * 0.05, 3.6 * S, 0, 0, PI2);
      g.fill();
      g.save();
      g.translate(W / 2 - 50 * S, H * 0.92 - 100 * S - jy);
      g.scale(S, S);
      runner(g, fr, look);
      g.restore();
      const R = H * 0.13;
      g.save();
      g.beginPath();
      g.arc(R + 14, R + 14, R, 0, PI2);
      g.fillStyle = '#2a1838';
      g.fill();
      g.clip();
      g.translate(14, 14 + R * 0.08);
      g.scale((2 * R) / 100, (2 * R) / 100);
      portrait(g, look, blink, t);
      g.restore();
      g.strokeStyle = '#f2d68a';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(R + 14, R + 14, R, 0, PI2);
      g.stroke();
    }
    function drawGarage(g, W, H, car, t, ava, label) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#16121c';
      g.fillRect(0, 0, W, H);
      const fl = g.createLinearGradient(0, H * 0.62, 0, H);
      fl.addColorStop(0, '#231f2d');
      fl.addColorStop(1, '#2c2638');
      g.fillStyle = fl;
      g.fillRect(0, H * 0.62, W, H);
      const sp = g.createRadialGradient(W / 2, 0, 10, W / 2, H * 0.5, H * 0.7);
      sp.addColorStop(0, 'rgba(255,230,170,.18)');
      sp.addColorStop(1, 'rgba(255,230,170,0)');
      g.fillStyle = sp;
      g.fillRect(0, 0, W, H);
      const S = Math.min(W / 190, H / 165);
      g.save();
      g.translate(W / 2 - 75 * S, H * 0.92 - 108 * S);
      g.scale(S, S);
      drawCar(g, car, t, ava, label);
      g.restore();
    }
    const drawPerson = (p, kind, L) => (kind === 'back' ? runner(p, 1, L) : portrait(p, L, false, 0.1));

    return { DEF, carDefault, runner, portrait, drawCar, avatar, initials, looksGet, looksSave, lookOf, ownedGet, editor };
  })();

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

  // Страница «Смотреть позже» YouTube (/playlist?list=WL) → [{ id, title, channel, … }] в порядке списка или null
  function parseWatchLaterPage(html) {
    const data = initialDataFrom(html);
    if (!data) return null;
    const out = [];
    const seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      const it = o.playlistVideoRenderer?.videoId ? fromVideoRenderer(o.playlistVideoRenderer) : o.lockupViewModel?.contentId ? fromLockup(o.lockupViewModel) : undefined;
      if (it !== undefined) {
        if (it?.id && /^[\w-]{11}$/.test(it.id) && !seen.has(it.id)) seen.add(it.id), out.push(it);
        return;
      }
      for (const k in o) walk(o[k]);
    })(data.contents || data);
    return out;
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
  async function driveSync(token, local, { settings, stats, playlists, fame, wardrobe, fetchFn = fetch } = {}) {
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
    // свои наборы — слиянием по каждому набору (свежее побеждает); у старых версий их нет — не трогаем
    const outSets = settings?.customSets || remote.settings?.customSets ? mergeSets(settings?.customSets, remote.settings?.customSets) : null;
    if (outSets && stableJson(outSets) !== stableJson(remote.settings?.customSets || null)) remoteChanged = true;
    if (stats && stableJson(stats) !== stableJson(remote.stats)) remoteChanged = true;
    // Список плейлистов: сливаем по каждому плейлисту; null — у устройства его нет (старая версия), не трогаем
    const outPlaylists = playlists || remote.playlists ? mergePlaylists(playlists, remote.playlists) : null;
    if (outPlaylists && stableJson(outPlaylists) !== stableJson(remote.playlists || null)) remoteChanged = true;
    const playlistsChanged = !!(outPlaylists && playlists !== undefined && stableJson(outPlaylists) !== stableJson(playlists || { lists: {} }));
    // Аллея славы — так же, по каждому каналу
    const outFame = fame || remote.fame ? mergeFame(fame, remote.fame) : null;
    if (outFame && stableJson(outFame) !== stableJson(remote.fame || null)) remoteChanged = true;
    const fameChanged = !!(outFame && fame !== undefined && stableJson(outFame) !== stableJson(fame || { stars: {} }));
    // Гардероб, гараж каналов и банк монет забега (mergeWardrobe): монеты — по устройствам, поэтому не задваиваются
    const outWard = wardrobe || remote.wardrobe ? mergeWardrobe(wardrobe, remote.wardrobe) : null;
    if (outWard && stableJson(outWard) !== stableJson(remote.wardrobe || null)) remoteChanged = true;
    const wardChanged = !!(outWard && wardrobe && stableJson(outWard) !== stableJson(mergeWardrobe(wardrobe, null)));
    // Свой набор критериев с другого устройства — подписи для старых оценок
    const remoteCriteria = remote.settings?.criteria || null;
    const outStats = stats || remote.stats || null;
    if (remoteChanged) {
      const body = JSON.stringify({ app: DRIVE_APP, version: 1, updatedAt: Date.now(), settings: { criteria: settings?.criteria || remoteCriteria || DEFAULT_CRITERIA, ...(outSets ? { customSets: outSets } : {}) }, stats: outStats, playlists: outPlaylists, fame: outFame, ...(outWard ? { wardrobe: outWard } : {}), videos: next });
      if (fileId) {
        await driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, fetchFn);
      } else {
        const boundary = 'smotribelno' + Date.now();
        const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
        const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
        await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }, fetchFn);
      }
    }
    return { changes, uploaded: remoteChanged, total: Object.keys(next).length, remoteCriteria, customSets: outSets, remoteStats: outStats, playlists: playlistsChanged ? outPlaylists : null, fame: fameChanged ? outFame : null, wardrobe: wardChanged ? outWard : null };
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
    USER_SET_RE,
    MAX_USER_SETS,
    useSettings,
    userSet,
    isTypeId,
    mergeSets,
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
    parseWatchLaterPage,
    fameSceneHtml,
    FAME_LAMP,
    fameBoulevard,
    fitFameWalks,
    fameWalk,
    fameRun,
    fameBank: runBank,
    fameSpend: runSpend,
    mergeWallet,
    walletBalance,
    mergeWardrobe,
    wardrobeGet,
    wardrobeApply,
    dress: DRESS,
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
