<script lang="ts">
  import type { Story } from '../data';
  import { LANG_COLORS, LANG_NAMES } from '../stories/palette';
  import { fmtSimTime } from '../time/clock';

  interface Props {
    story: Story | null;
    nearby: { index: number; story: Story }[]; // other stories at this spot, nearest first
    onPick: (index: number) => void;
    onClose: () => void;
    /** 1-based place in publication order among visible stories, and how many there are */
    position: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  }
  let { story, nearby, onPick, onClose, position, total, onPrev, onNext }: Props = $props();
  const fmt = (n: number) => n.toLocaleString('en');

  // each new story starts at the top of the scrolling body
  let body = $state<HTMLElement | null>(null);
  $effect(() => {
    void story;
    if (body) body.scrollTop = 0;
  });

  // outlet-placed stories need no note: that's where they're from
  const GEO_NOTE: Partial<Record<Story['geoBasis'], string>> = {
    country: 'placed in the country named by the source',
    language: 'approx. location — inferred from language only'
  };
  const MAX_NEARBY = 8;
</script>

{#if story}
  <!-- fixed size with a non-scrolling header, so ‹ › and ✕ never move as
       stories of different lengths come and go -->
  <aside class="card">
    <header>
      <nav class="steps" aria-label="Step through stories in publication order">
        <button onclick={onPrev} disabled={position <= 1} aria-label="Previous story" title="Previous story">‹</button>
        <span>{fmt(position)} of {fmt(total)}</span>
        <button onclick={onNext} disabled={position >= total} aria-label="Next story" title="Next story">›</button>
      </nav>
      <button class="x" onclick={onClose} aria-label="Close">✕</button>
    </header>
    <div class="body" bind:this={body}>
    <span
      class="lang-chip"
      style="background: {LANG_COLORS[story.language] ?? '#888'}33; color: {LANG_COLORS[story.language] ?? '#ccc'}"
      >{LANG_NAMES[story.language] ?? story.language}</span
    >
    <h2>{story.headline}</h2>
    <p class="meta">
      {story.outlet}
      {#if story.country}· {story.country.toUpperCase()}{/if}
    </p>
    {#if GEO_NOTE[story.geoBasis]}
      <p class="geo {story.geoBasis === 'language' ? 'approx' : ''}">{GEO_NOTE[story.geoBasis]}</p>
    {/if}
    <p class="time">{fmtSimTime(story.publishedAt)}</p>
    <!-- the pipeline only keeps snippets that add text beyond headline + outlet -->
    {#if story.snippet}<p class="snippet">{story.snippet}</p>{/if}
    <a class="open" href={story.url} target="_blank" rel="noopener noreferrer">Read the article ↗</a>
    {#if nearby.length}
      <h3>{nearby.length} more {nearby.length === 1 ? 'story' : 'stories'} here</h3>
      <ul class="nearby">
        {#each nearby.slice(0, MAX_NEARBY) as n (n.index)}
          <li>
            <button onclick={() => onPick(n.index)}>
              <span class="dot" style="background: {LANG_COLORS[n.story.language] ?? '#888'}"></span>
              <span class="hl">{n.story.headline}</span>
              <span class="src">{n.story.outlet}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if nearby.length > MAX_NEARBY}<p class="more">+{nearby.length - MAX_NEARBY} more at this location</p>{/if}
    {/if}
    </div>
  </aside>
{/if}

<style>
  .card {
    position: absolute;
    bottom: 118px;
    left: 14px;
    width: min(330px, calc(100vw - 28px));
    height: 42vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    backdrop-filter: blur(8px);
    animation: rise 160ms ease-out;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px 16px;
    border-bottom: 1px solid var(--panel-border);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 12px 16px 14px;
  }
  .x {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 13px;
  }
  .x:hover {
    color: var(--text);
  }
  .steps {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }
  .steps span {
    /* room for "1,546 of 1,546" so › doesn't shift as the count grows */
    min-width: 14ch;
    text-align: center;
  }
  .steps button {
    width: 28px;
    height: 26px;
    background: transparent;
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    color: var(--text);
    font-size: 16px;
    line-height: 1;
  }
  .steps button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .steps button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .lang-chip {
    display: inline-block;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 99px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    line-height: 1.35;
  }
  .meta {
    margin: 0 0 2px;
    font-size: 12px;
    color: var(--text);
  }
  .geo {
    margin: 0 0 2px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .geo.approx {
    font-style: italic;
    color: #e6b86a;
  }
  h3 {
    margin: 14px 0 4px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .nearby {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .nearby button {
    display: grid;
    grid-template-columns: 8px 1fr;
    column-gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 5px 4px;
    text-align: left;
    color: var(--text);
  }
  .nearby button:hover {
    background: rgba(140, 160, 210, 0.1);
  }
  .nearby .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 4px;
  }
  .nearby .hl {
    font-size: 12px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .nearby .src {
    grid-column: 2;
    font-size: 10px;
    color: var(--text-dim);
  }
  .more {
    margin: 4px 0 0;
    font-size: 10px;
    color: var(--text-dim);
  }
  .time {
    margin: 0 0 8px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }
  .snippet {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .open {
    display: inline-block;
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    border: 1px solid var(--accent);
    padding: 5px 12px;
    border-radius: 8px;
  }
  .open:hover {
    background: rgba(100, 181, 246, 0.12);
  }
  /* phones: full-width sheet over the timeline */
  @media (max-width: 820px) {
    .card {
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      height: 62vh;
      border-radius: 16px 16px 0 0;
      background: #0a0e18f5;
      z-index: 25;
      animation: sheet 200ms ease-out;
    }
    .body {
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
    .x {
      padding: 6px 8px;
      font-size: 15px;
    }
    .nearby button {
      padding: 8px 4px;
    }
  }
  @keyframes sheet {
    from {
      transform: translateY(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
  }
</style>
