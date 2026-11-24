<script lang="ts">
  import logoUrl from '$lib/assets/idb-logo.svg';
  import { onMount, untrack } from 'svelte';
  import '../app.css';
  import { DATA } from '$lib/data';
  import { clock, tickClock, clampWindow, PLAY_SPEED } from '$lib/time/clock';
  import { createScene, type SceneHandles } from '$lib/globe/scene';
  import { LANG_COLORS } from '$lib/stories/palette';
  import { fold } from '$lib/search';
  import Timeline from '$lib/ui/Timeline.svelte';
  import Legend from '$lib/ui/Legend.svelte';
  import DetailCard from '$lib/ui/DetailCard.svelte';
  import AboutModal from '$lib/ui/AboutModal.svelte';

  const { stories, meta, windowStart, windowEnd } = DATA;
  const LANGS = Object.keys(meta.languages);

  // ---- filters
  let enabled = $state<Record<string, boolean>>(Object.fromEntries(LANGS.map((l) => [l, true])));
  let country = $state<string | null>(null);
  let search = $state('');
  let outlet = $state<string | null>(null); // exact outlet, picked from the typeahead
  const foldedHeadlines = stories.map((s) => fold(s.headline));
  const foldedOutlets = stories.map((s) => fold(s.outlet));

  // `mask` is a stable buffer shared with the scene + timeline; `maskVersion`
  // bumps on every change so dependants re-run.
  const mask = new Uint8Array(stories.length);
  let maskVersion = $state(0);

  /** country/outlet/search filters only (the legend counts ignore the language toggles); q is folded */
  function passesNonLang(i: number, q: string): boolean {
    const s = stories[i];
    if (country && s.country !== country) return false;
    if (outlet && s.outlet !== outlet) return false;
    if (q && !(foldedHeadlines[i].includes(q) || foldedOutlets[i].includes(q))) return false;
    return true;
  }

  /** language + country filters: what the typeahead may suggest */
  function eligible(i: number): boolean {
    return enabled[stories[i].language] && (!country || stories[i].country === country);
  }

  function refreshMask() {
    const q = fold(search.trim());
    for (let i = 0; i < stories.length; i++) {
      mask[i] = enabled[stories[i].language] && passesNonLang(i, q) ? 1 : 0;
    }
    sceneHandles?.setStoryVisibility(mask);
    // untracked: refreshMask runs inside an effect and must not depend on what it writes
    untrack(() => {
      maskVersion++;
      if (selected >= 0 && mask[selected] === 0) selected = -1;
    });
    uiDirty = true;
  }

  /** language click cycle: only this language → all except it → all languages */
  function clickLang(lang: string) {
    const only = LANGS.every((l) => enabled[l] === (l === lang));
    const allBut = LANGS.every((l) => enabled[l] === (l !== lang));
    for (const l of LANGS) enabled[l] = only ? l !== lang : allBut ? true : l === lang;
  }
  function showAllLangs() {
    for (const l of LANGS) enabled[l] = true;
  }

  // ---- throttled reactive copies of the mutable clock
  let simMs = $state(windowStart);
  let playing = $state(false);
  let counters = $state({ stories: 0, langs: 0, countries: 0 });
  let soFar = $state<Record<string, number>>({});
  let uiDirty = true;

  // ---- selection / hover / detail
  let selected = $state(-1);
  // stories sharing the selected story's place (incl. it), lifted into orbit above it
  let cluster = $state<number[]>([]);
  let hovered = $state(-1);
  let hoverPos = $state({ x: 0, y: 0 });
  let aboutOpen = $state(false);

  // ---- intro: auto-plays the whole window from the start on load; any user
  // interaction with time ends it (playback rate is the same either way)
  let intro = $state(false);
  function endIntro(settle: boolean) {
    if (!intro) return;
    intro = false;
    if (settle) {
      clock.t = windowEnd;
      clock.playing = false;
    }
    uiDirty = true;
  }
  function startIntro() {
    selected = -1;
    clock.t = windowStart;
    clock.playing = true;
    intro = true;
  }

  // ---- scene wiring
  let host = $state<HTMLElement | null>(null);
  let sceneHandles: SceneHandles | null = null;
  let loading = $state(true);
  let webglFailed = $state(false);
  // set by any play/scrub input; a user who takes control while the
  // textures load doesn't get the intro forced on them afterwards
  let userTookControl = false;

  const reducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const canHover =
    typeof window !== 'undefined' ? window.matchMedia('(hover: hover)').matches : false;

  /** great-circle distance in degrees between two stories */
  function storyDistDeg(a: number, b: number): number {
    const r = Math.PI / 180;
    const [p1, p2] = [stories[a].lat * r, stories[b].lat * r];
    const dl = (stories[b].lon - stories[a].lon) * r;
    const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    return Math.acos(Math.min(1, c)) / r;
  }
  // city clusters are jittered by up to ~0.2°, so this keeps "here" to one city
  const SAME_PLACE_DEG = 0.35;

  const MAX_CLUSTER = 60; // keeps the satellite rings readable

  /** select a story; `near` are pick hits (nearest first) to build its cluster from */
  function select(i: number, near: number[] = []) {
    // picking another story in the open cluster just moves the selection
    if (i >= 0 && cluster.includes(i)) {
      selected = i;
      return;
    }
    selected = i;
    const same = i < 0 ? [] : near.filter((j) => j !== i && storyDistDeg(i, j) < SAME_PLACE_DEG);
    cluster = same.length ? [i, ...same.slice(0, MAX_CLUSTER - 1)] : [];
    if (i >= 0) sceneHandles?.focus(cluster.length ? $state.snapshot(cluster) : [i]);
  }

  onMount(() => {
    if (!host) return;
    try {
      sceneHandles = createScene(host, stories);
    } catch (err) {
      console.error(err);
      webglFailed = true;
      loading = false;
      return;
    }
    refreshMask();
    sceneHandles.resize();
    sceneHandles.setTimeScale(PLAY_SPEED);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__viz = { sceneHandles, clock, stories, mask };
    }

    let disposed = false;
    let last = performance.now();
    let uiAccum = 0;

    // hold at the start until the textures are in (max 6 s), then run the
    // intro — or, with reduced motion, jump straight to the end of the window
    clock.t = reducedMotion ? windowEnd : windowStart;
    clock.playing = false;
    const begin = () => {
      if (disposed || !loading) return;
      loading = false;
      if (!reducedMotion && !userTookControl) startIntro();
      uiDirty = true;
    };
    sceneHandles.ready.then(begin);
    setTimeout(begin, 6000);

    function loop(now: number) {
      if (disposed) return;
      requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      tickClock(dt);

      if (intro && clock.t >= windowEnd) endIntro(true);

      if (sceneHandles) {
        sceneHandles.setSimTime(clock.t);
        // no drift during the intro, with reduced motion, or while reading a story
        sceneHandles.setIdleDrift(!intro && !reducedMotion && selected < 0);
      }

      // throttled UI updates (~5 Hz), or immediately after a change
      uiAccum += dt;
      if (uiAccum > 200 || uiDirty) {
        uiAccum = 0;
        uiDirty = false;
        simMs = clock.t;
        playing = clock.playing;
        updateCounters();
        // scrubbing back before the selected story un-publishes it
        if (selected >= 0 && stories[selected].publishedAt > clock.t) selected = -1;
      }
    }
    requestAnimationFrame(loop);

    const onResize = () => sceneHandles?.resize();
    window.addEventListener('resize', onResize);

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if (e.code === 'Escape') {
        if (aboutOpen) aboutOpen = false;
        else selected = -1;
      } else if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('a,button')) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);

    // canvas click → pick; drag (orbit) is ignored. A single click waits
    // DOUBLE_MS so a double-click (or double-tap) doesn't also select stories.
    const DOUBLE_MS = 250;
    let pendingClick: ReturnType<typeof setTimeout> | null = null;
    let lastClick = { x: 0, y: 0, t: -Infinity };
    const onClick = (x: number, y: number) => {
      const now = performance.now();
      const isDouble = now - lastClick.t < DOUBLE_MS && Math.hypot(x - lastClick.x, y - lastClick.y) < 24;
      lastClick = { x, y, t: isDouble ? -Infinity : now };
      if (pendingClick) clearTimeout(pendingClick);
      pendingClick = null;
      if (isDouble) return onDoubleClick(x, y);
      pendingClick = setTimeout(() => {
        pendingClick = null;
        if (!sceneHandles) return;
        const hits = sceneHandles.pickAt(x, y);
        select(hits[0] ?? -1, hits);
      }, DOUBLE_MS);
    };
    // zoomed in → back to the starting zoom (closing any story); zoomed out →
    // zoom in on the spot
    const onDoubleClick = (x: number, y: number) => {
      if (!sceneHandles) return;
      if (sceneHandles.isZoomedIn()) {
        if (selected >= 0) {
          returnHome = true; // the deselect effect flies out to the start zoom
          selected = -1;
        } else sceneHandles.unfocus({ home: true });
      } else sceneHandles.zoomToPoint(x, y);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t0 = performance.now();
      const down = { x: e.clientX, y: e.clientY };
      const onUp = (ev: PointerEvent) => {
        const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
        if (moved < 6 && performance.now() - t0 < 500) onClick(ev.clientX, ev.clientY);
      };
      window.addEventListener('pointerup', onUp, { once: true });
    };
    host.addEventListener('pointerdown', onPointerDown);

    // hover tooltip (pointer devices only), one pick per frame at most
    let hoverQueued = false;
    let lastMove = { x: 0, y: 0, buttons: 0 };
    const onPointerMove = (e: PointerEvent) => {
      if (!canHover || e.pointerType !== 'mouse') return;
      lastMove = { x: e.clientX, y: e.clientY, buttons: e.buttons };
      if (hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        if (!sceneHandles || lastMove.buttons) {
          hovered = -1;
          return;
        }
        hovered = sceneHandles.pickAt(lastMove.x, lastMove.y)[0] ?? -1;
        hoverPos = { x: lastMove.x, y: lastMove.y };
      });
    };
    const onPointerLeave = () => (hovered = -1);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      host?.removeEventListener('pointerdown', onPointerDown);
      host?.removeEventListener('pointermove', onPointerMove);
      host?.removeEventListener('pointerleave', onPointerLeave);
      sceneHandles?.dispose();
      sceneHandles = null;
    };
  });

  function updateCounters() {
    const q = fold(search.trim());
    let n = 0;
    const langs = new Set<string>();
    const cts = new Set<string>();
    const perLang: Record<string, number> = {};
    // stories are sorted by publishedAt, so stop at the first future one
    for (let i = 0; i < stories.length && stories[i].publishedAt <= clock.t; i++) {
      const s = stories[i];
      if (!passesNonLang(i, q)) continue;
      perLang[s.language] = (perLang[s.language] ?? 0) + 1;
      if (mask[i] === 0) continue;
      n++;
      langs.add(s.language);
      if (s.country) cts.add(s.country);
    }
    counters = { stories: n, langs: langs.size, countries: cts.size };
    soFar = perLang;
  }

  // ---- time controls (all cancel the intro)
  function togglePlay() {
    userTookControl = true;
    endIntro(false);
    if (!clock.playing && clock.t >= windowEnd) clock.t = windowStart; // replay from the top
    clock.playing = !clock.playing;
    uiDirty = true;
  }
  function jumpToEnd() {
    userTookControl = true;
    endIntro(false);
    clock.t = windowEnd;
    clock.playing = false;
    uiDirty = true;
  }
  function scrub(t: number) {
    userTookControl = true;
    endIntro(false);
    clock.t = clampWindow(t);
    uiDirty = true;
  }

  // refresh mask on any filter change (touch every key so rune deps register)
  $effect(() => {
    for (const k in enabled) void enabled[k];
    void country;
    void search;
    void outlet;
    refreshMask();
  });

  $effect(() => {
    sceneHandles?.setHighlight(selected, hovered);
  });

  // closing a story (card ✕, Esc, empty-space click, filters, scrubbing back)
  // lands its satellites and flies back out to the globe
  let hadSelection = false;
  let returnHome = false; // set by a double-click: fly all the way out to the start zoom
  $effect(() => {
    const has = selected >= 0;
    if (hadSelection && !has) {
      untrack(() => (cluster = []));
      sceneHandles?.unfocus({ home: returnHome });
      returnHome = false;
    }
    hadSelection = has;
  });

  // phones: the detail card is a bottom sheet, so re-centre the globe in the
  // space above it (measured after the card renders)
  $effect(() => {
    const open = selected >= 0;
    const raf = requestAnimationFrame(() => {
      const mobile = window.matchMedia('(max-width: 820px)').matches;
      const card = document.querySelector<HTMLElement>('.card');
      sceneHandles?.setBottomInset(open && mobile && card ? card.offsetHeight : 0);
    });
    return () => cancelAnimationFrame(raf);
  });

  const selectedStory = $derived(selected >= 0 ? stories[selected] : null);

  // ---- prev/next: publication order among stories that are published and
  // pass the filters (stories are sorted by publishedAt)
  const stepList = $derived.by(() => {
    void maskVersion;
    const out: number[] = [];
    for (let i = 0; i < stories.length && stories[i].publishedAt <= simMs; i++) {
      if (mask[i]) out.push(i);
    }
    return out;
  });
  const stepPos = $derived(selected >= 0 ? stepList.indexOf(selected) : -1);

  /** visible stories published by now at the same place as `i`, nearest first */
  function samePlace(i: number): number[] {
    const out: { j: number; d: number }[] = [];
    for (let j = 0; j < stories.length && stories[j].publishedAt <= clock.t; j++) {
      if (!mask[j]) continue;
      const d = storyDistDeg(i, j);
      if (d < SAME_PLACE_DEG) out.push({ j, d });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.j);
  }

  /** typeahead pick: bring time forward to the story if needed, then open it */
  function pickStory(i: number) {
    if (stories[i].publishedAt > clock.t) {
      userTookControl = true;
      endIntro(false);
      clock.t = stories[i].publishedAt;
      clock.playing = false;
      uiDirty = true;
    }
    select(i, samePlace(i));
  }

  function step(dir: 1 | -1) {
    const j = stepList[stepPos + dir];
    if (j === undefined) return;
    select(j, samePlace(j)); // same cluster → just moves; elsewhere → flies there
  }
  const nearby = $derived(
    cluster.filter((j) => j !== selected).map((index) => ({ index, story: stories[index] }))
  );
  const hoveredStory = $derived(hovered >= 0 && hovered !== selected ? stories[hovered] : null);
  const countryList = Object.keys(meta.countries).sort(
    (a, b) => meta.countries[b] - meta.countries[a]
  );
</script>

<div class="root">
  <div class="canvas-host {hovered >= 0 ? 'pointer' : ''} {loading ? 'loading' : ''}" bind:this={host}></div>

  {#if loading}
    <p class="status" aria-live="polite">Loading the globe…</p>
  {/if}
  {#if webglFailed}
    <div class="status fail" role="alert">
      <p>This visualisation needs WebGL, which isn’t available in this browser.</p>
      <p>Try a recent Chrome, Firefox, Safari or Edge, or check that hardware acceleration is on.</p>
    </div>
  {/if}

  <header class="titlebar">
    <h1><img class="logo" src={logoUrl} alt="Inside Deutsche Bank" /></h1>
    <p class="sub">The banking data leak that travelled around the world</p>
    <div class="counters">
      <span><b>{counters.stories.toLocaleString('en')}</b> {counters.stories === 1 ? 'story' : 'stories'}</span>
      <span><b>{counters.langs}</b> {counters.langs === 1 ? 'language' : 'languages'}</span>
      <span><b>{counters.countries}</b> {counters.countries === 1 ? 'country' : 'countries'}</span>
    </div>
  </header>

  <button class="about-btn" onclick={() => (aboutOpen = true)}>About</button>
  <p class="hint">space play/pause · click a dot</p>

  <Legend
    {meta}
    {enabled}
    {soFar}
    onLang={clickLang}
    onAll={showAllLangs}
    countries={countryList}
    {country}
    onCountry={(c) => (country = c)}
    {search}
    onSearch={(q) => (search = q)}
    {stories}
    {foldedHeadlines}
    {foldedOutlets}
    {eligible}
    {outlet}
    onOutlet={(o) => (outlet = o)}
    onPickStory={pickStory}
  />

  {#if hoveredStory}
    <div class="tooltip" style="left: {hoverPos.x}px; top: {hoverPos.y}px">
      <span class="dot" style="background: {LANG_COLORS[hoveredStory.language] ?? '#888'}"></span>
      <span class="hl">{hoveredStory.headline}</span>
      <span class="src">{hoveredStory.outlet}</span>
    </div>
  {/if}

  {#if selectedStory}
    <DetailCard
      story={selectedStory}
      {nearby}
      onPick={(i) => select(i)}
      onClose={() => (selected = -1)}
      position={stepPos + 1}
      total={stepList.length}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
    />
  {/if}

  {#if aboutOpen}
    <AboutModal meta={meta} onClose={() => (aboutOpen = false)} />
  {/if}

  <Timeline
    {stories}
    {mask}
    {maskVersion}
    {windowStart}
    {windowEnd}
    {simMs}
    {playing}
    onScrub={scrub}
    onTogglePlay={togglePlay}
    onRestart={startIntro}
    onEnd={jumpToEnd}
  />
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  .canvas-host {
    transition: opacity 900ms ease;
  }
  .canvas-host.loading {
    opacity: 0;
  }
  .status {
    position: absolute;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .status.fail {
    width: min(420px, calc(100vw - 32px));
    color: var(--text);
    line-height: 1.5;
  }
  .canvas-host.pointer {
    cursor: pointer;
  }
  .canvas-host :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .titlebar {
    position: absolute;
    top: 18px;
    left: 18px;
    pointer-events: none;
  }
  h1 {
    margin: 0;
    line-height: 0;
  }
  .logo {
    height: 30px;
    width: auto;
  }
  .sub {
    margin: 10px 0 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .counters {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .counters b {
    color: var(--text);
    font-family: var(--mono);
  }
  .about-btn {
    position: absolute;
    top: 18px;
    right: 16px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--text);
    font-size: 12px;
    border-radius: 99px;
    padding: 6px 14px;
  }
  .about-btn:hover {
    border-color: var(--accent);
  }
  .hint {
    position: absolute;
    top: 50px;
    right: 18px;
    margin: 0;
    color: var(--text-dim);
    font-size: 10px;
    opacity: 0.7;
    pointer-events: none;
  }
  .tooltip {
    position: absolute;
    transform: translate(14px, 14px);
    max-width: 280px;
    display: grid;
    grid-template-columns: 8px 1fr;
    column-gap: 8px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 7px 10px;
    pointer-events: none;
    backdrop-filter: blur(8px);
    z-index: 10;
  }
  .tooltip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 4px;
  }
  .tooltip .hl {
    font-size: 12px;
    line-height: 1.35;
  }
  .tooltip .src {
    grid-column: 2;
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 2px;
  }
  @media (max-width: 820px) {
    .counters span:nth-child(3),
    .hint {
      display: none;
    }
    .titlebar {
      max-width: calc(100vw - 120px);
    }
    .logo {
      height: 24px;
    }
  }
</style>
