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
  function laterCmp(a, b) {
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
  const W3_TILT = 62; // наклон тротуара, градусов (вид с аллеи)
  const W3_TILT_TOP = 30; // вид сверху: камера поднята, на звёзды смотрим почти сверху
  function fameWalk(host, { items, onOpen, lite = false }) {
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
      // театр: камень, колонны с капителями, фронтон, козырёк с лампочками над входом, афиши
      theater: (H, L) => {
        const top = Math.round(H * 0.72);
        let r = grad('#5e5040', '#3e352a');
        for (let y = 22; y < L - 20; y += 46) {
          r += rect(0, y, top, 14, '#8f7f66') + rect(top - 8, y - 4, 8, 22, '#a8987e');
          if (rnd() < 0.6) r += rect(top - 60, y + 20, 22, 16, lit(0.7));
        }
        r += rect(top, 0, 12, L, '#a8987e');
        r += `<polygon points="${top + 12},8 ${H - 4},${L / 2} ${top + 12},${L - 8}" fill="#6e604d" stroke="#a8987e" stroke-width="4"/>`;
        r += rect(54, L * 0.18, 16, L * 0.64, '#2a2018') + bulbs(rowY(62, L * 0.18 + 6, L * 0.82 - 6, 12));
        for (let y = 26; y < L - 40; y += 46) if (rnd() < 0.7) r += rect(10, y + 16, 34, 24, '#e4d4ac') + rect(14, y + 20, 26, 16, pick(['#7a2a2a', '#2a4a6a', '#5a3a6a']));
        return r;
      },
      // кино: большая светящаяся вывеска-марки с лампочками, рамки афиш, неоновые полосы
      cinema: (H, L, trim) => {
        let r = grad('#14424a', '#0b2226');
        for (let y = 30; y < L - 10; y += 72) r += rect(0, y, H - 10, 3, trim);
        r += rect(72, 8, 50, L - 16, '#f4efe6');
        for (let x = 80; x < 118; x += 12) r += rect(x, 18, 5, L - 36, '#1e1b22');
        r += bulbs(rowY(70, 12, L - 12, 12)) + bulbs(rowY(124, 12, L - 12, 12));
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
    // Передний ряд — дома с глубиной: фасад к улице, крыша и торец со стороны зрителя (дом «протянут» вбок от улицы).
    // Задний ряд — выше и проще, только фасады: закрывает пустоту за передними домами. На телефоне (lite) его нет.
    let houses = '';
    for (const [sideCls, x] of [['l', 0], ['r', W]]) {
      const out = sideCls === 'l' ? -1 : 1; // наружу от улицы
      for (let y = 40, n = 0; y < LEN - 200; n++) {
        const L = 240 + Math.round(rnd() * 220);
        const H = 170 + Math.round(rnd() * 190);
        const D = 130 + Math.round(rnd() * 70);
        const kind = pick(KIND_POOL);
        const K = KINDS[kind];
        const trim = K ? pick(K.trim) : pick(TRIMS);
        const wall = WALLS[n % WALLS.length];
        // вывеска на фасаде — по типу дома: у казино и шоу повыше, у остальных на среднем этаже
        const sign = K
          ? `<span class="w3-fsign" style="left:${Math.round(H * (kind === 'casino' || kind === 'show' ? 0.66 : 0.5 + rnd() * 0.12))}px;top:${Math.round(L * (0.35 + rnd() * 0.3))}px"><b>${pick(K.words)}</b></span>`
          : '';
        houses += `<div class="w3-bld ${sideCls}" style="left:${x}px;bottom:${y}px;height:${L}px;--h:${H}px;--d:${D}px;--side:${K ? K.side : wall};--trim:${trim}"><div class="w3-wall ${sideCls}" style="width:${H}px;height:${L}px;--wall:${wall};background-image:${wallSvg(kind, H, L, trim)}">${sign}</div><i class="w3-roof"></i><i class="w3-endf"></i></div>`;
        y += L + 18 + Math.round(rnd() * 40);
      }
      if (!lite)
        for (let y = 0; y < LEN - 200; ) {
          const L = 300 + Math.round(rnd() * 300);
          const H = 280 + Math.round(rnd() * 140); // выше передних домов, но ниже верхней границы экрана
          houses += `<div class="w3-wall ${sideCls} back" style="left:${x + out * 250}px;bottom:${y}px;width:${H}px;height:${L}px;background-image:${wallSvg('back', H, L)}"></div>`;
          y += L + 12;
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
    // Машин всегда четыре, они ездят по кругу. Едут не по всей улице, а по отрезку перед зрителем (FAR),
    // и этот отрезок идёт вместе с ним: иначе машина позади проезжала бы у самой «камеры» —
    // браузер растягивал её в огромную картинку, и аллея начинала подтормаживать.
    // В конце отрезка машина растворяется в тумане (встречные — выезжают из него).
    const cars = lite
      ? ''
      : `<div class="w3-traffic" style="--len:${FAR}px">${lanes
          .map(([left, come, t, d], i) => `<div class="w3-car ${come ? 'come' : 'away'}" style="--d:${d}s;--t:${t}s;left:${left}px"><div class="w3-bb w3-rc" style="background-image:${retroCar(come, CAR_COLORS[i % CAR_COLORS.length])}"></div></div>`)
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
    const NEAR = 450;
    let cull = [];
    let traffic = null;
    let bucket = null;
    const collect = () => {
      cull = [...floor.children]
        .filter((el) => el.style.bottom)
        .map((el) => {
          const a = parseFloat(el.style.bottom);
          return { el, a, b: a + (parseFloat(el.style.height) || 260), on: true };
        });
      traffic = floor.querySelector('.w3-traffic');
      bucket = null;
    };
    const cullNow = () => {
      const k = Math.round(pos / 120);
      if (k === bucket) return;
      bucket = k;
      for (const c of cull) {
        const on = c.b > pos - NEAR && c.a < pos + FAR;
        if (on !== c.on) {
          c.on = on;
          c.el.style.display = on ? '' : 'none';
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
      if (traffic) traffic.style.transform = `translateY(${-pos}px)`; // дорожный поток идёт вместе со зрителем
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
        cap.innerHTML = r ? `<b>★ ${escH(r.title)}</b>${r.sub ? `<span>${r.sub}</span>` : ''}<button type="button" class="btn small w3-look" data-w3="${best}">Рассмотреть</button>` : '<b>Ремонт аллеи</b><span>Скоро здесь появятся новые звёзды: ставьте их любимым каналам и роликам</span>';
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
    // переход сразу на нужный бульвар
    w3.addEventListener('click', (e) => {
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
        setAuto(false);
        go(e.deltaY * (e.deltaMode === 1 ? 30 : 1) * 0.9);
      },
      { passive: false }
    );
    let lastY = null;
    let moved = 0;
    w3.addEventListener('pointerdown', (e) => {
      moved = 0;
      if (e.target.closest('.w3-ctl, .w3-cap .btn')) return;
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
          return fameWalk(host, { items, onOpen, lite: liteAsked });
        }
        measure();
        bucket = null;
        apply();
      });
      host._ro.observe(w3);
    }
    if (!host._resizeBound) {
      host._resizeBound = true;
      addEventListener('resize', () => host.isConnected && host.querySelector('.w3-floor') && (host._sig = '', 0));
    }
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
    fameSceneHtml,
    FAME_LAMP,
    fameBoulevard,
    fitFameWalks,
    fameWalk,
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
    send,
  };
})();
