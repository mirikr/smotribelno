// Смотрибельно на телефоне: «Смотреть позже+», оценки по типам видео, моменты, отзывы, «не досмотрел».
// Данные хранятся на телефоне (localStorage). С компьютером обмениваемся файлом: сюда — резервная копия
// из расширения, обратно — файл «с телефона», который расширение загружает в «Настройки» → «Резервная копия».
// При слиянии побеждает более поздняя правка (TR.mergeNewer) — тот же порядок, что будет у синхронизации через Google Drive.
(() => {
  const KEY = 'smotribelno:v1';
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, a, b, c) => {
    const m10 = n % 10;
    const m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
  };

  // ---------- Хранилище ----------
  let db = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && typeof d.videos === 'object') return { settings: {}, ...d };
    } catch {
      // повреждённые данные — начинаем с пустого
    }
    return { videos: {}, settings: {}, importedAt: 0, exportedAt: 0, changedAt: 0 };
  }
  function save(changed = true) {
    if (changed) {
      db.changedAt = Date.now();
      scheduleDrive(); // правка — на Диск через несколько секунд
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      toast('Не удалось сохранить: память браузера переполнена');
      console.warn(e);
    }
  }
  const settings = () => ({ ...TR.DEFAULT_SETTINGS, ...db.settings });
  const video = (id) => (db.videos[id] ||= { id });

  // ---------- Действия (как в фоне расширения) ----------
  function setLater(id, priority) {
    const v = video(id);
    const now = Date.now();
    if (priority) {
      v.later = { priority, addedAt: v.later?.addedAt || now, updatedAt: now };
      delete v.laterDel;
    } else if (v.later) {
      v.laterDel = now;
      delete v.later;
    }
    save();
  }
  function rate(id, scores, vtype, skip) {
    const v = video(id);
    const total = TR.computeTotal(scores);
    const now = Date.now();
    if (total == null) {
      if (v.rating) v.ratingDel = now;
      delete v.rating;
    } else {
      const type = vtype || v.rating?.type;
      v.rating = { scores, total, ratedAt: v.rating?.ratedAt || now, updatedAt: now };
      if (type) v.rating.type = type;
      const sk = (skip || []).filter((c) => !(c in scores));
      if (sk.length) v.rating.skip = sk;
      delete v.ratingDel;
      delete v.dropped; // оценили — значит не бросили
    }
    save();
  }
  function setWatched(id, on) {
    const v = video(id);
    if (on) {
      v.watchedAt = Date.now();
      v.watchedBy = 'phone';
    } else {
      v.watchedAt = null;
      v.watchedUpd = Date.now();
    }
    save();
  }
  function setNote(id, text, moments) {
    const v = video(id);
    const t = (text || '').trim().slice(0, 500);
    if (t) v.note = t;
    else delete v.note;
    if (moments) {
      if (moments.length) v.moments = moments;
      else delete v.moments;
    }
    v.noteAt = Date.now();
    save();
  }
  function setDropped(id, reason) {
    const v = video(id);
    if (reason) {
      v.dropped = { at: Date.now(), reason, pos: Math.round(TR.maxPos(v) * 100) / 100 };
      delete v.droppedDel;
    } else {
      if (v.dropped) v.droppedDel = Date.now();
      delete v.dropped;
    }
    save();
  }

  // ---------- Название и канал по ссылке (oEmbed) ----------
  async function fetchMeta(id) {
    const url = encodeURIComponent(TR.watchUrl(id));
    for (const api of [`https://www.youtube.com/oembed?format=json&url=${url}`, `https://noembed.com/embed?url=${url}`]) {
      try {
        const r = await fetch(api);
        if (!r.ok) continue;
        const j = await r.json();
        if (j.title) return { title: j.title, channel: j.author_name, channelUrl: j.author_url };
      } catch {
        // нет сети или сервис недоступен — пробуем следующий
      }
    }
    return null;
  }
  async function ensureMeta(id) {
    const v = video(id);
    if (v.title) return;
    const m = await fetchMeta(id);
    if (!m) return;
    Object.assign(v, Object.fromEntries(Object.entries(m).filter(([, x]) => x)));
    save(false);
    render();
    if (sheet.id === id) renderSheet();
  }

  // Ссылка из «Поделиться»: youtu.be/…, youtube.com/watch?v=…&t=…, shorts; иногда ссылка внутри текста
  function parseShared(str) {
    const m = String(str || '').match(/https?:\/\/[^\s]+/g) || [];
    for (const u of m) {
      const id = TR.parseVideoId(u);
      if (!id) continue;
      let t = 0;
      try {
        const raw = new URL(u).searchParams.get('t') || new URL(u).searchParams.get('start') || '';
        const mm = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
        if (mm) t = (Number(mm[1]) || 0) * 3600 + (Number(mm[2]) || 0) * 60 + (Number(mm[3]) || 0);
      } catch {
        t = 0;
      }
      return { id, t };
    }
    const id = TR.parseVideoId(str);
    return id ? { id, t: 0 } : null;
  }

  // ---------- Списки ----------
  let view = 'home';
  const thumb = (v, pct) => `<span class="vthumb"><img src="${TR.thumbUrl(v.id)}" alt="" loading="lazy">${v.duration ? `<span class="dur">${TR.fmtClock(v.duration)}</span>` : ''}${pct ? `<span class="bar" style="width:${pct}%"></span>` : ''}</span>`;
  const prioChip = (p) => {
    const P = TR.PRIORITIES[p];
    return P ? `<span class="prio" style="background:${P.tint};color:${P.ink}">${TR.prioGlyph(p, 10)}${P.short}</span>` : '';
  };
  const scoreBadge = (total) => {
    const g = TR.grade(total);
    return g ? `<span class="score${g.perfect ? ' perfect' : ''}" style="background:${g.color}">${g.perfect ? '★ ' : ''}${total}</span>` : '';
  };
  function card(v, started) {
    const pct = Math.round((started ? v.watch?.position : v.watch?.maxProgress) * 100) || 0;
    const meta = [v.channel ? esc(v.channel) : '', started && v.duration ? `осталось ${TR.fmtSpent(v.duration * (1 - v.watch.position))}` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="vcard${started ? ' started' : ''}" data-open="${v.id}">
      ${thumb(v, pct)}
      <span class="vinfo"><span class="vtitle">${esc(v.title || 'Видео ' + v.id)}</span><span class="vmeta">${meta || '&nbsp;'}</span>
      <span class="chips">${started ? '<span class="prio" style="background:#2c2445;color:#e4dcff">▶ Продолжить</span>' : ''}${v.later ? prioChip(v.later.priority) : ''}${v.rating ? scoreBadge(v.rating.total) : ''}</span></span>
    </button>`;
  }

  function renderLater() {
    const s = settings();
    const started = TR.startedVideos(db.videos, s.autoWatchedPct);
    const ids = new Set(started.map((v) => v.id));
    const queue = TR.laterQueue(db.videos).filter((v) => !ids.has(v.id));
    let html = '';
    if (started.length) html += `<h2 class="list-head">Продолжить <span>· ${started.length}</span></h2>${started.map((v) => card(v, true)).join('')}`;
    for (const p of [3, 2, 1]) {
      const g = queue.filter((v) => v.later.priority === p);
      if (g.length) html += `<h2 class="list-head">${prioChip(p)}<span>${g.length} ${plural(g.length, 'видео', 'видео', 'видео')}</span></h2>${g.map((v) => card(v, false)).join('')}`;
    }
    $('#later-list').innerHTML =
      html ||
      `<div class="empty">Список пуст.<br>${
        IOS ? 'В приложении YouTube: «Поделиться» → «Копировать ссылку», здесь — «Вставить» сверху.' : 'В приложении YouTube нажмите «Поделиться» → «Смотрибельно» или вставьте ссылку сверху.'
      }${
        Object.keys(db.videos).length ? '' : '<br><br>Оценки и список с компьютера — во вкладке «Данные».'
      }</div>`;
    $('#n-later').textContent = queue.length + started.length || '';
  }

  function renderRatings() {
    const q = ($('#ratings-search').value || '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    const hay = (v) => `${v.title || ''} ${v.channel || ''}`.toLowerCase().replace(/ё/g, 'е');
    const list = Object.values(db.videos)
      .filter((v) => v.rating && q.every((w) => hay(v).includes(w)))
      .sort((a, b) => (b.rating.updatedAt || 0) - (a.rating.updatedAt || 0));
    const all = Object.values(db.videos).filter((v) => v.rating).length;
    $('#ratings-list').innerHTML = list.length
      ? list.map((v) => card(v, false)).join('')
      : `<div class="empty">${all ? 'Ничего не нашлось.' : 'Оценок пока нет. Откройте видео и подвигайте ползунки.'}</div>`;
    $('#n-ratings').textContent = '';
  }

  function renderData() {
    const V = Object.values(db.videos);
    const fmt = (ts) => (ts ? new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'ещё не было');
    const pending = db.changedAt > (db.exportedAt || 0);
    $('#data-box').innerHTML = `
      ${driveCardHtml()}
      <div class="card"><div class="stats">
        <div><b>${V.filter((v) => v.later && !v.watchedAt).length}</b><span>в «Позже+»</span></div>
        <div><b>${V.filter((v) => v.rating).length}</b><span>оценок</span></div>
        <div><b>${V.filter((v) => v.note || v.moments?.length).length}</b><span>с отзывом</span></div>
      </div></div>
      <div class="card">
        <h2>С компьютера на телефон</h2>
        <p class="muted">В расширении: «Настройки» → «Резервная копия» → «Скачать резервную копию». Перешлите файл себе на телефон и выберите его здесь.</p>
        <label class="btn primary wide">Загрузить файл<input type="file" id="import-file" accept="application/json,.json" hidden></label>
        <p class="muted" style="margin:10px 0 0">Последняя загрузка: ${fmt(db.importedAt)}</p>
      </div>
      <div class="card">
        <h2>С телефона на компьютер</h2>
        <p class="muted">${pending ? 'Есть изменения, которых ещё нет на компьютере.' : 'Все изменения уже выгружены.'} Файл загрузите в расширении там же — «Загрузить копию или файл с телефона». Побеждает более поздняя правка.</p>
        <div class="row">
          ${navigator.canShare ? '<button type="button" class="btn primary" data-export="share">Отправить файл</button>' : ''}
          <button type="button" class="btn${navigator.canShare ? '' : ' primary'}" data-export="download">Скачать файл</button>
        </div>
        <p class="muted" style="margin:10px 0 0">Последняя выгрузка: ${fmt(db.exportedAt)}</p>
      </div>
      <div class="card">
        <h2>Как пользоваться</h2>
        ${
          IOS
            ? `<ol class="steps">
          <li>${STANDALONE ? 'Приложение уже на главном экране — данные хранятся в нём.' : 'Откройте эту страницу в Safari → кнопка «Поделиться» → «На экран „Домой“». Пользуйтесь значком на главном экране: у него своё хранилище, Safari его не чистит.'}</li>
          <li>В приложении YouTube: «Поделиться» → «Копировать ссылку». Здесь нажмите «Вставить» сверху — откроется видео. Ссылка «с этого момента» станет моментом.</li>
          <li>Раз в несколько дней обменивайтесь файлами с компьютером — через «Отправить файл» → AirDrop, Telegram или «Файлы». Скоро это заменит синхронизация через Google Drive.</li>
        </ol>`
            : `<ol class="steps">
          <li>Откройте эту страницу в Chrome на телефоне и выберите «Добавить на главный экран» — появится приложение «Смотрибельно».</li>
          <li>В приложении YouTube: «Поделиться» → «Смотрибельно». Откроется видео: отложите его, оцените или отметьте момент — если ссылка с таймкодом, он подставится сам.</li>
          <li>Раз в несколько дней обменивайтесь файлами с компьютером. Скоро это заменит синхронизация через Google Drive.</li>
        </ol>`
        }
      </div>`;
  }

  // ---------- Главная: что смотреть дальше, оценить просмотренное, неделя оценок, дальше в списке ----------
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const fireNum = (n) => `<span class="fire-num"><span class="flames" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><s></s><s></s><s></s></span><b>${n}</b></span>`;
  const critBar = (name, val) =>
    `<div class="crit-bar"><div class="lbl"><span>${esc(name)}</span><b>${val}</b></div><div class="track"><div class="fill" style="width:${(val / TR.SLIDER_MAX) * 100}%;background:${TR.scoreMark(Math.round((val / TR.SLIDER_MAX) * TR.MAX_SCORE))}"></div></div></div>`;
  const ringSvg = (total, size) => {
    const g = TR.grade(total);
    const len = 2 * Math.PI * 52;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 128 128" role="img" aria-label="Оценка ${total ?? 'нет'}"><circle class="track" cx="64" cy="64" r="52" stroke-width="12"/><circle class="fill" cx="64" cy="64" r="52" stroke-width="12" transform="rotate(-90 64 64)" stroke="${g ? g.mark : 'transparent'}" stroke-dasharray="${((len * (total || 0)) / TR.MAX_SCORE).toFixed(1)} ${len.toFixed(1)}" style="--glow:${g ? g.mark : 'transparent'}"/><text x="64" y="76" text-anchor="middle">${total ?? '—'}</text></svg>`;
  };

  // Дни, когда что-то оценивали (на телефоне нет учёта времени — серия по оценкам)
  function ratedDays() {
    const by = {};
    for (const v of Object.values(db.videos)) if (v.rating?.updatedAt) (by[TR.dateKey(new Date(v.rating.updatedAt))] ||= []).push(v.rating.total);
    return by;
  }
  function ratingStreak(by) {
    let cur = 0;
    const d = new Date();
    if (!by[TR.dateKey(d)]) d.setDate(d.getDate() - 1);
    while (by[TR.dateKey(d)]) {
      cur++;
      d.setDate(d.getDate() - 1);
    }
    return cur;
  }

  function renderHome() {
    const s = settings();
    const V = Object.values(db.videos);
    const next = TR.watchNext(db.videos, s.autoWatchedPct);
    const hero = next[0];
    let heroHtml;
    if (hero) {
      const started = TR.isStarted(hero, s.autoWatchedPct);
      const pos = hero.watch?.position || 0;
      const url = started ? TR.resumeUrl(hero) : TR.watchUrl(hero.id);
      const meta = [hero.channel ? esc(hero.channel) : '', started && hero.duration ? `осталось ${TR.fmtSpent(hero.duration * (1 - pos))}` : hero.duration ? TR.fmtClock(hero.duration) : ''].filter(Boolean).join(' · ');
      heroHtml = `<div class="home-hero">
        <button type="button" class="hh-shot" data-open="${hero.id}"><img src="${TR.thumbUrl(hero.id).replace('mqdefault', 'hqdefault')}" alt="">${started ? '<span class="hh-badge">▶ Продолжить</span>' : hero.later ? `<span class="hh-badge">${prioChip(hero.later.priority)}</span>` : ''}${started ? `<span class="bar" style="width:${Math.round(pos * 100)}%"></span>` : ''}</button>
        <div class="hh-body">
          <span class="sh-label">${started ? 'Продолжить' : 'Смотреть дальше'}</span>
          <button type="button" class="hh-title" data-open="${hero.id}">${esc(hero.title || 'Видео ' + hero.id)}</button>
          <span class="muted">${meta || '&nbsp;'}</span>
          <div class="row"><a class="btn primary" href="${url}" target="_blank" rel="noopener">▶ ${started ? 'Продолжить' : 'Смотреть'}</a><button type="button" class="btn" data-open="${hero.id}">Подробнее</button></div>
        </div>
      </div>`;
    } else {
      heroHtml = `<div class="card home-empty"><p class="muted" style="margin:0">Здесь появится видео, которое стоит посмотреть следующим: начатое или самое важное из «Смотреть позже+».<br><br>${
        IOS ? 'В YouTube: «Поделиться» → «Копировать ссылку», здесь — «Вставить».' : 'В YouTube: «Поделиться» → «Смотрибельно».'
      }</p></div>`;
    }

    // Оцените просмотренное — или последняя оценка
    // Начатое и недосмотренное — в «Продолжить», а не в «Оцените»
    const awaiting = V.filter((v) => TR.awaitingRating(v) && !TR.isStarted(v, s.autoWatchedPct)).sort((a, b) => (b.watchedAt || b.watch?.lastAt || 0) - (a.watchedAt || a.watch?.lastAt || 0));
    let ticketHtml = '';
    if (awaiting.length) {
      const v = awaiting[0];
      ticketHtml = `<div class="card ticket">
        <span class="sh-label">Оцените просмотренное${awaiting.length > 1 ? ` · ещё ${awaiting.length - 1}` : ''}</span>
        <button type="button" class="tk-row" data-open="${v.id}">${thumb(v, 0)}<span class="vinfo"><span class="vtitle">${esc(v.title || 'Видео ' + v.id)}</span><span class="vmeta">${esc(v.channel || '')}</span></span></button>
        <button type="button" class="btn primary wide" data-open="${v.id}">Оценить</button>
      </div>`;
    } else {
      const last = V.filter((v) => v.rating).sort((a, b) => (b.rating.updatedAt || 0) - (a.rating.updatedAt || 0))[0];
      if (last) {
        const g = TR.grade(last.rating.total);
        const ids = TR.typeCriteria(TR.ratingType(last.rating), s).map((c) => c.id);
        const bars = [...ids, ...Object.keys(last.rating.scores).filter((id) => !ids.includes(id))]
          .filter((id) => typeof last.rating.scores[id] === 'number')
          .map((id) => critBar(TR.critName(id, s), last.rating.scores[id]))
          .join('');
        ticketHtml = `<div class="card ticket">
          <span class="sh-label">Последняя оценка</span>
          <button type="button" class="tk-last" data-open="${last.id}">${ringSvg(last.rating.total, 76)}<span class="vinfo"><span class="vtitle">${esc(last.title || 'Видео ' + last.id)}</span><span class="vmeta">${esc(last.channel || '')}</span>${g ? `<span class="grade" style="background:${g.color};align-self:flex-start">${g.perfect ? '★ ' : ''}${g.label}</span>` : ''}</span></button>
          <div class="crit-bars">${bars}</div>
        </div>`;
      }
    }

    // Неделя оценок с понедельника и серия дней подряд с оценками
    const by = ratedDays();
    const streak = ratingStreak(by);
    const monday = new Date();
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const todayKey = TR.dateKey();
    const days = WD.map((w, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const k = TR.dateKey(d);
      const scores = (by[k] || []).sort((a, b) => b - a).slice(0, 3);
      const cls = k > todayKey ? 'future' : k === todayKey ? 'now' : scores.length ? '' : 'none';
      return `<div class="wk-day ${cls}"><div class="wk-bars">${scores
        .map((t) => {
          const g = TR.grade(t);
          return `<span style="background:${g.mark}${g.perfect ? ';box-shadow:0 0 10px 2px rgba(52,211,153,.7)' : ''}"></span>`;
        })
        .join('')}</div></div>`;
    }).join('');
    const nowIdx = (new Date().getDay() + 6) % 7;
    const weekHtml = `<div class="card home-week">
      <div class="wk-top">${streak ? `<span class="wk-streak">${fireNum(streak)}</span><span>${plural(streak, 'день', 'дня', 'дней')} подряд с оценками</span>` : '<span class="muted">Серия начнётся с первой оценки</span>'}</div>
      <div class="wk-grid">${days}</div>
      <div class="wk-grid wk-labels">${WD.map((w, i) => `<span class="${i === nowIdx ? 'now' : ''}">${w}</span>`).join('')}</div>
    </div>`;

    // Дальше в списке и сводка
    const rest = next.slice(1, 4);
    const rated = V.filter((v) => v.rating);
    const avg = rated.length ? Math.round(rated.reduce((a, v) => a + v.rating.total, 0) / rated.length) : null;
    const restHtml = rest.length
      ? `<h2 class="list-head">Дальше в списке <button type="button" class="link-btn" data-view="later">весь список →</button></h2>${rest.map((v) => card(v, TR.isStarted(v, s.autoWatchedPct))).join('')}`
      : '';
    const statsHtml = `<div class="card"><div class="stats">
      <div><b>${TR.laterQueue(db.videos).length}</b><span>в «Позже+»</span></div>
      <div><b>${rated.length}</b><span>оценок</span></div>
      <div><b>${avg ?? '—'}</b><span>в среднем</span></div>
    </div></div>`;

    $('#home').innerHTML = heroHtml + ticketHtml + weekHtml + restHtml + statsHtml;
  }

  // ---------- Каналы ----------
  const chState = { sort: 'score', q: '' };
  const fmtMin = (m) => TR.fmtSpent((m || 0) * 60);

  function channelList() {
    const map = {};
    const get = (name) => (map[name] ||= { name, url: '', icon: '', rated: [], later: 0, min: 0, dropped: 0, finished: 0, reasons: {} });
    for (const v of Object.values(db.videos)) {
      if (!v.channel) continue;
      const c = get(v.channel);
      if (!c.url && v.channelUrl) c.url = v.channelUrl;
      if (v.rating) c.rated.push(v);
      if (v.later && !v.watchedAt) c.later++;
      if (v.dropped) {
        c.dropped++;
        c.reasons[v.dropped.reason] = (c.reasons[v.dropped.reason] || 0) + 1;
      } else if (v.watchedAt) c.finished++;
    }
    for (const [name, x] of Object.entries(db.stats?.channels || {})) {
      const c = get(name);
      c.min = x[0] || 0;
      if (!c.url && x[1]) c.url = x[1];
      c.icon = TR.safeIconSrc(x[2]);
    }
    for (const c of Object.values(map)) {
      c.avg = c.rated.length ? Math.round(c.rated.reduce((s, v) => s + v.rating.total, 0) / c.rated.length) : null;
      const n = c.finished + c.dropped;
      c.finishPct = c.dropped && n >= 3 ? Math.round((c.finished / n) * 100) : null;
    }
    return Object.values(map);
  }
  const chAvatar = (c, size) =>
    c.icon
      ? `<img class="ch-ava" src="${esc(c.icon)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="ch-ava ch-letter" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px">${esc((c.name.trim()[0] || '?').toUpperCase())}</span>`;

  function renderChannels() {
    const box = $('#channels-box');
    if (!box.firstChild) {
      box.innerHTML = `<input id="ch-search" class="search" type="search" placeholder="Поиск канала" aria-label="Поиск канала">
        <div class="seg" id="ch-sort" style="margin-bottom:12px"><button type="button" data-chsort="score">По оценке</button><button type="button" data-chsort="time">По времени</button><button type="button" data-chsort="later">В «Позже+»</button></div>
        <div id="ch-list"></div>`;
      $('#ch-search').addEventListener('input', (e) => {
        chState.q = e.target.value;
        renderChannels();
      });
      $('#ch-sort').addEventListener('click', (e) => {
        const b = e.target.closest('[data-chsort]');
        if (!b) return;
        chState.sort = b.dataset.chsort;
        renderChannels();
      });
    }
    $$('#ch-sort button').forEach((b) => b.classList.toggle('on', b.dataset.chsort === chState.sort));
    const q = chState.q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    let list = channelList().filter((c) => q.every((w) => c.name.toLowerCase().replace(/ё/g, 'е').includes(w)));
    const sorters = {
      score: (a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.rated.length - a.rated.length || b.min - a.min,
      time: (a, b) => b.min - a.min || (b.avg ?? -1) - (a.avg ?? -1),
      later: (a, b) => b.later - a.later || b.min - a.min,
    };
    list = list.sort(sorters[chState.sort]).slice(0, 150);
    $('#ch-list').innerHTML = list.length
      ? list
          .map((c, i) => {
            const meta = [
              c.rated.length ? `${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}` : 'без оценок',
              c.min ? fmtMin(c.min) : '',
              c.later ? `в «Позже+»: ${c.later}` : '',
              c.finishPct != null ? `досматриваете ${c.finishPct}%` : '',
            ].filter(Boolean);
            return `<button type="button" class="ch-item" data-channel="${esc(c.name)}"><span class="ch-rank">${i + 1}</span>${chAvatar(c, 44)}<span class="vinfo"><span class="vtitle">${esc(c.name)}</span><span class="vmeta">${meta.join(' · ')}</span></span>${c.avg != null ? scoreBadge(c.avg) : ''}</button>`;
          })
          .join('')
      : `<div class="empty">${Object.keys(db.videos).length ? 'Ничего не нашлось.' : 'Каналы появятся, когда будут оценки или видео в «Позже+».'}</div>`;
  }

  // Профиль канала — в том же листе снизу, что и видео
  function openChannel(name) {
    const c = channelList().find((x) => x.name === name);
    if (!c) return;
    const s = settings();
    sheet.id = null;
    // Средние по критериям: сначала общие для всех типов, потом самые частые
    const acc = {};
    for (const v of c.rated) for (const [id, x] of Object.entries(v.rating.scores)) if (typeof x === 'number') ((acc[id] ||= { id, sum: 0, n: 0 }).sum += x), acc[id].n++;
    const bars = Object.values(acc)
      .sort((a, b) => TR.COMMON_CRITERIA.includes(b.id) - TR.COMMON_CRITERIA.includes(a.id) || b.n - a.n)
      .slice(0, 6)
      .map((x) => critBar(TR.critName(x.id, s), Math.round((x.sum / x.n) * 10) / 10))
      .join('');
    const best = c.rated.slice().sort((a, b) => b.rating.total - a.rating.total).slice(0, 3);
    const later = Object.values(db.videos).filter((v) => v.channel === name && v.later && !v.watchedAt).sort((a, b) => b.later.priority - a.later.priority);
    const reasons = Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => TR.dropReason(r).label.toLowerCase());
    const meta = [
      c.min ? `смотрели ${fmtMin(c.min)}` : '',
      c.rated.length ? `${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}` : 'оценок пока нет',
      c.finishPct != null ? `досматриваете ${c.finishPct}%` : '',
      c.dropped ? `бросили ${c.dropped}: ${reasons.join(', ')}` : '',
    ].filter(Boolean);
    $('#sheet-body').innerHTML = `
      <button type="button" class="sh-close" data-sh="close" aria-label="Закрыть">✕</button>
      <div class="ch-head">${chAvatar(c, 64)}<div><h2 id="sh-title">${esc(c.name)}</h2><div class="muted">${meta.join(' · ')}</div></div></div>
      ${c.avg != null ? `<div class="sh-sec rate-top">${ringSvg(c.avg, 84)}<div><span class="grade" style="background:${TR.grade(c.avg).color}">${TR.grade(c.avg).label}</span><div class="muted" style="margin-top:6px">средняя оценка канала</div></div></div>` : ''}
      ${bars ? `<div class="sh-sec"><span class="sh-label">По критериям</span><div class="crit-bars">${bars}</div></div>` : ''}
      ${best.length ? `<div class="sh-sec"><span class="sh-label">Лучшее</span>${best.map((v) => card(v, false)).join('')}</div>` : ''}
      ${later.length ? `<div class="sh-sec"><span class="sh-label">Ждёт в «Позже+»</span>${later.slice(0, 5).map((v) => card(v, false)).join('')}</div>` : ''}
      ${c.url ? `<div class="sh-sec"><a class="btn wide" href="${esc(c.url)}" target="_blank" rel="noopener">Открыть канал на YouTube ↗</a></div>` : ''}`;
    if (!sheetEl.open) sheetEl.showModal();
    sheetEl.scrollTop = 0;
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-channel]');
    if (c) openChannel(c.dataset.channel);
  });

  // ---------- Статистика ----------
  // Время просмотра приходит с компьютера через Google Drive (сводка по дням); оценки — свои.
  const stState = { mode: 'month', off: 0 };
  function renderStats() {
    const days = db.stats?.days || {};
    const mins = (k) => (days[k] ? (days[k][0] || 0) + (days[k][1] || 0) : 0);
    const keyOf = (d) => TR.dateKey(d);
    const back = (n) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return d;
    };
    const sumBack = (n) => Array.from({ length: n }, (_, i) => mins(keyOf(back(i)))).reduce((a, b) => a + b, 0);
    let streak = 0;
    for (let i = mins(keyOf(back(0))) ? 0 : 1; mins(keyOf(back(i))); i++) streak++;
    const has = Object.keys(days).length > 0;
    const ratedBy = ratedDays();

    // Кинолента за 30 дней: высота — время, цвет — средняя оценка оценённого в этот день
    const last = Array.from({ length: 30 }, (_, i) => back(29 - i));
    const maxM = Math.max(30, ...last.map((d) => mins(keyOf(d))));
    const film = last
      .map((d, i) => {
        const k = keyOf(d);
        const m = mins(k);
        const r = ratedBy[k];
        const avg = r ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null;
        const h = m ? Math.max(4, Math.round((m / maxM) * 100)) : 0;
        return `<div class="fm-col" title="${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}: ${m ? fmtMin(m) : 'без YouTube'}"><span style="height:${h}%;background:${avg != null ? TR.scoreMark(avg) : 'var(--violet-line)'}"></span>${i % 7 === 1 ? `<small>${d.getDate()}</small>` : ''}</div>`;
      })
      .join('');

    // Итоги месяца или года
    const now = new Date();
    const start = stState.mode === 'year' ? new Date(now.getFullYear() + stState.off, 0, 1, 12) : new Date(now.getFullYear(), now.getMonth() + stState.off, 1, 12);
    const prefix = stState.mode === 'year' ? String(start.getFullYear()) : keyOf(start).slice(0, 7);
    const inP = (ts) => ts && keyOf(new Date(ts)).startsWith(prefix);
    const pKeys = Object.keys(days).filter((k) => k.startsWith(prefix));
    const pMin = pKeys.reduce((a, k) => a + mins(k), 0);
    const V = Object.values(db.videos);
    const rated = V.filter((v) => v.rating && inP(v.rating.updatedAt));
    const avg = rated.length ? Math.round(rated.reduce((a, v) => a + v.rating.total, 0) / rated.length) : null;
    const best = rated.slice().sort((a, b) => b.rating.total - a.rating.total || b.rating.updatedAt - a.rating.updatedAt)[0];
    const byCh = {};
    for (const v of rated) if (v.channel) byCh[v.channel] = (byCh[v.channel] || 0) + 1;
    const topCh = Object.entries(byCh).sort((a, b) => b[1] - a[1])[0];
    const moments = V.reduce((n, v) => n + (v.moments || []).filter((m) => inP(m.at)).length, 0);
    const dropped = V.filter((v) => v.dropped && inP(v.dropped.at)).length;
    const title = stState.mode === 'year' ? `${start.getFullYear()}` : start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
    const first = [...Object.keys(days), ...V.filter((v) => v.rating).map((v) => keyOf(new Date(v.rating.updatedAt)))].sort()[0] || keyOf(now);
    const canBack = (stState.mode === 'year' ? first.slice(0, 4) : first.slice(0, 7)) < prefix;

    $('#stats-box').innerHTML = `
      ${
        has
          ? `<div class="stat-tiles">
              <div class="card st"><span>Сегодня</span><b>${fmtMin(mins(keyOf(back(0))))}</b></div>
              <div class="card st"><span>7 дней</span><b>${fmtMin(sumBack(7))}</b></div>
              <div class="card st"><span>30 дней</span><b>${fmtMin(sumBack(30))}</b></div>
            </div>
            <div class="card"><div class="wk-top">${streak ? `<span class="wk-streak">${fireNum(streak)}</span><span>${plural(streak, 'день', 'дня', 'дней')} подряд с YouTube</span>` : '<span class="muted">Серия начнётся с первого дня с YouTube</span>'}</div>
              <span class="sh-label" style="margin-top:12px">Кинолента · 30 дней</span><div class="film">${film}</div>
              <p class="muted" style="margin:8px 0 0">Высота — сколько смотрели, цвет — средняя оценка за день.</p></div>`
          : `<div class="card"><h2>Время просмотра</h2><p class="muted" style="margin:0">Время приходит с компьютера: подключите Google Drive в расширении («Настройки» → «История и синхронизация») и здесь (⚙ сверху). На телефоне его не посчитать — смотрите вы в приложении YouTube.</p></div>`
      }
      <div class="card">
        <div class="recap-head"><h2>${stState.off === 0 ? (stState.mode === 'year' ? 'Этот год' : 'Этот месяц') : 'Итоги'} · ${title}</h2>
          <div class="nav2"><button type="button" data-st="-1" aria-label="Раньше" ${canBack ? '' : 'disabled'}>‹</button><button type="button" data-st="1" aria-label="Позже" ${stState.off >= 0 ? 'disabled' : ''}>›</button></div></div>
        <div class="seg" style="margin:10px 0 12px"><button type="button" data-stmode="month" class="${stState.mode === 'month' ? 'on' : ''}">Месяц</button><button type="button" data-stmode="year" class="${stState.mode === 'year' ? 'on' : ''}">Год</button></div>
        <div class="stats">
          <div><b>${has ? fmtMin(pMin) : '—'}</b><span>на YouTube${has ? ` · дней ${pKeys.length}` : ''}</span></div>
          <div><b>${rated.length}</b><span>оценено${avg != null ? ` · в среднем ${avg}` : ''}</span></div>
          <div><b>${moments} · ${dropped}</b><span>моментов · брошено</span></div>
        </div>
        ${best ? `<span class="sh-label" style="margin-top:14px">Видео ${stState.mode === 'year' ? 'года' : 'месяца'}</span>${card(best, false)}` : ''}
        ${topCh ? `<span class="sh-label" style="margin-top:10px">Канал ${stState.mode === 'year' ? 'года' : 'месяца'}</span><button type="button" class="ch-item" data-channel="${esc(topCh[0])}">${chAvatar(channelList().find((c) => c.name === topCh[0]) || { name: topCh[0] }, 44)}<span class="vinfo"><span class="vtitle">${esc(topCh[0])}</span><span class="vmeta">${topCh[1]} ${plural(topCh[1], 'оценка', 'оценки', 'оценок')}</span></span></button>` : ''}
      </div>`;
  }
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-stmode]');
    if (m) {
      stState.mode = m.dataset.stmode;
      stState.off = 0;
      return renderStats();
    }
    const n = e.target.closest('[data-st]');
    if (n && !n.disabled) {
      stState.off = Math.min(0, stState.off + Number(n.dataset.st));
      renderStats();
    }
  });

  function render() {
    renderLater();
    if (view === 'home') renderHome();
    if (view === 'channels') renderChannels();
    if (view === 'stats') renderStats();
    if (view === 'ratings') renderRatings();
    if (view === 'data') renderData();
    for (const name of ['home', 'later', 'ratings', 'channels', 'stats', 'data']) $('#view-' + name).hidden = view !== name;
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }

  // ---------- Лист видео ----------
  const sheet = { id: null, type: null, picked: null, scores: {}, skip: new Set(), shareT: 0 };
  const sheetEl = $('#sheet');

  function openSheet(id, shareT = 0) {
    const v = video(id);
    sheet.id = id;
    sheet.scores = { ...(v.rating?.scores || {}) };
    sheet.skip = new Set(v.rating?.skip || []);
    sheet.type = TR.defaultType(db.videos, v);
    sheet.picked = null;
    sheet.shareT = shareT;
    sheet.autoAdded = false;
    renderSheet();
    if (!sheetEl.open) sheetEl.showModal();
    ensureMeta(id);
  }

  function typedScores() {
    const ids = TR.typeCriteria(sheet.type, settings()).map((c) => c.id);
    const scores = {};
    for (const c of ids) if (typeof sheet.scores[c] === 'number' && !sheet.skip.has(c)) scores[c] = sheet.scores[c];
    return { ids, scores, skip: ids.filter((c) => sheet.skip.has(c)) };
  }

  function renderSheet() {
    const v = video(sheet.id);
    const s = settings();
    const started = TR.isStarted(v, s.autoWatchedPct);
    const p = v.later?.priority || 0;
    const t = TR.videoType(sheet.type);
    const crits = TR.typeCriteria(t.id, s);
    const moments = v.moments || [];
    const shareTc = sheet.shareT && !moments.some((m) => m.t === sheet.shareT) ? sheet.shareT : 0;
    const prioBtns = [0, 1, 2, 3]
      .map((n) => {
        const P = TR.PRIORITIES[n];
        const on = n === p;
        return `<button type="button" data-prio="${n}" class="${on ? 'on' : ''}" style="${on && P ? `background:${P.tint};color:${P.ink}` : on ? 'background:#2c2445;color:#e4dcff' : ''}">${P ? `${TR.prioGlyph(n, 11)} ${P.short}` : 'Нет'}</button>`;
      })
      .join('');
    $('#sheet-body').innerHTML = `
      <button type="button" class="sh-close" data-sh="close" aria-label="Закрыть">✕</button>
      <div class="sh-head">${thumb(v, Math.round(TR.maxPos(v) * 100))}<div><h2 id="sh-title">${esc(v.title || 'Видео ' + v.id)}</h2><div class="muted">${esc(v.channel || 'загружаю название…')}</div></div></div>
      <div class="sh-sec row">
        <a class="btn primary" href="${started ? TR.resumeUrl(v) : TR.watchUrl(v.id)}" target="_blank" rel="noopener">▶ ${started ? 'Продолжить' : 'Смотреть'}</a>
        <button type="button" class="btn${v.watchedAt ? ' on' : ''}" data-sh="watched">${v.watchedAt ? '✓ Просмотрено' : 'Отметить просмотренным'}</button>
      </div>
      <div class="sh-sec"><span class="sh-label">Смотреть позже+</span><div class="seg">${prioBtns}</div></div>

      <div class="sh-sec">
        <span class="sh-label">Оценка</span>
        <div class="rate-top">
          <svg class="ring" width="84" height="84" viewBox="0 0 128 128" role="img" aria-label="Итоговая оценка"><circle class="track" cx="64" cy="64" r="52" stroke-width="12"/><circle class="fill" id="sh-ring" cx="64" cy="64" r="52" stroke-width="12" transform="rotate(-90 64 64)"/><text id="sh-total" x="64" y="76" text-anchor="middle">—</text></svg>
          <div><span class="grade" id="sh-grade" hidden></span><div class="muted" id="sh-note"></div></div>
        </div>
        <div class="chips" style="margin-top:12px" role="group" aria-label="Тип видео">${TR.VIDEO_TYPES.map((x) => `<button type="button" class="chip${x.id === t.id ? ' on' : ''}" data-type="${x.id}" aria-pressed="${x.id === t.id}">${esc(x.label)}</button>`).join('')}</div>
        <div class="muted" style="margin-top:6px">${typeHint(v)}</div>
        ${crits
          .map(
            (c) => `<div class="crit" data-id="${esc(c.id)}">
              <div class="crit-top"><span class="crit-name">${esc(c.name)}</span><span class="crit-kind${c.common ? '' : ' own'}">${c.common ? 'общий' : t.id === 'custom' ? 'свой' : esc(t.label.toLowerCase())}</span><span class="crit-val">—</span><button type="button" class="skip" data-skip="${esc(c.id)}" aria-label="Не про это видео — пропустить">✕</button></div>
              <input class="range" type="range" min="0" max="${TR.SLIDER_MAX}" step="1" aria-label="${esc(c.name)}">
            </div>`
          )
          .join('')}
        <div class="row" style="margin-top:14px"><button type="button" class="btn primary" data-sh="save">Сохранить оценку</button>${v.rating ? '<button type="button" class="btn" data-sh="unrate">Удалить</button>' : ''}</div>
      </div>

      <div class="sh-sec">
        <span class="sh-label">Моменты и отзыв</span>
        <div class="moments">${moments
          .map((m) => `<span class="moment"><a href="${TR.watchUrl(v.id)}&t=${m.t}s" target="_blank" rel="noopener">★ ${TR.fmtClock(m.t) || '0:00'}</a><button type="button" data-rm="${m.t}" aria-label="Убрать момент">×</button></span>`)
          .join('')}${shareTc ? `<button type="button" class="chip on" data-sh="moment">+ Момент ${TR.fmtClock(shareTc)}</button>` : ''}</div>
        ${moments.length || shareTc ? '' : '<p class="muted" style="margin:0 0 8px">Поделитесь видео «с этого момента» — таймкод станет моментом.</p>'}
        <textarea id="sh-text" maxlength="500" placeholder="Что понравилось или нет — необязательно" style="margin-top:8px">${esc(v.note || '')}</textarea>
      </div>

      ${
        !v.rating && !v.watchedAt
          ? `<div class="sh-sec"><span class="sh-label">Не досмотрели?</span><div class="chips">${TR.DROP_REASONS.map((r) => `<button type="button" class="chip${v.dropped?.reason === r.id ? ' on' : ''}" data-drop="${r.id}">${esc(r.label)}</button>`).join('')}</div></div>`
          : ''
      }`;
    paintRate();
  }

  function typeHint(v) {
    if (sheet.picked) return v.rating ? '' : `«${TR.videoType(sheet.picked).label}» запомнится для канала`;
    const src = TR.typeSource(db.videos, v);
    if (src === 'rated') return v.rating.type ? '' : 'Оценка поставлена до типов — свой набор';
    return src === 'channel' ? 'Тип взят из прошлых оценок канала' : 'Последний выбранный тип';
  }

  function paintRate() {
    const { scores, ids } = typedScores();
    $$('#sheet-body .crit').forEach((el) => {
      const cid = el.dataset.id;
      const skipped = sheet.skip.has(cid);
      const val = skipped ? undefined : scores[cid];
      const set = typeof val === 'number';
      const input = $('input', el);
      input.value = set ? val : Math.round(TR.SLIDER_MAX / 2);
      input.classList.toggle('unset', !set);
      input.style.setProperty('--p', `${(Number(input.value) / TR.SLIDER_MAX) * 100}%`);
      input.style.setProperty('--fill', set ? TR.scoreMark(Math.round((val / TR.SLIDER_MAX) * TR.MAX_SCORE)) : '#6b6480');
      $('.crit-val', el).textContent = skipped ? 'пропуск' : set ? String(val) : '—';
      $('.skip', el).textContent = skipped ? '↺' : '✕';
      el.classList.toggle('skipped', skipped);
    });
    const total = TR.computeTotal(scores);
    const g = TR.grade(total);
    const len = 2 * Math.PI * 52;
    const ring = $('#sh-ring');
    ring.setAttribute('stroke', g ? g.mark : 'transparent');
    ring.setAttribute('stroke-dasharray', `${((len * (total || 0)) / TR.MAX_SCORE).toFixed(1)} ${len.toFixed(1)}`);
    ring.style.setProperty('--glow', g ? g.mark : 'transparent');
    $('#sh-total').textContent = total ?? '—';
    const ge = $('#sh-grade');
    ge.hidden = !g;
    ge.textContent = g ? (g.perfect ? '★ ' : '') + g.label : '';
    ge.style.background = g ? g.color : '';
    const n = Object.keys(scores).length;
    const all = ids.filter((c) => !sheet.skip.has(c)).length;
    $('#sh-note').textContent = !n ? 'двигайте ползунки' : n < all ? `заполнено ${n} из ${all}` : '';
  }

  function saveNoteIfChanged() {
    const ta = $('#sh-text');
    if (!ta || !sheet.id) return;
    const v = video(sheet.id);
    if (ta.value.trim() !== (v.note || '')) setNote(sheet.id, ta.value);
  }

  sheetEl.addEventListener('input', (e) => {
    const el = e.target.closest('.crit');
    if (!el || !e.target.matches('input')) return;
    sheet.scores[el.dataset.id] = Number(e.target.value);
    sheet.skip.delete(el.dataset.id);
    paintRate();
  });
  sheetEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) {
      if (e.target === sheetEl) sheetEl.close(); // нажатие на затемнение
      return;
    }
    const id = sheet.id;
    if (b.dataset.prio != null) {
      sheet.autoAdded = false; // важность выбрали сами — больше не трогаем
      setLater(id, Number(b.dataset.prio));
      toast(Number(b.dataset.prio) ? 'В «Смотреть позже+»' : 'Убрано из списка');
      renderSheet();
      return render();
    }
    if (b.dataset.type) {
      sheet.type = sheet.picked = b.dataset.type;
      return renderSheet();
    }
    if (b.dataset.skip) {
      const c = b.dataset.skip;
      if (sheet.skip.has(c)) sheet.skip.delete(c);
      else sheet.skip.add(c);
      return paintRate();
    }
    if (b.dataset.drop) {
      const same = video(id).dropped?.reason === b.dataset.drop;
      setDropped(id, same ? null : b.dataset.drop);
      toast(same ? 'Отметка снята' : 'Учту в профиле канала');
      return renderSheet();
    }
    if (b.dataset.rm) {
      const t = Number(b.dataset.rm);
      setNote(id, $('#sh-text').value, (video(id).moments || []).filter((m) => m.t !== t));
      return renderSheet();
    }
    switch (b.dataset.sh) {
      case 'close':
        sheetEl.close();
        break;
      case 'watched':
        setWatched(id, !video(id).watchedAt);
        renderSheet();
        render();
        break;
      case 'moment': {
        const ms = [...(video(id).moments || []), { t: sheet.shareT, at: Date.now() }].sort((a, c) => a.t - c.t);
        setNote(id, $('#sh-text').value, ms);
        toast(`★ Момент ${TR.fmtClock(sheet.shareT)} добавлен`);
        renderSheet();
        break;
      }
      case 'save': {
        const { scores, skip } = typedScores();
        if (!Object.keys(scores).length) return toast('Подвигайте хотя бы один ползунок');
        const old = video(id).rating;
        rate(id, scores, sheet.picked || (old && !old.type ? undefined : sheet.type), skip);
        // Поделились, чтобы оценить уже просмотренное, — из «Позже+» убираем то, что сами туда положили
        if (sheet.autoAdded) setLater(id, 0);
        saveNoteIfChanged();
        toast(`Оценка ${video(id).rating.total} сохранена`);
        sheetEl.close();
        render();
        break;
      }
      case 'unrate':
        if (!confirm('Удалить оценку этого видео?')) return;
        rate(id, {});
        sheetEl.close();
        render();
        break;
    }
  });
  sheetEl.addEventListener('close', () => {
    saveNoteIfChanged();
    sheet.id = null;
    render();
  });

  // ---------- Обмен файлами с компьютером ----------
  // Храним только то, что нужно на телефоне: оценки, список, отзывы, «бросили», начатое — без статистики по дням.
  const KEEP = ['id', 'title', 'channel', 'channelUrl', 'duration', 'short', 'live', 'rating', 'ratingDel', 'later', 'laterDel', 'note', 'noteAt', 'moments', 'watchedAt', 'watchedUpd', 'watchedBy', 'dropped', 'droppedDel'];
  function slim(v) {
    const o = {};
    for (const k of KEEP) if (v[k] != null) o[k] = v[k];
    if (v.watch) o.watch = { real: v.watch.real, position: v.watch.position, maxProgress: v.watch.maxProgress, lastAt: v.watch.lastAt, remote: v.watch.remote };
    return o;
  }
  const worthKeeping = (v) => v.rating || v.later || v.note || v.moments?.length || v.dropped || v.ratingDel || v.laterDel || v.droppedDel || TR.isStarted(v);

  async function importFile(file) {
    const json = JSON.parse(await file.text());
    let incoming = {};
    if (json?.app === 'TubeRate' && json.data) {
      for (const [k, v] of Object.entries(json.data)) if (k.startsWith('v:') && v) incoming[k.slice(2)] = v;
      if (json.data.settings?.criteria) db.settings.criteria = json.data.settings.criteria;
      if (json.data.settings?.autoWatchedPct) db.settings.autoWatchedPct = json.data.settings.autoWatchedPct;
    } else if (json?.app === TR.MOBILE_APP && json.videos) {
      incoming = json.videos;
    } else {
      throw new Error('Это не файл «Смотрибельно»');
    }
    let added = 0;
    let changed = 0;
    for (const [id, inc] of Object.entries(incoming)) {
      if (!/^[\w-]{11}$/.test(id) || !worthKeeping(inc)) continue;
      const cur = db.videos[id];
      const merged = slim(TR.mergeNewer(cur, slim({ ...inc, id })));
      if (!cur) added++;
      else if (JSON.stringify(merged) !== JSON.stringify(slim(cur))) changed++;
      else continue;
      db.videos[id] = merged;
    }
    db.importedAt = Date.now();
    save(false);
    return { added, changed };
  }

  function exportFile() {
    const videos = {};
    for (const [id, v] of Object.entries(db.videos)) if (worthKeeping(v)) videos[id] = slim(v);
    const body = JSON.stringify({ app: TR.MOBILE_APP, version: 1, exportedAt: new Date().toISOString(), videos });
    const name = `smotribelno-phone-${TR.dateKey()}.json`;
    return new File([body], name, { type: 'application/json' });
  }

  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'import-file') return;
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await importFile(f);
      toast(`Загружено: новых ${r.added}, обновлено ${r.changed}`);
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
    render();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    const file = exportFile();
    try {
      if (b.dataset.export === 'share' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Смотрибельно — с телефона' });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      db.exportedAt = Date.now();
      save(false);
      renderData();
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Не удалось отправить: ' + err.message);
    }
  });

  // ---------- Синхронизация через Google Drive ----------
  // Тот же файл в скрытой папке приложения на Диске, что и у расширения (TR.driveSync).
  // Вход — переход на страницу Google и обратно; токен живёт час, потом тихо обновляется (prompt=none).
  const DKEY = 'smotribelno:drive';
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
  let drive = (() => {
    try {
      return JSON.parse(localStorage.getItem(DKEY) || 'null') || { on: false };
    } catch {
      return { on: false };
    }
  })();
  const saveDrive = () => {
    try {
      localStorage.setItem(DKEY, JSON.stringify(drive));
    } catch {
      // нет места — синхронизация продолжит работать до перезапуска
    }
  };
  let driveTimer = null;
  let driveBusy = false;

  function scheduleDrive(ms = 8000) {
    if (!drive.on) return;
    clearTimeout(driveTimer);
    driveTimer = setTimeout(() => syncDrive(), ms);
  }

  function driveLogin(interactive) {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('smotribelno:oauth-state', state);
    location.href = TR.googleAuthUrl({ redirectUri: REDIRECT, interactive, state });
  }

  // Вернулись со страницы Google: токен в #фрагменте адреса
  function takeAuthFromUrl() {
    if (!location.hash.includes('access_token') && !location.hash.includes('error=')) return false;
    const got = TR.parseAuthFragment(location.href);
    const expected = sessionStorage.getItem('smotribelno:oauth-state');
    history.replaceState(null, '', location.pathname + location.search);
    if (!got || (got.state && expected && got.state !== expected)) return false;
    if (got.token) {
      drive = { ...drive, on: true, token: got.token, exp: got.exp, needLogin: false, error: '' };
    } else {
      drive = { ...drive, needLogin: true, error: got.error === 'access_denied' ? 'Доступ к Диску не разрешён' : 'Нужно войти в Google снова' };
    }
    saveDrive();
    return true;
  }

  async function syncDrive({ allowRedirect = false } = {}) {
    if (!drive.on || driveBusy || !TR.GOOGLE_CLIENT_ID) return;
    if (!drive.token || !(drive.exp > Date.now())) {
      // Токен истёк: при открытии приложения один раз тихо обновляем, иначе ждём кнопку
      if (allowRedirect && !sessionStorage.getItem('smotribelno:silent')) {
        sessionStorage.setItem('smotribelno:silent', '1');
        return driveLogin(false);
      }
      drive.needLogin = true;
      saveDrive();
      if (view === 'data') renderData();
      return;
    }
    driveBusy = true;
    try {
      const r = await TR.driveSync(drive.token, db.videos, { settings: db.settings });
      for (const [id, v] of Object.entries(r.changes)) db.videos[id] = TR.slimVideo(v);
      if (r.remoteCriteria) db.settings.criteria = r.remoteCriteria;
      if (r.remoteStats) db.stats = r.remoteStats; // время по дням и каналам — с компьютера
      save(false);
      drive = { ...drive, needLogin: false, error: '', at: Date.now(), received: Object.keys(r.changes).length, total: r.total };
      sessionStorage.removeItem('smotribelno:silent');
      if (Object.keys(r.changes).length) render();
    } catch (e) {
      drive = { ...drive, error: e.message, at: Date.now(), needLogin: !!e.auth };
      if (e.auth) drive.token = null;
    } finally {
      driveBusy = false;
      saveDrive();
      if (view === 'data') renderData();
    }
  }

  function driveCardHtml() {
    if (!TR.GOOGLE_CLIENT_ID) return '<div class="card"><h2>Google Drive</h2><p class="muted">Синхронизация с компьютером через Google Drive скоро появится. Пока — обмен файлами ниже.</p></div>';
    const when = drive.at ? new Date(drive.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    const status = !drive.on
      ? 'Оценки, список, отзывы и моменты будут общими с расширением на компьютере. Хранятся в скрытой папке приложения на вашем Google Диске — приложению виден только этот файл.'
      : drive.needLogin
        ? drive.error || 'Нужно войти в Google снова'
        : drive.error
          ? `Ошибка: ${esc(drive.error)}`
          : drive.at
            ? `Синхронизировано ${when}${drive.received ? ` · получено ${drive.received}` : ''} · на Диске видео: ${drive.total ?? '—'}`
            : 'Синхронизирую…';
    return `<div class="card"><h2>Google Drive ${drive.on ? (drive.needLogin ? '· нужен вход' : '· включено') : ''}</h2>
      <p class="muted">${status}</p>
      <div class="row">${
        !drive.on || drive.needLogin
          ? `<button type="button" class="btn primary" data-drive="login">${drive.on ? 'Войти в Google' : 'Подключить Google Drive'}</button>`
          : '<button type="button" class="btn primary" data-drive="sync">Синхронизировать сейчас</button>'
      }${drive.on ? '<button type="button" class="btn" data-drive="off">Отключить</button>' : ''}</div></div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-drive]');
    if (!b) return;
    if (b.dataset.drive === 'login') return driveLogin(true);
    if (b.dataset.drive === 'sync') {
      b.disabled = true;
      return syncDrive();
    }
    if (b.dataset.drive === 'off' && confirm('Отключить синхронизацию? Данные на телефоне и на Диске останутся.')) {
      drive = { on: false };
      saveDrive();
      renderData();
    }
  });
  // Вернулись в приложение — подтянуть изменения с компьютера (не чаще раза в минуту)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && drive.on && Date.now() - (drive.at || 0) > 60000) syncDrive();
  });

  // ---------- Обновление приложения ----------
  // Новая версия скачивается в фоне (sw.js) и ждёт; появляется плашка «Доступна новая версия».
  // «Обновить» включает её и перезагружает страницу. Проверяем при открытии, при возвращении и раз в 30 минут.
  let waitingWorker = null;
  let reloading = false;

  function showUpdate(worker) {
    waitingWorker = worker;
    $('#update-bar').hidden = false;
  }
  function applyUpdate() {
    if (waitingWorker) {
      reloading = true; // перезагрузка — по controllerchange, когда новая версия включится
      waitingWorker.postMessage({ type: 'skip' });
      setTimeout(() => location.reload(), 3000); // запасной путь, если событие не придёт
    } else {
      location.reload();
    }
  }
  async function setupUpdates() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let reg;
    try {
      reg = await navigator.serviceWorker.register('sw.js');
    } catch {
      return;
    }
    const check = () => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    };
    check();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => w.state === 'installed' && check());
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) return; // первая установка тоже меняет controller — тогда не перезагружаем
      location.reload();
    });
    const look = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && look());
    setInterval(look, 30 * 60 * 1000);
  }
  $('#update-btn').addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Обновляю…';
    applyUpdate();
  });

  // ---------- Потянуть вниз — обновить ----------
  // На iPhone у приложения с главного экрана нет своего жеста обновления, поэтому свой:
  // тянем список вниз от самого верха, звезда проворачивается; после порога — перезагрузка
  // (она же подтягивает изменения с Google Drive и новую версию приложения).
  const PTR_MAX = 110;
  const PTR_GO = 70;
  const ptrEl = $('#ptr');
  const mainEl = $('main');
  const ptr = { y0: null, d: 0, active: false };

  function ptrPaint(d) {
    const topY = $('.top').offsetHeight;
    ptrEl.style.transform = `translateY(${topY - 44 + d}px) rotate(${d * 3}deg)`;
    ptrEl.style.opacity = String(Math.min(1, d / PTR_GO));
    ptrEl.classList.toggle('ready', d >= PTR_GO);
    mainEl.style.transform = d ? `translateY(${d}px)` : '';
  }
  function ptrReset() {
    ptrEl.classList.add('back');
    mainEl.classList.add('back');
    ptrPaint(0);
    setTimeout(() => {
      ptrEl.classList.remove('back');
      mainEl.classList.remove('back');
    }, 260);
  }

  mainEl.addEventListener(
    'touchstart',
    (e) => {
      ptr.y0 = window.scrollY <= 0 && !sheetEl.open && e.touches.length === 1 ? e.touches[0].clientY : null;
      ptr.d = 0;
      ptr.active = false;
    },
    { passive: true }
  );
  mainEl.addEventListener(
    'touchmove',
    (e) => {
      if (ptr.y0 == null) return;
      const dy = e.touches[0].clientY - ptr.y0;
      if (dy <= 0 || window.scrollY > 0) {
        if (ptr.active) ptrPaint(0);
        ptr.active = false;
        return;
      }
      ptr.active = true;
      e.preventDefault(); // без «резинки» iOS — список двигаем сами
      ptr.d = Math.min(PTR_MAX, dy * 0.5);
      ptrPaint(ptr.d);
    },
    { passive: false }
  );
  mainEl.addEventListener('touchend', () => {
    if (!ptr.active) return;
    ptr.active = false;
    ptr.y0 = null;
    if (ptr.d < PTR_GO) return ptrReset();
    // Держим звезду на месте и крутим, пока перезагружаемся
    ptrEl.classList.add('back', 'loading');
    mainEl.classList.add('back');
    ptrPaint(56);
    setTimeout(applyUpdate, 380); // скачанная новая версия ставится этим же жестом
  });
  mainEl.addEventListener('touchcancel', () => {
    if (ptr.active) ptrReset();
    ptr.active = false;
    ptr.y0 = null;
  });

  // ---------- Навигация, ссылка, «Поделиться» ----------
  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // Разделы: нижнее меню, название сверху (→ главная), «весь список» на главной
  // Переход: новый раздел въезжает с той стороны, куда перешли по нижнему меню, и проявляется
  const ORDER = ['home', 'later', 'ratings', 'channels', 'stats', 'data'];
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const to = b.dataset.view;
    if (to === view) {
      window.scrollTo({ top: 0, behavior: 'smooth' }); // повторное нажатие — наверх
      return;
    }
    const dir = ORDER.indexOf(to) > ORDER.indexOf(view) ? 'r' : 'l';
    view = to;
    render();
    window.scrollTo(0, 0);
    const sec = $('#view-' + to);
    sec.classList.remove('enter-r', 'enter-l');
    void sec.offsetWidth; // перезапуск анимации
    sec.classList.add('enter-' + dir);
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-open]');
    if (c) openSheet(c.dataset.open);
  });
  $('#ratings-search').addEventListener('input', renderRatings);

  // iPhone: «Поделиться» для веб-приложений там нет — в YouTube «Копировать ссылку», здесь «Вставить».
  // Safari спросит разрешение вставить — это одно касание.
  $('#paste-btn').addEventListener('click', async () => {
    let text = '';
    try {
      text = (await navigator.clipboard?.readText?.()) || '';
    } catch {
      text = '';
    }
    const s = parseShared(text) || (/^[\w-]{11}$/.test(text.trim()) ? { id: text.trim(), t: 0 } : null);
    if (!s) {
      $('#link-input').focus();
      return toast(text ? 'В буфере нет ссылки на видео YouTube' : 'Вставьте ссылку в поле — долгое нажатие → «Вставить»');
    }
    const v = video(s.id);
    const fresh = !v.later && !v.rating && !v.watchedAt;
    if (fresh) setLater(s.id, settings().wlPriority || 2);
    openSheet(s.id, s.t);
    sheet.autoAdded = fresh;
    if (fresh) toast('Добавлено в «Смотреть позже+» — важность можно поменять');
  });
  $('#link-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#link-input').value.trim();
    const s = parseShared(raw) || (/^[\w-]{11}$/.test(raw) ? { id: raw, t: 0 } : null);
    if (!s) return toast('Не похоже на ссылку на видео YouTube');
    $('#link-input').value = '';
    openSheet(s.id, s.t);
  });

  // Открыли через «Поделиться» (Android) или по ссылке ?url=…
  function handleShare() {
    const q = new URLSearchParams(location.search);
    const raw = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
    if (!raw) return;
    history.replaceState(null, '', location.pathname);
    const s = parseShared(raw);
    if (!s) return toast('В том, чем поделились, нет ссылки на видео');
    // Новое видео из «Поделиться» сразу кладём в список со средней важностью — его легко поменять
    const v = video(s.id);
    const fresh = !v.later && !v.rating && !v.watchedAt;
    if (fresh) setLater(s.id, settings().wlPriority || 2);
    openSheet(s.id, s.t);
    sheet.autoAdded = fresh;
    if (fresh) toast('Добавлено в «Смотреть позже+» — важность можно поменять');
  }

  // Попросить браузер не удалять данные при нехватке места (Safari иначе может очистить сайт)
  navigator.storage?.persist?.().catch(() => {});

  const backFromGoogle = takeAuthFromUrl();
  render();
  const shared = location.search.includes('url=') || location.search.includes('text=');
  handleShare();
  // При открытии — синхронизация; если токен истёк, тихий вход (кроме открытия через «Поделиться», чтобы не потерять ссылку)
  const silentBounce = !!sessionStorage.getItem('smotribelno:silent');
  if (drive.on) syncDrive({ allowRedirect: !shared && !backFromGoogle });
  if (backFromGoogle && !silentBounce) toast(drive.token ? 'Google Drive подключён — синхронизирую' : drive.error || 'Вход не завершён');
  setupUpdates();
})();
