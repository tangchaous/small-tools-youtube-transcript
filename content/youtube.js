// Transcript + metadata extraction, injected into the YouTube watch page in the MAIN world
// (so it can call the player's getPlayerResponse()). The service worker calls
// window.__ytsYoutube.extract(), which resolves to one of:
//   { meta, panel: [{ label, text }] }   from the "Show transcript" panel (preferred)
//   { meta, json3: object }              from a caption track (fallback)
//   { meta, error: string }
//
// Re-injecting always redefines window.__ytsYoutube, so a tab that was open while the extension
// was updated picks up the new code instead of keeping the old copy.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // YouTube has shipped several transcript panels (old target-id, "PAmodern_transcript_view", and an
  // untagged one), so the transcript panel is whichever engagement panel actually holds segment rows.
  const PANELS = 'ytd-engagement-panel-section-list-renderer';
  const KNOWN_PANEL = `${PANELS}[target-id="engagement-panel-searchable-transcript"]`;
  const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
  const SEGMENT_VARIANTS = [
    {
      row: 'transcript-segment-view-model',
      label: '.ytwTranscriptSegmentViewModelTimestamp, [class*="Timestamp"]:not([class*="A11y"])',
      text: 'span[role="text"], [class*="SegmentText"]',
    },
    { row: 'ytd-transcript-segment-renderer', label: '.segment-timestamp', text: '.segment-text' },
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

  function transcriptPanel() {
    let best = null;
    let bestRows = 0;
    for (const panel of document.querySelectorAll(PANELS)) {
      for (const v of SEGMENT_VARIANTS) {
        const n = panel.querySelectorAll(v.row).length;
        if (n > bestRows) [best, bestRows] = [panel, n];
      }
    }
    return best ?? document.querySelector(KNOWN_PANEL);
  }

  function readPanel() {
    const panel = transcriptPanel();
    if (panel) {
      for (const v of SEGMENT_VARIANTS) {
        const rows = [...panel.querySelectorAll(v.row)];
        if (rows.length) {
          return rows
            .map((row) => ({ label: text(row.querySelector(v.label)), text: text(row.querySelector(v.text)) }))
            .filter((s) => s.text);
        }
      }
    }
    return genericRows();
  }

  const STAMP = /^\d{1,2}(:\d{2}){1,2}$/;
  const SPOKEN_DURATION = /^(\d+ (hours?|minutes?|seconds?),? ?)+/;

  // Layout-independent fallback for transcript markup we don't know yet: in an open panel, every
  // leaf element whose text is a timestamp starts a row; the row's remaining text is the segment.
  function genericRows() {
    for (const panel of expandedPanels()) {
      const rows = [];
      for (const el of panel.querySelectorAll('*')) {
        const label = text(el);
        if (el.children.length || !STAMP.test(label)) continue;
        let row = el.parentElement;
        while (row && row !== panel && text(row) === label) row = row.parentElement;
        if (!row || row === panel) continue;
        const body = text(row).replace(label, '').trim().replace(SPOKEN_DURATION, '').trim();
        if (body) rows.push({ label, text: body });
      }
      if (rows.length >= 3) return rows;
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
      return 'button';
    }
    const panel = document.querySelector(KNOWN_PANEL);
    if (panel) {
      panel.setAttribute('visibility', EXPANDED);
      return 'panel';
    }
    return '';
  }

  const expandedPanels = () => new Set([...document.querySelectorAll(PANELS)].filter((p) => p.getAttribute('visibility') === EXPANDED));

  // Hides only the panels that were opened after `before` was taken, i.e. the ones we opened.
  function closePanelsOpenedSince(before) {
    for (const panel of expandedPanels()) {
      if (!before.has(panel)) panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    }
  }

  const signature = (rows) => rows.slice(0, 5).map((r) => `${r.label} ${r.text}`).join('|');

  // Waits until the panel has segments and their count has stopped changing, so the whole
  // transcript is collected before anything is sent. Rows matching `staleSignature` (left over
  // from a previously processed video) count as not loaded yet.
  async function collectPanel(staleSignature = null) {
    const end = Date.now() + 20_000;
    let count = 0;
    let stableSince = Date.now();
    while (Date.now() < end) {
      await sleep(300);
      const rows = readPanel();
      const n = staleSignature && signature(rows) === staleSignature ? 0 : rows.length;
      if (n !== count) {
        count = n;
        stableSince = Date.now();
      } else if (n > 0 && Date.now() - stableSince >= 1500) {
        return rows;
      }
    }
    return count ? readPanel() : [];
  }

  function pickTrack(tracks) {
    const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2);
    const manual = tracks.filter((t) => t.kind !== 'asr');
    const auto = tracks.filter((t) => t.kind === 'asr');
    const inLang = (list) => list.find((t) => t.languageCode?.startsWith(lang));
    return inLang(manual) || manual[0] || inLang(auto) || auto[0] || null;
  }

  // Resolves to { json3 } or { reason } explaining why no captions could be downloaded.
  async function fetchCaptions(pr) {
    if (!pr) return { reason: 'player data unavailable' };
    const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks);
    if (!track) return { reason: 'video lists no caption tracks' };
    try {
      const res = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' });
      const body = await res.text();
      if (!res.ok) return { reason: `HTTP ${res.status}` };
      // YouTube answers an empty body when it requires tokens only its own player has.
      if (!body.trim()) return { reason: `blocked by YouTube (${tracks.length} track(s) listed)` };
      const json3 = JSON.parse(body);
      return json3.events?.length ? { json3 } : { reason: 'caption track was empty' };
    } catch (err) {
      return { reason: err.message };
    }
  }

  async function extract() {
    const videoId = new URL(location.href).searchParams.get('v');
    const pr = playerResponse(videoId);
    const meta = readMeta(pr);

    // The panel element survives in-app navigation, so rows we read for another video may still be
    // in it. We tag the panel with the video it was read for and refuse to reuse foreign rows.
    const panelEl = transcriptPanel();
    const readFor = panelEl?.dataset.ytsVideo;
    const stale = readFor && readFor !== videoId ? signature(readPanel()) : null;
    const userOpened = panelEl?.getAttribute('visibility') === EXPANDED;

    let panel = [];
    let opened = userOpened ? 'already open' : '';
    if (userOpened && !stale && readPanel().length) {
      panel = await collectPanel();
    } else {
      const before = expandedPanels();
      opened = await openPanel();
      if (opened) {
        panel = await collectPanel(stale);
        closePanelsOpenedSince(before);
      }
    }
    if (panel.length) {
      transcriptPanel()?.setAttribute('data-yts-video', videoId);
      return { meta, panel };
    }

    const captions = await fetchCaptions(pr);
    if (captions.json3) return { meta, json3: captions.json3 };

    const panelDetail = opened
      ? `transcript panel opened (${opened}) but no lines were recognized`
      : 'no "Show transcript" button found';
    return {
      meta,
      error: `Couldn't get this video's transcript: ${panelDetail}; caption download: ${captions.reason}. ` +
        'If YouTube shows a transcript for this video, reload the YouTube tab and try again.',
    };
  }

  window.__ytsYoutube = { extract };
})();
