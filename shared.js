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
  function thumbHQ(id) {
    return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
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
        if (next) img.src = next;
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
  const SYNC_FIELDS = ['id', 'title', 'channel', 'channelUrl', 'duration', 'short', 'live', 'rating', 'ratingDel', 'later', 'laterDel', 'note', 'noteAt', 'moments', 'watchedAt', 'watchedUpd', 'watchedBy', 'dropped', 'droppedDel', 'noRate', 'resumeHidden', 'pl', 'plAt'];

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
    !!(v && (v.rating || v.later || v.note || v.moments?.length || v.dropped || v.ratingDel || v.laterDel || v.droppedDel || isStarted(v) || ((awaitingRating(v) || isDropCandidate(v)) && recentlyWatched(v)) || (v.pl && Object.keys(v.pl).length) || Date.now() - (v.plAt || 0) < 60 * 86400000));

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
  async function driveSync(token, local, { settings, stats, playlists, fetchFn = fetch } = {}) {
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
    // Свой набор критериев с другого устройства — подписи для старых оценок
    const remoteCriteria = remote.settings?.criteria || null;
    const outStats = stats || remote.stats || null;
    if (remoteChanged) {
      const body = JSON.stringify({ app: DRIVE_APP, version: 1, updatedAt: Date.now(), settings: { criteria: settings?.criteria || remoteCriteria || DEFAULT_CRITERIA }, stats: outStats, playlists: outPlaylists, videos: next });
      if (fileId) {
        await driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, fetchFn);
      } else {
        const boundary = 'smotribelno' + Date.now();
        const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
        const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
        await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }, fetchFn);
      }
    }
    return { changes, uploaded: remoteChanged, total: Object.keys(next).length, remoteCriteria, remoteStats: outStats, playlists: playlistsChanged ? outPlaylists : null };
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
