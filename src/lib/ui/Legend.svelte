<script lang="ts">
  import { LANG_COLORS, LANG_NAMES } from '../stories/palette';
  import type { Meta, Story } from '../data';
  import SearchBox from './SearchBox.svelte';

  interface Props {
    meta: Meta;
    enabled: Record<string, boolean>; // lang → visible
    soFar: Record<string, number>; // lang → stories published so far (country/search filters applied)
    /** cycles: only this language → all except it → all */
    onLang: (lang: string) => void;
    onAll: () => void;
    countries: string[];
    country: string | null;
    onCountry: (c: string | null) => void;
    search: string;
    onSearch: (s: string) => void;
    // typeahead
    stories: Story[];
    foldedHeadlines: string[];
    foldedOutlets: string[];
    eligible: (i: number) => boolean;
    outlet: string | null;
    onOutlet: (o: string | null) => void;
    onPickStory: (i: number) => void;
  }

  let {
    meta,
    enabled,
    soFar,
    onLang,
    onAll,
    countries,
    country,
    onCountry,
    search,
    onSearch,
    stories,
    foldedHeadlines,
    foldedOutlets,
    eligible,
    outlet,
    onOutlet,
    onPickStory
  }: Props = $props();

  const langs = $derived(
    Object.keys(meta.languages).sort((a, b) => meta.languages[b] - meta.languages[a])
  );
  const allOn = $derived(langs.every((l) => enabled[l]));

  /** what clicking `lang` will do next (mirrors the page's click cycle) */
  function nextAction(lang: string): string {
    const name = LANG_NAMES[lang] ?? lang;
    if (langs.every((l) => enabled[l] === (l === lang))) return `Show all except ${name}`;
    if (langs.every((l) => enabled[l] === (l !== lang))) return 'Show all languages';
    return `Show only ${name}`;
  }

  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const countryName = (c: string) => {
    try {
      return regionNames.of(c.toUpperCase()) ?? c.toUpperCase();
    } catch {
      return c.toUpperCase();
    }
  };

  // Desktop: floating panel. Narrow screens: a pill button that opens a
  // bottom sheet, so the filters never sit on top of the globe.
  const MOBILE_QUERY = '(max-width: 820px)';
  let mobile = $state(typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  $effect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => (mobile = mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
  let sheetOpen = $state(false);

  const activeFilters = $derived(
    (allOn ? 0 : 1) + (country ? 1 : 0) + (search.trim() ? 1 : 0) + (outlet ? 1 : 0)
  );

  function clearAll() {
    if (!allOn) onAll();
    onCountry(null);
    onSearch('');
    onOutlet(null);
  }
</script>

<svelte:window onkeydown={(e) => e.code === 'Escape' && (sheetOpen = false)} />

{#snippet filters()}
  <div class="head">
    <h3>Language</h3>
    {#if !allOn}<button class="link" onclick={onAll}>show all</button>{/if}
  </div>
  <div class="legend">
    {#each langs as lang (lang)}
      <button
        class="sw {enabled[lang] ? '' : 'off'}"
        onclick={() => onLang(lang)}
        title={nextAction(lang)}
        aria-label="{LANG_NAMES[lang] ?? lang}: {nextAction(lang)}"
        aria-pressed={enabled[lang]}
      >
        <span class="chip" style="background: {LANG_COLORS[lang] ?? '#888'}"></span>
        <span class="name">{LANG_NAMES[lang] ?? lang}</span>
        <span class="count"><b>{(soFar[lang] ?? 0).toLocaleString('en')}</b>/{meta.languages[lang].toLocaleString('en')}</span>
      </button>
    {/each}
  </div>

  <h3>Country</h3>
  <select
    value={country ?? ''}
    onchange={(e) => onCountry((e.target as HTMLSelectElement).value || null)}
    aria-label="Country"
  >
    <option value="">All countries</option>
    {#each countries as c (c)}
      <option value={c}>{countryName(c)} ({meta.countries[c]})</option>
    {/each}
  </select>
  <p class="note">Country filter only covers stories whose source named a country.</p>
  <!-- last, so its suggestions open below everything else instead of over it -->
  <SearchBox
    {stories}
    {foldedHeadlines}
    {foldedOutlets}
    {eligible}
    {search}
    {outlet}
    {onSearch}
    {onOutlet}
    onPickStory={(i) => {
      sheetOpen = false; // phones: get the sheet out of the way of the story card
      onPickStory(i);
    }}
  />
{/snippet}

{#if !mobile}
  <div class="panel">
    {@render filters()}
  </div>
{:else}
  <button class="pill" onclick={() => (sheetOpen = true)} aria-haspopup="dialog">
    Filters{#if activeFilters}<span class="badge">{activeFilters}</span>{/if}
  </button>
  {#if sheetOpen}
    <div class="scrim" role="presentation" onclick={() => (sheetOpen = false)}></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Filters">
      <div class="sheet-head">
        <span class="grab" aria-hidden="true"></span>
        <h2>Filters</h2>
        <div class="actions">
          {#if activeFilters}<button class="clear" onclick={clearAll}>Clear</button>{/if}
          <button class="done" onclick={() => (sheetOpen = false)}>Done</button>
        </div>
      </div>
      {@render filters()}
    </div>
  {/if}
{/if}

<style>
  .panel {
    position: absolute;
    top: 76px;
    right: 14px;
    width: 220px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    padding: 8px 12px 12px;
    backdrop-filter: blur(8px);
  }
  .pill {
    position: absolute;
    top: 54px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--text);
    font-size: 12px;
    border-radius: 99px;
    padding: 6px 14px;
  }
  .badge {
    min-width: 17px;
    height: 17px;
    border-radius: 99px;
    background: var(--accent);
    color: #03050c;
    font-size: 10px;
    font-weight: 600;
    line-height: 17px;
    text-align: center;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(2, 4, 10, 0.55);
    z-index: 30;
    animation: fade 160ms ease-out;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 78vh;
    overflow: auto;
    overscroll-behavior: contain;
    background: #0a0e18f5;
    border-top: 1px solid var(--panel-border);
    border-radius: 16px 16px 0 0;
    padding: 6px 16px calc(16px + env(safe-area-inset-bottom));
    z-index: 31;
    animation: slide 200ms ease-out;
  }
  .sheet-head {
    position: sticky;
    top: -6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 0 6px;
    background: #0a0e18f5;
  }
  .grab {
    position: absolute;
    top: 4px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: rgba(140, 160, 210, 0.35);
  }
  .sheet-head h2 {
    margin: 0;
    font-size: 15px;
  }
  .actions {
    display: flex;
    align-items: center;
  }
  .clear {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 14px;
    padding: 6px 4px 6px 12px;
  }
  .done {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    padding: 6px 0 6px 12px;
  }
  .sheet .legend {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .sheet .sw {
    min-height: 40px;
    padding: 6px 10px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    font-size: 13px;
  }
  .sheet select {
    min-height: 40px;
    font-size: 16px; /* ≥16px stops iOS zooming into the field */
  }
  @keyframes slide {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h3 {
    margin: 6px 0 6px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 11px;
    padding: 0;
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 8px;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 3px 4px;
    border-radius: 6px;
    font-size: 12px;
    text-align: left;
  }
  .sw:hover {
    background: rgba(140, 160, 210, 0.1);
  }
  .sw.off {
    opacity: 0.35;
  }
  .chip {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    flex: none;
  }
  .count {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 11px;
    font-family: var(--mono);
  }
  .count b {
    color: var(--text);
    font-weight: 500;
  }
  select {
    width: 100%;
    background: rgba(10, 14, 24, 0.9);
    border: 1px solid var(--panel-border);
    color: var(--text);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 12px;
    margin-top: 6px;
  }
  .note {
    margin: 8px 0 0;
    font-size: 10px;
    line-height: 1.4;
    color: var(--text-dim);
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .scrim {
      animation: none;
    }
  }
</style>
