/**
 * Ingaze Tracking Pixel — v2
 * Injected via Google Tag Manager
 *
 * Key fixes vs v1:
 * 1. SPA-aware routing: patches history.pushState/replaceState + popstate so
 *    every client-side navigation is visible to the pixel.
 * 2. Reliable outbound detection: cross-origin ATS links are tracked in the
 *    click handler (page still alive) rather than via Navigation API (which
 *    does NOT fire for cross-origin destinations in most browsers).
 * 3. Belt-and-suspenders send: sendBeacon → keepalive fetch → sync XHR
 *    fallback, in that priority order.
 * 4. Queue is flushed on pagehide + visibilitychange so events survive
 *    aggressive tab discard.
 */

(function () {
    if (window.ingazePixelInitialized) return;
    window.ingazePixelInitialized = true;

    // ─── Config (injected by GTM template) ────────────────────────────────────
    const workspaceId     = window.ingazeWorkspaceId;
    const customAtsDomain = window.ingazeAtsDomain    || '';
    const careerSiteUrl   = window.ingazeCareerSiteUrl || '';
    const jobOfferUrl     = window.ingazeJobOfferUrl   || '';

    if (!workspaceId) {
        console.warn('[Ingaze] Workspace ID mancante. Tracking disabilitato.');
        return;
    }

    const ENDPOINT_URL = 'https://ingaze-tracking-worker.guglielmo-84a.workers.dev/';

    const atsDomains = [
        'zucchetti', 'inrecruiting', 'allibo', 'personio',
        'workday', 'greenhouse', 'lever'
    ];
    if (customAtsDomain) {
        atsDomains.push(customAtsDomain.replace(/^https?:\/\//, '').split('/')[0]);
    }

    const applyKeywords = [
        'candidati', 'invia candidatura', 'invia cv', 'candidati ora', 'applica',
        'apply', 'apply now', 'submit application', 'submit resume', 'send application'
    ];

    // ─── Session / UTM ────────────────────────────────────────────────────────
    function generateSessionId() {
        return 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    function getSessionId() {
        let sid = sessionStorage.getItem('ingaze_session_id');
        if (!sid) { sid = generateSessionId(); sessionStorage.setItem('ingaze_session_id', sid); }
        return sid;
    }

    function parseUtms() {
        const p = new URLSearchParams(window.location.search);
        if (p.get('utm_source')) sessionStorage.setItem('ingaze_utm_source', p.get('utm_source'));
        if (p.get('utm_medium')) sessionStorage.setItem('ingaze_utm_medium', p.get('utm_medium'));
    }

    function getUtmSource() { return sessionStorage.getItem('ingaze_utm_source') || ''; }

    // ─── URL / page-type helpers ──────────────────────────────────────────────
    function extractJobId(url, base) {
        if (!base || !url) return null;
        base = base.trim(); url = url.trim();
        const urlLower = url.toLowerCase();
        let baseLower = base.toLowerCase();
        if (!baseLower.endsWith('=')) baseLower = baseLower.replace(/\/+$/, '');
        const idx = urlLower.indexOf(baseLower);
        if (idx === -1) return null;
        let remainder = url.substring(idx + baseLower.length);
        if (baseLower.endsWith('=')) {
            let id = remainder.split('&')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
            return id || null;
        }
        remainder = remainder.replace(/^\/+/, '');
        if (remainder.startsWith('?')) {
            try {
                const params = new URLSearchParams(remainder.split('#')[0]);
                for (const key of ['job', 'id', 'offerta', 'position', 'slug', 'req', 'role', 'guid']) {
                    if (params.has(key) && params.get(key)) return params.get(key);
                }
                const keys = Array.from(params.keys());
                if (keys.length === 1 && !['page','sort','filter','lang','utm_source'].includes(keys[0].toLowerCase())) {
                    return params.get(keys[0]);
                }
            } catch (e) {}
            return null;
        }
        let id = remainder.split('?')[0].split('#')[0].replace(/\/+$/g, '');
        return id || null;
    }

    function getJobId(url) { return extractJobId(url || window.location.href, jobOfferUrl); }

    function getPageType(url) {
        const full  = url || window.location.href;
        if (jobOfferUrl && extractJobId(full, jobOfferUrl) !== null) return 'job_detail';
        const base  = full.toLowerCase().split('?')[0].split('#')[0].replace(/\/$/, '');
        if (careerSiteUrl) {
            const bc = careerSiteUrl.toLowerCase().trim().split('?')[0].split('#')[0].replace(/\/$/, '');
            if (base === bc) return 'career_home';
        }
        return 'other';
    }

    // ─── Event queue (survives navigation) ───────────────────────────────────
    const QUEUE_KEY = 'ingaze_event_queue';

    function getQueue() {
        try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
    }

    function saveQueue(q) {
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
    }

    function enqueueEvent(payload) {
        payload._eventId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        const q = getQueue(); q.push(payload); saveQueue(q);
        return payload._eventId;
    }

    function dequeueEvent(eventId) {
        saveQueue(getQueue().filter(item => item._eventId !== eventId));
    }

    // ─── Send helpers ─────────────────────────────────────────────────────────
    /**
     * sendReliable() — three-tier send:
     * 1. navigator.sendBeacon  (best for pre-unload; fire-and-forget)
     * 2. fetch with keepalive  (async, survives short navigation delays)
     * 3. sync XMLHttpRequest   (last resort when the page is already dying;
     *                           blocks the thread for <1 ms on LAN Worker)
     *
     * NOTE: sendBeacon is always attempted for critical pre-navigation events.
     * fetch(keepalive) is used as the primary path for normal in-page events.
     */
    function sendReliable(bodyStr, useBeacon) {
        const blob = new Blob([bodyStr], { type: 'text/plain' });

        if (useBeacon) {
            // Beacon is the safest option when the page is about to navigate.
            const ok = navigator.sendBeacon(ENDPOINT_URL, blob);
            if (ok) return Promise.resolve();
            // Beacon quota exceeded — fall through to sync XHR.
        }

        // keepalive fetch for normal in-page sends.
        const p = fetch(ENDPOINT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: bodyStr,
            keepalive: true
        }).catch(() => null);

        if (!useBeacon) return p;

        // If we reach here, sendBeacon returned false (quota hit).
        // Use sync XHR as an absolute last resort.
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', ENDPOINT_URL, false); // false = synchronous
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.send(bodyStr);
        } catch (e) {}
        return Promise.resolve();
    }

    function sendEventPayload(payload, useBeacon) {
        const eventId   = payload._eventId;
        const sendBody  = Object.assign({}, payload);
        delete sendBody._eventId;
        return sendReliable(JSON.stringify(sendBody), useBeacon).then(() => {
            if (eventId) dequeueEvent(eventId);
        });
    }

    function flushQueue(useBeacon) {
        getQueue().forEach(payload => sendEventPayload(payload, useBeacon));
    }

    // ─── Core send ────────────────────────────────────────────────────────────
    function sendEvent(eventType, contextUrl, useBeacon) {
        const url     = contextUrl || window.location.href;
        const payload = {
            Timestamp:    new Date().toISOString(),
            Workspace_ID: workspaceId,
            Session_ID:   getSessionId(),
            Event_Type:   eventType,
            Page_URL:     url,
            UTM_Source:   getUtmSource(),
            Page_Type:    getPageType(url),
            Job_ID:       getJobId(url)
        };
        enqueueEvent(payload);
        return sendEventPayload(payload, useBeacon);
    }

    // ─── Heuristics ───────────────────────────────────────────────────────────
    function isAtsLink(url) {
        if (!url) return false;
        try {
            const h = new URL(url, window.location.origin).hostname.toLowerCase();
            return atsDomains.some(d => h.includes(d.toLowerCase()));
        } catch (e) { return false; }
    }

    function isApplyButton(el) {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase();
        return applyKeywords.some(kw => text.includes(kw));
    }

    function isJobDetailLink(url, el) {
        if (!url) return false;
        if (jobOfferUrl && extractJobId(url, jobOfferUrl) !== null) return true;
        const urlLower = url.toLowerCase();
        const hasJobPath = urlLower.includes('/job/') || urlLower.includes('/offerta/') ||
                           urlLower.includes('/career/') || urlLower.includes('/position/');
        const text = (el.innerText || '').toLowerCase();
        const isJobText = text.includes('scopri') || text.includes('dettagli') ||
                          text.includes('view') || text.includes('details');
        return hasJobPath || isJobText;
    }

    // ─── Deduplication state ──────────────────────────────────────────────────
    var lastJobClickUrl  = null;
    var lastJobClickTime = 0;
    var lastPageViewUrl  = null;

    function dedupeJobClick(url) {
        if (url === lastJobClickUrl && (Date.now() - lastJobClickTime) < 2000) return false;
        lastJobClickUrl  = url;
        lastJobClickTime = Date.now();
        return true;
    }

    // ─── Layer 1: Click delegation ────────────────────────────────────────────
    // Fires BEFORE the browser navigates — the page is still fully alive.
    // This is the most reliable layer for BOTH job_click and outbound_ats_click.
    function setupEventDelegation() {
        document.addEventListener('click', function (e) {
            const target = e.target.closest('a, button, input[type="button"], input[type="submit"]') || e.target;
            if (!target) return;

            let url = target.href || target.getAttribute('href') || target.getAttribute('data-link');
            if (!url && target.tagName && target.tagName.toLowerCase() !== 'a') {
                const innerA = target.querySelector('a');
                if (innerA) url = innerA.href;
            }

            let eventType = null;

            if (isAtsLink(url)) {
                // *** FIX: outbound is tracked here, in the click handler,
                //     where the page is guaranteed alive.
                //     useBeacon=true because the page is about to navigate away.
                eventType = 'outbound_ats_click';
            } else if (isApplyButton(target)) {
                eventType = 'apply_click';
            } else if (isJobDetailLink(url, target)) {
                eventType = 'job_click';
            }

            if (!eventType) return;

            if (eventType === 'job_click') {
                const targetUrl = url || window.location.href;
                if (!dedupeJobClick(targetUrl)) return;
            }

            // useBeacon=true for outbound (page navigates away immediately).
            // keepalive fetch is fine for job_click in SPAs (no full unload).
            const useBeacon = (eventType === 'outbound_ats_click');
            sendEvent(eventType, url, useBeacon);
        }, true); // capture phase
    }

    // ─── Layer 2: SPA routing monitor ────────────────────────────────────────
    // Patches history.pushState / replaceState so we can observe every
    // client-side URL change regardless of the SPA framework used.
    function setupSpaMonitor() {
        var previousUrl = window.location.href;

        function onVirtualNavigation(newUrl) {
            if (newUrl === previousUrl) return;
            const prevUrl = previousUrl;
            previousUrl   = newUrl;

            // Fire page_view for the new virtual page (debounced to avoid double-fire
            // when pushState fires right before popstate).
            setTimeout(function () {
                if (window.location.href !== newUrl) return; // already changed again
                parseUtms(); // pick up any new UTM params in the new URL

                // Retrospective job_click: did we just land on a job_detail?
                if (getPageType(newUrl) === 'job_detail' && getPageType(prevUrl) !== 'job_detail') {
                    if (dedupeJobClick(newUrl)) {
                        sendEvent('job_click', newUrl, false);
                    }
                }

                // Debounce page_view — only if URL actually differs
                if (newUrl !== lastPageViewUrl) {
                    lastPageViewUrl = newUrl;
                    sendEvent('page_view', newUrl, false);
                }
            }, 0);
        }

        // Patch pushState
        var originalPush = history.pushState.bind(history);
        history.pushState = function (state, title, url) {
            originalPush(state, title, url);
            onVirtualNavigation(window.location.href);
        };

        // Patch replaceState
        var originalReplace = history.replaceState.bind(history);
        history.replaceState = function (state, title, url) {
            originalReplace(state, title, url);
            onVirtualNavigation(window.location.href);
        };

        // Handle browser back/forward
        window.addEventListener('popstate', function () {
            onVirtualNavigation(window.location.href);
        });

        // Hash-only SPAs
        window.addEventListener('hashchange', function () {
            onVirtualNavigation(window.location.href);
        });
    }

    // ─── Layer 3: window.open fallback ────────────────────────────────────────
    function setupOutboundFallback() {
        var originalOpen = window.open;
        window.open = function (url) {
            if (url && isAtsLink(url.toString())) {
                // New tab: page stays alive, so keepalive fetch is fine.
                sendEvent('outbound_ats_click', url.toString(), false);
            }
            return originalOpen.apply(this, arguments);
        };
    }

    // ─── Layer 4: Navigation API (same-origin only, Chrome 102+) ─────────────
    // Kept for completeness — mainly useful for Bubble.io / location.href=
    // navigations to same-origin job_detail pages.
    // Cross-origin outbound is intentionally NOT handled here (see Layer 1).
    function setupNavigationInterception() {
        if (!window.navigation) return;
        navigation.addEventListener('navigate', function (event) {
            var destUrl = event.destination.url;
            if (!destUrl) return;

            // Only handle same-origin navigations (cross-origin won't fire here anyway).
            try { if (new URL(destUrl).origin !== window.location.origin) return; }
            catch (e) { return; }

            if (getPageType(destUrl) === 'job_detail') {
                if (dedupeJobClick(destUrl)) {
                    var payload = {
                        Timestamp:    new Date().toISOString(),
                        Workspace_ID: workspaceId,
                        Session_ID:   getSessionId(),
                        Event_Type:   'job_click',
                        Page_URL:     destUrl,
                        UTM_Source:   getUtmSource(),
                        Page_Type:    getPageType(destUrl),
                        Job_ID:       getJobId(destUrl)
                    };
                    // useBeacon=true: page is about to navigate.
                    var blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });
                    navigator.sendBeacon(ENDPOINT_URL, blob);
                }
            }
        });
    }

    // ─── Page lifecycle: flush on unload ─────────────────────────────────────
    function setupLifecycleFlush() {
        // pagehide is fired reliably on mobile Safari and Chromium for BFcache.
        window.addEventListener('pagehide', function () {
            flushQueue(true); // useBeacon=true: page is dying
        });

        // visibilitychange catches tab switching and aggressive discard.
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                flushQueue(true);
            }
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function init() {
        parseUtms();
        flushQueue(false); // flush any events left from the previous page

        // Retrospective job_click on hard navigation (same-origin referrer → job_detail).
        // This covers traditional MPA navigation where the pixel loads fresh.
        var currentPageType = getPageType();
        if (currentPageType === 'job_detail') {
            try {
                var referrer = document.referrer;
                if (referrer && new URL(referrer).origin === window.location.origin) {
                    if (dedupeJobClick(window.location.href)) {
                        sendEvent('job_click', window.location.href, false);
                    }
                }
            } catch (e) {}
        }

        lastPageViewUrl = window.location.href;
        sendEvent('page_view');

        setupEventDelegation();      // Layer 1: click handler (most reliable)
        setupSpaMonitor();           // Layer 2: SPA route patching (*** key fix)
        setupOutboundFallback();     // Layer 3: window.open intercept
        setupNavigationInterception(); // Layer 4: Navigation API (bonus)
        setupLifecycleFlush();       // Flush queue on pagehide / hidden
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
