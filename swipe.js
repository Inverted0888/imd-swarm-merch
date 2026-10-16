/**
 * swipe.js — phone mode for the merch vote site: one line at a time, swipe right to WEAR it, left to BURN it,
 * tap the photo for the line's next product. Works off app.js's ideas, counts and heart buttons (window.SwarmApp)
 * and casts through vote.js, so a swipe is the same vote as the grid's buttons.
 */
(function () {
  'use strict';

  const PHONE = window.matchMedia('(max-width: 719px)');
  const SWIPE_PX = 96; // drag distance that commits a vote
  const FLICK_V = 0.55; // px/ms: a fast flick commits from a shorter drag

  let app = null;
  let queue = []; // idea ids still to judge
  let pos = 0;
  let productIdx = 0;
  let busy = false;

  const deckEl = document.createElement('section');
  deckEl.id = 'swipe-deck';
  deckEl.className = 'swipe-deck';
  deckEl.setAttribute('aria-label', 'Swipe to vote');
  deckEl.hidden = true;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'telemetry-pill mode-toggle';

  const toastEl = document.createElement('div');
  toastEl.className = 'swipe-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.hidden = true;

  function ideaById(id) {
    return app.state.ideas.find((i) => i.id === id);
  }

  function setMode(mode) {
    const swipe = mode === 'swipe';
    document.body.classList.toggle('mode-swipe', swipe);
    deckEl.hidden = !swipe;
    toggleBtn.textContent = swipe ? 'SEE ALL' : 'SWIPE';
    toggleBtn.setAttribute('aria-label', swipe ? 'Show every line as a grid' : 'Judge lines one at a time');
    if (swipe) {
      render();
    } else {
      app.refreshAllVoteBars();
    }
  }

  function buildQueue() {
    const voted = window.VoteAPI.getLocalVotes();
    queue = app.state.shuffledOrder.filter((id) => !voted[id]);
    const target = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (target && queue.includes(target)) {
      queue = [target].concat(queue.filter((id) => id !== target));
    }
    pos = 0;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  function renderEnd() {
    deckEl.innerHTML = '';
    const end = el('div', 'swipe-end');
    end.appendChild(el('p', 'swipe-end-title', 'That’s every line.'));
    end.appendChild(el('p', 'swipe-end-sub', 'Thanks for judging the swarm. See how everyone else voted, or send it to a friend.'));
    const row = el('div', 'swipe-end-actions');
    const gridBtn = el('button', 'swipe-action', 'See all the lines');
    gridBtn.type = 'button';
    gridBtn.addEventListener('click', () => setMode('grid'));
    const shareBtn = el('button', 'swipe-action', 'Share');
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Created by the Swarm', url });
        else {
          await navigator.clipboard.writeText(url);
          showToast('Link copied');
        }
      } catch (_) { /* cancelled */ }
    });
    row.appendChild(gridBtn);
    row.appendChild(shareBtn);
    end.appendChild(row);
    deckEl.appendChild(end);
  }

  function cardFor(idea, interactive) {
    const card = el('article', 'swipe-card');
    card.dataset.ideaId = idea.id;

    const photo = el('div', 'swipe-photo');
    const img = el('img');
    img.src = idea.products[0].img;
    img.alt = `${idea.name} — ${idea.products[0].parsed.prominent}`;
    img.width = 720;
    img.height = 720;
    img.draggable = false;
    photo.appendChild(img);
    const concept = el('span', 'concept-tag', 'CONCEPT');
    concept.hidden = !idea.products[0].concept;
    photo.appendChild(concept);
    if (interactive) {
      const dots = el('div', 'swipe-dots');
      idea.products.forEach((_, i) => dots.appendChild(el('span', i === 0 ? 'is-active' : '')));
      photo.appendChild(dots);
      photo.appendChild(el('span', 'stamp stamp-wear', 'WEAR'));
      photo.appendChild(el('span', 'stamp stamp-burn', 'BURN'));
      if (idea.products.length > 1) photo.appendChild(el('span', 'swipe-tap-hint', 'tap for next product'));
    }
    card.appendChild(photo);

    const info = el('div', 'swipe-info');
    const head = el('div', 'swipe-head');
    head.appendChild(el('span', 'card-id-badge', idea.id));
    head.appendChild(el('span', 'swipe-name', idea.name));
    head.appendChild(el('span', 'swipe-credit', idea.credit || `worker #${idea.seat}`));
    info.appendChild(head);

    const prompt = el('div', `card-prompt${idea.house ? ' is-house' : ''}`);
    prompt.appendChild(el('span', 'prompt-label', idea.house ? 'house line' : 'we asked the swarm'));
    prompt.appendChild(el('p', 'card-question', idea.house ? idea.question : `“${idea.question}”`));
    info.appendChild(prompt);

    if (interactive) {
      const readout = el('div', 'product-readout');
      const text = el('div', 'readout-text');
      const name = el('div', 'prod-name-prominent', idea.products[0].parsed.prominent);
      text.appendChild(name);
      readout.appendChild(text);
      const heart = app.makeHeartBtn(idea, 0);
      heart.point(0, true);
      readout.appendChild(heart);
      info.appendChild(readout);

      // Tap the photo: next product
      card.nextProduct = () => {
        productIdx = (productIdx + 1) % idea.products.length;
        const p = idea.products[productIdx];
        img.src = p.img;
        img.alt = `${idea.name} — ${p.parsed.prominent}`;
        concept.hidden = !p.concept;
        name.textContent = p.parsed.prominent;
        heart.point(productIdx, true);
        Array.from(photo.querySelectorAll('.swipe-dots span')).forEach((d, i) => d.classList.toggle('is-active', i === productIdx));
        const hint = photo.querySelector('.swipe-tap-hint');
        if (hint) hint.remove();
      };
    }
    card.appendChild(info);
    return card;
  }

  /* After the last line: "did you enjoy this?", swiped the same way. One answer per browser
   * (counters feedback-yes / feedback-no on the same counter service). */
  const FEEDBACK_KEY = `${window.VoteAPI ? window.VoteAPI.NAMESPACE : 'imd-swarm-merch'}:feedback`;
  function feedbackGiven() {
    try { return !!localStorage.getItem(FEEDBACK_KEY); } catch (_) { return false; }
  }

  function renderFeedback() {
    deckEl.innerHTML = '';
    const progress = el('div', 'swipe-progress');
    progress.appendChild(el('span', '', 'last one'));
    progress.appendChild(el('span', 'swipe-hint-text', '\u2190 nah \u00b7 yes \u2192'));
    deckEl.appendChild(progress);

    const stack = el('div', 'swipe-stack');
    const card = el('article', 'swipe-card swipe-feedback');
    card.dataset.kind = 'feedback';
    const face = el('div', 'swipe-photo feedback-face');
    face.appendChild(el('span', 'feedback-mark', '\u25C7'));
    face.appendChild(el('p', 'feedback-q', 'Did you enjoy this?'));
    face.appendChild(el('p', 'feedback-sub', 'Judging merch the IMD swarm invented, one swipe at a time.'));
    face.appendChild(el('span', 'stamp stamp-wear', 'YES'));
    face.appendChild(el('span', 'stamp stamp-burn', 'NAH'));
    card.appendChild(face);
    stack.appendChild(card);
    deckEl.appendChild(stack);
    attachDrag(card);

    const actions = el('div', 'swipe-buttons');
    const no = el('button', 'swipe-btn swipe-btn-burn', 'NAH');
    no.type = 'button';
    no.addEventListener('click', () => commit(card, 'down'));
    const yes = el('button', 'swipe-btn swipe-btn-wear', 'YES');
    yes.type = 'button';
    yes.addEventListener('click', () => commit(card, 'up'));
    actions.appendChild(no);
    actions.appendChild(yes);
    deckEl.appendChild(actions);
  }

  function render() {
    if (!app) return;
    if (pos >= queue.length) {
      if (feedbackGiven()) renderEnd();
      else renderFeedback();
      return;
    }
    deckEl.innerHTML = '';
    productIdx = 0;

    deckEl.appendChild(el('p', 'swipe-intro', 'Merch lines invented and drawn by the IMD swarm, as real Printful mockups. Swipe right to WEAR it, left to BURN it.'));
    const progress = el('div', 'swipe-progress');
    progress.appendChild(el('span', '', `${pos + 1} / ${queue.length}`));
    progress.appendChild(el('span', 'swipe-hint-text', '← burn · wear →'));
    deckEl.appendChild(progress);

    const stack = el('div', 'swipe-stack');
    const next = queue[pos + 1] && ideaById(queue[pos + 1]);
    if (next) {
      const under = cardFor(next, false);
      under.classList.add('is-under');
      under.setAttribute('aria-hidden', 'true');
      stack.appendChild(under);
    }
    const idea = ideaById(queue[pos]);
    const card = cardFor(idea, true);
    stack.appendChild(card);
    deckEl.appendChild(stack);
    attachDrag(card);

    const actions = el('div', 'swipe-buttons');
    const burn = el('button', 'swipe-btn swipe-btn-burn');
    burn.type = 'button';
    burn.innerHTML = '<span aria-hidden="true">🔥</span> BURN';
    burn.setAttribute('aria-label', `Burn ${idea.name}`);
    burn.addEventListener('click', () => commit(card, 'down'));
    const wear = el('button', 'swipe-btn swipe-btn-wear');
    wear.type = 'button';
    wear.innerHTML = '<span aria-hidden="true">👕</span> WEAR';
    wear.setAttribute('aria-label', `Wear ${idea.name}`);
    wear.addEventListener('click', () => commit(card, 'up'));
    actions.appendChild(burn);
    actions.appendChild(wear);
    deckEl.appendChild(actions);
  }

  function commit(card, dir) {
    if (busy) return;
    busy = true;
    if (card.dataset.kind === 'feedback') {
      card.style.transition = 'transform 260ms ease-in, opacity 260ms ease-in';
      card.style.transform = `translateX(${dir === 'up' ? 140 : -140}vw) rotate(${dir === 'up' ? 22 : -22}deg)`;
      card.style.opacity = '0';
      try { localStorage.setItem(FEEDBACK_KEY, dir === 'up' ? 'yes' : 'no'); } catch (_) { /* private mode */ }
      if (window.VoteAPI && window.VoteAPI.feedback) window.VoteAPI.feedback(dir === 'up' ? 'yes' : 'no');
      showToast(dir === 'up' ? 'Glad you liked it' : 'Noted, thanks');
      setTimeout(() => { busy = false; renderEnd(); }, 240);
      return;
    }
    const id = card.dataset.ideaId;
    const idea = ideaById(id);
    card.style.transition = 'transform 260ms ease-in, opacity 260ms ease-in';
    card.style.transform = `translateX(${dir === 'up' ? 140 : -140}vw) rotate(${dir === 'up' ? 22 : -22}deg)`;
    card.style.opacity = '0';
    card.querySelector(dir === 'up' ? '.stamp-wear' : '.stamp-burn').style.opacity = '1';

    // Optimistic count, then the counter service's answer
    const prev = app.state.counts[id] || { up: 0, down: 0 };
    app.state.counts[id] = { up: prev.up + (dir === 'up' ? 1 : 0), down: prev.down + (dir === 'down' ? 1 : 0) };
    const pending = window.VoteAPI.cast(id, dir); // records the local vote at once
    app.refreshAllVoteBars(); // header "your votes" + the grid's bars
    pending.then((c) => {
      app.state.counts[id] = { up: c.up, down: c.down };
      app.refreshAllVoteBars();
      const others = dir === 'up' ? c.up - 1 : c.down - 1;
      showToast(`${dir === 'up' ? 'Worn' : 'Burned'} — ${idea.name}${others > 0 ? ` (you + ${others})` : ''}`);
    }).catch(() => {});

    setTimeout(() => {
      pos += 1;
      busy = false;
      render();
    }, 240);
  }

  function attachDrag(card) {
    const wear = card.querySelector('.stamp-wear');
    const burn = card.querySelector('.stamp-burn');
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let t0 = 0;
    let dragging = false;
    let horizontal = null;

    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      horizontal = null;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dy = 0;
      t0 = performance.now();
      card.style.transition = 'none';
    });

    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (horizontal) card.setPointerCapture(e.pointerId);
      }
      if (!horizontal) return;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      const k = Math.min(1, Math.abs(dx) / SWIPE_PX);
      wear.style.opacity = dx > 0 ? String(k) : '0';
      burn.style.opacity = dx < 0 ? String(k) : '0';
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      const dt = Math.max(1, performance.now() - t0);
      const v = Math.abs(dx) / dt;
      if (horizontal && (Math.abs(dx) > SWIPE_PX || (v > FLICK_V && Math.abs(dx) > 36))) {
        commit(card, dx > 0 ? 'up' : 'down');
        return;
      }
      if (!horizontal && Math.abs(dx) < 8 && Math.abs(dy) < 8 && card.nextProduct) {
        card.nextProduct();
      }
      card.style.transition = 'transform 200ms ease-out';
      card.style.transform = '';
      wear.style.opacity = '0';
      burn.style.opacity = '0';
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('mode-swipe') || document.body.classList.contains('lightbox-open')) return;
    const card = deckEl.querySelector('.swipe-card:not(.is-under)');
    if (!card) return;
    if (e.key === 'ArrowRight') commit(card, 'up');
    if (e.key === 'ArrowLeft') commit(card, 'down');
  });

  window.addEventListener('swarm:ready', () => {
    app = window.SwarmApp;
    const header = document.querySelector('.site-header');
    header.insertAdjacentElement('afterend', deckEl);
    document.body.appendChild(toastEl);
    const pills = document.querySelector('.terminal-telemetry');
    if (pills) pills.insertBefore(toggleBtn, pills.firstChild);
    toggleBtn.addEventListener('click', () => {
      if (document.body.classList.contains('mode-swipe')) {
        setMode('grid');
      } else {
        buildQueue();
        setMode('swipe');
      }
    });
    buildQueue();
    // Phones start in the deck; a shared link to one line still opens the deck, on that line first.
    setMode(PHONE.matches ? 'swipe' : 'grid');
  });
})();
