/* Tilth resident portal. Hash-routed single page, no build step. */
(function () {
  'use strict';

  const { h, svg, api, fmt, toast, clear, OUTCOME, FLAG_TEXT } = T;
  const $ = (id) => document.getElementById(id);

  const state = { profile: null, unread: 0, live: false, es: null, route: 'home', renderToken: 0 };

  const BADGE_MARK = { FIRST_LOOP: '1', CLEAN_5: '5', CLEAN_25: '25', STREAK_7: '7d', STREAK_30: '30d', KG_50: '50', KG_250: '250', HEAVY_LIFT: '3+', PERFECT: '100', SECOND_CHANCE: '2nd', LEVEL_5: 'L5', TRUSTED: '750' };

  /* ---------- small utilities ---------- */

  function countUp(el, to, ms = 900, prefix = '') {
    if (T.reducedMotion || !to) {
      el.textContent = prefix + fmt.num(to);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      el.textContent = prefix + fmt.num(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const chip = (text, tone) => h('span', { class: `chip ${tone || ''}` }, text);
  const outcomeChip = (o) => chip(OUTCOME[o].label, { good: 'good', warn: 'warn', bad: 'bad', neutral: '' }[OUTCOME[o].tone]);

  function field(label, input, hint) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  }

  /* ---------- sheet (modal) ---------- */

  function openSheet(node, tone = '') {
    const sheet = $('sheet');
    sheet.className = tone ? `sheet-tone-${tone}` : '';
    clear(sheet).append(node);
    if (!sheet.open) sheet.showModal();
  }
  const closeSheet = () => $('sheet').open && $('sheet').close();

  /* ---------- auth ---------- */

  function showAuth() {
    stopStream();
    state.profile = null;
    let mode = 'in';
    const app = clear($('app'));
    const err = h('div', { class: 'error', role: 'alert' });
    const form = h('form', { novalidate: true });
    const tabs = h('div', { class: 'tabs', role: 'tablist' });

    function draw() {
      clear(tabs).append(
        ...[['in', 'Sign in'], ['up', 'Create account']].map(([m, label]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === m), on: { click: () => { mode = m; err.textContent = ''; draw(); } } }, label)
        )
      );
      const email = h('input', { type: 'email', autocomplete: 'email', required: true });
      const pass = h('input', { type: 'password', autocomplete: mode === 'in' ? 'current-password' : 'new-password', required: true });
      const name = h('input', { type: 'text', autocomplete: 'nickname', maxLength: 32 });
      const submit = h('button', { class: 'btn', type: 'submit' }, mode === 'in' ? 'Sign in' : 'Create account');
      clear(form).append(
        mode === 'up' ? field('Display name', name, 'Shown on the leaderboard. Use a nickname if you prefer.') : null,
        field('Email', email),
        field('Password', pass, mode === 'up' ? 'At least 10 characters.' : null),
        err,
        h('div', { class: 'row mt' }, submit)
      );
      form.onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          if (mode === 'in') await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: pass.value } });
          else await api('/api/auth/register', { method: 'POST', body: { email: email.value, password: pass.value, displayName: name.value } });
          await boot();
        } catch (ex) {
          err.textContent = ex.message;
          submit.disabled = false;
        }
      };
    }
    draw();

    app.append(
      h(
        'div',
        { class: 'auth' },
        h(
          'section',
          { class: 'auth-art' },
          h('span', { class: 'wordmark' }, 'tilth'),
          h('div', { class: 'stack' }, h('h1', {}, 'Every clean drop counts.'), h('p', {}, 'Sort your kitchen waste, tap your bin to a dock, and watch it become biogas. Clean drops build your score.')),
          h('ol', { class: 'auth-steps' }, h('li', {}, 'Fill your smart bin with food scraps only.'), h('li', {}, 'Tap it to a docking station. NFC and Bluetooth confirm it is really yours.'), h('li', {}, 'The dock checks purity and credits you within seconds.'))
        ),
        h('section', { class: 'auth-form' }, h('div', {}, tabs, form))
      )
    );
  }

  /* ---------- shell ---------- */

  const NAV = [['home', 'Home'], ['deposits', 'Deposits'], ['bins', 'My bins'], ['board', 'Leaderboard'], ['alerts', 'Alerts']];

  function showShell() {
    const app = clear($('app'));
    app.append(
      h(
        'header',
        { class: 'topbar' },
        h('a', { class: 'wordmark', href: '#/home' }, 'tilth'),
        h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Main' }),
        h(
          'div',
          { class: 'userbox' },
          h('span', { class: 'live-dot', id: 'live', title: 'Live updates' }),
          h('span', { class: 'who', id: 'who' }),
          h('button', { class: 'btn ghost small', type: 'button', on: { click: signOut } }, 'Sign out')
        )
      ),
      h('main', { id: 'view' })
    );
    updateHeader();
    startStream();
    route();
  }

  function updateHeader() {
    const nav = $('nav');
    if (!nav) return;
    clear(nav).append(
      ...NAV.map(([key, label]) =>
        h('a', { href: `#/${key}`, 'aria-current': state.route === key ? 'page' : null }, label, key === 'alerts' && state.unread ? h('span', { class: 'badge-count' }, state.unread) : null)
      )
    );
    if ($('who') && state.profile) $('who').textContent = state.profile.displayName;
    if ($('live')) $('live').classList.toggle('on', state.live);
  }

  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      showAuth();
    }
  }

  /* ---------- realtime ---------- */

  function startStream() {
    stopStream();
    state.es = T.sse(
      '/api/stream',
      {
        deposit: (r) => {
          showResult(r);
          refreshProfile();
        },
        profile: () => refreshProfile(),
        notification: (n) => {
          state.unread += 1;
          updateHeader();
          if (n.type !== 'DEPOSIT') toast(n.title, n.tone === 'bad' ? 'bad' : n.tone === 'good' ? 'good' : 'neutral');
          if (state.route === 'alerts') route();
        },
        pairing: (p) => toast(`Bin paired at ${p.dockId}. Drop your batch within 10 minutes.`, 'good'),
      },
      (on) => {
        state.live = on;
        updateHeader();
      }
    );
    api('/api/me/notifications').then((n) => {
      state.unread = n.unread;
      updateHeader();
    }).catch(() => {});
  }

  function stopStream() {
    if (state.es) state.es.close();
    state.es = null;
    state.live = false;
  }

  async function refreshProfile() {
    try {
      state.profile = await api('/api/me');
      updateHeader();
      if (state.route === 'home' || state.route === 'bins') route();
    } catch {
      /* handled by onUnauthorized */
    }
  }

  /* ---------- routing ---------- */

  async function route() {
    const key = location.hash.replace(/^#\/?/, '') || 'home';
    const fn = VIEWS[key];
    state.route = fn ? key : 'home';
    updateHeader();
    const host = $('view');
    if (!host) return;
    const token = ++state.renderToken;
    try {
      const node = await (fn || VIEWS.home)();
      if (token !== state.renderToken) return;
      clear(host).append(node);
      if (typeof node.afterMount === 'function') node.afterMount();
    } catch (e) {
      if (token === state.renderToken) clear(host).append(h('div', { class: 'card empty' }, e.message));
    }
  }
  window.addEventListener('hashchange', route);

  /* ---------- home ---------- */

  function dial(p) {
    const cx = 150, cy = 150, r = 122, gap = 5, a0 = 135, sweep = 270;
    const ang = (s) => a0 + (sweep * Math.max(0, Math.min(1000, s))) / 1000;
    const pt = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const arc = (s1, s2) => {
      const [x1, y1] = pt(ang(s1));
      const [x2, y2] = pt(ang(s2));
      return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${ang(s2) - ang(s1) > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    };
    const bounds = [...p.tiers.map((t) => t.min), 1000];
    const root = svg('svg', { viewBox: '0 0 300 300', class: 'dial', role: 'img', 'aria-label': `Credit score ${p.creditScore} out of 1000, tier ${p.tier.label}` });
    const progs = [];
    bounds.slice(0, -1).forEach((lo, i) => {
      const a = lo + gap, b = bounds[i + 1] - gap;
      root.append(svg('path', { d: arc(a, b), class: 'track', stroke: `var(--band-${i + 1})`, opacity: 0.4 }));
      const end = Math.min(p.creditScore, b);
      if (end > a + 0.5) {
        const path = svg('path', { d: arc(a, end), class: 'prog', stroke: `var(--band-${i + 1})`, pathLength: 1 });
        path.style.strokeDashoffset = T.reducedMotion ? 0 : 1;
        root.append(path);
        progs.push({ path, from: a, len: end - a });
      }
    });
    const knob = svg('g', { class: 'knob' }, svg('circle', { cx: cx + r, cy, r: 12, fill: '#fff', stroke: 'var(--ink)', 'stroke-width': 3 }));
    knob.style.transformOrigin = `${cx}px ${cy}px`;
    knob.style.transform = `rotate(${T.reducedMotion ? ang(p.creditScore) : a0}deg)`;
    root.append(knob);

    const play = () => {
      if (T.reducedMotion) return;
      const total = 1100;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          progs.forEach(({ path, from, len }) => {
            path.style.transition = `stroke-dashoffset ${(len / p.creditScore) * total}ms linear ${(from / p.creditScore) * total}ms`;
            path.style.strokeDashoffset = 0;
          });
          knob.style.transition = `transform ${total}ms linear`;
          knob.style.transform = `rotate(${ang(p.creditScore)}deg)`;
        })
      );
    };
    return { node: root, play };
  }

  function hexBadge(b) {
    return h(
      'div',
      { class: `badge ${b.earned ? '' : 'locked'}`, title: b.desc },
      svg('svg', { viewBox: '0 0 68 68', role: 'img', 'aria-label': b.earned ? `${b.name}, earned` : `${b.name}, locked` },
        svg('polygon', { points: '34,3 61,18.5 61,49.5 34,65 7,49.5 7,18.5', class: 'hex-fill' }),
        svg('polygon', { points: '34,10 55,22 55,46 34,58 13,46 13,22', class: 'hex-ring' }),
        svg('text', { x: 34, y: 41, class: 'hex-text' }, BADGE_MARK[b.key] || '*')),
      b.name
    );
  }

  function alertBox(p) {
    const box = h('div', { class: `alertbox ${p.status === 'FLAGGED' ? 'review' : ''}`, role: 'alert' });
    if (p.status === 'SUSPENDED') box.append(h('h2', {}, 'Pairing is paused'), h('p', {}, `Your bin cannot pair until ${fmt.date(p.suspendedUntil)}.`));
    else if (p.status === 'FLAGGED') box.append(h('h2', {}, 'Your account is under review'), h('p', {}, 'Staff are checking recent deposits. Pairing resumes once the review is done.'));
    else box.append(h('h2', {}, 'You have an open penalty'));
    for (const pen of p.penalties) {
      box.append(
        h('div', { class: 'pen' },
          h('div', {}, h('b', {}, `Strike ${pen.strike}: ${pen.type.toLowerCase()}`), h('div', { class: 'small' }, pen.reason)),
          pen.status === 'ACTIVE' ? h('button', { class: 'btn small ghost', type: 'button', on: { click: () => appealSheet(pen) } }, 'Appeal') : chip('Appeal under review', 'warn'))
      );
    }
    return box;
  }

  async function homeView() {
    const p = (state.profile = await api('/api/me'));
    const root = h('div', {});
    const kg = p.impact.kg;
    root.append(h('h1', { class: 'hero-line' }, kg > 0 ? `${fmt.num(kg, 1)} kg kept out of landfill, ${p.displayName}.` : `Ready for your first clean drop, ${p.displayName}?`));
    if (p.status !== 'ACTIVE' || p.penalties.length) root.append(alertBox(p));

    /* score dial */
    const d = dial(p);
    const scoreEl = h('div', { class: 'dial-score' }, T.reducedMotion ? fmt.num(p.creditScore) : '0');
    const tierRow = h('div', { class: 'tier-legend' }, ...p.tiers.map((t, i) => h('span', { class: p.tier.key === t.key ? 'on' : '' }, h('i', { class: `sw sw${i + 1}` }), t.label)));
    const scoreCard = h('section', { class: 'card c5', 'aria-label': 'Credit score' },
      h('h2', {}, 'Credit score'),
      h('div', { class: 'dial-wrap' }, d.node, h('div', { class: 'dial-center' }, scoreEl, h('div', { class: 'dial-tier' }, p.tier.label), h('div', { class: 'dial-label' }, 'out of 1000'))),
      h('p', { class: 'muted small mt' }, p.nextTier ? `${p.nextTier.pointsToGo} points to ${p.nextTier.label}. Higher tiers earn more credits per kilo.` : 'Top tier. Credits earn at the maximum rate.'),
      tierRow,
      h('div', { class: 'credits-row' }, h('span', { class: 'muted' }, 'Credits balance'), h('b', { id: 'creditsNum' }, T.reducedMotion ? fmt.num(p.credits) : '0'))
    );

    /* level, streak, quests */
    const lv = p.level;
    const questNodes = p.quests.map((q) =>
      h('div', { class: 'quest' },
        h('div', { class: 'row' }, h('b', {}, q.title), q.claimed ? chip('Claimed', 'good') : q.done ? chip('Done', 'good') : chip(`+${q.reward} credits`, '')),
        h('div', { class: 'bar' + (q.done ? '' : ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': q.target, 'aria-valuenow': q.progress, 'aria-label': q.title }, h('i', { dataset: { w: `${Math.round((q.progress / q.target) * 100)}%` } })),
        h('div', { class: 'small muted mt' }, `${q.desc} (${fmt.num(q.progress, q.target % 1 ? 1 : 0)} of ${q.target})`))
    );
    const progressCard = h('section', { class: 'card c7', 'aria-label': 'Progress' },
      h('h2', {}, 'Level and streak'),
      h('div', { class: 'level-line' }, h('b', {}, `Level ${lv.level}`), h('span', { class: 'muted small' }, `${fmt.num(lv.xp)} / ${fmt.num(lv.next)} XP`)),
      h('div', { class: 'bar' }, h('i', { dataset: { w: `${lv.pct}%` } })),
      h('div', { class: 'level-line mt' }, h('span', { class: 'muted small mt' }, 'Streak'), h('span', { class: 'small' }, `${p.streak.current} day${p.streak.current === 1 ? '' : 's'} · best ${p.streak.best}`)),
      h('div', { class: 'pips' }, ...Array.from({ length: 7 }, (_, i) => h('span', { class: `pip ${i < Math.min(7, p.streak.current) ? 'on' : ''}` }))),
      h('h2', { class: 'section-title mt' }, 'This week'),
      ...questNodes
    );

    /* impact */
    const im = p.impact;
    const tile = (val, unit, label) => h('div', { class: 'tile' }, h('div', {}, h('span', { class: 'big' }, val), h('span', { class: 'unit' }, unit)), h('div', { class: 'lbl' }, label));
    const impactCard = h('section', { class: 'card c12', 'aria-label': 'Your impact' },
      h('div', { class: 'row between wrap' }, h('h2', {}, 'Your impact'), h('span', { class: 'muted small' }, 'Estimates from typical food-waste digestion yields')),
      h('div', { class: 'impact' }, tile(fmt.num(im.kg, 1), 'kg', 'Organic waste verified'), tile(fmt.num(im.co2eKg, 1), 'kg CO2e', 'Landfill emissions avoided'), tile(fmt.num(im.biogasM3, 1), 'm3', 'Biogas potential'), tile(fmt.num(im.kwh, 1), 'kWh', 'Energy potential')),
      h('p', { class: 'muted small mt' }, `${p.totals.accepted} accepted, ${p.totals.partial} with a note, ${p.totals.rejected + p.totals.flagged} not accepted across ${p.totals.deposits} deposits.`)
    );

    /* last deposit */
    const lastBody = h('div', { class: 'empty' }, 'Loading...');
    const lastCard = h('section', { class: 'card c5', 'aria-label': 'Latest deposit' }, h('h2', {}, 'Latest deposit'), lastBody);
    api('/api/me/deposits?limit=1').then(({ items }) => {
      clear(lastBody);
      lastBody.className = '';
      if (!items.length) {
        lastBody.className = 'empty';
        lastBody.append('No deposits yet. Tap your bin to a docking station to start.');
        return;
      }
      const dep = items[0];
      lastBody.append(
        h('div', { class: 'row between' }, outcomeChip(dep.outcome), h('span', { class: 'muted small' }, `${dep.dockId} · ${fmt.ago(dep.at)}`)),
        h('div', { class: 'row wrap mt' }, h('b', { class: 'big-num' }, `${(dep.purity * 100).toFixed(1)}%`), h('span', { class: 'muted' }, `purity · ${fmt.num(dep.verifiedKg, 2)} kg verified`)),
        h('p', {}, `${fmt.signed(dep.credits)} credits, score ${fmt.signed(dep.scoreDelta)}`),
        ...dep.flags.filter((f) => FLAG_TEXT[f]).slice(0, 2).map((f) => h('p', { class: 'small muted mt' }, FLAG_TEXT[f])),
        h('a', { href: '#/deposits', class: 'small' }, 'See all deposits')
      );
    }).catch(() => {});

    /* badges */
    const earned = p.badges.filter((b) => b.earned).length;
    const badgeCard = h('section', { class: 'card c7', 'aria-label': 'Badges' },
      h('div', { class: 'row between' }, h('h2', {}, 'Badges'), h('span', { class: 'muted small' }, `${earned} of ${p.badges.length} earned`)),
      h('div', { class: 'badges' }, ...p.badges.map(hexBadge))
    );

    root.append(h('div', { class: 'grid' }, scoreCard, progressCard, impactCard, lastCard, badgeCard));

    root.afterMount = () => {
      d.play();
      countUp(scoreEl, p.creditScore, 1100);
      countUp($('creditsNum'), p.credits, 900);
      requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.bar > i').forEach((el) => { el.style.width = el.dataset.w; })));
    };
    return root;
  }

  /* ---------- deposit result sheet ---------- */

  function showResult(r) {
    const o = OUTCOME[r.outcome];
    const heads = { ACCEPTED: 'Clean drop.', PARTIAL: 'Accepted, with a note.', REJECTED: 'This one was rejected.', FLAGGED: 'Held for review.', INVALID: "We couldn't verify this batch." };
    const tone = o.tone === 'neutral' ? '' : o.tone;
    const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--info)';

    const fg = svg('circle', { class: 'fg', cx: 60, cy: 60, r: 54, pathLength: 1, stroke: color });
    fg.style.strokeDashoffset = T.reducedMotion ? 1 - r.purity : 1;
    const credits = h('dd', {}, T.reducedMotion ? fmt.signed(r.credits) : '+0');

    const stats = h('dl', { class: 'stat-list' },
      h('div', {}, h('dt', {}, 'Verified'), h('dd', {}, `${fmt.num(r.verifiedKg, 2)} kg`)),
      h('div', {}, h('dt', {}, 'Credits'), credits),
      h('div', {}, h('dt', {}, 'Credit score'), h('dd', {}, `${r.scoreAfter} (${fmt.signed(r.scoreDelta)})`)),
      h('div', {}, h('dt', {}, 'XP'), h('dd', {}, `+${r.xpGained}`)));

    const reasons = r.flags.filter((f) => FLAG_TEXT[f]);
    const body = h('div', { class: 'sheet-body' },
      h('div', { class: 'result-grid' },
        svg('svg', { viewBox: '0 0 120 120', class: 'ring', role: 'img', 'aria-label': `Purity ${(r.purity * 100).toFixed(1)} percent` }, svg('circle', { class: 'bg', cx: 60, cy: 60, r: 54 }), fg, svg('text', { x: 60, y: 69 }, `${(r.purity * 100).toFixed(0)}%`)),
        stats),
      reasons.length ? h('ul', { class: 'small mt' }, ...reasons.map((f) => h('li', {}, FLAG_TEXT[f]))) : h('p', { class: 'muted small mt' }, r.summary),
      r.penalty ? h('div', { class: 'penalty-box' }, h('b', {}, `Strike ${r.penalty.strike}: ${r.penalty.type.toLowerCase()}`), h('div', { class: 'small' }, r.penalty.suspendedUntil ? `Pairing is paused until ${fmt.date(r.penalty.suspendedUntil)}.` : r.penalty.creditsDeducted ? `${r.penalty.creditsDeducted} credits were deducted.` : 'This is a warning; your score dropped.'), h('div', { class: 'small' }, 'You can appeal from the Deposits page.')) : null,
      r.badges.length || r.quests.length || r.levelUp
        ? h('div', { class: 'earned' },
            r.levelUp ? h('div', {}, `Level ${r.level} reached`) : null,
            ...r.badges.map((b) => h('div', {}, `Badge earned: ${b.name}`)),
            ...r.quests.map((q) => h('div', {}, `Quest complete: ${q.title} (+${q.reward})`)))
        : null,
      h('div', { class: 'sheet-actions' },
        r.penalty ? h('a', { class: 'btn ghost', href: '#/deposits', on: { click: closeSheet } }, 'View penalty') : null,
        h('button', { class: 'btn', type: 'button', on: { click: closeSheet } }, r.outcome === 'ACCEPTED' || r.outcome === 'PARTIAL' ? 'Keep going' : 'Got it'))
    );

    openSheet(h('div', {}, h('div', { class: 'sheet-head' }, outcomeChip(r.outcome), h('h2', {}, heads[r.outcome]), h('p', { class: 'muted small mt' }, `${r.dockId} · ${fmt.time(r.at)}`)), body), tone);

    if (!T.reducedMotion) {
      requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = 1 - r.purity; }));
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 900);
        credits.textContent = fmt.signed(Math.round(r.credits * (1 - (1 - t) ** 3)));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  function appealSheet(pen) {
    const note = h('textarea', { rows: 4, maxLength: 500, placeholder: 'What happened? Staff will read this.' });
    const err = h('div', { class: 'error', role: 'alert' });
    const send = h('button', { class: 'btn', type: 'button' }, 'Send appeal');
    send.addEventListener('click', async () => {
      err.textContent = '';
      send.disabled = true;
      try {
        await api(`/api/me/penalties/${pen.id}/appeal`, { method: 'POST', body: { note: note.value } });
        closeSheet();
        toast('Appeal sent. Staff will review it.', 'good');
        refreshProfile();
        if (state.route === 'deposits') route();
      } catch (e) {
        err.textContent = e.message;
        send.disabled = false;
      }
    });
    openSheet(h('div', {}, h('div', { class: 'sheet-head' }, h('h2', {}, 'Appeal this penalty'), h('p', { class: 'muted small mt' }, pen.reason)),
      h('div', { class: 'sheet-body' }, field('Your explanation', note, 'Five characters minimum. If staff waive the penalty, your credits and score are restored.'), err,
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', type: 'button', on: { click: closeSheet } }, 'Cancel'), send))));
  }

  /* ---------- deposits ---------- */

  async function depositsView() {
    const root = h('div', { class: 'stack' });
    const [{ items: pens }] = await Promise.all([api('/api/me/penalties')]);
    if (pens.length) {
      root.append(
        h('section', { class: 'card' }, h('h2', {}, 'Penalties'),
          h('ul', { class: 'list' }, ...pens.map((p) => {
            const canAppeal = p.status === 'ACTIVE' && Date.now() - new Date(p.createdAt).getTime() < 14 * 864e5;
            const tone = { ACTIVE: 'bad', APPEALED: 'warn', WAIVED: 'good', UPHELD: '' }[p.status];
            return h('li', {},
              h('div', { class: 'row between wrap' }, h('b', {}, `Strike ${p.strike}: ${p.type.toLowerCase()}`), chip(p.status.toLowerCase(), tone)),
              h('p', { class: 'small mt' }, p.reason),
              h('p', { class: 'small muted mt' }, `${fmt.date(p.createdAt)} · ${p.creditsDeducted} credits, ${p.scoreApplied} score${p.suspendedUntil ? ` · pairing paused until ${fmt.date(p.suspendedUntil)}` : ''}`),
              p.appealNote ? h('p', { class: 'small mt' }, `Your appeal: ${p.appealNote}`) : null,
              p.resolutionNote ? h('p', { class: 'small mt' }, `Staff note: ${p.resolutionNote}`) : null,
              canAppeal ? h('button', { class: 'btn small ghost', type: 'button', on: { click: () => appealSheet(p) } }, 'Appeal') : null);
          })))
      );
    }

    const list = h('ul', { class: 'list' });
    const more = h('button', { class: 'btn ghost', type: 'button' }, 'Load more');
    let before = null;
    async function load() {
      more.disabled = true;
      const { items, hasMore } = await api(`/api/me/deposits?limit=15${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      for (const d of items) list.append(depositRow(d));
      if (items.length) before = items[items.length - 1].at;
      more.hidden = !hasMore;
      more.disabled = false;
      if (!list.children.length) list.append(h('li', { class: 'empty' }, 'No deposits yet.'));
    }
    more.addEventListener('click', load);
    root.append(h('section', { class: 'card' }, h('h2', {}, 'Deposit history'), list, h('div', { class: 'row mt' }, more)));
    await load();
    return root;
  }

  function depositRow(d) {
    const detail = h('div', { class: 'dep-detail', hidden: true },
      h('div', {}, d.summary),
      d.flags.filter((f) => FLAG_TEXT[f]).length ? h('ul', {}, ...d.flags.filter((f) => FLAG_TEXT[f]).map((f) => h('li', {}, FLAG_TEXT[f]))) : null,
      h('div', { class: 'small muted mt' }, `Accuracy ${d.accuracy}/100 · Bin ${d.binId}`));
    const btn = h('button', { class: 'dep', type: 'button', 'aria-expanded': 'false', on: { click: () => { detail.hidden = !detail.hidden; btn.setAttribute('aria-expanded', String(!detail.hidden)); } } },
      h('div', {}, h('div', { class: 'row' }, outcomeChip(d.outcome), h('b', {}, `${(d.purity * 100).toFixed(1)}% purity`)), h('div', { class: 'meta' }, `${fmt.date(d.at)} · ${d.dockId}`)),
      h('div', { class: 'nums' }, h('div', {}, `${fmt.num(d.verifiedKg, 2)} kg`), h('div', { class: 'small muted' }, `${fmt.signed(d.credits)} credits`)));
    return h('li', {}, btn, detail);
  }

  /* ---------- bins ---------- */

  async function binsView() {
    const p = (state.profile = await api('/api/me'));
    const { items: sessions } = await api('/api/me/sessions');
    const root = h('div', { class: 'grid' });

    const binList = p.bins.length
      ? h('ul', { class: 'list' }, ...p.bins.map((b) => h('li', {}, h('div', { class: 'row between wrap' }, h('b', {}, b.binId), chip(b.status.toLowerCase(), b.status === 'ACTIVE' ? 'good' : 'bad')), h('div', { class: 'small muted' }, b.lastPairedAt ? `Last paired ${fmt.ago(b.lastPairedAt)} at ${b.lastDockId}` : `Linked ${fmt.day(b.claimedAt)}, not paired yet`))))
      : h('div', { class: 'empty' }, 'No bins linked yet.');

    const binId = h('input', { type: 'text', placeholder: 'BIN-1A2B3C', autocomplete: 'off', maxLength: 10 });
    const code = h('input', { type: 'text', placeholder: 'ABCD-EFGH-JKMN', autocomplete: 'off', maxLength: 14 });
    const err = h('div', { class: 'error', role: 'alert' });
    const go = h('button', { class: 'btn', type: 'button' }, 'Link bin');
    go.addEventListener('click', async () => {
      err.textContent = '';
      go.disabled = true;
      try {
        await api('/api/me/bins/claim', { method: 'POST', body: { binId: binId.value.trim().toUpperCase(), claimCode: code.value } });
        toast('Bin linked to your account.', 'good');
        await refreshProfile();
      } catch (e) {
        err.textContent = e.message;
        go.disabled = false;
      }
    });

    const sessionTone = { PAIRED: 'good', CLOSED: 'good', CHALLENGED: 'info', EXPIRED: '', FAILED: 'bad' };
    root.append(
      h('section', { class: 'card c6' }, h('h2', {}, 'My bins'), binList),
      h('section', { class: 'card c6' }, h('h2', {}, 'Link a bin'), h('p', { class: 'muted small mt' }, 'The bin ID and claim code are printed on the label inside the lid.'), field('Bin ID', binId), field('Claim code', code), err, go),
      h('section', { class: 'card c6' }, h('h2', {}, 'How pairing works'),
        h('ol', { class: 'steps' },
          h('li', {}, h('div', {}, h('b', {}, 'Tap'), h('div', { class: 'small muted' }, 'Hold the bin to the dock NFC pad. The dock reads the tag ID.'))),
          h('li', {}, h('div', {}, h('b', {}, 'Handshake'), h('div', { class: 'small muted' }, 'Over Bluetooth the bin proves it holds its secret key. The key never leaves the bin.'))),
          h('li', {}, h('div', {}, h('b', {}, 'Deposit'), h('div', { class: 'small muted' }, 'The hatch opens for 10 minutes. The dock weighs and scans your batch, then credits you.')))),
        h('p', { class: 'note mt' }, 'Lost or sold a bin? Ask staff to unlink it so nobody else can use it.')),
      h('section', { class: 'card c6' }, h('h2', {}, 'Recent pairing attempts'),
        sessions.length ? h('ul', { class: 'list' }, ...sessions.slice(0, 8).map((s) => h('li', {}, h('div', { class: 'row between wrap' }, h('span', {}, `${s.dockId} · ${s.binId}`), chip(s.state.toLowerCase(), sessionTone[s.state])), h('div', { class: 'small muted' }, `${fmt.date(s.at)}${s.failReason ? ` · ${s.failReason.toLowerCase().replace(/_/g, ' ')}` : ''}`)))) : h('div', { class: 'empty' }, 'Nothing yet.'))
    );
    return root;
  }

  /* ---------- leaderboard ---------- */

  async function boardView() {
    const [lb] = await Promise.all([api('/api/leaderboard')]);
    const p = state.profile || (state.profile = await api('/api/me'));
    const row = (r) => h('tr', { class: r.isMe ? 'me' : '' }, h('td', { class: 'rank' }, r.rank), h('td', {}, r.name, r.isMe ? ' (you)' : ''), h('td', {}, r.tier), h('td', {}, `${fmt.num(r.kg, 1)} kg`), h('td', {}, r.deposits));
    const rows = lb.top.map(row);
    if (lb.me && !lb.top.some((r) => r.isMe)) rows.push(h('tr', {}, h('td', { colspan: 5, class: 'muted small' }, '...')), row(lb.me));

    const toggle = h('input', { type: 'checkbox', checked: p.showOnLeaderboard, id: 'lbToggle' });
    toggle.addEventListener('change', async () => {
      try {
        await api('/api/me', { method: 'PATCH', body: { showOnLeaderboard: toggle.checked } });
        state.profile.showOnLeaderboard = toggle.checked;
        toast(toggle.checked ? 'You are visible on the leaderboard.' : 'You are hidden from others.', 'neutral');
      } catch (e) {
        toggle.checked = !toggle.checked;
        toast(e.message, 'bad');
      }
    });

    return h('section', { class: 'card' },
      h('div', { class: 'row between wrap' }, h('h2', {}, `Leaderboard, ${lb.month}`), h('label', { class: 'row small', for: 'lbToggle' }, toggle, 'Show me on the leaderboard')),
      h('p', { class: 'muted small mt' }, 'Ranked by verified kilograms this month. Only display names are shown.'),
      lb.top.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Name'), h('th', {}, 'Tier'), h('th', {}, 'Verified'), h('th', {}, 'Deposits'))), h('tbody', {}, rows)) : h('div', { class: 'empty' }, 'No verified deposits yet this month. Be the first.'));
  }

  /* ---------- alerts ---------- */

  async function alertsView() {
    const { items } = await api('/api/me/notifications');
    if (state.unread) {
      api('/api/me/notifications/read', { method: 'POST' }).then(() => {
        state.unread = 0;
        updateHeader();
      }).catch(() => {});
    }
    const tone = { good: 'good', bad: 'bad', info: 'info' };
    return h('section', { class: 'card' }, h('h2', {}, 'Alerts'),
      items.length ? h('ul', { class: 'list' }, ...items.map((n) => h('li', {}, h('div', { class: 'row between wrap' }, h('b', {}, n.title), chip(fmt.ago(n.at), tone[n.tone])), n.body ? h('p', { class: 'small muted mt' }, n.body) : null))) : h('div', { class: 'empty' }, 'Nothing here yet.'));
  }

  const VIEWS = { home: homeView, deposits: depositsView, bins: binsView, board: boardView, alerts: alertsView };

  /* ---------- boot ---------- */

  async function boot() {
    T.onUnauthorized = () => showAuth();
    try {
      state.profile = await api('/api/me');
    } catch {
      return showAuth();
    }
    return showShell();
  }

  boot();
})();
