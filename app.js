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
    if (changed) db.changedAt = Date.now();
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
  let view = 'later';
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

  function render() {
    renderLater();
    if (view === 'ratings') renderRatings();
    if (view === 'data') renderData();
    for (const name of ['later', 'ratings', 'data']) $('#view-' + name).hidden = view !== name;
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

  // ---------- Навигация, ссылка, «Поделиться» ----------
  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  $('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    render();
    scrollTo(0, 0);
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

  render();
  handleShare();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
