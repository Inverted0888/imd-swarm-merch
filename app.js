/**
 * app.js — Main UI controller for "Created by the Swarm" merch vote site.
 */
(function () {
  'use strict';

  // Named fallback swatches for worker palettes that omit hex codes (e.g. a1-a5)
  const NAMED_SWATCHES = {
    'midnight navy': '#131d38',
    'electric cyan': '#1fe0f5',
    'lavender': '#b79ced',
    'warm cream': '#f4ead2',
    'sandstone': '#c9a679',
    'terracotta': '#c65d3e',
    'chalk': '#f1efe9',
    'charcoal': '#2b2d2f',
    'oxblood': '#651c23',
    'antique gold': '#c59b38',
    'ivory': '#f3ecd8',
    'forest green': '#1f4d36',
    'cobalt': '#1d4ed8',
    'vermilion': '#df3e26',
    'lemon yellow': '#f5e03b',
    'white': '#ffffff',
    'mint': '#9fe2bf',
    'peach': '#f7a983',
    'butter yellow': '#f3d36b',
    'deep teal': '#144c52'
  };

  const state = {
    job: '',
    ideas: [],
    shuffledOrder: [],
    counts: Object.create(null), // { [id]: { up, down } }
    hearts: Object.create(null), // { [heartKey]: number } read lazily per product
    countsReady: false,
    activeProductByIdea: Object.create(null), // { [id]: number }
    expandedIdeas: new Set(),
    sortBy: 'shuffle', // 'shuffle' | 'liked' | 'voted'
    filterGroup: 'all',
    lightbox: {
      open: false,
      ideaId: null,
      productIndex: 0,
      returnFocusEl: null
    }
  };

  // DOM Elements
  const gridEl = document.getElementById('ideas-grid');
  const statusBannerEl = document.getElementById('status-banner');
  const filterChipsEl = document.getElementById('filter-chips');
  const sortButtons = Array.from(document.querySelectorAll('.sort-btn'));
  const jobLinkEl = document.getElementById('job-link');
  const telemetryCountEl = document.getElementById('telemetry-count');
  const telemetryVotedEl = document.getElementById('telemetry-voted');
  const offlineBadgeEl = document.getElementById('votes-offline-badge');

  // Lightbox DOM Elements
  const lightboxEl = document.getElementById('lightbox');
  const lightboxLineIdEl = document.getElementById('lightbox-line-id');
  const lightboxTitleEl = document.getElementById('lightbox-title');
  const lightboxWorkerEl = document.getElementById('lightbox-worker');
  const lightboxCounterEl = document.getElementById('lightbox-counter');
  const lightboxCloseBtn = document.getElementById('lightbox-close');
  const lightboxPrevBtn = document.getElementById('lightbox-prev');
  const lightboxNextBtn = document.getElementById('lightbox-next');
  const lightboxStageEl = document.getElementById('lightbox-stage');
  const lightboxImgEl = document.getElementById('lightbox-img');
  const lightboxConceptEl = document.getElementById('lightbox-concept');
  const lightboxProdNameEl = document.getElementById('lightbox-prod-name');
  const lightboxProdRestEl = document.getElementById('lightbox-prod-rest');
  const lightboxThumbsEl = document.getElementById('lightbox-thumbs');
  const lightboxHeartSlotEl = document.getElementById('lightbox-heart-slot');
  const sortStatusEl = document.getElementById('sort-status');

  /* ==========================================================================
   * Product hearts (one per product photo, read only when that product is looked at)
   * ========================================================================== */

  const heartKey = (ideaId, idx) => `${ideaId}-p${idx + 1}-heart`;
  const heartLoads = new Map();

  function paintHearts(key) {
    document.querySelectorAll(`.heart-btn[data-heart-key="${key}"]`).forEach((btn) => {
      const mine = window.VoteAPI ? window.VoteAPI.hasHeart(key) : false;
      const n = state.hearts[key];
      btn.classList.toggle('is-hearted', mine);
      btn.disabled = mine;
      btn.querySelector('.heart-glyph').textContent = mine ? '\u2665' : '\u2661';
      btn.querySelector('.heart-count').textContent = typeof n === 'number' ? String(n) : '';
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
    });
  }

  function loadHeart(key) {
    if (!window.VoteAPI || typeof state.hearts[key] === 'number' || heartLoads.has(key)) return;
    const p = window.VoteAPI.getHeart(key)
      .then((n) => { state.hearts[key] = n; })
      .catch(() => {})
      .finally(() => { heartLoads.delete(key); paintHearts(key); });
    heartLoads.set(key, p);
  }

  /** A heart button bound to one product; `point(idx, load)` re-targets it when the shown product changes. */
  function makeHeartBtn(idea, idx) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'heart-btn';
    btn.innerHTML = '<span class="heart-glyph" aria-hidden="true">\u2661</span><span class="heart-count"></span>';
    btn.point = (i, load) => {
      const key = heartKey(idea.id, i);
      btn.dataset.heartKey = key;
      btn.setAttribute('aria-label', `Heart this product: ${idea.name} \u2014 ${idea.products[i].parsed.prominent}`);
      btn.title = 'Heart this product';
      if (load) loadHeart(key);
      paintHearts(key);
    };
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.heartKey;
      if (!window.VoteAPI || window.VoteAPI.hasHeart(key)) return;
      state.hearts[key] = (state.hearts[key] || 0) + 1;
      const pending = window.VoteAPI.heart(key);
      paintHearts(key);
      try { state.hearts[key] = await pending; } catch (_) { /* keep the optimistic count */ }
      paintHearts(key);
    });
    btn.point(idx, false);
    return btn;
  }

  /* ==========================================================================
   * Links to one line (#b3)
   * ========================================================================== */

  function lineUrl(id) {
    return `${location.origin}${location.pathname}#${id}`;
  }

  function showTargetLine() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!id) return;
    const card = document.getElementById(`line-${id}`);
    if (!card) return;
    document.querySelectorAll('.idea-card.is-target').forEach((c) => c.classList.remove('is-target'));
    card.classList.add('is-target');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.addEventListener('hashchange', showTargetLine);

  /**
   * Strip stray markdown (** and backticks) from text fields.
   */
  function cleanText(value) {
    if (value == null) return '';
    return String(value)
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Parse worker's product label:
   * "Product / group · placement · print method"
   * Returns { prominent, rest, shortName, group }
   */
  function parseProductLabel(rawLabel) {
    const cleaned = cleanText(rawLabel);
    const parts = cleaned.split(/\s*\u00b7\s*/).filter(Boolean);
    const prominent = parts[0] || cleaned;
    const rest = parts.slice(1).join(' \u00b7 ');

    // Short product name for thumbnail strip
    const slashIdx = prominent.indexOf(' / ');
    const shortName = slashIdx !== -1 ? prominent.slice(0, slashIdx).trim() : prominent;

    // Extract group (text after " / " in the product part, case-insensitive,
    // with fallback to the category segment if " / " holds a numeric catalog ID)
    let group = '';
    if (slashIdx !== -1) {
      const afterSlash = prominent.slice(slashIdx + 3).trim();
      if (afterSlash && !/^\d+$/.test(afterSlash)) {
        group = afterSlash.toLowerCase();
      }
    }
    if (!group) {
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].trim();
        if (seg && !/^\d+$/.test(seg) && seg.length <= 20) {
          group = seg.toLowerCase();
          break;
        }
      }
    }

    return {
      prominent,
      rest,
      shortName,
      group: group || 'other'
    };
  }

  /**
   * Format style field into concise chip data while preserving full text.
   */
  function parseStyleSpec(rawStyle) {
    const full = cleanText(rawStyle).replace(/\.$/, '');
    if (!full) return null;
    // Keep chip concise by taking first sentence if multi-sentence
    const firstSentence = full.split(/\.\s+/)[0].replace(/\.$/, '');
    return {
      short: firstSentence,
      full
    };
  }

  /**
   * Parse palette string into colour chip items with optional hex swatch.
   */
  function parsePaletteSpecs(rawPalette) {
    const cleaned = cleanText(rawPalette);
    if (!cleaned) return [];

    // Take primary colour list sentence before any explanatory prose
    const firstSentence = cleaned.split(/\.\s+/)[0].replace(/\.$/, '');
    const segments = firstSentence
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    return segments.map((seg) => {
      // Remove conversational prefixes like "the notebook also uses "
      const label = seg.replace(/^the\s+.*?\buses\s+/i, '').trim();
      const hexMatch = label.match(/#[0-9a-fA-F]{6}\b/);
      let swatch = hexMatch ? hexMatch[0] : null;
      if (!swatch) {
        const lower = label.toLowerCase();
        if (NAMED_SWATCHES[lower]) {
          swatch = NAMED_SWATCHES[lower];
        }
      }
      return {
        label,
        swatch
      };
    });
  }

  /**
   * Fisher-Yates shuffle returning a new array of idea IDs.
   */
  function shuffleIds(ids) {
    const arr = ids.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    // It's the swarm's vote: its lines come first (shuffled), our house pieces after them.
    const isHouse = (id) => (state.ideas.find((x) => x.id === id) || {}).house;
    return arr.filter((id) => !isHouse(id)).concat(arr.filter(isHouse));
  }

  /**
   * Update header telemetry pills.
   */
  function updateTelemetry(visibleCount) {
    const total = state.ideas.length;
    if (typeof visibleCount === 'number' && visibleCount !== total) {
      telemetryCountEl.textContent = `LINES: ${visibleCount}/${total}`;
    } else {
      telemetryCountEl.textContent = `LINES: ${total}`;
    }

    const localVotes = window.VoteAPI ? window.VoteAPI.getLocalVotes() : {};
    const votedCount = Object.keys(localVotes).filter((id) =>
      state.ideas.some((idea) => idea.id === id)
    ).length;
    telemetryVotedEl.textContent = `YOUR VOTES: ${votedCount}`;

    const isOffline = window.VoteAPI ? window.VoteAPI.isOffline() : false;
    offlineBadgeEl.hidden = !isOffline;
  }

  /**
   * Build product group filter chips dynamically from loaded ideas.
   */
  function renderFilterChips() {
    const groupCounts = new Map();
    state.ideas.forEach((idea) => {
      const seenInIdea = new Set();
      idea.products.forEach((p) => {
        if (p.parsed.group) {
          seenInIdea.add(p.parsed.group);
        }
      });
      seenInIdea.forEach((g) => {
        groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
      });
    });

    // Preferred ordering for common groups, then alphabetical for any others
    const preferredOrder = [
      'wear',
      'headwear',
      'bags',
      'drinkware',
      'desk + tech',
      'home',
      'wall',
      'knit',
      'feet',
      'small',
      'other'
    ];

    const groups = Array.from(groupCounts.keys()).sort((a, b) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    filterChipsEl.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `filter-chip${state.filterGroup === 'all' ? ' is-active' : ''}`;
    allBtn.dataset.group = 'all';
    allBtn.setAttribute('aria-pressed', state.filterGroup === 'all' ? 'true' : 'false');
    allBtn.innerHTML = `<span>All</span><span class="chip-count">${state.ideas.length}</span>`;
    allBtn.addEventListener('click', () => setFilterGroup('all'));
    filterChipsEl.appendChild(allBtn);

    groups.forEach((group) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = state.filterGroup === group;
      btn.className = `filter-chip${isActive ? ' is-active' : ''}`;
      btn.dataset.group = group;
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = group;
      const countSpan = document.createElement('span');
      countSpan.className = 'chip-count';
      countSpan.textContent = String(groupCounts.get(group));

      btn.appendChild(nameSpan);
      btn.appendChild(countSpan);
      btn.addEventListener('click', () => setFilterGroup(group));
      filterChipsEl.appendChild(btn);
    });
  }

  function setFilterGroup(group) {
    state.filterGroup = group;

    // When filtering by a specific product group, switch each matching card's
    // active preview to the product belonging to that group.
    if (group !== 'all') {
      state.ideas.forEach((idea) => {
        const matchIdx = idea.products.findIndex((p) => p.parsed.group === group);
        if (matchIdx !== -1) {
          state.activeProductByIdea[idea.id] = matchIdx;
        }
      });
    }

    Array.from(filterChipsEl.querySelectorAll('.filter-chip')).forEach((btn) => {
      const active = btn.dataset.group === group;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    renderGrid();
  }

  function setSortBy(sortMode) {
    if (sortMode !== 'shuffle' && !state.countsReady) return;
    if (sortMode === 'shuffle') {
      state.shuffledOrder = shuffleIds(state.ideas.map((item) => item.id));
    }
    state.sortBy = sortMode;

    sortButtons.forEach((btn) => {
      const active = btn.dataset.sort === sortMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    renderGrid();
  }

  /**
   * Return filtered and sorted list of ideas.
   */
  function getVisibleIdeas() {
    let list = state.ideas.filter((idea) => {
      if (state.filterGroup === 'all') return true;
      return idea.products.some((p) => p.parsed.group === state.filterGroup);
    });

    const shuffleIndexMap = new Map();
    state.shuffledOrder.forEach((id, idx) => shuffleIndexMap.set(id, idx));

    list = list.slice().sort((a, b) => {
      const ca = state.counts[a.id] || { up: 0, down: 0 };
      const cb = state.counts[b.id] || { up: 0, down: 0 };

      if (state.sortBy === 'liked') {
        const scoreA = ca.up - ca.down;
        const scoreB = cb.up - cb.down;
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (cb.up !== ca.up) return cb.up - ca.up;
        const totA = ca.up + ca.down;
        const totB = cb.up + cb.down;
        if (totB !== totA) return totB - totA;
      } else if (state.sortBy === 'voted') {
        const totA = ca.up + ca.down;
        const totB = cb.up + cb.down;
        if (totB !== totA) return totB - totA;
        if (cb.up !== ca.up) return cb.up - ca.up;
      }

      return (shuffleIndexMap.get(a.id) ?? 0) - (shuffleIndexMap.get(b.id) ?? 0);
    });

    return list;
  }

  /**
   * Build and render a single idea card.
   */
  function createIdeaCard(idea) {
    const card = document.createElement('article');
    const isExpanded = state.expandedIdeas.has(idea.id);
    card.className = `idea-card${isExpanded ? ' is-expanded' : ''}`;
    card.dataset.ideaId = idea.id;
    card.id = `line-${idea.id}`;

    const activeIdx = state.activeProductByIdea[idea.id] || 0;
    const activeProd = idea.products[activeIdx] || idea.products[0];

    // 1. Header: ID badge, Line name, worker credit, question answered
    const header = document.createElement('header');
    header.className = 'card-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'card-title-row';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'card-title-group';

    const idBadge = document.createElement('span');
    idBadge.className = 'card-id-badge';
    idBadge.textContent = idea.id;

    const titleEl = document.createElement('h2');
    titleEl.className = 'card-title';
    titleEl.textContent = idea.name;

    titleGroup.appendChild(idBadge);
    titleGroup.appendChild(titleEl);

    const workerEl = document.createElement('span');
    workerEl.className = 'card-worker';
    workerEl.textContent = (idea.credit || `made by worker #${idea.seat}`);

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'copy-link-btn';
    linkBtn.textContent = 'link';
    linkBtn.title = 'Copy a link to this line';
    linkBtn.setAttribute('aria-label', `Copy a link to ${idea.name}`);
    linkBtn.addEventListener('click', async () => {
      const url = lineUrl(idea.id);
      try {
        await navigator.clipboard.writeText(url);
        linkBtn.textContent = 'copied';
      } catch (_) {
        history.replaceState(null, '', `#${idea.id}`);
        linkBtn.textContent = 'in address bar';
      }
      setTimeout(() => { linkBtn.textContent = 'link'; }, 1600);
    });
    titleGroup.appendChild(linkBtn);

    titleRow.appendChild(titleGroup);
    titleRow.appendChild(workerEl);

    // The question is what made the line: label it plainly so visitors see the cause, not just the result.
    const questionEl = document.createElement('div');
    const ours = idea.house && !idea.fromSwarm;
    questionEl.className = `card-prompt${idea.house ? ' is-house' : ''}`;
    const promptLabel = document.createElement('span');
    promptLabel.className = 'prompt-label';
    promptLabel.textContent = idea.tag || (idea.house ? 'house line' : 'we asked the swarm');
    const promptText = document.createElement('p');
    promptText.className = 'card-question';
    promptText.textContent = ours ? idea.question : `\u201c${idea.question}\u201d`;
    questionEl.appendChild(promptLabel);
    questionEl.appendChild(promptText);

    header.appendChild(titleRow);
    header.appendChild(questionEl);
    card.appendChild(header);

    // 2. Product Gallery (1 large image + readout + 4 thumbnails to switch)
    const gallery = document.createElement('div');
    gallery.className = 'card-gallery';

    const mainImgBtn = document.createElement('button');
    mainImgBtn.type = 'button';
    mainImgBtn.className = 'main-img-btn';
    mainImgBtn.setAttribute(
      'aria-label',
      `Inspect ${idea.name} — ${activeProd.parsed.prominent} in lightbox`
    );

    const mainImg = document.createElement('img');
    mainImg.src = activeProd.img;
    mainImg.alt = `${idea.name} — ${activeProd.parsed.prominent}`;
    mainImg.loading = 'lazy';
    mainImg.width = 720;
    mainImg.height = 720;

    const zoomBadge = document.createElement('span');
    zoomBadge.className = 'zoom-badge';
    zoomBadge.setAttribute('aria-hidden', 'true');
    zoomBadge.textContent = `${activeIdx + 1}/${idea.products.length} · ZOOM`;

    // AI-drawn product photos are concepts (CLAUDE.md merch rules); Printful mockups of real print files are not.
    const conceptTag = document.createElement('span');
    conceptTag.className = 'concept-tag';
    conceptTag.textContent = 'CONCEPT';
    conceptTag.title = 'AI concept image. The real piece is printed from flat art, so it may differ.';
    conceptTag.hidden = !activeProd.concept;

    mainImgBtn.appendChild(mainImg);
    mainImgBtn.appendChild(zoomBadge);
    mainImgBtn.appendChild(conceptTag);

    mainImgBtn.addEventListener('click', () => {
      const currentIdx = state.activeProductByIdea[idea.id] || 0;
      openLightbox(idea.id, currentIdx, mainImgBtn);
    });

    // Product label readout (product name before first " · " prominent, rest small)
    const readout = document.createElement('div');
    readout.className = 'product-readout';

    const prodProminent = document.createElement('div');
    prodProminent.className = 'prod-name-prominent';
    prodProminent.textContent = activeProd.parsed.prominent;

    const prodRest = document.createElement('div');
    prodRest.className = 'prod-label-small';
    prodRest.textContent = activeProd.parsed.rest;

    const readoutText = document.createElement('div');
    readoutText.className = 'readout-text';
    readoutText.appendChild(prodProminent);
    readoutText.appendChild(prodRest);
    prodRest.hidden = !activeProd.parsed.rest;
    const heartBtn = makeHeartBtn(idea, activeIdx);
    readout.appendChild(readoutText);
    readout.appendChild(heartBtn);

    // 4 Thumbnails strip
    const thumbStrip = document.createElement('div');
    thumbStrip.className = 'thumb-strip';
    thumbStrip.setAttribute('role', 'group');
    thumbStrip.setAttribute('aria-label', `${idea.name} products`);

    idea.products.forEach((prod, idx) => {
      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      const isThumbActive = idx === activeIdx;
      thumbBtn.className = `thumb-btn${isThumbActive ? ' is-active' : ''}`;
      thumbBtn.setAttribute('aria-pressed', isThumbActive ? 'true' : 'false');
      thumbBtn.setAttribute(
        'aria-label',
        `Show ${idea.name} — ${prod.parsed.prominent}`
      );
      thumbBtn.title = prod.parsed.prominent;

      const imgWrap = document.createElement('span');
      imgWrap.className = 'thumb-img-wrap';

      const tImg = document.createElement('img');
      tImg.src = prod.img;
      tImg.alt = `${idea.name} — ${prod.parsed.shortName}`;
      tImg.loading = 'lazy';
      tImg.width = 180;
      tImg.height = 180;

      imgWrap.appendChild(tImg);

      const shortLbl = document.createElement('span');
      shortLbl.className = 'thumb-short-label';
      shortLbl.textContent = prod.parsed.shortName;

      thumbBtn.appendChild(imgWrap);
      thumbBtn.appendChild(shortLbl);

      thumbBtn.addEventListener('click', () => {
        const prevIdx = state.activeProductByIdea[idea.id] || 0;
        if (prevIdx === idx) {
          // Clicking the already active thumbnail opens the lightbox
          openLightbox(idea.id, idx, thumbBtn);
          return;
        }
        state.activeProductByIdea[idea.id] = idx;
        mainImg.src = prod.img;
        mainImg.alt = `${idea.name} — ${prod.parsed.prominent}`;
        conceptTag.hidden = !prod.concept;
        zoomBadge.textContent = `${idx + 1}/${idea.products.length} · ZOOM`;
        mainImgBtn.setAttribute(
          'aria-label',
          `Inspect ${idea.name} — ${prod.parsed.prominent} in lightbox`
        );
        prodProminent.textContent = prod.parsed.prominent;
        prodRest.textContent = prod.parsed.rest;
        prodRest.hidden = !prod.parsed.rest;
        heartBtn.point(idx, true);

        Array.from(thumbStrip.querySelectorAll('.thumb-btn')).forEach((b, bIdx) => {
          const active = bIdx === idx;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      });

      thumbStrip.appendChild(thumbBtn);
    });

    gallery.appendChild(mainImgBtn);
    gallery.appendChild(readout);
    gallery.appendChild(thumbStrip);
    card.appendChild(gallery);

    // 3. Card Body: Worker's answer (2 lines, expand for more) + style/palette chips
    const body = document.createElement('div');
    body.className = 'card-body';

    const answerBlock = document.createElement('div');
    answerBlock.className = 'answer-block';

    const answerLabel = document.createElement('span');
    answerLabel.className = 'prompt-label';
    answerLabel.textContent = ours ? 'the piece' : 'the swarm answered';
    answerBlock.appendChild(answerLabel);

    const answerP = document.createElement('p');
    answerP.className = `card-answer${isExpanded ? ' is-expanded' : ''}`;
    answerP.textContent = idea.answer;

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'expand-btn';
    expandBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    expandBtn.textContent = isExpanded ? '[- less]' : '[+ more]';

    expandBtn.addEventListener('click', () => {
      const nowExpanded = !state.expandedIdeas.has(idea.id);
      if (nowExpanded) {
        state.expandedIdeas.add(idea.id);
      } else {
        state.expandedIdeas.delete(idea.id);
      }
      card.classList.toggle('is-expanded', nowExpanded);
      answerP.classList.toggle('is-expanded', nowExpanded);
      expandBtn.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
      expandBtn.textContent = nowExpanded ? '[- less]' : '[+ more]';
      const styleTextNode = card.querySelector('.spec-chip-style .spec-chip-text');
      if (styleTextNode && idea.styleSpec) {
        styleTextNode.textContent = nowExpanded ? idea.styleSpec.full : idea.styleSpec.short;
      }
    });

    answerBlock.appendChild(answerP);
    answerBlock.appendChild(expandBtn);
    body.appendChild(answerBlock);

    // Style & Palette chips
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'spec-chips';

    if (idea.styleSpec) {
      const styleChip = document.createElement('span');
      styleChip.className = 'spec-chip spec-chip-style';
      styleChip.title = `Style: ${idea.styleSpec.full}`;

      const prefix = document.createElement('span');
      prefix.className = 'chip-prefix';
      prefix.textContent = 'style';

      const textSpan = document.createElement('span');
      textSpan.className = 'spec-chip-text';
      textSpan.textContent = isExpanded ? idea.styleSpec.full : idea.styleSpec.short;

      styleChip.appendChild(prefix);
      styleChip.appendChild(textSpan);
      chipsContainer.appendChild(styleChip);
    }

    idea.paletteSpecs.forEach((pal) => {
      const palChip = document.createElement('span');
      palChip.className = 'spec-chip spec-chip-palette';
      palChip.title = `Palette: ${pal.label}`;

      if (pal.swatch) {
        const dot = document.createElement('span');
        dot.className = 'swatch-dot';
        dot.style.backgroundColor = pal.swatch;
        dot.setAttribute('aria-hidden', 'true');
        palChip.appendChild(dot);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'spec-chip-text';
      textSpan.textContent = pal.label;

      palChip.appendChild(textSpan);
      chipsContainer.appendChild(palChip);
    });

    body.appendChild(chipsContainer);
    card.appendChild(body);

    // 4. Vote Bar
    const voteBar = document.createElement('div');
    voteBar.className = 'vote-bar';
    renderVoteBarContents(voteBar, idea);
    card.appendChild(voteBar);

    return card;
  }

  /**
   * Populate or update the vote bar inside a card.
   */
  function renderVoteBarContents(voteBarEl, idea) {
    const counts = state.counts[idea.id] || { up: 0, down: 0 };
    const up = counts.up || 0;
    const down = counts.down || 0;
    const total = up + down;
    const localChoice = window.VoteAPI ? window.VoteAPI.getLocalVote(idea.id) : null;
    const hasVoted = localChoice === 'up' || localChoice === 'down';

    const upPct = total > 0 ? Math.round((up / total) * 100) : 0;
    const downPct = total > 0 ? 100 - upPct : 0;

    voteBarEl.innerHTML = '';

    const controls = document.createElement('div');
    controls.className = 'vote-controls';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = `vote-btn vote-up${localChoice === 'up' ? ' is-selected' : ''}`;
    upBtn.disabled = hasVoted;
    upBtn.setAttribute('aria-label', `Vote thumbs up for ${idea.name}`);
    upBtn.setAttribute('aria-pressed', localChoice === 'up' ? 'true' : 'false');
    upBtn.innerHTML = `
      <span class="vote-btn-label"><span aria-hidden="true">👕</span><span>WEAR</span></span>
      <span class="vote-count" data-count-up="${idea.id}">${up}</span>
    `;

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = `vote-btn vote-down${localChoice === 'down' ? ' is-selected' : ''}`;
    downBtn.disabled = hasVoted;
    downBtn.setAttribute('aria-label', `Vote thumbs down for ${idea.name}`);
    downBtn.setAttribute('aria-pressed', localChoice === 'down' ? 'true' : 'false');
    downBtn.innerHTML = `
      <span class="vote-btn-label"><span aria-hidden="true">🔥</span><span>BURN</span></span>
      <span class="vote-count" data-count-down="${idea.id}">${down}</span>
    `;

    if (!hasVoted) {
      upBtn.addEventListener('click', () => handleVote(idea, 'up', voteBarEl));
      downBtn.addEventListener('click', () => handleVote(idea, 'down', voteBarEl));
    }

    // BURN left, WEAR right: the same sides as the swipe deck (swipe left = burn, right = wear)
    controls.appendChild(downBtn);
    controls.appendChild(upBtn);

    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'score-bar-wrap';

    const track = document.createElement('div');
    track.className = 'score-track';
    track.setAttribute('role', 'img');
    track.setAttribute(
      'aria-label',
      total > 0 ? `${upPct}% positive (${up} up, ${down} down)` : 'No votes yet'
    );

    const fillUp = document.createElement('div');
    fillUp.className = 'score-fill-up';
    fillUp.style.width = `${upPct}%`;

    const fillDown = document.createElement('div');
    fillDown.className = 'score-fill-down';
    fillDown.style.width = `${downPct}%`;

    // burn share on the left under BURN, wear share on the right under WEAR
    track.appendChild(fillDown);
    track.appendChild(fillUp);

    const meta = document.createElement('div');
    meta.className = 'score-meta';

    const ratioSpan = document.createElement('span');
    ratioSpan.textContent =
      total > 0 ? `${upPct}% liked · ${total} vote${total === 1 ? '' : 's'}` : '0 votes yet';

    meta.appendChild(ratioSpan);

    if (hasVoted) {
      const votedTag = document.createElement('span');
      votedTag.className = 'voted-tag';
      votedTag.textContent = localChoice === 'up' ? 'VOTED 👍' : 'VOTED 👎';
      meta.appendChild(votedTag);
    }

    scoreWrap.appendChild(track);
    scoreWrap.appendChild(meta);

    voteBarEl.appendChild(controls);
    voteBarEl.appendChild(scoreWrap);
  }

  /**
   * Handle casting a vote on an idea.
   */
  async function handleVote(idea, direction, voteBarEl) {
    if (!window.VoteAPI) return;
    if (window.VoteAPI.getLocalVote(idea.id)) return;

    // Optimistic update
    const prev = state.counts[idea.id] || { up: 0, down: 0 };
    state.counts[idea.id] = {
      up: direction === 'up' ? prev.up + 1 : prev.up,
      down: direction === 'down' ? prev.down + 1 : prev.down
    };

    // cast() records the choice locally before its first network call, so the card can show it straight away
    const pending = window.VoteAPI.cast(idea.id, direction);
    renderVoteBarContents(voteBarEl, idea);
    const updated = await pending;
    state.counts[idea.id] = { up: updated.up, down: updated.down };

    renderVoteBarContents(voteBarEl, idea);
    updateTelemetry(getVisibleIdeas().length);

    if (state.sortBy === 'liked' || state.sortBy === 'voted') {
      renderGrid();
    }
  }

  /**
   * Render all visible idea cards into the grid.
   */
  function renderGrid() {
    const visible = getVisibleIdeas();
    gridEl.innerHTML = '';

    if (visible.length === 0) {
      statusBannerEl.textContent = 'No merch lines match this product group.';
      statusBannerEl.hidden = false;
    } else {
      statusBannerEl.hidden = true;
      const fragment = document.createDocumentFragment();
      visible.forEach((idea) => {
        fragment.appendChild(createIdeaCard(idea));
      });
      gridEl.appendChild(fragment);
    }

    updateTelemetry(visible.length);
  }

  /**
   * Update only the vote bars in-place when background vote counts finish loading.
   */
  function refreshAllVoteBars() {
    if (state.sortBy === 'liked' || state.sortBy === 'voted') {
      renderGrid();
      return;
    }

    Array.from(gridEl.querySelectorAll('.idea-card')).forEach((cardEl) => {
      const id = cardEl.dataset.ideaId;
      const idea = state.ideas.find((item) => item.id === id);
      const voteBarEl = cardEl.querySelector('.vote-bar');
      if (idea && voteBarEl) {
        renderVoteBarContents(voteBarEl, idea);
      }
    });
    updateTelemetry(getVisibleIdeas().length);
  }

  /* ==========================================================================
   * Lightbox Logic (Arrow keys, swipe, Esc)
   * ========================================================================== */

  function openLightbox(ideaId, productIndex, triggerEl) {
    const idea = state.ideas.find((item) => item.id === ideaId);
    if (!idea) return;

    state.lightbox.open = true;
    state.lightbox.ideaId = ideaId;
    state.lightbox.productIndex =
      ((productIndex % idea.products.length) + idea.products.length) % idea.products.length;
    state.lightbox.returnFocusEl = triggerEl || document.activeElement;

    updateLightboxView();
    lightboxEl.hidden = false;
    document.body.classList.add('lightbox-open');
    lightboxCloseBtn.focus();
  }

  function closeLightbox() {
    if (!state.lightbox.open) return;
    state.lightbox.open = false;
    lightboxEl.hidden = true;
    document.body.classList.remove('lightbox-open');

    if (
      state.lightbox.returnFocusEl &&
      typeof state.lightbox.returnFocusEl.focus === 'function'
    ) {
      state.lightbox.returnFocusEl.focus();
    }
  }

  function stepLightbox(delta) {
    if (!state.lightbox.open) return;
    const idea = state.ideas.find((item) => item.id === state.lightbox.ideaId);
    if (!idea || !idea.products.length) return;

    const len = idea.products.length;
    state.lightbox.productIndex = (state.lightbox.productIndex + delta + len) % len;
    state.activeProductByIdea[idea.id] = state.lightbox.productIndex;
    updateLightboxView();
  }

  function updateLightboxView() {
    const idea = state.ideas.find((item) => item.id === state.lightbox.ideaId);
    if (!idea) return;

    const idx = state.lightbox.productIndex;
    const prod = idea.products[idx] || idea.products[0];

    if (lightboxHeartSlotEl) {
      lightboxHeartSlotEl.innerHTML = '';
      const hb = makeHeartBtn(idea, idx);
      hb.point(idx, true);
      lightboxHeartSlotEl.appendChild(hb);
    }

    lightboxLineIdEl.textContent = idea.id;
    lightboxTitleEl.textContent = idea.name;
    lightboxWorkerEl.textContent = (idea.credit || `made by worker #${idea.seat}`);
    lightboxCounterEl.textContent = `${idx + 1} / ${idea.products.length}`;

    // Show the light preview at once, then swap in the swarm's full-size original when it has loaded.
    lightboxImgEl.src = prod.img;
    lightboxImgEl.dataset.want = prod.full || '';
    if (prod.full) {
      const hi = new Image();
      hi.onload = () => { if (lightboxImgEl.dataset.want === prod.full) lightboxImgEl.src = prod.full; };
      hi.src = prod.full;
    }
    lightboxImgEl.alt = `${idea.name} — ${prod.parsed.prominent}`;
    lightboxConceptEl.hidden = !prod.concept;

    lightboxProdNameEl.textContent = prod.parsed.prominent;
    lightboxProdRestEl.textContent = prod.parsed.rest;
    lightboxProdRestEl.hidden = !prod.parsed.rest;

    // Render lightbox thumbnails
    lightboxThumbsEl.innerHTML = '';
    idea.products.forEach((p, pIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = pIdx === idx;
      btn.className = `thumb-btn${active ? ' is-active' : ''}`;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-label', `${idea.name} — ${p.parsed.prominent}`);

      const wrap = document.createElement('span');
      wrap.className = 'thumb-img-wrap';

      const img = document.createElement('img');
      img.src = p.img;
      img.alt = `${idea.name} — ${p.parsed.shortName}`;
      img.width = 180;
      img.height = 180;

      wrap.appendChild(img);

      const lbl = document.createElement('span');
      lbl.className = 'thumb-short-label';
      lbl.textContent = p.parsed.shortName;

      btn.appendChild(wrap);
      btn.appendChild(lbl);

      btn.addEventListener('click', () => {
        state.lightbox.productIndex = pIdx;
        state.activeProductByIdea[idea.id] = pIdx;
        updateLightboxView();
      });

      lightboxThumbsEl.appendChild(btn);
    });
  }

  // Lightbox Event Listeners
  lightboxCloseBtn.addEventListener('click', closeLightbox);
  lightboxPrevBtn.addEventListener('click', () => stepLightbox(-1));
  lightboxNextBtn.addEventListener('click', () => stepLightbox(1));

  lightboxEl.addEventListener('click', (e) => {
    if (e.target && e.target.hasAttribute('data-lightbox-close')) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!state.lightbox.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepLightbox(1);
    }
  });

  // Touch swipe support on lightbox stage
  let touchStartX = null;
  let touchStartY = null;

  lightboxStageEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    },
    { passive: true }
  );

  lightboxStageEl.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null || touchStartY === null) return;
      if (e.changedTouches && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) {
            stepLightbox(1);
          } else {
            stepLightbox(-1);
          }
        }
      }
      touchStartX = null;
      touchStartY = null;
    },
    { passive: true }
  );

  // Sort buttons listeners
  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSortBy(btn.dataset.sort);
    });
  });

  // Subscribe to vote API status changes
  if (window.VoteAPI && typeof window.VoteAPI.onStatusChange === 'function') {
    window.VoteAPI.onStatusChange((offline) => {
      offlineBadgeEl.hidden = !offline;
    });
  }

  /**
   * Initialize application: load data.json, render UI, then fetch vote counts.
   */
  async function init() {
    try {
      const response = await fetch('data.json');
      if (!response.ok) {
        throw new Error(`Failed to load data.json (${response.status})`);
      }
      const rawData = await response.json();

      state.job = cleanText(rawData.job || '');
      if (state.job) {
        jobLinkEl.href = `https://api.imd.fun/jobs/${encodeURIComponent(state.job)}`;
        jobLinkEl.title = `job ${state.job}`;
      }

      const rawIdeas = Array.isArray(rawData.ideas) ? rawData.ideas : [];
      state.ideas = rawIdeas.map((item) => {
        const id = cleanText(item.id);
        const products = (Array.isArray(item.products) ? item.products : []).map((p) => ({
          img: cleanText(p.img),
          full: cleanText(p.full || ''),
          label: cleanText(p.label),
          concept: p.concept === true,
          parsed: parseProductLabel(p.label)
        }));

        products.forEach((p) => { if (p.full) (window.__fullFor = window.__fullFor || {})[p.img] = p.full; });
        state.activeProductByIdea[id] = 0;

        // Seed initial counts with local vote floor until remote counts resolve
        const localVote = window.VoteAPI ? window.VoteAPI.getLocalVote(id) : null;
        state.counts[id] = {
          up: localVote === 'up' ? 1 : 0,
          down: localVote === 'down' ? 1 : 0
        };

        return {
          id,
          name: cleanText(item.name),
          question: cleanText(item.question),
          answer: cleanText(item.answer),
          style: cleanText(item.style),
          palette: cleanText(item.palette),
          styleSpec: parseStyleSpec(item.style),
          paletteSpecs: parsePaletteSpecs(item.palette),
          seat: cleanText(item.seat),
          credit: cleanText(item.credit || ''),
          house: !!item.house,
          tag: cleanText(item.tag || ''), // a yardstick from an earlier round
          fromSwarm: !!item.fromSwarm,
          products
        };
      });

      state.shuffledOrder = shuffleIds(state.ideas.map((item) => item.id));

      renderFilterChips();
      renderGrid();
      showTargetLine();
      // The phone swipe deck (swipe.js) works off the same ideas, counts and heart buttons.
      window.SwarmApp = { state, refreshAllVoteBars, makeHeartBtn, lineUrl };
      window.dispatchEvent(new CustomEvent('swarm:ready'));
      if (window.VoteAPI && window.VoteAPI.countVisit) window.VoteAPI.countVisit();

      // "Most liked" / "Most voted" only mean something once every count is in.
      const voteSorts = sortButtons.filter((b) => b.dataset.sort !== 'shuffle');
      voteSorts.forEach((b) => { b.disabled = true; });
      if (sortStatusEl) sortStatusEl.hidden = false;

      // Fetch remote counts with concurrency limit via vote.js
      if (window.VoteAPI && typeof window.VoteAPI.getCounts === 'function') {
        // Read counts a few lines at a time (in the shuffled order, so the cards on screen fill first);
        // vote.js paces the requests to the counter service's rate limit.
        const order = state.shuffledOrder.slice();
        for (let i = 0; i < order.length; i += 4) {
          const remoteCounts = await window.VoteAPI.getCounts(order.slice(i, i + 4));
          Object.keys(remoteCounts).forEach((id) => {
            state.counts[id] = remoteCounts[id];
          });
          offlineBadgeEl.hidden = !remoteCounts._offline;
          refreshAllVoteBars();
        }
        state.countsReady = true;
        window.dispatchEvent(new CustomEvent('swarm:counts'));
        voteSorts.forEach((b) => { b.disabled = false; });
        if (sortStatusEl) sortStatusEl.hidden = true;
      }
    } catch (err) {
      statusBannerEl.textContent = `Error loading merch lines: ${err.message || err}`;
      statusBannerEl.hidden = false;
    }
  }

  init();
})();

// Previews live in img/; if one is missing, load the swarm's original from api.imd.fun instead.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || t.dataset.fellBack) return;
  const full = (window.__fullFor || {})[t.getAttribute('src')];
  if (full) { t.dataset.fellBack = '1'; t.src = full; }
}, true);
