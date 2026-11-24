<script lang="ts">
  import type { Story } from '../data';
  import { LANG_COLORS } from '../stories/palette';
  import { fmtSimTime } from '../time/clock';
  import { fold, splitMatch, matchRank } from '../search';

  interface Props {
    stories: Story[];
    foldedHeadlines: string[];
    foldedOutlets: string[];
    /** stories that pass the language/country filters (suggestions only offer these) */
    eligible: (i: number) => boolean;
    search: string; // free-text filter, live as you type
    outlet: string | null; // exact outlet filter
    onSearch: (q: string) => void;
    onOutlet: (o: string | null) => void;
    onPickStory: (i: number) => void;
  }
  let {
    stories,
    foldedHeadlines,
    foldedOutlets,
    eligible,
    search,
    outlet,
    onSearch,
    onOutlet,
    onPickStory
  }: Props = $props();

  const MAX_OUTLETS = 5;
  const MAX_HEADLINES = 6;
  const uid = Math.random().toString(36).slice(2, 8);

  type Suggestion =
    | { kind: 'outlet'; name: string; count: number }
    | { kind: 'story'; index: number };

  let open = $state(false);
  let active = $state(-1);
  let input = $state<HTMLInputElement | null>(null);

  const q = $derived(fold(search.trim()));

  const suggestions = $derived.by((): Suggestion[] => {
    if (q.length < 2) return [];
    // outlets: best match position first, then most stories
    const outlets = new Map<string, { count: number; rank: number }>();
    const heads: { index: number; rank: number }[] = [];
    for (let i = 0; i < stories.length; i++) {
      if (!eligible(i)) continue;
      const or = matchRank(foldedOutlets[i], q);
      if (or >= 0) {
        const o = outlets.get(stories[i].outlet);
        if (o) o.count++;
        else outlets.set(stories[i].outlet, { count: 1, rank: or });
      }
      const hr = matchRank(foldedHeadlines[i], q);
      if (hr >= 0) heads.push({ index: i, rank: hr });
    }
    const os = [...outlets.entries()]
      .sort((a, b) => a[1].rank - b[1].rank || b[1].count - a[1].count)
      .slice(0, MAX_OUTLETS)
      .map(([name, o]): Suggestion => ({ kind: 'outlet', name, count: o.count }));
    // headlines: best match position first, then earliest published
    const hs = heads
      .sort((a, b) => a.rank - b.rank || stories[a.index].publishedAt - stories[b.index].publishedAt)
      .slice(0, MAX_HEADLINES)
      .map((h): Suggestion => ({ kind: 'story', index: h.index }));
    return [...os, ...hs];
  });
  const headlineTotal = $derived.by(() => {
    if (q.length < 2) return 0;
    let n = 0;
    for (let i = 0; i < stories.length; i++) if (eligible(i) && foldedHeadlines[i].includes(q)) n++;
    return n;
  });

  const showList = $derived(open && suggestions.length > 0);

  function choose(s: Suggestion) {
    open = false;
    active = -1;
    if (s.kind === 'outlet') {
      onOutlet(s.name);
      onSearch('');
    } else {
      onPickStory(s.index);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      open = true;
      const n = suggestions.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
    } else if (e.key === 'Enter') {
      if (showList && active >= 0) {
        e.preventDefault();
        choose(suggestions[active]);
      } else open = false; // free text: the filter is already live
    } else if (e.key === 'Escape') {
      if (showList) {
        e.stopPropagation();
        open = false;
        active = -1;
      } else if (search) onSearch('');
    }
  }

  const optId = (i: number) => `sb-${uid}-${i}`;

  // On phones the list is inline, so collapsing it moves the rest of the sheet.
  // If focus left because of a tap or click, keep the list until that click has
  // landed, then collapse. (Touch releases before the blur and mouse after it,
  // so key off the click itself, not pointerup.)
  let lastPointerDown = -Infinity;
  $effect(() => {
    const down = () => (lastPointerDown = performance.now());
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  });
  function onBlur() {
    if (performance.now() - lastPointerDown > 1000) {
      open = false; // keyboard (Tab) or programmatic blur
      return;
    }
    const ac = new AbortController();
    const close = () => {
      ac.abort();
      clearTimeout(fallback);
      setTimeout(() => (open = false)); // after the click's handlers
    };
    // no click comes if the press turned into a scroll or drag
    const fallback = setTimeout(close, 700);
    window.addEventListener('click', close, { capture: true, signal: ac.signal });
  }
</script>

<div class="searchbox">
  {#if outlet}
    <div class="outlet-chip">
      <span><span class="dim">Outlet:</span> {outlet}</span>
      <button onclick={() => onOutlet(null)} aria-label="Clear outlet filter">✕</button>
    </div>
  {/if}
  <input
    bind:this={input}
    type="search"
    placeholder={outlet ? 'Search within this outlet…' : 'Search headline or outlet…'}
    value={search}
    role="combobox"
    aria-label="Search headline or outlet"
    aria-autocomplete="list"
    aria-expanded={showList}
    aria-controls="sb-{uid}-list"
    aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
    autocomplete="off"
    spellcheck="false"
    oninput={(e) => {
      onSearch((e.target as HTMLInputElement).value);
      open = true;
      active = -1;
    }}
    onfocus={() => (open = true)}
    onblur={onBlur}
    onkeydown={onKeydown}
  />
  {#if showList}
    <ul class="list" id="sb-{uid}-list" role="listbox" aria-label="Suggestions">
      {#each suggestions as s, i (s.kind === 'outlet' ? 'o:' + s.name : 's:' + s.index)}
        {#if i === 0 && s.kind === 'outlet'}<li class="group" role="presentation">Outlets</li>{/if}
        {#if s.kind === 'story' && (i === 0 || suggestions[i - 1].kind === 'outlet')}
          <li class="group" role="presentation">
            Headlines{#if headlineTotal > MAX_HEADLINES}<span class="dim"> · {headlineTotal.toLocaleString('en')} matches, all shown on the globe</span>{/if}
          </li>
        {/if}
        <!-- keyboard is handled on the input (combobox + aria-activedescendant) -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optId(i)}
          role="option"
          aria-selected={i === active}
          class="opt {i === active ? 'active' : ''}"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => choose(s)}
          onmousemove={() => (active = i)}
        >
          {#if s.kind === 'outlet'}
            {@const parts = splitMatch(s.name, q)}
            <span class="text">{#if parts}{parts[0]}<mark>{parts[1]}</mark>{parts[2]}{:else}{s.name}{/if}</span>
            <span class="count">{s.count.toLocaleString('en')}</span>
          {:else}
            {@const st = stories[s.index]}
            {@const parts = splitMatch(st.headline, q)}
            <span class="dot" style="background: {LANG_COLORS[st.language] ?? '#888'}"></span>
            <span class="text">{#if parts}{parts[0]}<mark>{parts[1]}</mark>{parts[2]}{:else}{st.headline}{/if}</span>
            <span class="sub">{st.outlet} · {fmtSimTime(st.publishedAt)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .searchbox {
    position: relative;
    margin-top: 6px;
  }
  input {
    width: 100%;
    background: rgba(10, 14, 24, 0.9);
    border: 1px solid var(--panel-border);
    color: var(--text);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 12px;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .outlet-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 6px;
    padding: 4px 4px 4px 9px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    font-size: 12px;
    background: rgba(100, 181, 246, 0.1);
  }
  .outlet-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .outlet-chip button {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 2px 6px;
  }
  .outlet-chip button:hover {
    color: var(--text);
  }
  .dim {
    color: var(--text-dim);
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: max(100%, min(360px, calc(100vw - 32px)));
    max-height: min(60vh, 440px);
    overflow: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: #0a0e18f8;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    z-index: 20;
  }
  .group {
    padding: 8px 8px 4px;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .group .dim {
    letter-spacing: 0;
    text-transform: none;
  }
  .opt {
    display: grid;
    grid-template-columns: 8px 1fr auto;
    column-gap: 8px;
    align-items: baseline;
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1.35;
  }
  .opt .text {
    grid-column: 1 / 3;
  }
  .opt .dot + .text {
    grid-column: 2 / 4;
  }
  .opt.active {
    background: rgba(100, 181, 246, 0.14);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    align-self: start;
    margin-top: 4px;
  }
  .count {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }
  .sub {
    grid-column: 2 / 4;
    font-size: 10px;
    color: var(--text-dim);
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  @media (max-width: 820px) {
    input {
      min-height: 40px;
      font-size: 16px; /* ≥16px stops iOS zooming into the field */
    }
    .list {
      position: static;
      width: auto;
      margin-top: 6px;
      max-height: none;
      box-shadow: none;
    }
    .opt {
      padding: 9px 8px;
    }
  }
</style>
