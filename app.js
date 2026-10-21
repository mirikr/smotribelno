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
  // Перерисовка без «мигания»: у основных списков присвоение innerHTML заменяет только изменившиеся верхние
  // элементы, а одинаковую разметку не трогает — анимации не начинаются заново при каждой синхронизации
  const protoHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  function keepUnchanged(el) {
    if (!el || el._keep) return;
    el._keep = true;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() {
        return protoHTML.get.call(el);
      },
      set(html) {
        if (el._html === html) return;
        el._html = html;
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        // сравниваем с прошлой разметкой каждого блока, а не с живым DOM: его могли подкрасить (ползунки, кольцо)
        const next = [...tpl.content.childNodes];
        const parts = next.map((n) => n.outerHTML ?? n.textContent);
        const cur = [...el.childNodes];
        const prev = el._parts;
        el._parts = parts;
        if (!prev || next.length !== cur.length || prev.length !== cur.length) return el.replaceChildren(...next);
        next.forEach((n, i) => {
          if (parts[i] !== prev[i]) cur[i].replaceWith(n);
        });
      },
    });
  }  const plural = (n, a, b, c) => {
    const m10 = n % 10;
    const m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
  };

  TR.watchThumbFallback(); // крупные превью: 720p, а нет — на ступень ниже
  ['#home', '#later-list', '#ratings-list', '#pl-view'].forEach((x) => keepUnchanged(document.querySelector(x)));

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

  // ---------- Отмена удаления (как в расширении): уведомление на 10 секунд над нижним меню ----------
  // Удаление выполняется сразу; «Отменить» возвращает как было, «ОК» или истечение времени — оставить удалённым.
  const UNDO_MS = 10000;
  let undoEl = null;
  function undoToast(text, undo) {
    undoEl?._close();
    const box = document.createElement('div');
    box.className = 'undo-toast';
    box.setAttribute('role', 'status');
    box.innerHTML = `<span class="ut-text">${esc(text)}</span><button type="button" class="btn primary ut-undo">Отменить</button><button type="button" class="btn ut-ok">ОК</button><i class="ut-bar" aria-hidden="true"></i>`;
    document.body.appendChild(box);
    undoEl = box;
    const timer = setTimeout(() => box._close(), UNDO_MS);
    box._close = () => {
      clearTimeout(timer);
      if (undoEl === box) undoEl = null;
      box.classList.add('out');
      setTimeout(() => box.remove(), 250);
    };
    box.querySelector('.ut-ok').addEventListener('click', () => box._close());
    box.querySelector('.ut-undo').addEventListener('click', () => {
      box._close();
      undo();
      save();
      render();
      navigator.vibrate?.(8);
    });
  }
  // снимок полей видео до удаления (null — поля не было) и возврат с меткой «изменено сейчас», как restoreVideo в расширении
  function undoVideo(id, keys) {
    const v0 = db.videos[id] || {};
    const snap = Object.fromEntries(keys.map((k) => [k, v0[k] != null ? JSON.parse(JSON.stringify(v0[k])) : null]));
    return () => {
      const v = video(id);
      const now = Date.now();
      for (const [k, val] of Object.entries(snap)) {
        if (val == null) delete v[k];
        else v[k] = val;
      }
      if (snap.later) {
        v.later.updatedAt = now;
        delete v.laterDel;
      }
      if (snap.rating) {
        v.rating.updatedAt = now;
        delete v.ratingDel;
      }
      if (snap.star) delete v.starDel;
      if ('pl' in snap) v.plAt = now;
    };
  }

  // ---------- Действия (как в фоне расширения) ----------
  function setLater(id, priority) {
    const v = video(id);
    const now = Date.now();
    if (priority) {
      const keep = v.later?.priority === priority && v.later.order != null ? { order: v.later.order } : {}; // в другом блоке — наверх
      if (v.later?.pinned) keep.pinned = v.later.pinned; // закреплённое остаётся закреплённым
      v.later = { priority, addedAt: v.later?.addedAt || now, updatedAt: now, ...keep };
      delete v.laterDel;
    } else if (v.later) {
      v.laterDel = now;
      delete v.later;
    }
    save();
  }
  // Блок важности после перетаскивания: все его видео по порядку (как laterOrder в расширении)
  function setLaterOrder(priority, ids) {
    const now = Date.now();
    ids.forEach((id, i) => {
      const v = video(id);
      if (!v.later || (v.later.priority === priority && v.later.order === i + 1)) return;
      v.later = { ...v.later, priority, order: i + 1, updatedAt: now };
    });
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
  // Плейлисты — как в расширении (TR.playlistList): список в db.playlists, что в плейлисте — в v.pl
  const plStore = () => (db.playlists ||= { lists: {} });
  function plCreate(name, addId) {
    const store = plStore();
    const plId = TR.newPlaylistId();
    const now = Date.now();
    store.lists[plId] = { name: String(name).trim().slice(0, 60) || 'Новый плейлист', emoji: TR.PLAYLIST_EMOJI[Object.keys(store.lists).length % TR.PLAYLIST_EMOJI.length], createdAt: now, updatedAt: now };
    if (addId) plToggle(addId, plId, true);
    save();
    return plId;
  }
  function plUpdate(plId, patch) {
    const p = plStore().lists[plId];
    if (!p || p.del) return;
    if (patch.name != null) p.name = String(patch.name).trim().slice(0, 60) || p.name;
    if (patch.emoji && TR.PLAYLIST_EMOJI.includes(patch.emoji)) p.emoji = patch.emoji;
    p.updatedAt = Date.now();
    save();
  }
  function plDelete(plId) {
    const now = Date.now();
    plStore().lists[plId] = { del: now };
    for (const v of Object.values(db.videos)) {
      if (!v.pl || !(plId in v.pl)) continue;
      delete v.pl[plId];
      if (!Object.keys(v.pl).length) delete v.pl;
      v.plAt = now;
    }
    save();
  }
  // Канал в плейлисте — ссылкой (как plChannel в расширении): хранится в самом плейлисте
  function plChannelSet(plId, name, url, on, at) {
    const p = plStore().lists[plId];
    const k = TR.fameKey(name);
    if (!p || p.del || !k) return false;
    p.channels ||= {};
    const has = !!p.channels[k];
    const want = on == null ? !has : !!on;
    if (want !== has) {
      if (want) p.channels[k] = { name: String(name).trim().slice(0, 120), url: url || '', at: at || Date.now() };
      else delete p.channels[k];
      if (!Object.keys(p.channels).length) delete p.channels;
      p.updatedAt = Date.now();
      save();
    }
    return want;
  }
  function plToggle(id, plId, on) {
    const v = video(id);
    const has = !!v.pl && plId in v.pl;
    const want = on == null ? !has : !!on;
    if (want === has) return want;
    if (want) {
      const last = TR.playlistItems(db.videos, plId).reduce((m, x) => Math.max(m, x.pl[plId] || 0), 0);
      v.pl = { ...(v.pl || {}), [plId]: last + 1 };
    } else {
      delete v.pl[plId];
      if (!Object.keys(v.pl).length) delete v.pl;
    }
    v.plAt = Date.now();
    save();
    return want;
  }
  function plOrder(plId, ids) {
    const now = Date.now();
    ids.forEach((id, i) => {
      const v = db.videos[id];
      if (!v?.pl || !(plId in v.pl) || v.pl[plId] === i + 1) return;
      v.pl = { ...v.pl, [plId]: i + 1 };
      v.plAt = now;
    });
    save();
  }

  // Звезда ролику, который прям очень зашёл (как videoStar в расширении)
  function setVideoStar(id, on) {
    const v = video(id);
    const want = on == null ? !v.star : !!on;
    if (want === !!v.star) return want;
    if (want) {
      v.star = { at: Date.now() };
      delete v.starDel;
    } else {
      delete v.star;
      v.starDel = Date.now();
    }
    save();
    return want;
  }
  // Аллея славы (как в расширении: TR.fameList) — звезда любимому каналу
  const fameStore = () => (db.fame ||= { stars: {} });
  function setFame(name, url, on) {
    const k = TR.fameKey(name);
    if (!k) return false;
    const st = fameStore();
    const cur = st.stars[k];
    const has = !!(cur && !cur.del);
    const want = on == null ? !has : !!on;
    if (want !== has) {
      st.stars[k] = want ? { name: String(name).trim().slice(0, 120), url: url || cur?.url || '', at: Date.now() } : { del: Date.now() };
      save();
    }
    return want;
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
  // после забега за ремонтом страница перезагружается (см. fameWalk в shared.js) — снова открываем аллею
  try {
    if (sessionStorage.getItem('smotribelno:reopen') === 'fame') view = 'fame';
    sessionStorage.removeItem('smotribelno:reopen');
  } catch {
    // хранилище недоступно — откроется главная
  }
  const thumb =(v, pct) => `<span class="vthumb"><img src="${TR.thumbUrl(v.id)}" alt="" loading="lazy">${v.duration ? `<span class="dur">${TR.fmtClock(v.duration)}</span>` : ''}${pct ? `<span class="bar" style="width:${pct}%"></span>` : ''}</span>`;
  const prioChip = (p) => {
    const P = TR.PRIORITIES[p];
    return P ? `<span class="prio" style="background:${P.tint};color:${P.ink}">${TR.prioGlyph(p, 10)}${P.short}</span>` : '';
  };
  const scoreBadge = (total) => {
    const g = TR.grade(total);
    return g ? `<span class="score${g.perfect ? ' perfect' : ''}" style="background:${g.color};--g:${g.color}">${g.perfect ? '★ ' : ''}${total}</span>` : '';
  };
  function card(v, started, note = '') {
    const pct = Math.round((started ? v.watch?.position : v.watch?.maxProgress) * 100) || 0;
    const meta = [v.channel ? esc(v.channel) : '', started && v.duration ? `осталось ${TR.fmtSpent(v.duration * (1 - v.watch.position))}` : '', note ? esc(note) : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="vcard${started ? ' started' : ''}" data-open="${v.id}">
      ${thumb(v, pct)}
      <span class="vinfo"><span class="vtitle">${esc(v.title || 'Видео ' + v.id)}</span><span class="vmeta">${meta || '&nbsp;'}</span>
      <span class="chips">${started ? '<span class="prio" style="background:#2c2445;color:#e4dcff">▶ Продолжить</span>' : ''}${v.star ? '<span class="prio vstar-chip" aria-label="На аллее славы">★</span>' : ''}${v.later ? prioChip(v.later.priority) : ''}${v.rating ? scoreBadge(v.rating.total) : ''}</span></span>
    </button>`;
  }

  // Состояние перетаскивания (см. «Перетаскивание» ниже) — объявлено здесь: renderLater проверяет его при каждом вызове
  const dnd = { timer: null, card: null, item: null, ghost: null, slot: null, box: null, id: null, x0: 0, y0: 0, dx: 0, dy: 0, fx: 0, fy: 0, gx: 0, gy: 0, rot: 0, mode: 'prio', active: false, suppressClick: false, raf: 0 };
  // «Позже»: переключатель «Очередь / Плейлисты» (как в расширении); открытый плейлист — lState.open
  const lState = { mode: 'queue', open: null, q: '' };
  try {
    lState.mode = localStorage.getItem('smotribelno:lmode') === 'pl' ? 'pl' : 'queue';
  } catch {
    // без памяти браузера — с очереди
  }

  function renderLater() {
    if (dnd.active) return; // видео в руке — список перерисуем, когда отпустят
    const s = settings();
    const started = TR.startedVideos(db.videos, s.autoWatchedPct);
    const ids = new Set(started.map((v) => v.id));
    const queue = TR.laterQueue(db.videos).filter((v) => !ids.has(v.id));
    $('#n-later').textContent = queue.length + started.length || '';
    const lists = TR.playlistList(plStore());
    $('#later-seg').innerHTML = [
      ['queue', `Очередь · ${queue.length + started.length}`],
      ['pl', `Плейлисты${lists.length ? ' · ' + lists.length : ''}`],
    ]
      .map(([v, l]) => `<button type="button" data-lmode="${v}" class="${lState.mode === v ? 'on' : ''}">${l}</button>`)
      .join('');
    $('#later-list').hidden = lState.mode === 'pl';
    $('#pl-view').hidden = lState.mode !== 'pl';
    if (lState.mode === 'pl') return renderPlaylists(lists);
    let html = '';
    if (started.length) html += `<h2 class="list-head">Продолжить <span>· ${started.length}</span></h2>${started.map((v) => card(v, true)).join('')}`;
    // Отдельные подсвеченные блоки по важности; видны и пустыми — в них перетаскивают зажатием пальца
    if (queue.length || started.length) {
      html += '<p class="muted drag-hint">Зажмите видео и перетащите: на другое место или в другой блок важности.</p>';
      for (const p of [3, 2, 1]) {
        const g = queue.filter((v) => v.later.priority === p);
        const P = TR.PRIORITIES[p];
        html += `<section class="prio-group" data-prio="${p}" style="--pt:${P.tint};--pc:${P.color}">
          <h2 class="list-head">${prioChip(p)}<span>${g.length} ${plural(g.length, 'видео', 'видео', 'видео')}</span></h2>
          ${g.map((v) => card(v, false)).join('') || `<div class="drop-empty">Перетащите сюда — важность «${P.short}»</div>`}
        </section>`;
      }
    }
    $('#later-list').innerHTML =
      html ||
      `<div class="empty">Список пуст.<br>${
        IOS ? 'В приложении YouTube: «Поделиться» → «Копировать ссылку», здесь — «Вставить» сверху.' : 'В приложении YouTube нажмите «Поделиться» → «Смотрибельно» или вставьте ссылку сверху.'
      }${
        Object.keys(db.videos).length ? '' : '<br><br>Оценки и список с компьютера — во вкладке «Данные».'
      }</div>`;
  }

  // ---------- Плейлисты ----------
  const plCover = (items) => {
    const th = items.slice(0, 4);
    return th.length
      ? `<span class="pl-cover n${th.length}" aria-hidden="true">${th.map((v) => `<img src="${TR.thumbUrl(v.id)}" alt="" loading="lazy">`).join('')}</span>`
      : '<span class="pl-cover empty" aria-hidden="true">▶</span>';
  };
  const plMeta = (sum) =>
    [`${sum.count} ${plural(sum.count, 'видео', 'видео', 'видео')}`, sum.duration ? TR.fmtSpent(sum.duration) : '', sum.count ? `просмотрено ${sum.watched} из ${sum.count}` : '', sum.avg != null ? `средняя ${sum.avg}` : '']
      .filter(Boolean)
      .join(' · ');

  function renderPlaylists(lists) {
    const box = $('#pl-view');
    const open = lState.open && plStore().lists[lState.open] && !plStore().lists[lState.open].del ? lState.open : null;
    if (!open) {
      lState.open = null;
      box.innerHTML = `
        ${lists
          .map((p) => {
            const items = TR.playlistItems(db.videos, p.id);
            const sum = TR.playlistSummary(items);
            return `<button type="button" class="pl-card" data-plopen="${p.id}">
              ${plCover(items)}
              <span class="pl-card-b"><span class="pl-name">${esc(p.emoji || '')} ${esc(p.name)}</span><span class="vmeta">${plMeta(sum)}</span>
              <span class="pl-bar"><span style="width:${sum.count ? Math.round((sum.watched / sum.count) * 100) : 0}%"></span></span></span>
            </button>`;
          })
          .join('')}
        <form class="pl-new" id="pl-new-form"><input id="pl-new-name" maxlength="60" placeholder="Новый плейлист" enterkeyhint="done" aria-label="Название нового плейлиста"><button type="submit" class="btn primary">Создать</button></form>
        ${lists.length ? '' : '<p class="muted pl-hint">Собирайте видео в подборки: «На выходные», «Учёба», «Кофе». Добавлять можно из карточки любого видео — там появилась строка «Плейлисты».</p>'}`;
      return;
    }
    const p = plStore().lists[open];
    const items = TR.playlistItems(db.videos, open);
    const sum = TR.playlistSummary(items);
    const next = TR.playlistNext(db.videos, open, null);
    const s = settings();
    const keepFocus = document.activeElement?.id === 'pl-q';
    box.innerHTML = `
      <button type="button" class="link-btn pl-back" data-plback="1">← Все плейлисты</button>
      <div class="pl-hero">
        ${plCover(items)}
        <div class="pl-title-row"><button type="button" class="pl-emoji" data-plemoji="1" aria-label="Сменить значок">${esc(p.emoji || '🎬')}</button><input id="pl-title" class="pl-title" value="${esc(p.name)}" maxlength="60" enterkeyhint="done" aria-label="Название плейлиста"></div>
        <div class="pl-emoji-pick" id="pl-emoji-pick" hidden>${TR.PLAYLIST_EMOJI.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
        <div class="vmeta">${plMeta(sum)}${next && sum.left > 60 ? ` · осталось ≈ ${TR.fmtSpent(sum.left)}` : ''}</div>
        <div class="row">
          ${next ? `<a class="btn primary" href="${TR.resumeUrl(next)}" target="_blank" rel="noopener">▶ ${sum.watched || TR.isStarted(next, s.autoWatchedPct) ? 'Продолжить' : 'Смотреть по порядку'}</a>` : sum.count ? '<span class="pl-done">✓ Всё просмотрено</span>' : ''}
          <button type="button" class="btn" data-pldel="1">Удалить</button>
        </div>
      </div>
      <input type="search" id="pl-q" class="pl-q" placeholder="＋ Добавить: поиск по своим видео" value="${esc(lState.q)}" autocomplete="off" enterkeyhint="search">
      <div id="pl-res">${plResults(open)}</div>
      ${plChannelsBlock(p)}
      ${items.length > 1 ? '<p class="muted drag-hint">Зажмите видео и перетащите, чтобы поменять порядок.</p>' : ''}
      <div id="pl-items" data-pl="${open}">
        ${items.map((v, i) => `<div class="pl-it${v.watchedAt ? ' done' : ''}"><span class="pl-num">${v.watchedAt ? '✓' : i + 1}</span>${card(v, TR.isStarted(v, s.autoWatchedPct) && !v.watchedAt)}</div>`).join('') || '<div class="empty">Пока пусто. Найдите видео поиском выше или откройте любое видео и отметьте этот плейлист.</div>'}
      </div>`;
    if (keepFocus) {
      const q = $('#pl-q');
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  }

  // Каналы плейлиста: аватарка, название (→ карточка канала), средняя оценка, YouTube, убрать
  function plChannelsBlock(p) {
    const chans = TR.playlistChannels(p);
    if (!chans.length) return '';
    const byKey = new Map(channelList().map((c) => [TR.fameKey(c.name), c]));
    return `<div class="pl-chs"><span class="sh-label">Каналы · ${chans.length}</span>${chans
      .map((ch) => {
        const c = byKey.get(TR.fameKey(ch.name));
        const url = ch.url || c?.url || '';
        const n = c?.rated?.length || 0;
        return `<div class="pl-ch">
          <button type="button" class="pl-ch-open" data-plch-open="${esc(ch.name)}">${chAvatar(c || { name: ch.name }, 40)}<span class="vinfo"><span class="vtitle">${esc(ch.name)}</span><span class="vmeta">${
            c?.avg != null ? `средняя ${c.avg} · ${n} ${plural(n, 'оценка', 'оценки', 'оценок')}` : 'оценок пока нет'
          }</span></span></button>
          ${url ? `<a class="pl-ch-yt" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Открыть на YouTube">↗</a>` : ''}
          <button type="button" class="pl-ch-del" data-plch-del="${esc(ch.name)}" aria-label="Убрать канал из плейлиста">✕</button>
        </div>`;
      })
      .join('')}</div>`;
  }

  // Поиск для добавления: все видео на телефоне (с компьютера тоже), новые сверху
  function plResults(plId) {
    const words = lState.q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    const hay = (v) => `${v.title || ''} ${v.channel || ''}`.toLowerCase().replace(/ё/g, 'е');
    const found = Object.values(db.videos)
      .filter((v) => v.title && words.every((w) => hay(v).includes(w)))
      .sort((a, b) => Math.max(b.watch?.lastAt || 0, b.later?.addedAt || 0, b.rating?.updatedAt || 0) - Math.max(a.watch?.lastAt || 0, a.later?.addedAt || 0, a.rating?.updatedAt || 0))
      .slice(0, 8);
    if (!found.length) return '<p class="muted pl-hint">Ничего не нашлось. Видео можно добавить и из его карточки.</p>';
    return `<div class="pl-res">${found
      .map((v) => {
        const inPl = !!v.pl && plId in v.pl;
        return `<button type="button" class="pl-res-i${inPl ? ' in' : ''}" data-pladd="${v.id}" ${inPl ? 'disabled' : ''}>${thumb(v)}<span class="vinfo"><span class="vtitle">${esc(v.title)}</span><span class="vmeta">${esc(v.channel || '')}</span></span><span class="pl-res-go">${inPl ? '✓' : '＋'}</span></button>`;
      })
      .join('')}</div>`;
  }

  const plView = $('#pl-view');
  $('#later-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lmode]');
    if (!b) return;
    lState.mode = b.dataset.lmode;
    try {
      localStorage.setItem('smotribelno:lmode', lState.mode);
    } catch {
      // не критично
    }
    renderLater();
  });
  plView.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#pl-new-name')?.value.trim();
    if (!name) return $('#pl-new-name')?.focus();
    lState.open = plCreate(name);
    lState.q = '';
    renderLater();
    toast(`Плейлист «${name}» создан`);
  });
  plView.addEventListener('click', (e) => {
    if (dnd.suppressClick) return;
    const t = e.target;
    const openB = t.closest('[data-plopen]');
    if (openB) {
      lState.open = openB.dataset.plopen;
      lState.q = '';
      renderLater();
      return window.scrollTo(0, 0);
    }
    if (t.closest('[data-plback]')) {
      lState.open = null;
      return renderLater();
    }
    if (t.closest('[data-plemoji]')) return ($('#pl-emoji-pick').hidden = !$('#pl-emoji-pick').hidden);
    const em = t.closest('[data-emoji]');
    if (em) {
      plUpdate(lState.open, { emoji: em.dataset.emoji });
      return renderLater();
    }
    if (t.closest('[data-pldel]')) {
      const plId = lState.open;
      const p = plStore().lists[plId];
      const list = JSON.parse(JSON.stringify(p));
      const members = Object.fromEntries(Object.values(db.videos).filter((v) => v.pl && plId in v.pl).map((v) => [v.id, v.pl[plId]]));
      plDelete(plId);
      lState.open = null;
      renderLater();
      return undoToast(`Плейлист «${p.name}» удалён`, () => {
        const now = Date.now();
        plStore().lists[plId] = { ...list, updatedAt: now };
        for (const [id, entry] of Object.entries(members)) {
          const v = video(id);
          v.pl = { ...(v.pl || {}), [plId]: entry };
          v.plAt = now;
        }
        lState.open = plId;
      });
    }
    const chOpen = t.closest('[data-plch-open]');
    if (chOpen) {
      const name = chOpen.dataset.plchOpen;
      if (channelList().some((c) => c.name === name)) return openChannel(name);
      return toast('Про этот канал на телефоне пока нет данных');
    }
    const chDel = t.closest('[data-plch-del]');
    if (chDel) {
      const plId = lState.open;
      const name = chDel.dataset.plchDel;
      const was = plStore().lists[plId]?.channels?.[TR.fameKey(name)];
      plChannelSet(plId, name, '', false);
      renderLater();
      if (was) undoToast(`Канал «${name}» убран из плейлиста`, () => plChannelSet(plId, was.name, was.url, true, was.at));
      return;
    }
    const add = t.closest('[data-pladd]');
    if (add) {
      plToggle(add.dataset.pladd, lState.open, true);
      navigator.vibrate?.(8);
      toast('Добавлено в плейлист');
      return renderLater();
    }
  });
  plView.addEventListener('input', (e) => {
    if (e.target.id !== 'pl-q') return;
    lState.q = e.target.value;
    $('#pl-res').innerHTML = plResults(lState.open);
  });
  // Переименование: «Готово» на клавиатуре или уход из поля
  plView.addEventListener('keydown', (e) => e.target.id === 'pl-title' && e.key === 'Enter' && e.target.blur());
  plView.addEventListener('focusout', (e) => {
    if (e.target.id !== 'pl-title') return;
    const name = e.target.value.trim();
    if (name && name !== plStore().lists[lState.open]?.name) {
      plUpdate(lState.open, { name });
      toast('Переименовано');
    }
  });

  // ---------- Перетаскивание: зажать карточку ~0,4 с и вести пальцем ----------
  // Очередь — в любой блок важности и на любое место в нём (mode 'prio'); открытый плейлист — на новое место (mode 'order').
  // Куда встанет видео, показывает «прорезь»: соседи пружинисто расступаются, блок под пальцем покачивается, как желе,
  // а карточка в руке тянется за пальцем с небольшим отставанием и наклоняется по ходу движения.
  const laterListEl = $('#view-later');
  const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isItem = (x) => (dnd.mode === 'order' ? x.classList.contains('pl-it') : x.matches('.vcard[data-open]'));
  const dndBoxes = () => (dnd.mode === 'order' ? $$('#pl-items') : $$('#later-list .prio-group'));
  const dndItems = (box) => [...box.children].filter((x) => x !== dnd.item && isItem(x));
  const idOf = (x) => (x.matches('.vcard') ? x : $('.vcard[data-open]', x))?.dataset.open;

  // FLIP: запомнить, где элементы видны сейчас, переставить разметку и с пружиной довести их до новых мест
  function flip(mutate) {
    const els = dndBoxes().flatMap((b) => [b, ...dndItems(b)]);
    const rel = (e) => e.getBoundingClientRect().top - e.parentElement.getBoundingClientRect().top;
    const before = new Map(els.map((e) => [e, rel(e)]));
    for (const e of els) {
      e.style.transition = 'none';
      e.style.transform = '';
    }
    mutate();
    if (reduceMotion) return;
    for (const e of els) {
      const d = before.get(e) - rel(e);
      if (Math.abs(d) < 1) continue;
      e.style.transform = `translateY(${d}px)`;
      e.getBoundingClientRect(); // зафиксировать начальное положение
      e.style.transition = `transform 0.45s ${SPRING}`;
      e.style.transform = '';
    }
  }
  // Блок «желе»: короткое пружинистое покачивание
  function jelly(box) {
    if (!box || reduceMotion) return;
    box.classList.remove('jelly');
    void box.offsetWidth;
    box.classList.add('jelly');
  }

  // Долгое нажатие на iPhone начинает выделять текст — во время перетаскивания выделение сбрасываем
  function clearSelection() {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // не критично
    }
  }

  function dndCancel() {
    clearTimeout(dnd.timer);
    dnd.timer = null;
    if (!dnd.active) dnd.card = null;
  }
  function dndStart() {
    dnd.timer = null;
    dnd.item = dnd.mode === 'order' ? dnd.card.closest('.pl-it') : dnd.card;
    if (!dnd.item) return;
    const r = dnd.card.getBoundingClientRect();
    dnd.dx = dnd.x0 - r.left;
    dnd.dy = dnd.y0 - r.top;
    dnd.gx = r.left;
    dnd.gy = r.top;
    dnd.fx = dnd.x0;
    dnd.fy = dnd.y0;
    dnd.rot = 0;
    const ghost = dnd.card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1.04)`;
    document.body.appendChild(ghost);
    dnd.ghost = ghost;
    // на месте карточки — прорезь её высоты, сама карточка прячется до конца перетаскивания
    const slot = document.createElement('div');
    slot.className = 'drop-slot';
    slot.style.height = dnd.item.offsetHeight + 'px';
    dnd.item.before(slot);
    dnd.item.classList.add('dnd-hidden');
    dnd.slot = slot;
    dnd.box = slot.parentElement;
    dnd.box.classList.add('drop-over');
    dnd.active = true;
    laterListEl.classList.add('drag-active');
    document.body.classList.add('dnd-on'); // iOS не выделяет текст, пока видео в руке
    clearSelection();
    jelly(dnd.box);
    navigator.vibrate?.(12);
    dnd.raf = requestAnimationFrame(ghostLoop);
  }

  // Куда встанет: блок под пальцем (или ближайший, если палец между блоками) и видео, перед которым
  function dndTarget(x, y) {
    let box = document.elementFromPoint(x, y)?.closest?.(dnd.mode === 'order' ? '#pl-items' : '#later-list .prio-group');
    if (!box) {
      let best = null;
      let bd = Infinity;
      for (const b of dndBoxes()) {
        const r = b.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      box = bd < 90 ? best : null;
    }
    if (!box) return null;
    const items = dndItems(box);
    const i = items.findIndex((el) => y < el.getBoundingClientRect().top + el.offsetHeight / 2);
    return { box, before: i < 0 ? null : items[i] };
  }
  function nextItemAfterSlot() {
    let n = dnd.slot.nextElementSibling;
    while (n && (n === dnd.item || !isItem(n))) n = n.nextElementSibling;
    return n;
  }
  function dndUpdateTarget(x, y) {
    const t = dndTarget(x, y);
    if (!t || (t.box === dnd.slot.parentElement && t.before === nextItemAfterSlot())) return;
    flip(() => {
      if (t.before) t.box.insertBefore(dnd.slot, t.before);
      else {
        const items = dndItems(t.box);
        if (items.length) items[items.length - 1].after(dnd.slot);
        else t.box.appendChild(dnd.slot);
      }
    });
    dnd.slot.classList.remove('pop');
    void dnd.slot.offsetWidth;
    dnd.slot.classList.add('pop');
    if (t.box !== dnd.box) {
      dnd.box?.classList.remove('drop-over');
      t.box.classList.add('drop-over');
      jelly(t.box);
      dnd.box = t.box;
      navigator.vibrate?.(6);
    }
  }

  // Карточка в руке догоняет палец (лёгкое отставание), наклоняется и чуть вытягивается по ходу — как слайм.
  // У краёв экрана список сам прокручивается.
  function ghostLoop() {
    dnd.raf = 0;
    if (!dnd.active || !dnd.ghost) return;
    const tx = dnd.fx - dnd.dx;
    const ty = dnd.fy - dnd.dy;
    const vx = tx - dnd.gx;
    const vy = ty - dnd.gy;
    const k = reduceMotion ? 1 : 0.38;
    dnd.gx += vx * k;
    dnd.gy += vy * k;
    dnd.rot += (Math.max(-8, Math.min(8, vx * 0.35)) - dnd.rot) * 0.25;
    const s = reduceMotion ? 0 : Math.min(0.05, Math.abs(vy) / 500);
    dnd.ghost.style.transform = `translate(${dnd.gx}px, ${dnd.gy}px) rotate(${reduceMotion ? 0 : dnd.rot}deg) scale(${1.04 - s}, ${1.04 + s})`;
    const h = innerHeight;
    const v = dnd.fy < 120 ? -Math.ceil((120 - dnd.fy) / 8) : dnd.fy > h - 140 ? Math.ceil((dnd.fy - (h - 140)) / 8) : 0;
    if (v) {
      window.scrollBy(0, v);
      dndUpdateTarget(dnd.fx, dnd.fy);
    }
    dnd.raf = requestAnimationFrame(ghostLoop);
  }
  function dndMove(x, y) {
    clearSelection();
    dnd.fx = x;
    dnd.fy = y;
    dndUpdateTarget(x, y);
  }

  function dndEnd(abort = false) {
    cancelAnimationFrame(dnd.raf);
    dnd.raf = 0;
    const { id, slot, item, ghost, mode } = dnd;
    const box = slot?.parentElement;
    let ids = null;
    if (!abort && box) ids = [...box.children].filter((x) => x === slot || (x !== item && isItem(x))).map((x) => (x === slot ? id : idOf(x)));
    const prio = mode === 'prio' && box ? Number(box.dataset.prio) : null;
    const plId = mode === 'order' && box ? box.dataset.pl : null;
    // карточка «прилипает» на своё новое место
    const r = (abort ? item : slot)?.getBoundingClientRect();
    if (ghost && r && !reduceMotion) {
      ghost.style.transition = `transform 0.26s ${SPRING}`;
      ghost.style.transform = `translate(${r.left}px, ${r.top}px) rotate(0deg) scale(1)`;
    }
    dnd.box?.classList.remove('drop-over');
    laterListEl.classList.remove('drag-active');
    document.body.classList.remove('dnd-on');
    clearSelection();
    dnd.active = false;
    dnd.ghost = dnd.card = dnd.item = dnd.slot = dnd.box = null;
    dnd.suppressClick = true; // отпускание пальца после перетаскивания — не «нажатие» на карточку
    setTimeout(() => (dnd.suppressClick = false), 500);
    setTimeout(
      () => {
        ghost?.remove();
        // прорезь убираем всегда: если порядок не поменялся, список не перерисуется (разметка та же)
        slot?.remove();
        item?.classList.remove('dnd-hidden');
        const oldP = video(id).later?.priority;
        if (ids && mode === 'order' && plId) plOrder(plId, ids);
        if (ids && mode === 'prio' && prio) {
          setLaterOrder(prio, ids);
          if (oldP !== prio) toast(`Важность: ${TR.PRIORITIES[prio].label.toLowerCase()}`);
        }
        if (!ids) return;
        renderLater();
        $(`#view-later .vcard[data-open="${id}"]`)?.classList.add('just-moved');
      },
      reduceMotion ? 0 : 240
    );
  }
  laterListEl.addEventListener(
    'touchstart',
    (e) => {
      const c = e.target.closest('#later-list .prio-group .vcard[data-open], #pl-items .vcard[data-open]');
      if (!c || e.touches.length > 1 || dnd.active) return;
      dnd.mode = c.closest('#pl-items') ? 'order' : 'prio';
      dnd.card = c;
      dnd.id = c.dataset.open;
      dnd.x0 = e.touches[0].clientX;
      dnd.y0 = e.touches[0].clientY;
      dnd.timer = setTimeout(dndStart, 420);
    },
    { passive: true }
  );
  laterListEl.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (dnd.active) {
        e.preventDefault(); // во время перетаскивания страница не прокручивается сама
        return dndMove(t.clientX, t.clientY);
      }
      if (dnd.timer && Math.hypot(t.clientX - dnd.x0, t.clientY - dnd.y0) > 10) dndCancel(); // это прокрутка
    },
    { passive: false }
  );
  laterListEl.addEventListener('touchend', () => (dnd.active ? dndEnd() : dndCancel()));
  laterListEl.addEventListener('touchcancel', () => (dnd.active ? dndEnd(true) : dndCancel()));
  // Пока ждём долгое нажатие или тащим — выделение текста не начинается
  laterListEl.addEventListener('selectstart', (e) => (dnd.timer || dnd.active) && e.preventDefault());
  // Долгое нажатие на iPhone открывает меню ссылки/картинки — у карточек его нет
  laterListEl.addEventListener('contextmenu', (e) => e.target.closest('.vcard') && e.preventDefault());
  // После перетаскивания «клик» по карточке не открывает её
  document.addEventListener(
    'click',
    (e) => {
      if (dnd.suppressClick && e.target.closest('#view-later .vcard')) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  // Оценки: «Оценённые», «Ждут оценки» (досмотрено, но без оценки — в т. ч. на компьютере), «Бросили»
  const rState = { tab: 'rated' };
  const awaitingList = () =>
    Object.values(db.videos)
      .filter((v) => TR.awaitingRating(v) && !TR.isStarted(v, settings().autoWatchedPct))
      .sort((a, b) => Math.max(b.watchedAt || 0, b.watch?.lastAt || 0) - Math.max(a.watchedAt || 0, a.watch?.lastAt || 0));
  function renderRatings() {
    const q = ($('#ratings-search').value || '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    const hay = (v) => `${v.title || ''} ${v.channel || ''}`.toLowerCase().replace(/ё/g, 'е');
    const V = Object.values(db.videos);
    const rated = V.filter((v) => v.rating).sort((a, b) => (b.rating.updatedAt || 0) - (a.rating.updatedAt || 0));
    const awaiting = awaitingList();
    const ask = V.filter((v) => TR.isDropCandidate(v)).sort((a, b) => (b.watch?.lastAt || 0) - (a.watch?.lastAt || 0));
    const dropped = V.filter((v) => v.dropped).sort((a, b) => b.dropped.at - a.dropped.at);
    const seg = $('#ratings-seg');
    seg.innerHTML = [
      ['rated', `Оценённые · ${rated.length}`],
      ['todo', `Ждут оценки · ${awaiting.length}`],
      ['dropped', `Бросили · ${ask.length + dropped.length}`],
    ]
      .map(([v, l]) => `<button type="button" data-rtab="${v}" class="${rState.tab === v ? 'on' : ''}">${l}</button>`)
      .join('');
    const match = (v) => q.every((w) => hay(v).includes(w));
    let html = '';
    if (rState.tab === 'rated') {
      const list = rated.filter(match);
      html = list.length ? list.map((v) => card(v, false)).join('') : `<div class="empty">${rated.length ? 'Ничего не нашлось.' : 'Оценок пока нет. Откройте видео и подвигайте ползунки.'}</div>`;
    } else if (rState.tab === 'todo') {
      const list = awaiting.filter(match);
      html = list.length
        ? list.map((v) => card(v, false, TR.fromOtherDevice(v) ? 'досмотрено на другом устройстве' : 'досмотрено')).join('')
        : '<div class="empty">Все просмотренные видео оценены 🎉</div>';
    } else {
      const a = ask.filter(match);
      const d = dropped.filter(match);
      html =
        (a.length ? `<h2 class="list-head">Почему не досмотрели? <span>· ${a.length}</span></h2>${a.map((v) => card(v, false, `на ${Math.round(TR.maxPos(v) * 100)}%`)).join('')}` : '') +
        (d.length ? `<h2 class="list-head">Брошенные <span>· ${d.length}</span></h2>${d.map((v) => card(v, false, TR.dropReason(v.dropped.reason).label)).join('')}` : '') ||
        '<div class="empty">Брошенных видео нет. Сюда попадают видео, которые начали, но ушли раньше 60% и не возвращались три дня.</div>';
    }
    $('#ratings-list').innerHTML = html;
    $('#n-ratings').textContent = awaiting.length || '';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rtab]');
    if (!b) return;
    rState.tab = b.dataset.rtab;
    renderRatings();
  });

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
        <button type="button" class="hh-shot" data-open="${hero.id}"><img src="${TR.thumbHQ(hero.id)}" alt="">${started ? '<span class="hh-badge">▶ Продолжить</span>' : hero.later ? `<span class="hh-badge">${prioChip(hero.later.priority)}</span>` : ''}${started ? `<span class="bar" style="width:${Math.round(pos * 100)}%"></span>` : ''}</button>
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

    // Тоже начато: остальные недосмотренные — лентой поменьше под большой карточкой (как на компьютере)
    const isStarted = (v) => TR.isStarted(v, s.autoWatchedPct);
    const moreStarted = next.filter((v) => v.id !== hero?.id && isStarted(v)).slice(0, 8);
    const startedHtml = moreStarted.length
      ? `<h2 class="list-head">Тоже начато <span>· ${moreStarted.length}</span></h2>
        <div class="hc-strip">${moreStarted
          .map((v) => {
            const pos = Math.min(v.watch?.position || 0, 1);
            const left = v.duration ? `осталось ${TR.fmtSpent(v.duration * (1 - pos))}` : `просмотрено ${Math.round(pos * 100)}%`;
            return `<button type="button" class="hc-card" data-open="${v.id}">
              <span class="hc-shot"><img src="${TR.thumbUrl(v.id)}" alt="" loading="lazy"><span class="hc-play" aria-hidden="true">▶</span><span class="bar" style="width:${Math.round(pos * 100)}%"></span></span>
              <span class="hc-t">${esc(v.title || 'Видео ' + v.id)}</span>
              <span class="vmeta">${left}</span>
            </button>`;
          })
          .join('')}</div>`
      : '';

    // Оценка — отдельным блоком с крупным превью: ждущее оценки (после «Сохранить» здесь сразу следующее), иначе последняя.
    // Начатое и недосмотренное — в «Продолжить», а не здесь.
    const awaiting = V.filter((v) => TR.awaitingRating(v) && !isStarted(v)).sort((a, b) => (b.watchedAt || b.watch?.lastAt || 0) - (a.watchedAt || a.watch?.lastAt || 0));
    let ticketHtml = '';
    const tkShot = (v) =>
      `<button type="button" class="tk-shot" data-open="${v.id}" aria-label="Открыть видео"><img src="${TR.thumbHQ(v.id)}" alt="">${v.duration ? `<span class="dur">${TR.fmtClock(v.duration)}</span>` : ''}</button>`;
    if (awaiting.length) {
      const v = awaiting[0];
      ticketHtml = `<div class="card ticket tk-wide">
        <span class="sh-label">Оцените просмотренное${awaiting.length > 1 ? ` · ещё ${awaiting.length - 1} ${plural(awaiting.length - 1, 'ждёт', 'ждут', 'ждут')}` : ''}</span>
        ${tkShot(v)}
        <div class="tk-head">${ringSvg(null, 64)}<span class="vinfo"><span class="vtitle">${esc(v.title || 'Видео ' + v.id)}</span><span class="vmeta">${esc(v.channel || '')}</span></span></div>
        <div class="row"><button type="button" class="btn primary" data-open="${v.id}">Оценить</button><button type="button" class="btn" data-norate="${v.id}">Не оценивать</button></div>
        ${awaiting.length > 1 ? '<p class="muted tk-hint">После оценки здесь появится следующее.</p>' : ''}
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
        ticketHtml = `<div class="card ticket tk-wide">
          <span class="sh-label">Последняя оценка · всё оценено</span>
          ${tkShot(last)}
          <button type="button" class="tk-last" data-open="${last.id}">${ringSvg(last.rating.total, 64)}<span class="vinfo"><span class="vtitle">${esc(last.title || 'Видео ' + last.id)}</span><span class="vmeta">${esc(last.channel || '')}</span>${g ? `<span class="grade" style="background:${g.color};--g:${g.color};align-self:flex-start">${g.perfect ? '★ ' : ''}${g.label}</span>` : ''}</span></button>
          <div class="crit-bars">${bars}</div>
        </div>`;
      }
    }

    // Неделя оценок с понедельника и серия дней подряд с оценками
    const by = ratedDays();
    // Серия — дни подряд с YouTube (по сводке с компьютера, как в расширении); без неё — дни с оценками
    const yt = youtubeStreak();
    const streak = yt ? yt.cur : ratingStreak(by);
    const streakWhat = yt ? 'с YouTube' : 'с оценками';
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
      <div class="wk-top">${streak ? `<span class="wk-streak">${fireNum(streak)}</span><span>${plural(streak, 'день', 'дня', 'дней')} подряд ${streakWhat}</span>${yt ? `<span class="spacer"></span><span class="muted">рекорд ${yt.best}</span>` : ''}` : `<span class="muted">${yt ? 'Серия начнётся с первого дня с YouTube' : 'Серия начнётся с первой оценки'}</span>`}</div>
      <div class="wk-grid">${days}</div>
      <div class="wk-grid wk-labels">${WD.map((w, i) => `<span class="${i === nowIdx ? 'now' : ''}">${w}</span>`).join('')}</div>
    </div>`;

    // Дальше в списке и сводка
    const rest = next.filter((v) => v.id !== hero?.id && !isStarted(v)).slice(0, 3);
    const rated = V.filter((v) => v.rating);
    const avg = rated.length ? Math.round(rated.reduce((a, v) => a + v.rating.total, 0) / rated.length) : null;
    const restHtml = rest.length
      ? `<h2 class="list-head">Дальше в списке <button type="button" class="link-btn" data-view="later">весь список →</button></h2>${rest.map((v) => card(v, false)).join('')}`
      : '';
    const statsHtml = `<div class="card"><div class="stats">
      <div><b>${TR.laterQueue(db.videos).length}</b><span>в «Позже+»</span></div>
      <div><b>${rated.length}</b><span>оценок</span></div>
      <div><b>${avg ?? '—'}</b><span>в среднем</span></div>
    </div></div>`;

    // Сверху — что смотреть (большое «Продолжить», лента начатых), потом оценка с превью, очередь, неделя и сводка
    // Ссылка на аллею славы: три последние звезды и сколько всего на аллее
    const famed = [
      ...TR.fameList(fameStore()).map((s) => ({ at: s.at, html: fameStarHtml(s.name, TR.fameType(db.videos, s.name)) })),
      ...TR.starredVideos(db.videos).map((v) => ({ at: v.star.at, html: videoFameStar(v) })),
    ].sort((a, b) => b.at - a.at);
    const fameHtml = `<button type="button" class="card fame-teaser" data-view="fame">
      <span class="ft-stars">${famed.length ? famed.slice(0, 3).map((x) => x.html).join('') : fameStarHtml('', 'custom', 'ghost')}</span>
      <span class="ft-info"><span class="sh-label" style="margin:0">★ Аллея славы</span><b>${famed.length ? `${famed.length} ${plural(famed.length, 'звезда', 'звезды', 'звёзд')} на аллее` : 'Любимые каналы и ролики'}</b><span class="muted">${famed.length ? 'Прогуляйтесь по бульварам Каналов и Роликов →' : 'Дайте звезду каналу или ролику, который прям очень зашёл →'}</span></span>
    </button>`;
    $('#home').innerHTML = heroHtml + startedHtml + ticketHtml + restHtml + weekHtml + fameHtml + statsHtml;
  }
  // «Не оценивать» прямо с главной — и сразу следующее ждущее оценки
  $('#home').addEventListener('click', (e) => {
    const b = e.target.closest('[data-norate]');
    if (!b) return;
    const undo = undoVideo(b.dataset.norate, ['noRate']);
    video(b.dataset.norate).noRate = Date.now(); // уйдёт и на компьютер
    save();
    render();
    undoToast('Убрано из «Ждут оценки»', undo);
  });

  // ---------- Каналы ----------
  // Полный список — со сводки с компьютера (stats.channels: адрес, аватарка, видео в истории YouTube,
  // минуты за 7/30/90/365 дней и за всё время), плюс каналы видео, которые есть здесь.
  const chState = { sort: 'score', q: '', view: 'all' };
  const fmtMin = (m) => TR.fmtSpent((m || 0) * 60);
  const WIN = { 7: 0, 30: 1, 90: 2, 365: 3, 0: 4 }; // индексы окон в stats.channels и stats.topVideos

  function channelList() {
    const map = {};
    const get = (name) => (map[name] ||= { name, url: '', icon: '', rated: [], later: 0, min: 0, mins: [0, 0, 0, 0, 0], views: 0, dropped: 0, finished: 0, reasons: {} });
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
    const v2 = db.stats?.v === 2;
    for (const [name, x] of Object.entries(db.stats?.channels || {})) {
      const c = get(name);
      if (v2) {
        // [адрес, аватарка, видео в истории, мин 7, 30, 90, 365, всё время]
        if (!c.url && x[0]) c.url = x[0];
        c.icon = TR.safeIconSrc(x[1]);
        c.views = x[2] || 0;
        c.mins = x.slice(3, 8).map((n) => n || 0);
        c.min = c.mins[4];
      } else {
        c.min = x[0] || 0;
        if (!c.url && x[1]) c.url = x[1];
        c.icon = TR.safeIconSrc(x[2]);
      }
    }
    for (const c of Object.values(map)) {
      c.rated.sort((a, b) => (a.rating.updatedAt || 0) - (b.rating.updatedAt || 0));
      c.avg = c.rated.length ? Math.round(c.rated.reduce((s, v) => s + v.rating.total, 0) / c.rated.length) : null;
      const n = c.finished + c.dropped;
      c.finishPct = c.dropped && n >= 3 ? Math.round((c.finished / n) * 100) : null;
    }
    return Object.values(map);
  }
  // Аватарка поверх буквы: если картинка не загрузится, останется буква
  const chAvatar = (c, size) =>
    `<span class="ch-ava" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px">${esc((c.name.trim()[0] || '?').toUpperCase())}${
      c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''
    }</span>`;

  function renderChannels() {
    const box = $('#channels-box');
    if (!box.firstChild) {
      box.innerHTML = `<input id="ch-search" class="search" type="search" placeholder="Поиск канала" aria-label="Поиск канала">
        <div class="seg" id="ch-sort" style="margin-bottom:8px"><button type="button" data-chsort="score">По оценке</button><button type="button" data-chsort="time">По времени</button><button type="button" data-chsort="views">По просмотрам</button></div>
        <p class="muted" id="ch-summary" style="margin:0 0 10px"></p>
        <div id="ch-list"></div>`;
      keepUnchanged($('#ch-list'));
      $('#ch-search').addEventListener('input', (e) => {
        chState.q = e.target.value;
        renderChannels();
      });
      $('#ch-sort').addEventListener('click', (e) => {
        const b = e.target.closest('[data-chsort]');
        if (!b) return;
        chState.sort = b.dataset.chsort;
        renderChannels();
        window.scrollTo(0, 0);
      });
    }

    $$('#ch-sort button').forEach((b) => b.classList.toggle('on', b.dataset.chsort === chState.sort));
    const all = channelList();
    const q = chState.q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    let list = all.filter((c) => q.every((w) => c.name.toLowerCase().replace(/ё/g, 'е').includes(w)));
    const sorters = {
      // по оценке — только оценённые, выше те, у кого оценок больше; остальные — ниже, по времени
      score: (a, b) => (b.avg != null) - (a.avg != null) || (b.avg ?? -1) - (a.avg ?? -1) || b.rated.length - a.rated.length || b.min - a.min,
      time: (a, b) => b.min - a.min || b.views - a.views,
      views: (a, b) => b.views - a.views || b.min - a.min,
    };
    list = list.sort(sorters[chState.sort]).slice(0, 300);
    const rated = all.filter((c) => c.avg != null).length;
    $('#ch-summary').textContent = all.length ? `Каналов: ${all.length} · с оценками: ${rated}${db.stats?.v === 2 ? '' : ' · полный список и время придут с компьютера через Google Drive'}` : '';
    $('#ch-list').innerHTML = list.length
      ? list
          .map((c, i) => {
            const meta = [
              c.rated.length ? `${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}` : '',
              c.min ? fmtMin(c.min) : '',
              c.views ? `в истории: ${c.views}` : '',
              c.later ? `в «Позже+»: ${c.later}` : '',
              c.finishPct != null ? `досматриваете ${c.finishPct}%` : '',
            ].filter(Boolean);
            const strip = c.rated
              .slice(-24)
              .map((v) => `<i style="background:${TR.grade(v.rating.total).mark}"></i>`)
              .join('');
            return `<button type="button" class="ch-item" data-channel="${esc(c.name)}" style="--i:${Math.min(i, 10)}"><span class="ch-rank">${i + 1}</span>${chAvatar(c, 44)}<span class="vinfo"><span class="vtitle">${esc(c.name)}${TR.fameStar(fameStore(), c.name) ? '<span class="fame-mark" aria-label="На аллее славы">★</span>' : ''}</span><span class="vmeta">${meta.join(' · ') || '&nbsp;'}</span>${strip ? `<span class="ch-strip">${strip}</span>` : ''}</span>${c.avg != null ? scoreBadge(c.avg) : ''}</button>`;
          })
          .join('')
      : `<div class="empty">${all.length ? 'Ничего не нашлось.' : 'Каналы появятся, когда будут оценки или видео в «Позже+».'}</div>`;
  }

  // Аллея славы — отдельный раздел: нажатия на звёзды, «дать звезду»
  keepUnchanged($('#fame-box'));
  // Звезда крупно, с лупой: канал — в его карточку, ролик — открыть или на YouTube
  const fmtD = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  function zoomFameChannel(name) {
    const s = TR.fameStar(fameStore(), name);
    const ch = channelList().find((x) => x.name === name);
    TR.fameCloseup({
      star: fameStarHtml(name, TR.fameType(db.videos, name)),
      title: name,
      sub: [s ? `на аллее славы с ${fmtD(s.at)}` : '', ch?.avg != null ? `средняя <b style="color:${TR.grade(ch.avg).mark}">${ch.avg}</b>` : ''].filter(Boolean).join(' · '),
      actions: [{ label: 'Статистика канала →', onClick: () => openChannel(name), primary: true }, ch?.url ? { label: 'YouTube ↗', href: ch.url, target: '_blank' } : null],
    });
  }
  function zoomFameVideo(id) {
    const v = db.videos[id];
    if (!v) return;
    TR.fameCloseup({
      star: videoFameStar(v),
      title: v.title || 'Видео',
      sub: [v.star ? `на аллее славы с ${fmtD(v.star.at)}` : '', v.rating ? `оценка <b style="color:${TR.grade(v.rating.total).mark}">${v.rating.total}</b>` : '', esc(v.channel || '')].filter(Boolean).join(' · '),
      // сайт не может читать страницы YouTube (браузер не пускает), поэтому цифры — только в расширении
      extra: TR.fameVideoExtra(v.id, { note: 'Просмотры и лайки с YouTube — в расширении на компьютере' }),
      actions: [{ label: 'Открыть видео', onClick: () => openSheet(v.id), primary: true }, v.channel ? { label: 'Статистика канала →', onClick: () => openChannel(v.channel) } : null, { label: '▶ YouTube', href: TR.watchUrl(v.id), target: '_blank' }],
    });
  }
  const videoFameStar = (v) =>
    `<span class="fame-star vstar" aria-hidden="true"><span class="fs-brass"></span><span class="fs-pink"></span><span class="fs-name" style="--n:${TR.fameNameSize(v.title || 'Видео')}">${esc(v.title || 'Видео')}</span><span class="fs-medal fs-shot"><img src="${TR.thumbUrl(v.id)}" alt=""></span></span>`;
  $('#fame-box').addEventListener('click', (e) => {    const vgive = e.target.closest('[data-vstar-give]');
    if (vgive) {
      e.stopPropagation();
      setVideoStar(vgive.dataset.vstarGive, true);
      navigator.vibrate?.(14);
      toast('★ Ролик — на аллее славы');
      return renderFame();
    }
    const give = e.target.closest('[data-fame-give]');
    if (give) {
      e.stopPropagation();
      setFame(give.dataset.fameGive, give.dataset.url || '', true);
      navigator.vibrate?.(14);
      toast(`★ «${give.dataset.fameGive}» — на аллее славы`);
      return renderFame(); // кандидатов открывает общий обработчик [data-channel]
    }
  });
  // Аллея славы: звёзды любимых каналов на «мостовой», ниже — достойные звезды (высокие оценки, звезды нет)
  function fameStarHtml(name, type, cls = '') {
    return `<span class="fame-star ${cls}" aria-hidden="true"><span class="fs-brass"></span><span class="fs-pink"></span><span class="fs-name" style="--n:${TR.fameNameSize(name)}">${esc(name)}</span><span class="fs-medal">${TR.fameEmblem(type, 16)}</span></span>`;
  }
  function renderFame() {
    const list = channelList();
    const byKey = new Map(list.map((c) => [TR.fameKey(c.name), c]));
    const stars = TR.fameList(fameStore());
    const vstars = TR.starredVideos(db.videos);
    const cands = list
      .filter((c) => c.avg != null && c.avg >= 75 && c.rated.length >= 3 && !TR.fameStar(fameStore(), c.name))
      .sort((a, b) => b.avg - a.avg || b.rated.length - a.rated.length)
      .slice(0, 6);
    $('#fame-box').innerHTML = `
      <div class="fame-intro"><h2>Аллея славы</h2><p class="muted" style="font-size:13px">Любимые каналы и ролики — по звезде каждому. Ведите пальцем вверх, чтобы идти по аллее; нажмите на звезду — рассмотреть под лупой.</p></div>
      <div class="w3-host"></div>
      ${
        cands.length
          ? `<h3 class="fame-sub">Достойны звезды?</h3><p class="muted" style="font-size:13px">Высокие оценки, но звезды пока нет.</p>
        <div class="fame-cands">${cands
          .map(
            (c) => `<div class="fame-cand" data-channel="${esc(c.name)}">${chAvatar(c, 40)}<span class="fc-info"><span class="fc-name">${esc(c.name)}</span><span class="muted">средняя <b style="color:${TR.grade(c.avg).mark}">${c.avg}</b> · ${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}</span></span><button type="button" class="btn fame-btn" data-fame-give="${esc(c.name)}" data-url="${esc(c.url || '')}">★ Дать</button></div>`
          )
          .join('')}</div>`
          : ''
      }
      ${fameVideosHtml()}`;
    // Прогулка: бульвар Каналов, перекрёсток, бульвар Роликов
    const items = [
      { sign: 'бульвар Каналов' },
      ...(stars.length
        ? stars.map((s) => {
            const c = byKey.get(TR.fameKey(s.name));
            return { kind: 'ch', name: s.name, star: fameStarHtml(s.name, TR.fameType(db.videos, s.name)), title: s.name, sub: [`на аллее с ${fmtD(s.at)}`, c?.avg != null ? `средняя <b style="color:${TR.grade(c.avg).mark}">${c.avg}</b>` : ''].filter(Boolean).join(' · ') };
          })
        : [{ kind: 'slot', star: fameStarHtml('Ваш любимый канал', 'custom', 'ghost'), title: 'Здесь будет первая звезда канала' }]),
      { sign: 'бульвар Роликов' },
      ...(vstars.length
        ? vstars.map((v) => ({ kind: 'v', id: v.id, star: videoFameStar(v), title: v.title || 'Видео', sub: [v.rating ? `оценка <b style="color:${TR.grade(v.rating.total).mark}">${v.rating.total}</b>` : '', esc(v.channel || '')].filter(Boolean).join(' · ') }))
        : [{ kind: 'slot', star: fameStarHtml('Любимый ролик', 'custom', 'ghost'), title: 'Здесь будет первый ролик' }]),
    ];
    // машины в забеге за ремонтом — каналы со звёздами и те, что смотрите чаще всего
    const racers = [...stars.map((s) => byKey.get(TR.fameKey(s.name)) || { name: s.name, icon: '' }), ...list.slice().sort((a, b) => b.views + b.rated.length - (a.views + a.rated.length))]
      .filter((c, i, a) => c.name && a.findIndex((x) => TR.fameKey(x.name) === TR.fameKey(c.name)) === i)
      .slice(0, 16)
      .map((c) => ({ name: c.name, icon: c.icon || '' }));
    TR.fameWalk($('#fame-box .w3-host'), {
      items,
      racers,
      lite: true, // на телефоне — без машин и лишнего света: легче и быстрее
      onBuilt: fitFame, // улица собирается после заставки — подогнать высоту ещё раз
      onOpen: (it) =>
        it.kind === 'ch'
          ? zoomFameChannel(it.name)
          : it.kind === 'v'
            ? zoomFameVideo(it.id)
            : TR.fameCloseup({ star: it.star, title: it.title, sub: 'Дайте звезду каналу или ролику — в карточке видео или канала. Звезда появится здесь, на аллее.' }),
    });
    requestAnimationFrame(() => {
      TR.fitFameNames($('#fame-box')); // длинные имена — мельче, чтобы не выходили за звезду
      fitFame();
    });
  }
  // Аллея — ровно на экран между шапкой и нижним меню: страница на этой вкладке не листается
  function fitFame() {
    const w = $('#fame-box .w3');
    if (!w || $('#view-fame').hidden) return;
    scrollTo(0, 0);
    const bottom = document.querySelector('.tabbar')?.getBoundingClientRect().top || innerHeight;
    w.style.height = `${Math.max(300, Math.round(bottom - w.getBoundingClientRect().top - 8))}px`;
  }
  addEventListener('resize', () => setTimeout(fitFame, 80)); // после пересборки аллеи под новую ширину  // Ролики, достойные звезды: шедевры (от 85) без звезды — под прогулкой
  function fameVideosHtml() {
    const vcands = Object.values(db.videos)
      .filter((v) => v.rating && v.rating.total >= 85 && !v.star)
      .sort((a, b) => b.rating.total - a.rating.total || (b.rating.updatedAt || 0) - (a.rating.updatedAt || 0))
      .slice(0, 6);
    if (!vcands.length) return '';
    return `<h3 class="fame-sub">Ролики, достойные звезды?</h3><p class="muted" style="font-size:13px">Шедевры от 85, у которых звезды пока нет. Звезду ролику дают и в его карточке.</p>
      <div class="fame-cands">${vcands
        .map(
          (v) => `<div class="fame-cand vcand" data-open="${v.id}"><span class="fc-thumb"><img src="${TR.thumbUrl(v.id)}" alt="" loading="lazy"></span><span class="fc-info"><span class="fc-name">${esc(v.title || 'Видео ' + v.id)}</span><span class="muted"><b style="color:${TR.grade(v.rating.total).mark}">${v.rating.total}</b> · ${esc(v.channel || '')}</span></span><button type="button" class="btn fame-btn" data-vstar-give="${v.id}">★ Дать</button></div>`
        )
        .join('')}</div>`;
  }
  // Радар по критериям: фигура канала поверх ваших средних по всем видео (пунктир) — как в расширении
  function radarSvg(axes) {
    const n = axes.length;
    const S = 300;
    const c = S / 2;
    const R = 92;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const r = (v / TR.SLIDER_MAX) * R;
      return [c + Math.cos(a) * r, c + Math.sin(a) * r];
    };
    const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    let svg = '';
    for (const lvl of [2, 4, 6, 8, 10]) svg += `<polygon class="rd-ring${lvl === 10 ? ' outer' : ''}" points="${poly(axes.map(() => lvl))}"/>`;
    axes.forEach((_, i) => {
      const [x, y] = pt(i, TR.SLIDER_MAX);
      svg += `<line class="rd-axis" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    });
    if (axes.some((a) => a.base != null)) svg += `<polygon class="rd-base" points="${poly(axes.map((a) => a.base ?? 0))}"/>`;
    svg += `<polygon class="rd-shape" points="${poly(axes.map((a) => a.val ?? 0))}"/>`;
    axes.forEach((a, i) => {
      const [x, y] = pt(i, a.val);
      const col = TR.scoreMark(Math.round((a.val / TR.SLIDER_MAX) * TR.MAX_SCORE));
      svg += `<circle class="rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${col}"/>`;
    });
    axes.forEach((a, i) => {
      const [x, y] = pt(i, TR.SLIDER_MAX + 2.6);
      const anchor = Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end';
      svg += `<text class="rd-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(a.name)} <tspan class="rd-val">${String(Math.round(a.val * 10) / 10).replace('.', ',')}</tspan></text>`;
    });
    return `<svg class="radar" viewBox="-40 -10 380 320" role="img" aria-label="Средние оценки канала по критериям">${svg}</svg>`;
  }

  // Оценки канала во времени: точки цвета оценки, пунктир — среднее
  function timelineSvg(list, avg) {
    const W = 600;
    const H = 150;
    const m = { l: 10, r: 10, t: 14, b: 24 };
    const ts = list.map((v) => v.rating.updatedAt || 0);
    const t0 = Math.min(...ts);
    const span = Math.max(1, Math.max(...ts) - t0);
    const x = (t) => m.l + (list.length === 1 ? 0.5 : (t - t0) / span) * (W - m.l - m.r);
    const y = (s) => m.t + (1 - s / TR.MAX_SCORE) * (H - m.t - m.b);
    const pts = list.map((v) => [x(v.rating.updatedAt || 0), y(v.rating.total), v]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const fmtM = (t) => new Date(t).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
    return `<svg class="tl" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Оценки видео канала по времени">
      <line class="tl-avg" x1="${m.l}" x2="${W - m.r}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>
      <path class="tl-line" d="${path}"/>
      ${pts.map(([px, py, v]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="${TR.grade(v.rating.total).mark}" class="tl-dot"/>`).join('')}
      <text class="tl-t" x="${m.l}" y="${H - 6}">${fmtM(t0)}</text><text class="tl-t" x="${W - m.r}" y="${H - 6}" text-anchor="end">${fmtM(t0 + span)}</text>
    </svg>`;
  }

  // Профиль канала — в том же листе снизу, что и видео
  function openChannel(name) {
    const c = channelList().find((x) => x.name === name);
    if (!c) return;
    const s = settings();
    sheet.id = null;
    const mean = (list, id) => {
      const xs = list.map((v) => v.rating.scores?.[id]).filter((x) => typeof x === 'number');
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const allRated = Object.values(db.videos).filter((v) => v.rating);
    // Оси — критерии, по которым канал оценивали: сначала общие для всех типов, потом самые частые
    const acc = {};
    for (const v of c.rated) for (const [id, x] of Object.entries(v.rating.scores)) if (typeof x === 'number') ((acc[id] ||= { id, sum: 0, n: 0 }).sum += x), acc[id].n++;
    const axes = Object.values(acc)
      .sort((a, b) => TR.COMMON_CRITERIA.includes(b.id) - TR.COMMON_CRITERIA.includes(a.id) || b.n - a.n)
      .slice(0, 6)
      .map((x) => ({ id: x.id, name: TR.critName(x.id, s), val: x.sum / x.n, base: mean(allRated, x.id) }));
    const strong = axes.slice().sort((a, b) => b.val - a.val)[0];
    const weak = axes.slice().sort((a, b) => a.val - b.val)[0];
    const fmt1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    const chart = axes.length >= 3 ? radarSvg(axes) : axes.length ? `<div class="crit-bars">${axes.map((a) => critBar(a.name, Math.round(a.val * 10) / 10)).join('')}</div>` : '';
    let trend = '';
    if (c.rated.length >= 4) {
      const half = Math.floor(c.rated.length / 2);
      const a1 = c.rated.slice(0, half).reduce((x, v) => x + v.rating.total, 0) / half;
      const a2 = c.rated.slice(half).reduce((x, v) => x + v.rating.total, 0) / (c.rated.length - half);
      const d = Math.round(a2 - a1);
      trend = Math.abs(d) < 3 ? 'Канал держит уровень.' : d > 0 ? `Канал растёт: новые видео в среднем на <b>${d}</b> выше прежних.` : `Канал проседает: новые видео в среднем на <b>${-d}</b> ниже прежних.`;
    }
    const best = c.rated.slice().sort((a, b) => b.rating.total - a.rating.total).slice(0, 3);
    const later = Object.values(db.videos).filter((v) => v.channel === name && v.later && !v.watchedAt).sort((a, b) => b.later.priority - a.later.priority);
    const notes = Object.values(db.videos).filter((v) => v.channel === name && (v.note || v.moments?.length)).sort((a, b) => (b.noteAt || 0) - (a.noteAt || 0)).slice(0, 4);
    const reasons = Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => TR.dropReason(r).label.toLowerCase());
    const meta = [
      c.min ? `смотрели ${fmtMin(c.min)}` : '',
      c.views ? `видео в истории: ${c.views}` : '',
      c.rated.length ? `${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}` : 'оценок пока нет',
      c.finishPct != null ? `досматриваете ${c.finishPct}%` : '',
      c.dropped ? `бросили ${c.dropped}: ${reasons.join(', ')}` : '',
    ].filter(Boolean);
    const g = c.avg != null ? TR.grade(c.avg) : null;
    $('#sheet-body').innerHTML = `
      <button type="button" class="sh-close" data-sh="close" aria-label="Закрыть">✕</button>
      <div class="ch-head">${chAvatar(c, 64)}<div><h2 id="sh-title">${esc(c.name)}</h2><div class="muted">${meta.join(' · ')}</div></div></div>
      ${(() => {
        const star = TR.fameStar(fameStore(), c.name);
        return `<div class="sh-sec"><button type="button" class="btn fame-btn wide${star ? ' on' : ''}" data-fame-ch="${esc(c.name)}" data-url="${esc(c.url || '')}">${star ? `★ На аллее славы с ${new Date(star.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : '☆ Звезда на аллее славы'}</button></div>`;
      })()}
      ${(() => {
        const lists = TR.playlistList(plStore());
        if (!lists.length) return '';
        const k = TR.fameKey(c.name);
        return `<div class="sh-sec"><span class="sh-label">В плейлистах</span><div class="chips">${lists
          .map((p) => `<button type="button" class="chip${p.channels?.[k] ? ' on' : ''}" data-chpl="${p.id}" data-chname="${esc(c.name)}" data-url="${esc(c.url || '')}">${esc(p.emoji || '')} ${esc(p.name)}</button>`)
          .join('')}</div></div>`;
      })()}
      ${g ? `<div class="sh-sec rate-top">${ringSvg(c.avg, 84)}<div><span class="grade${g.perfect ? ' perfect' : ''}" style="background:${g.color};--g:${g.color}">${g.perfect ? '★ ' : ''}${g.label}</span><div class="muted" style="margin-top:6px">средняя оценка канала</div></div></div>` : ''}
      ${
        chart
          ? `<div class="sh-sec"><span class="sh-label">Сильные и слабые стороны</span>${chart}
              ${axes.length >= 3 ? '<div class="rd-legend"><span><i class="sw-shape"></i>этот канал</span><span><i class="sw-base"></i>все ваши оценки</span></div>' : ''}
              ${strong ? `<p class="muted rd-sum">Сильнее всего — <b>${esc(strong.name)}</b> ${fmt1(strong.val)}${weak && weak !== strong ? `, слабее всего — <b>${esc(weak.name)}</b> ${fmt1(weak.val)}` : ''}.</p>` : ''}</div>`
          : ''
      }
      ${c.rated.length >= 2 ? `<div class="sh-sec"><span class="sh-label">Оценки во времени</span>${timelineSvg(c.rated, c.avg)}${trend ? `<p class="muted rd-sum">${trend}</p>` : ''}</div>` : ''}
      ${best.length ? `<div class="sh-sec"><span class="sh-label">Лучшее</span>${best.map((v) => card(v, false)).join('')}</div>` : ''}
      ${notes.length ? `<div class="sh-sec"><span class="sh-label">Ваши отзывы и моменты</span>${notes.map((v) => card(v, false, v.note ? `«${v.note.slice(0, 60)}${v.note.length > 60 ? '…' : ''}»` : `моментов: ${v.moments.length}`)).join('')}</div>` : ''}
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
  // Время просмотра приходит с компьютера через Google Drive: сводка по дням (с историей YouTube с других
  // устройств), часам, каналам и видео, «Интересные факты» — то же, что в статистике расширения. Оценки — свои.
  const stState = { range: 30, mode: 'month', off: 0, open: new Set() };
  const RANGES = [
    [7, '7 дней'],
    [30, '30 дней'],
    [90, '90 дней'],
    [365, 'Год'],
    [0, 'Всё время'],
  ];
  const keyOf = (d) => TR.dateKey(d);
  const dayBack = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  };
  const statDays = () => db.stats?.days || {};
  const dayMin = (k) => {
    const d = statDays()[k];
    return d ? (d[0] || 0) + (d[1] || 0) : 0;
  };
  // Серия дней подряд с YouTube (как на компьютере); без сводки с компьютера — по дням с оценками
  function youtubeStreak() {
    const days = statDays();
    const keys = Object.keys(days).filter((k) => dayMin(k) > 0).sort();
    if (!keys.length) return null;
    let cur = 0;
    for (let i = dayMin(keyOf(dayBack(0))) ? 0 : 1; dayMin(keyOf(dayBack(i))); i++) cur++;
    let best = 1;
    let run = 1;
    for (let i = 1; i < keys.length; i++) {
      const gap = Math.round((new Date(keys[i] + 'T12:00:00') - new Date(keys[i - 1] + 'T12:00:00')) / 86400000);
      run = gap === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return { cur, best };
  }

  // Горизонтальные полоски с подписью: первые 8, остальное — «Показать все»
  function hbars(id, rows) {
    const open = stState.open.has(id);
    const max = Math.max(1, ...rows.map((r) => r.value));
    const shown = open ? rows : rows.slice(0, 8);
    return (
      `<div class="hbars">${shown
        .map(
          (r, i) => `<div class="hb${r.channel ? ' hb-link' : ''}" ${r.channel ? `data-channel="${esc(r.channel)}"` : r.video ? `data-open="${r.video}"` : ''} style="--i:${Math.min(i, 10)}">
            ${r.lead || ''}<span class="hb-body"><span class="hb-top"><span class="hb-name">${esc(r.name)}</span><b>${r.label}</b></span>
            <span class="hb-track"><span style="width:${Math.max(2, (r.value / max) * 100).toFixed(1)}%;${r.color ? `background:${r.color}` : ''}"></span></span>${r.sub ? `<span class="hb-sub">${r.sub}</span>` : ''}</span></div>`
        )
        .join('')}</div>` + (rows.length > 8 ? `<button type="button" class="link-btn more" data-more="${id}">${open ? 'Свернуть' : `Показать все (${rows.length})`}</button>` : '')
    );
  }

  function renderStats() {
    const S = db.stats || {};
    const v2 = S.v === 2;
    const days = statDays();
    const has = Object.keys(days).length > 0;
    const range = stState.range;
    const wi = WIN[range];
    const today = keyOf(dayBack(0));
    const firstKey = Object.keys(days).sort()[0] || today;
    const span = range || Math.max(1, Math.round((new Date(today + 'T12:00:00') - new Date(firstKey + 'T12:00:00')) / 86400000) + 1);
    const keys = Array.from({ length: span }, (_, i) => keyOf(dayBack(span - 1 - i)));
    const rMin = keys.reduce((a, k) => a + dayMin(k), 0);
    const rEst = keys.reduce((a, k) => a + (days[k]?.[1] || 0), 0);
    const rViews = keys.reduce((a, k) => a + (days[k]?.[2] || 0), 0);
    const active = keys.filter((k) => dayMin(k) > 0).length;
    const st = youtubeStreak();
    const ratedBy = ratedDays();
    const approx = rEst > rMin / 2 ? '≈ ' : '';

    // Кинолента: до 90 дней — по дням, год — по неделям, всё время — по месяцам
    const groups = [];
    if (span <= 90) for (const k of keys) groups.push({ keys: [k], label: new Date(k + 'T12:00:00').getDate(), title: new Date(k + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) });
    else if (range === 365) for (let i = 0; i < keys.length; i += 7) groups.push({ keys: keys.slice(i, i + 7), label: '', title: `неделя с ${new Date(keys[i] + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` });
    else {
      const byM = {};
      for (const k of keys) (byM[k.slice(0, 7)] ||= []).push(k);
      for (const [m, ks] of Object.entries(byM)) groups.push({ keys: ks, label: '', title: new Date(m + '-15T12:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) });
    }
    const gMin = groups.map((g) => g.keys.reduce((a, k) => a + dayMin(k), 0));
    const maxG = Math.max(30, ...gMin);
    const every = Math.max(1, Math.ceil(groups.length / 6));
    const film = groups
      .map((g, i) => {
        const r = g.keys.flatMap((k) => ratedBy[k] || []);
        const avg = r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null;
        const h = gMin[i] ? Math.max(4, Math.round((gMin[i] / maxG) * 100)) : 0;
        const lbl = g.label !== '' && i % every === every - 1 ? `<small>${g.label}</small>` : '';
        return `<div class="fm-col" title="${g.title}: ${gMin[i] ? fmtMin(gMin[i]) : 'без YouTube'}"><span style="height:${h}%;--d:${i};background:${avg != null ? TR.scoreMark(avg) : 'var(--violet-line)'}"></span>${lbl}</div>`;
      })
      .join('');

    // Каналы и видео за период
    const chans = channelList();
    const topCh = chans
      .filter((c) => c.mins[wi] > 0)
      .sort((a, b) => b.mins[wi] - a.mins[wi])
      .map((c) => ({ name: c.name, channel: c.name, value: c.mins[wi], label: fmtMin(c.mins[wi]), lead: chAvatar(c, 32), sub: c.avg != null ? `в среднем ${c.avg}` : '' }));
    const worth = chans
      .filter((c) => c.rated.length >= 2 && c.mins[wi] > 0)
      .sort((a, b) => b.mins[wi] - a.mins[wi])
      .map((c) => {
        const bad = c.avg < 50;
        return { name: c.name, channel: c.name, value: c.mins[wi], label: `${fmtMin(c.mins[wi])} · ${c.avg}`, lead: chAvatar(c, 32), color: TR.scoreMark(c.avg), sub: bad ? 'много времени — низкая оценка' : `${c.rated.length} ${plural(c.rated.length, 'оценка', 'оценки', 'оценок')}` };
      });
    const topVid = (S.topVideos?.[wi] || []).map(([id, title, channel, min]) => ({
      name: db.videos[id]?.title || title || 'Видео ' + id,
      video: id,
      value: min,
      label: fmtMin(min),
      lead: `<img class="hb-thumb" src="${TR.thumbUrl(id)}" alt="" loading="lazy">`,
      sub: esc(channel || ''),
    }));
    // По часам суток и дням недели
    const hrs = Array(24).fill(0);
    const wd = Array(7).fill(0);
    for (const k of keys) {
      (S.hours?.[k] || []).forEach((n, h) => (hrs[h] += n || 0));
      const v = days[k]?.[2] || 0;
      wd[(new Date(k + 'T12:00:00').getDay() + 6) % 7] += v || (v2 ? 0 : dayMin(k));
    }
    const vbars = (vals, labels, every2) => {
      const mx = Math.max(1, ...vals);
      return `<div class="vbars">${vals.map((n, i) => `<div class="vb" title="${labels[i]}: ${n}"><span style="height:${n ? Math.max(4, (n / mx) * 100) : 0}%;--d:${i}"></span><small>${i % every2 === 0 ? labels[i] : ''}</small></div>`).join('')}</div>`;
    };
    const hourLabels = hrs.map((_, h) => String(h));
    const topHour = hrs.indexOf(Math.max(...hrs));
    const wdNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    // Итоги месяца или года
    const now = new Date();
    const start = stState.mode === 'year' ? new Date(now.getFullYear() + stState.off, 0, 1, 12) : new Date(now.getFullYear(), now.getMonth() + stState.off, 1, 12);
    const prefix = stState.mode === 'year' ? String(start.getFullYear()) : keyOf(start).slice(0, 7);
    const inP = (ts) => ts && keyOf(new Date(ts)).startsWith(prefix);
    const pKeys = Object.keys(days).filter((k) => k.startsWith(prefix));
    const pMin = pKeys.reduce((a, k) => a + dayMin(k), 0);
    const V = Object.values(db.videos);
    const pRated = V.filter((v) => v.rating && inP(v.rating.updatedAt));
    const pAvg = pRated.length ? Math.round(pRated.reduce((a, v) => a + v.rating.total, 0) / pRated.length) : null;
    const pBest = pRated.slice().sort((a, b) => b.rating.total - a.rating.total || b.rating.updatedAt - a.rating.updatedAt)[0];
    const moments = V.reduce((n, v) => n + (v.moments || []).filter((m) => inP(m.at)).length, 0);
    const pDropped = V.filter((v) => v.dropped && inP(v.dropped.at)).length;
    const title = stState.mode === 'year' ? `${start.getFullYear()}` : start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
    const first = [...Object.keys(days), ...V.filter((v) => v.rating).map((v) => keyOf(new Date(v.rating.updatedAt)))].sort()[0] || keyOf(now);
    const canBack = (stState.mode === 'year' ? first.slice(0, 4) : first.slice(0, 7)) < prefix;
    // Канал периода — больше всего времени (по сводке), иначе больше всего оценок
    const pChTime = {};
    if (v2 && stState.off === 0) for (const c of chans) if (c.mins[stState.mode === 'year' ? 3 : 1] > 0) pChTime[c.name] = c.mins[stState.mode === 'year' ? 3 : 1];
    const byCh = {};
    for (const v of pRated) if (v.channel) byCh[v.channel] = (byCh[v.channel] || 0) + 1;
    const pTopCh = Object.entries(Object.keys(pChTime).length ? pChTime : byCh).sort((a, b) => b[1] - a[1])[0];

    const rangeSeg = `<div class="seg seg-scroll" style="margin-bottom:12px">${RANGES.map(([n, l]) => `<button type="button" data-range="${n}" class="${range === n ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    $('#stats-box').innerHTML = `
      ${rangeSeg}
      ${
        has
          ? `<div class="stat-tiles">
              <div class="card st"><span>На YouTube</span><b data-count>${approx}${fmtMin(rMin)}</b></div>
              <div class="card st"><span>В среднем в день</span><b>${fmtMin(Math.round(rMin / span))}</b></div>
              <div class="card st"><span>${v2 && rViews ? 'Видео' : 'Дней с YouTube'}</span><b>${v2 && rViews ? rViews : active}</b></div>
            </div>
            <div class="card"><div class="wk-top">${st?.cur ? `<span class="wk-streak">${fireNum(st.cur)}</span><span>${plural(st.cur, 'день', 'дня', 'дней')} подряд с YouTube</span>` : '<span class="muted">Серия начнётся с первого дня с YouTube</span>'}<span class="spacer"></span><span class="muted">рекорд ${st?.best || 0}</span></div>
              <span class="sh-label" style="margin-top:12px">Кинолента · ${RANGES.find((r) => r[0] === range)[1].toLowerCase()}</span><div class="film">${film}</div>
              <p class="muted" style="margin:8px 0 0">Высота — сколько смотрели, цвет — средняя оценка оценённого за ${span <= 90 ? 'день' : range === 365 ? 'неделю' : 'месяц'}.</p></div>
            ${worth.length ? `<div class="card"><h2>Стоит ли времени</h2><p class="muted">Каналы с двумя и больше оценками: сколько времени ушло за период и как вы их оцениваете.</p>${hbars('worth', worth)}</div>` : ''}
            ${topCh.length ? `<div class="card"><h2>Каналы, на которые ушло больше всего времени</h2>${hbars('topch', topCh)}</div>` : ''}
            ${topVid.length ? `<div class="card"><h2>Видео, на которые ушло больше всего времени</h2>${hbars('topvid', topVid)}</div>` : ''}
            ${hrs.some(Boolean) ? `<div class="card"><h2>По часам суток</h2>${vbars(hrs, hourLabels, 3)}<p class="muted" style="margin:8px 0 0">Чаще всего начинаете смотреть в ${topHour}:00–${topHour + 1}:00.</p></div>` : ''}
            ${wd.some(Boolean) ? `<div class="card"><h2>По дням недели</h2>${vbars(wd, wdNames, 1)}</div>` : ''}`
          : `<div class="card"><h2>Время просмотра</h2><p class="muted" style="margin:0">Время приходит с компьютера: подключите Google Drive в расширении («Настройки» → «История и синхронизация») и здесь (⚙ сверху). На телефоне его не посчитать — смотрите вы в приложении YouTube.</p></div>`
      }
      <div class="card">
        <div class="recap-head"><h2>${stState.off === 0 ? (stState.mode === 'year' ? 'Этот год' : 'Этот месяц') : 'Итоги'} · ${title}</h2>
          <div class="nav2"><button type="button" data-st="-1" aria-label="Раньше" ${canBack ? '' : 'disabled'}>‹</button><button type="button" data-st="1" aria-label="Позже" ${stState.off >= 0 ? 'disabled' : ''}>›</button></div></div>
        <div class="seg" style="margin:10px 0 12px"><button type="button" data-stmode="month" class="${stState.mode === 'month' ? 'on' : ''}">Месяц</button><button type="button" data-stmode="year" class="${stState.mode === 'year' ? 'on' : ''}">Год</button></div>
        <div class="stats">
          <div><b>${has ? fmtMin(pMin) : '—'}</b><span>на YouTube${has ? ` · дней ${pKeys.length}` : ''}</span></div>
          <div><b>${pRated.length}</b><span>оценено${pAvg != null ? ` · в среднем ${pAvg}` : ''}</span></div>
          <div><b>${moments} · ${pDropped}</b><span>моментов · брошено</span></div>
        </div>
        ${pBest ? `<span class="sh-label" style="margin-top:14px">Видео ${stState.mode === 'year' ? 'года' : 'месяца'}</span>${card(pBest, false)}` : ''}
        ${pTopCh ? `<span class="sh-label" style="margin-top:10px">Канал ${stState.mode === 'year' ? 'года' : 'месяца'}</span><button type="button" class="ch-item" data-channel="${esc(pTopCh[0])}">${chAvatar(chans.find((c) => c.name === pTopCh[0]) || { name: pTopCh[0] }, 44)}<span class="vinfo"><span class="vtitle">${esc(pTopCh[0])}</span><span class="vmeta">${Object.keys(pChTime).length ? fmtMin(pTopCh[1]) : `${pTopCh[1]} ${plural(pTopCh[1], 'оценка', 'оценки', 'оценок')}`}</span></span></button>` : ''}
      </div>
      ${
        S.facts?.length
          ? `<div class="card"><h2>Интересные факты <span class="muted">· за всё время</span></h2><div class="facts">${S.facts
              .map((f) => `<div class="fact"><span class="fact-ico">${esc(f.icon)}</span><span><span class="fact-k">${esc(f.k)}</span><b>${esc(f.v)}</b><span class="fact-d">${esc(f.d)}</span></span></div>`)
              .join('')}</div></div>`
          : ''
      }`;
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-range]');
    if (r) {
      stState.range = Number(r.dataset.range);
      stState.open.clear();
      return renderStats();
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      const id = more.dataset.more;
      if (stState.open.has(id)) stState.open.delete(id);
      else stState.open.add(id);
      return renderStats();
    }
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
    if (view === 'fame') renderFame();
    for (const name of ['home', 'fame', 'later', 'ratings', 'channels', 'stats', 'data']) $('#view-' + name).hidden = view !== name;
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    renderRelogin();
  }

  // ---------- Лист видео ----------
  const sheet = { id: null, type: null, picked: null, scores: {}, skip: new Set(), shareT: 0 };
  const sheetEl = $('#sheet');

  // Закрытие листа — уезжает вниз и гаснет, потом закрывается
  let sheetClosing = false;
  function closeSheet() {
    if (!sheetEl.open || sheetClosing) return;
    sheetClosing = true;
    sheetEl.classList.add('closing');
    setTimeout(() => {
      sheetEl.classList.remove('closing', 'full');
      sheetEl.style.transform = '';
      sheetEl.close();
      sheetClosing = false;
    }, 220);
  }

  // Полоска сверху листа: тянуть вниз — закрыть, вверх — развернуть на весь экран
  const drag = { y0: null, dy: 0 };
  sheetEl.addEventListener(
    'touchstart',
    (e) => {
      const onGrip = e.target.closest('.sheet-grip, .sh-head, .ch-head');
      drag.y0 = onGrip || sheetEl.scrollTop <= 0 ? e.touches[0].clientY : null;
      drag.grip = !!onGrip;
      drag.dy = 0;
    },
    { passive: true }
  );
  sheetEl.addEventListener(
    'touchmove',
    (e) => {
      if (drag.y0 == null) return;
      drag.dy = e.touches[0].clientY - drag.y0;
      if (drag.dy > 0 && (drag.grip || sheetEl.scrollTop <= 0)) {
        e.preventDefault();
        sheetEl.style.transition = 'none';
        sheetEl.style.transform = `translateY(${drag.dy}px)`;
      } else if (drag.dy < -50 && drag.grip) {
        sheetEl.classList.add('full');
      }
    },
    { passive: false }
  );
  sheetEl.addEventListener('touchend', () => {
    if (drag.y0 == null) return;
    sheetEl.style.transition = '';
    if (drag.dy > 110) closeSheet();
    else sheetEl.style.transform = '';
    drag.y0 = null;
  });
  // Нажатие на полоску — развернуть или свернуть
  sheetEl.addEventListener('click', (e) => {
    if (e.target.closest('.sheet-grip')) sheetEl.classList.toggle('full');
  });

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
      ${sheetPlaylists(v)}

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
        <div class="row" style="margin-top:14px"><button type="button" class="btn primary" data-sh="save">Сохранить оценку</button>${v.rating ? '<button type="button" class="btn" data-sh="unrate">Удалить</button>' : TR.awaitingRating(v) ? '<button type="button" class="btn" data-sh="norate" title="Убрать из «Ждут оценки»">Не оценивать</button>' : ''}</div>
        <button type="button" class="btn fame-btn wide${v.star ? ' on' : ''}" data-sh="vstar" style="margin-top:10px">${v.star ? '★ Ролик на аллее славы' : '☆ Звезда ролику — если прям очень зашёл'}</button>
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

  // Плейлисты в листе видео: одно нажатие — добавить или убрать; «＋ Новый» — создать и сразу добавить
  function sheetPlaylists(v) {
    const lists = TR.playlistList(plStore());
    const chips = lists
      .map((p) => {
        const on = !!v.pl && p.id in v.pl;
        return `<button type="button" class="chip${on ? ' on' : ''}" data-pltog="${p.id}" aria-pressed="${on}">${on ? '✓' : '＋'} ${esc(p.emoji || '')} ${esc(p.name)}</button>`;
      })
      .join('');
    const next = Object.keys(v.pl || {})
      .map((k) => ({ p: plStore().lists[k], n: TR.playlistNext(db.videos, k, v.id) }))
      .find((x) => x.p && !x.p.del && x.n);
    return `<div class="sh-sec">
      <span class="sh-label">Плейлисты</span>
      <div class="chips">${chips}<button type="button" class="chip ghost" data-sh="plnew">＋ Новый</button></div>
      <form id="sh-pl-form" class="pl-new" hidden><input id="sh-pl-name" maxlength="60" placeholder="Название плейлиста" enterkeyhint="done" aria-label="Название нового плейлиста"><button type="submit" class="btn primary">Создать</button></form>
      ${next ? `<button type="button" class="pl-next" data-plnext="${next.n.id}">Дальше в ${esc(next.p.emoji || '')} «${esc(next.p.name)}»: <b>${esc(next.n.title || 'видео')}</b> →</button>` : ''}
    </div>`;
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
    ge.style.setProperty('--g', g ? g.color : 'transparent');
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
      if (e.target === sheetEl) closeSheet(); // нажатие на затемнение
      return;
    }
    const id = sheet.id;
    if (b.dataset.prio != null) {
      sheet.autoAdded = false; // важность выбрали сами — больше не трогаем
      const removing = !Number(b.dataset.prio) && !!video(id).later;
      const undo = removing ? undoVideo(id, ['later']) : null;
      setLater(id, Number(b.dataset.prio));
      if (undo) undoToast('Убрано из «Смотреть позже+»', () => (undo(), sheetEl.open && sheet.id === id && renderSheet()));
      else toast(Number(b.dataset.prio) ? 'В «Смотреть позже+»' : 'Убрано из списка');
      renderSheet();
      return render();
    }
    if (b.dataset.type) {
      sheet.type = sheet.picked = b.dataset.type;
      return renderSheet();
    }
    if (b.dataset.fameCh) {
      const name = b.dataset.fameCh;
      const has = !!TR.fameStar(fameStore(), name);
      const k = TR.fameKey(name);
      const was = has ? JSON.parse(JSON.stringify(fameStore().stars[k])) : null;
      setFame(name, b.dataset.url || '', !has);
      navigator.vibrate?.(has ? 8 : 16);
      if (was)
        undoToast(`Звезда канала «${name}» снята`, () => {
          fameStore().stars[k] = was;
          if (sheetEl.open && !sheet.id) openChannel(name);
        });
      else toast(`★ «${name}» — на аллее славы`);
      openChannel(name); // перерисовать карточку канала
      return render();
    }
    if (b.dataset.chpl) {
      // канал — в плейлист ссылкой (из карточки канала)
      const on = plChannelSet(b.dataset.chpl, b.dataset.chname, b.dataset.url || '', null);
      b.classList.toggle('on', on);
      navigator.vibrate?.(8);
      toast(on ? 'Канал добавлен в плейлист' : 'Канал убран из плейлиста');
      return render();
    }
    if (b.dataset.pltog) {
      const p = plStore().lists[b.dataset.pltog];
      const undo = video(id).pl && b.dataset.pltog in video(id).pl ? undoVideo(id, ['pl']) : null;
      const on = plToggle(id, b.dataset.pltog);
      navigator.vibrate?.(8);
      if (!on && undo) undoToast(`Убрано из «${p.name}»`, () => (undo(), sheetEl.open && sheet.id === id && renderSheet()));
      else toast(on ? `Добавлено в «${p.name}»` : `Убрано из «${p.name}»`);
      renderSheet();
      return render();
    }
    if (b.dataset.plnext) {
      saveNoteIfChanged();
      return openSheet(b.dataset.plnext);
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
        closeSheet();
        break;
      case 'vstar': {
        const undo = video(id).star ? undoVideo(id, ['star']) : null;
        const on = setVideoStar(id);
        navigator.vibrate?.(on ? 16 : 8);
        if (!on && undo) undoToast('Звезда ролика снята', () => (undo(), sheetEl.open && sheet.id === id && renderSheet()));
        else toast('★ Ролик — на аллее славы');
        renderSheet();
        render();
        break;
      }      case 'plnew': {
        const f = $('#sh-pl-form');
        f.hidden = false;
        b.hidden = true;
        $('#sh-pl-name').focus();
        break;
      }
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
        closeSheet();
        render();
        break;
      }
      case 'unrate': {
        const undo = undoVideo(id, ['rating']);
        rate(id, {});
        closeSheet();
        render();
        undoToast('Оценка удалена', undo);
        break;
      }
      case 'norate': {
        const undo = undoVideo(id, ['noRate']);
        video(id).noRate = Date.now(); // убрать из «Ждут оценки» — уйдёт и на компьютер
        save();
        closeSheet();
        render();
        undoToast('Убрано из «Ждут оценки»', undo);
        break;
      }
    }
  });
  sheetEl.addEventListener('submit', (e) => {
    if (e.target.id !== 'sh-pl-form') return;
    e.preventDefault();
    const name = $('#sh-pl-name').value.trim();
    if (!name || !sheet.id) return $('#sh-pl-name').focus();
    plCreate(name, sheet.id);
    toast(`Добавлено в новый плейлист «${name}»`);
    renderSheet();
    render();
  });
  sheetEl.addEventListener('close', () => {
    saveNoteIfChanged();
    sheet.id = null;
    render();
  });

  // ---------- Обмен файлами с компьютером ----------
  // Храним только то, что нужно на телефоне: оценки, список, отзывы, «бросили», начатое — без статистики по дням.
  const KEEP = ['id', 'title', 'channel', 'channelUrl', 'duration', 'short', 'live', 'rating', 'ratingDel', 'later', 'laterDel', 'note', 'noteAt', 'moments', 'watchedAt', 'watchedUpd', 'watchedBy', 'dropped', 'droppedDel', 'noRate', 'resumeHidden', 'pl', 'plAt', 'star', 'starDel'];
  function slim(v) {
    const o = {};
    for (const k of KEEP) if (v[k] != null) o[k] = v[k];
    if (v.watch) o.watch = { real: v.watch.real, position: v.watch.position, maxProgress: v.watch.maxProgress, lastAt: v.watch.lastAt, remote: v.watch.remote };
    return o;
  }
  const worthKeeping = (v) => TR.worthSyncing(v);

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
      renderRelogin();
      return;
    }
    driveBusy = true;
    try {
      const r = await TR.driveSync(drive.token, db.videos, { settings: db.settings, playlists: plStore(), fame: fameStore() });
      for (const [id, v] of Object.entries(r.changes)) db.videos[id] = TR.slimVideo(v);
      if (r.playlists) db.playlists = r.playlists; // плейлисты с компьютера (или их переименование, удаление)
      if (r.fame) db.fame = r.fame; // аллея славы с компьютера
      if (r.remoteCriteria) db.settings.criteria = r.remoteCriteria;
      if (r.remoteStats) db.stats = r.remoteStats; // время по дням и каналам — с компьютера
      save(false);
      drive = { ...drive, needLogin: false, error: '', at: Date.now(), received: Object.keys(r.changes).length, total: r.total };
      sessionStorage.removeItem('smotribelno:silent');
      if (Object.keys(r.changes).length || r.playlists || r.fame) render();
    } catch (e) {
      drive = { ...drive, error: e.message, at: Date.now(), needLogin: !!e.auth };
      if (e.auth) drive.token = null;
    } finally {
      driveBusy = false;
      saveDrive();
      if (view === 'data') renderData();
      renderRelogin();
    }
  }

  // Google Диск отключился — уведомление на весь экран. «Позже» прячет до следующего сбоя (время именно этой ошибки).
  function renderRelogin() {
    let later = null;
    try {
      later = sessionStorage.getItem('smotribelno:relogin-later');
    } catch {
      later = null;
    }
    const show = !!drive.on && !!drive.needLogin && !!TR.GOOGLE_CLIENT_ID && later !== String(drive.at || '');
    $('#relogin').hidden = !show;
  }
  $('#relogin-go').addEventListener('click', () => driveLogin(true));
  $('#relogin-later').addEventListener('click', () => {
    try {
      sessionStorage.setItem('smotribelno:relogin-later', String(drive.at || ''));
    } catch {
      // не критично
    }
    $('#relogin').hidden = true;
  });

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
      if (dy <= 0 || window.scrollY > 0 || dnd.active) {
        // тянем карточку в «Позже+» — это не жест обновления
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
    t.classList.remove('leaving');
    t.hidden = false;
    clearTimeout(toastTimer);
    // уходит плавно: сначала гаснет, потом прячется
    toastTimer = setTimeout(() => {
      t.classList.add('leaving');
      toastTimer = setTimeout(() => (t.hidden = true), 260);
    }, 2200);
  }

  // Разделы: нижнее меню, название сверху (→ главная), «весь список» на главной
  // Переход: новый раздел въезжает с той стороны, куда перешли по нижнему меню, и проявляется
  const ORDER = ['home', 'fame', 'later', 'ratings', 'channels', 'stats', 'data'];
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
    sec.classList.remove('enter-r', 'enter-l', 'entering');
    void sec.offsetWidth; // перезапуск анимации
    sec.classList.add('enter-' + dir);
    markEntering(sec);
  });
  // Клавиатура открыта (фокус в поле ввода) — нижнее меню прячем, чтобы iPhone не тащил его над клавиатурой
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type="range"]):not([type="checkbox"]), textarea')) document.body.classList.add('kb-open');
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.('input:not([type="range"]), textarea')) document.body.classList.remove('kb-open');
  }, 50));

  // Появление карточек лесенкой — только при входе в раздел
  let enterTimer = null;
  function markEntering(sec) {
    sec.classList.add('entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => sec.classList.remove('entering'), 900);
  }
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
  markEntering($('#view-' + view));
  const shared = location.search.includes('url=') || location.search.includes('text=');
  handleShare();
  // При открытии — синхронизация; если токен истёк, тихий вход (кроме открытия через «Поделиться», чтобы не потерять ссылку)
  const silentBounce = !!sessionStorage.getItem('smotribelno:silent');
  if (drive.on) syncDrive({ allowRedirect: !shared && !backFromGoogle });
  if (backFromGoogle && !silentBounce) toast(drive.token ? 'Google Drive подключён — синхронизирую' : drive.error || 'Вход не завершён');
  setupUpdates();
})();