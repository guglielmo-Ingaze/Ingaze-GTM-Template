/**
 * Ingaze Tracking Pixel
 * Injected via Google Tag Manager
 * 
 * Responsabilità:
 * 1. Generazione/Recupero Session ID.
 * 2. Estrazione e persistenza parametri UTM.
 * 3. Tracciamento page_view.
 * 4. Tracciamento click tramite Event Delegation (job_click, apply_click, outbound_ats_click).
 * 5. Invio dati strutturati al Cloudflare Worker.
 */

(function () {
    // Evita esecuzioni multiple
    if (window.ingazePixelInitialized) return;
    window.ingazePixelInitialized = true;

    // Recupera variabili esposte dal GTM Template
    const workspaceId = window.ingazeWorkspaceId;
    const customAtsDomain = window.ingazeAtsDomain || '';
    const careerSiteUrl = window.ingazeCareerSiteUrl || '';
    const jobOfferUrl = window.ingazeJobOfferUrl || '';

    if (!workspaceId) {
        console.warn('[Ingaze] Workspace ID mancante. Tracking disabilitato.');
        return;
    }

    const ENDPOINT_URL = 'https://ingaze-tracking-worker.guglielmo-84a.workers.dev/';

    // Lista degli ATS noti (aggiunto il customAtsDomain se presente)
    const atsDomains = [
        'zucchetti', 'inrecruiting', 'allibo', 'personio',
        'workday', 'greenhouse', 'lever'
    ];
    if (customAtsDomain) {
        atsDomains.push(customAtsDomain.replace(/^https?:\/\//, '').split('/')[0]);
    }

    // Keyword per i pulsanti di "Apply"
    const applyKeywords = [
        'candidati', 'invia candidatura', 'invia cv', 'candidati ora', 'applica',
        'apply', 'apply now', 'submit application', 'submit resume', 'send application'
    ];

    /**
     * Utility: Genera un Session ID univoco
     */
    function generateSessionId() {
        return 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    /**
     * Utility: Gestione Cookie e Storage
     */
    function getSessionId() {
        let sid = sessionStorage.getItem('ingaze_session_id');
        if (!sid) {
            sid = generateSessionId();
            sessionStorage.setItem('ingaze_session_id', sid);
        }
        return sid;
    }

    function parseUtms() {
        const urlParams = new URLSearchParams(window.location.search);
        const source = urlParams.get('utm_source');
        const medium = urlParams.get('utm_medium');

        if (source) {
            sessionStorage.setItem('ingaze_utm_source', source);
        }
        if (medium) {
            sessionStorage.setItem('ingaze_utm_medium', medium);
        }
    }

    function getUtmSource() {
        return sessionStorage.getItem('ingaze_utm_source') || '';
    }

    /**
     * Page Context Extractors
     */
    function extractJobId(url, base) {
        if (!base || !url) return null;
        base = base.trim();
        url = url.trim();

        // Normalizziamo le stringhe per il confronto base
        const urlLower = url.toLowerCase();
        let baseLower = base.toLowerCase();

        // Rimuoviamo eventuale slash finale dalla base (a meno che non finisca con =) per evitare mismatch
        if (!baseLower.endsWith('=')) {
            baseLower = baseLower.replace(/\/+$/, '');
        }

        const idx = urlLower.indexOf(baseLower);
        if (idx === -1) return null;

        // Estraiamo la parte dell'URL che viene DOPO la base
        let remainder = url.substring(idx + baseLower.length);

        // Se la base terminava esplicitamente con "=", è un parametro esatto (es. ?job=)
        if (baseLower.endsWith('=')) {
            let id = remainder.split('&')[0].split('#')[0];
            id = id.replace(/^\/+|\/+$/g, '');
            return id || null;
        }

        // Rimuoviamo eventuali slash all'inizio del remainder
        remainder = remainder.replace(/^\/+/, '');

        // Se inizia con "?", significa che l'ID è passato come query parameter
        if (remainder.startsWith('?')) {
            try {
                const searchStr = remainder.split('#')[0];
                const params = new URLSearchParams(searchStr);

                // Cerchiamo chiavi comuni usate per gli ID delle offerte
                const jobKeys = ['job', 'id', 'offerta', 'position', 'slug', 'req', 'role', 'guid'];
                for (let key of jobKeys) {
                    if (params.has(key) && params.get(key)) {
                        return params.get(key);
                    }
                }

                // Se c'è un solo parametro, e non è di paginazione, lo prendiamo per buono
                const keys = Array.from(params.keys());
                if (keys.length === 1) {
                    const firstKey = keys[0];
                    if (!['page', 'sort', 'filter', 'lang', 'utm_source'].includes(firstKey.toLowerCase())) {
                        return params.get(firstKey);
                    }
                }
            } catch (e) { }
            return null;
        } else {
            // Altrimenti è parte del path (es. /software-engineer)
            let id = remainder.split('?')[0].split('#')[0];
            id = id.replace(/\/+$/g, '');
            return id || null;
        }
    }

    function getJobId(url) {
        return extractJobId(url || window.location.href, jobOfferUrl);
    }

    function getPageType(url) {
        const currentUrlFull = url || window.location.href;
        const currentUrlLower = currentUrlFull.toLowerCase();

        // 1. Identifica 'job_detail' usando jobOfferUrl
        if (jobOfferUrl && extractJobId(currentUrlFull, jobOfferUrl) !== null) {
            return 'job_detail';
        }

        // 2. Identifica 'career_home' usando careerSiteUrl
        // Rimuoviamo query e hash per fare il check pulito della root
        const currentBase = currentUrlLower.split('?')[0].split('#')[0].replace(/\/$/, '');

        if (careerSiteUrl) {
            const baseCareer = careerSiteUrl.toLowerCase().trim().split('?')[0].split('#')[0].replace(/\/$/, '');
            if (currentBase === baseCareer) {
                return 'career_home';
            }
        }

        return 'other';
    }

    /**
     * Core: Invia l'evento al Middleware (Cloudflare Worker)
     */
    // Deduplicazione: evita doppio job_click da click handler + SPA monitor
    var lastJobClickUrl = null;
    var lastJobClickTime = 0;

    // Queue implementation per garantire l'invio durante la navigazione
    const QUEUE_KEY = 'ingaze_event_queue';

    function getQueue() {
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function saveQueue(queue) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch (e) {}
    }

    function enqueueEvent(payload) {
        payload._eventId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        const queue = getQueue();
        queue.push(payload);
        saveQueue(queue);
        return payload._eventId;
    }

    function dequeueEvent(eventId) {
        const queue = getQueue();
        const newQueue = queue.filter(item => item._eventId !== eventId);
        saveQueue(newQueue);
    }

    function sendEventPayload(payload) {
        const eventId = payload._eventId;
        const sendPayload = Object.assign({}, payload);
        delete sendPayload._eventId;

        return fetch(ENDPOINT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' }, // Usa text/plain per evitare preflight CORS
            body: JSON.stringify(sendPayload),
            keepalive: true // Garantisce l'invio anche se la pagina viene chiusa/navigata
        }).then(res => {
            if (eventId) dequeueEvent(eventId);
            return res;
        }).catch(err => {
            console.warn('[Ingaze] Errore invio evento:', err);
        });
    }

    function flushQueue() {
        const queue = getQueue();
        queue.forEach(payload => {
            sendEventPayload(payload);
        });
    }

    function sendEvent(eventType, contextUrl) {
        const url = contextUrl || window.location.href;
        const payload = {
            Timestamp: new Date().toISOString(),
            Workspace_ID: workspaceId,
            Session_ID: getSessionId(),
            Event_Type: eventType,
            Page_URL: url,
            UTM_Source: getUtmSource(),
            Page_Type: getPageType(url),
            Job_ID: getJobId(url)
        };

        enqueueEvent(payload);
        return sendEventPayload(payload);
    }

    /**
     * Heuristics per identificare i tipi di click
     */
    function isAtsLink(url) {
        if (!url) return false;
        try {
            const urlObj = new URL(url, window.location.origin);
            const hostname = urlObj.hostname.toLowerCase();
            return atsDomains.some(domain => hostname.includes(domain.toLowerCase()));
        } catch (e) {
            return false;
        }
    }

    function isApplyButton(element) {
        const text = (element.innerText || element.value || element.getAttribute('aria-label') || '').toLowerCase();
        return applyKeywords.some(keyword => text.includes(keyword));
    }

    function isJobDetailLink(url, element) {
        if (!url) return false;

        // 1. Euristica forte basata sulla GTM config
        if (jobOfferUrl && extractJobId(url, jobOfferUrl) !== null) {
            return true;
        }

        // 2. Fallback su keyword nel path e nel testo
        const urlLower = url.toLowerCase();
        const hasJobPath = urlLower.includes('/job/') || urlLower.includes('/offerta/') || urlLower.includes('/career/') || urlLower.includes('/position/');

        const text = (element.innerText || '').toLowerCase();
        const isJobRelatedText = text.includes('scopri') || text.includes('dettagli') || text.includes('view') || text.includes('details');

        return hasJobPath || isJobRelatedText;
    }

    /**
     * Intent Interception (Best-effort prima della navigazione)
     */
    function getCandidateElement(e) {
        if (e.composedPath) {
            const path = e.composedPath();
            for (const node of path) {
                if (node instanceof Element && node.matches('a, button, [role="button"], [data-href], [data-url], [onclick]')) {
                    return node;
                }
            }
        }
        return e.target && e.target.closest
            ? e.target.closest('a, button, [role="button"], [data-href], [data-url], [onclick]')
            : null;
    }

    function getCandidateUrl(el) {
        if (!el) return '';
        return (
            el.href ||
            el.getAttribute('data-href') ||
            el.getAttribute('data-url') ||
            el.getAttribute('href') ||
            ''
        );
    }

    function setupIntentInterception() {
        function handleIntent(e) {
            const el = getCandidateElement(e);
            if (!el) return;

            const url = getCandidateUrl(el);
            let eventType = null;

            if (isAtsLink(url)) {
                eventType = 'outbound_ats_click';
            } else if (isApplyButton(el)) {
                eventType = 'apply_click';
            } else if (isJobDetailLink(url, el)) {
                eventType = 'job_click';
            }

            if (!eventType) return;

            if (eventType === 'job_click') {
                let targetUrl = url || window.location.href;
                if (targetUrl === lastJobClickUrl && (Date.now() - lastJobClickTime) < 2000) return;
                lastJobClickUrl = targetUrl;
                lastJobClickTime = Date.now();
            }

            // Invio tramite coda / keepalive
            sendEvent(eventType, url || window.location.href);
        }

        document.addEventListener('pointerdown', handleIntent, { capture: true, passive: true });
        document.addEventListener('auxclick', handleIntent, { capture: true, passive: true });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') handleIntent(e);
        }, true);
    }

    /**
     * SPA Routing Interception (Inference basata sulla destinazione)
     */
    function setupSpaRouting() {
        let lastUrl = window.location.href;

        function handleUrlChange() {
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                const oldType = getPageType(lastUrl);
                const newType = getPageType(currentUrl);

                // Infer job_click se navighiamo verso job_detail da un'altra pagina del sito
                if (newType === 'job_detail' && oldType !== 'job_detail') {
                    if (currentUrl !== lastJobClickUrl || (Date.now() - lastJobClickTime) > 2000) {
                        lastJobClickUrl = currentUrl;
                        lastJobClickTime = Date.now();
                        sendEvent('job_click', currentUrl);
                    }
                }

                // Traccia la page_view della SPA
                sendEvent('page_view', currentUrl);
                lastUrl = currentUrl;
            }
        }

        const originalPushState = history.pushState;
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            handleUrlChange();
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            handleUrlChange();
        };

        window.addEventListener('popstate', handleUrlChange);
    }

    /**
     * Outbound Interception (Fallback)
     * Per browser senza Navigation API: intercetta window.open()
     * e prova a wrappare location.assign/replace.
     */
    function setupOutboundFallback() {
        // Intercetta window.open (per link che aprono in nuova tab)
        var originalOpen = window.open;
        window.open = function (url) {
            if (url && isAtsLink(url.toString())) {
                var payload = {
                    Timestamp: new Date().toISOString(),
                    Workspace_ID: workspaceId,
                    Session_ID: getSessionId(),
                    Event_Type: 'outbound_ats_click',
                    Page_URL: url.toString(),
                    UTM_Source: getUtmSource(),
                    Page_Type: getPageType(),
                    Job_ID: getJobId()
                };
                var blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });
                navigator.sendBeacon(ENDPOINT_URL, blob);
            }
            return originalOpen.apply(this, arguments);
        };
    }

    /**
     * Init logic
     */
    function init() {
        parseUtms();
        
        // Svuota eventuali eventi rimasti in coda (es. job_click da pagina precedente)
        flushQueue();

        // Retrospective job_click detection:
        // Se il pixel si carica su una pagina job_detail e il referrer
        // è dello stesso sito, significa che l'utente ha cliccato su un'offerta.
        // Questo funziona universalmente indipendentemente dal framework.
        var currentPageType = getPageType();
        if (currentPageType === 'job_detail') {
            try {
                var referrer = document.referrer;
                if (referrer && new URL(referrer).origin === window.location.origin) {
                    sendEvent('job_click');
                }
            } catch (e) { }
        }

        // Traccia la page_view al caricamento
        sendEvent('page_view');

        // Layer 1: Best-effort intent interception (pointerdown)
        setupIntentInterception();

        // Layer 2: SPA Route monitoring per inferred job_clicks
        setupSpaRouting();

        // Layer 3: Fallback window.open per browser outbound generici
        setupOutboundFallback();
    }

    // Esegui quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
