<script lang="ts">
  import { onMount } from 'svelte';
  import type { Story } from '../data';
  import { LANG_COLORS } from '../stories/palette';
  import { clock, fmtSimTime } from '../time/clock';

  interface Props {
    stories: Story[];
    mask: Uint8Array; // filtered visibility (mutated in place)
    maskVersion: number; // bumps whenever `mask` changes
    windowStart: number;
    windowEnd: number;
    simMs: number; // reactive display value
    playing: boolean;
    onScrub: (t: number) => void;
    onTogglePlay: () => void;
    onRestart: () => void;
    onEnd: () => void;
  }

  let {
    stories,
    mask,
    maskVersion,
    windowStart,
    windowEnd,
    simMs,
    playing,
    onScrub,
    onTogglePlay,
    onRestart,
    onEnd
  }: Props = $props();

  const BIN_MS = 15 * 60 * 1000;
  // the data window is fixed for the lifetime of the page
  // svelte-ignore state_referenced_locally
  const binCount = Math.ceil((windowEnd - windowStart) / BIN_MS);
  const binOf = (t: number) => Math.min(binCount - 1, Math.floor((t - windowStart) / BIN_MS));

  let canvas = $state<HTMLCanvasElement | null>(null);
  let track = $state<HTMLElement | null>(null);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let hoverX = $state<number | null>(null);
  let hoverT = $state(0);

  const playheadPct = $derived(((simMs - windowStart) / (windowEnd - windowStart)) * 100);

  let drawing = false;
  function drawHist() {
    if (!canvas || drawing) return;
    drawing = true;
    requestAnimationFrame(() => {
      drawing = false;
      const cv = canvas;
      if (!cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      cv.width = w * dpr;
      cv.height = h * dpr;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // per-language stacked bins (only filtered-visible stories)
      const byLang: Record<string, Float32Array> = {};
      for (let i = 0; i < stories.length; i++) {
        if (mask[i] === 0) continue;
        const lang = stories[i].language;
        (byLang[lang] ??= new Float32Array(binCount))[binOf(stories[i].publishedAt)]++;
      }
      const maxStack = new Float32Array(binCount);
      for (const arr of Object.values(byLang)) {
        for (let b = 0; b < binCount; b++) maxStack[b] += arr[b];
      }
      let peak = 1;
      for (let b = 0; b < binCount; b++) peak = Math.max(peak, maxStack[b]);

      const bw = w / binCount;
      for (let b = 0; b < binCount; b++) {
        let y = h;
        for (const [lang, arr] of Object.entries(byLang)) {
          const v = arr[b] / peak;
          if (v <= 0) continue;
          y -= v * (h - 6);
          ctx.fillStyle = LANG_COLORS[lang] ?? '#888';
          ctx.fillRect(b * bw, y, Math.max(1, bw - 0.5), v * (h - 6));
        }
      }

      // UTC midnight ticks, labelled with the day that starts there
      ctx.font = '10px ui-sans-serif, system-ui';
      const d0 = new Date(windowStart);
      const firstMidnight = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1);
      for (let t = firstMidnight; t < windowEnd; t += 86400000) {
        const x = Math.round(((t - windowStart) / (windowEnd - windowStart)) * w) + 0.5;
        ctx.fillStyle = 'rgba(180,195,230,0.18)';
        ctx.fillRect(x, 0, 1, h);
        if (x < w - 52) {
          const d = new Date(t);
          ctx.fillStyle = 'rgba(180,195,230,0.6)';
          ctx.fillText(`${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`, x + 4, 11);
        }
      }
    });
  }

  $effect(() => {
    void maskVersion;
    drawHist();
  });
  onMount(() => {
    drawHist();
    window.addEventListener('resize', drawHist);
    return () => window.removeEventListener('resize', drawHist);
  });

  // The playhead follows the clock every frame (the `simMs` prop only updates
  // ~5 Hz, which made it step during playback). Written straight to the DOM.
  let playheadEl = $state<HTMLElement | null>(null);
  let futureEl = $state<HTMLElement | null>(null);
  onMount(() => {
    let raf = 0;
    let lastPct = -1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const pct = ((clock.t - windowStart) / (windowEnd - windowStart)) * 100;
      if (pct === lastPct || !playheadEl || !futureEl) return;
      lastPct = pct;
      playheadEl.style.left = futureEl.style.left = `${pct}%`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

  function scrubTo(clientX: number) {
    if (!track) return;
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onScrub(windowStart + f * (windowEnd - windowStart));
  }
  let dragging = false;
  function onPointerDown(e: PointerEvent) {
    dragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) scrubTo(e.clientX);
    if (!track) return;
    const r = track.getBoundingClientRect();
    hoverX = Math.min(r.width, Math.max(0, e.clientX - r.left));
    hoverT = windowStart + (hoverX / r.width) * (windowEnd - windowStart);
  }
  function onPointerUp() {
    dragging = false;
  }
</script>

<div class="timeline">
  <div class="controls">
    <button class="ctl play" onclick={onTogglePlay} title={playing ? 'Pause' : 'Play'}>
      {playing ? '❚❚' : '▶'}
    </button>
    <button class="ctl" onclick={onRestart} title="Back to start" aria-label="Back to start">⏮</button>
    <button class="ctl" onclick={onEnd} title="Jump to end" aria-label="Jump to end">⏭</button>
    <span class="clock">{fmtSimTime(simMs)} <span class="tz">UTC</span></span>
  </div>
  <div
    class="scrub"
    bind:this={track}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={() => (hoverX = null)}
    role="slider"
    aria-label="Timeline"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(playheadPct)}
    tabindex="0"
  >
    <canvas class="hist" bind:this={canvas}></canvas>
    <!-- not-yet-reached part of the window is dimmed -->
    <div class="future" bind:this={futureEl}></div>
    <div class="playhead" bind:this={playheadEl}></div>
    {#if hoverX !== null}
      <div class="hover" style="left: {hoverX}px">
        <span>{fmtSimTime(hoverT)}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .timeline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 10px 16px 14px;
    background: linear-gradient(transparent, rgba(3, 5, 12, 0.85));
    user-select: none;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .ctl {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--text);
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 13px;
  }
  .ctl:hover {
    border-color: var(--accent);
  }
  .play {
    min-width: 40px;
    font-size: 12px;
  }
  .tz {
    color: var(--text-dim);
    font-size: 11px;
  }
  .clock {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text);
  }
  .scrub {
    position: relative;
    height: 74px;
    cursor: crosshair;
    touch-action: none;
  }
  .hist {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .future {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    background: rgba(3, 5, 12, 0.55);
    pointer-events: none;
  }
  .hover {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(220, 230, 255, 0.45);
    pointer-events: none;
  }
  .hover span {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    transform: translateX(-50%);
    font-family: var(--mono);
    font-size: 10px;
    white-space: nowrap;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
    pointer-events: none;
  }
  .playhead::after {
    content: '';
    position: absolute;
    top: -4px;
    left: -4px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
  }
  @media (max-width: 700px) {
    .scrub {
      height: 58px;
    }
  }
</style>
