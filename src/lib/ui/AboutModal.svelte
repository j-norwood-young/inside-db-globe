<script lang="ts">
  import type { Meta } from '../data';

  let { meta, onClose }: { meta: Meta; onClose: () => void } = $props();
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="About" tabindex="-1">
    <button class="x" onclick={onClose} aria-label="Close">✕</button>
    <!-- scrolls inside an inset, so the ✕ stays put and text never runs into the border -->
    <div class="body">
      <h1>Inside Deutsche Bank: Risky Business</h1>
      <p>
        For the first time, a major global investigation reveals the inner workings of Deutsche
        Bank, Germany’s biggest and most significant bank. It is based on a leak of more than
        15 million files covering the bank’s activities from the early 2010s onward. Over 230
        journalists from 50 countries investigated the leak, which was then taken up by the
        global media.
      </p>
      <p>
        The files show Deutsche Bank doing significant deals with corrupt, sanctioned and
        crooked actors. Internal investigations in the data show officials repeatedly bending
        internal controls, using malleable waiver systems to let suspect clients carry on
        banking, and banking high-risk and even sanctioned clients in secrecy havens.
      </p>
      <p>
        <a href="https://www.inside-db.com/" target="_blank" rel="noopener noreferrer">Read the investigation at inside-db.com ↗</a>
      </p>

      <h2>This globe</h2>
      <p>
        The investigation was published on 16 November 2026. This page replays how
        <strong>news coverage</strong> of it spread around the world over the following
        week: {meta.total.toLocaleString('en')} stories in {Object.keys(meta.languages).length}
        languages, each appearing at the moment it was published (UTC).
      </p>

      <h2>Credits</h2>
      <dl class="credits">
        <dt>Data visualisation</dt>
        <dd>Jason Norwood-Young</dd>
        <dt>Data scraping</dt>
        <dd>Werner Koegelenberg</dd>
        <dt>Earth imagery</dt>
        <dd>
          <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar
            System Scope</a> (INOVE), based on NASA imagery, used under
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>;
          converted, recompressed and colour-graded
        </dd>
      </dl>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(2, 4, 10, 0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 40;
  }
  .modal {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 32px));
    max-height: 82vh;
    max-height: 82dvh;
    background: #0a0e18f2;
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 44px 0 16px; /* top: room for the ✕ above the scrolling text */
  }
  .body {
    overflow: auto;
    overscroll-behavior: contain;
    padding: 6px 28px 10px;
    /* soft fade where text scrolls out of view */
    mask-image: linear-gradient(to bottom, transparent, #000 10px, #000 calc(100% - 14px), transparent);
  }
  h1 {
    font-size: 19px;
    margin: 0 0 10px;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    margin: 16px 0 6px;
  }
  p {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
  }
  .credits {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 6px 0 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .credits dt {
    color: var(--text-dim);
  }
  .credits dd {
    margin: 0;
    color: var(--text);
  }
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  .x {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    width: 40px;
    height: 40px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 15px;
  }
  .x:hover {
    color: var(--text);
  }
  @media (max-width: 820px) {
    .body {
      padding: 6px 20px 10px;
    }
  }
</style>
