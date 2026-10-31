// Transcript + metadata extraction, injected into the YouTube watch page in the MAIN world
// (so it can call the player's getPlayerResponse()). The service worker calls
// window.__ytsYoutube.extract(), which resolves to one of:
//   { meta, panel: [{ label, text }] }   from the "Show transcript" panel (preferred)
//   { meta, json3: object }              from a caption track (fallback)
//   { meta, error: string }
(() => {
  if (window.__ytsYoutube) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const SEGMENT_VARIANTS = [
    { row: 'ytd-transcript-segment-renderer', label: '.segment-timestamp', text: '.segment-text' },
    { row: 'transcript-segment-view-model', label: '[class*="Timestamp"]', text: '[class*="SegmentText"], span[role="text"]' },
  ];

  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function playerResponse(videoId) {
    try {
      const pr = document.getElementById('movie_player')?.getPlayerResponse?.();
      if (pr?.videoDetails?.videoId === videoId) return pr;
    } catch { /* player not ready */ }
    // ytInitialPlayerResponse goes stale after in-app navigation, so verify the id.
    const initial = window.ytInitialPlayerResponse;
    return initial?.videoDetails?.videoId === videoId ? initial : null;
  }

  function readMeta(pr) {
    const videoId = new URL(location.href).searchParams.get('v');
    const details = pr?.videoDetails ?? {};
    const micro = pr?.microformat?.playerMicroformatRenderer ?? {};
    const published = (micro.publishDate || micro.uploadDate ||
      document.querySelector('meta[itemprop="datePublished"]')?.content || '').slice(0, 10);
    return {
      videoId,
      title: details.title || text(document.querySelector('ytd-watch-metadata h1')) ||
        document.title.replace(/ - YouTube$/, ''),
      channel: details.author || text(document.querySelector('ytd-watch-metadata ytd-channel-name a')),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published,
    };
  }

  function readPanel() {
    const panel = document.querySelector(PANEL);
    if (!panel) return [];
    for (const v of SEGMENT_VARIANTS) {
      const rows = [...panel.querySelectorAll(v.row)];
      if (rows.length) {
        return rows
          .map((row) => ({ label: text(row.querySelector(v.label)), text: text(row.querySelector(v.text)) }))
          .filter((s) => s.text);
      }
    }
    return [];
  }

  async function openPanel() {
    const findButton = () =>
      document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      [...document.querySelectorAll('ytd-watch-metadata button, #description button')]
        .find((b) => /transcript/i.test(b.textContent || b.getAttribute('aria-label') || ''));

    let button = findButton();
    if (!button) {
      document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click();
      await sleep(500);
      button = findButton();
    }
    if (button) {
      button.click();
      return true;
    }
    const panel = document.querySelector(PANEL);
    if (panel) {
      panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      return true;
    }
    return false;
  }

  function closePanel() {
    document.querySelector(PANEL)?.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  }

  // Waits until the panel has segments and their count has stopped changing,
  // so the whole transcript is collected before anything is sent.
  async function collectPanel() {
    const end = Date.now() + 20_000;
    let count = 0;
    let stableSince = Date.now();
    while (Date.now() < end) {
      await sleep(300);
      const n = readPanel().length;
      if (n !== count) {
        count = n;
        stableSince = Date.now();
      } else if (n > 0 && Date.now() - stableSince >= 1500) {
        return readPanel();
      }
    }
    return readPanel();
  }

  function pickTrack(tracks) {
    const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2);
    const manual = tracks.filter((t) => t.kind !== 'asr');
    const auto = tracks.filter((t) => t.kind === 'asr');
    const inLang = (list) => list.find((t) => t.languageCode?.startsWith(lang));
    return inLang(manual) || manual[0] || inLang(auto) || auto[0] || null;
  }

  async function fetchCaptions(pr) {
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks);
    if (!track) return null;
    const res = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' });
    const body = await res.text();
    if (!res.ok || !body.trim()) return null;
    return JSON.parse(body);
  }

  async function extract() {
    const videoId = new URL(location.href).searchParams.get('v');
    const pr = playerResponse(videoId);
    const meta = readMeta(pr);

    let panel = readPanel();
    if (!panel.length) {
      const opened = await openPanel();
      if (opened) {
        panel = await collectPanel();
        closePanel();
      }
    }
    if (panel.length) return { meta, panel };

    try {
      const json3 = await fetchCaptions(pr);
      if (json3?.events?.length) return { meta, json3 };
    } catch { /* fall through to the error below */ }

    return { meta, error: 'This video has no transcript or captions available.' };
  }

  window.__ytsYoutube = { extract };
})();
