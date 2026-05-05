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
     * Event Delegation
     */
    function setupEventDelegation() {
        document.addEventListener('click', function (e) {
            // Ampliamo la ricerca: framework SPA come Bubble.io usano div o span.
            // Cerchiamo a, button etc., ma se non lo troviamo analizziamo direttamente l'e.target
            const target = e.target.closest('a, button, input[type="button"], input[type="submit"]') || e.target;
            if (!target) return;

            // Usa target.href per i tag <a> per ottenere l'URL *assoluto* e non relativo.
            let url = target.href || target.getAttribute('href') || target.getAttribute('data-link');
            if (!url && target.tagName && target.tagName.toLowerCase() !== 'a') {
                const innerA = target.querySelector('a');
                if (innerA) url = innerA.href;
            }

            // Determina il tipo di evento
            let eventType = null;

            if (isAtsLink(url)) {
                eventType = 'outbound_ats_click';
            } else if (isApplyButton(target)) {
                eventType = 'apply_click';
            } else if (isJobDetailLink(url, target)) {
                eventType = 'job_click';
            }

            if (!eventType) return;

            // Invio tracciamento. Grazie a keepalive e localStorage queue, 
            // l'evento sopravviverà all'imminente unload/navigation.
            // Rimuoviamo preventDefault() che rompe l'esperienza utente e le Single Page Application.
            
            if (eventType === 'job_click') {
                let targetUrl = url || window.location.href;
                if (targetUrl === lastJobClickUrl && (Date.now() - lastJobClickTime) < 2000) return;
                lastJobClickUrl = targetUrl;
                lastJobClickTime = Date.now();
            }

            sendEvent(eventType, url);
        }, true); // true per la Capture Phase (cattura prima dei framework che bloccano la propagazione)
    }

    /**
     * Navigation Interception (Navigation API)
     * Intercetta TUTTE le navigazioni (incluso window.location.href = ...)
     * PRIMA che avvengano. Disponibile in Chrome/Edge 102+.
     * Usa sendBeacon con text/plain per inviare l'evento prima che la pagina muoia.
     */
    function setupNavigationInterception() {
        if (!window.navigation) return;

        navigation.addEventListener('navigate', function (event) {
            var destinationUrl = event.destination.url;
            if (!destinationUrl) return;

            var eventType = null;

            // Controllo outbound ATS
            if (isAtsLink(destinationUrl)) {
                eventType = 'outbound_ats_click';
            }
            // Controllo navigazione verso job_detail
            else if (getPageType(destinationUrl) === 'job_detail') {
                // Evita duplicati
                if (destinationUrl !== lastJobClickUrl || Date.now() - lastJobClickTime > 2000) {
                    lastJobClickUrl = destinationUrl;
                    lastJobClickTime = Date.now();
                    eventType = 'job_click';
                }
            }

            if (!eventType) return;

            var payload = {
                Timestamp: new Date().toISOString(),
                Workspace_ID: workspaceId,
                Session_ID: getSessionId(),
                Event_Type: eventType,
                Page_URL: destinationUrl,
                UTM_Source: getUtmSource(),
                Page_Type: getPageType(destinationUrl),
                Job_ID: getJobId(destinationUrl)
            };

            // sendBeacon con text/plain bypassa il CORS preflight.
            // Il Worker già gestisce payload text/plain (request.text() + JSON.parse).
            var blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });
            navigator.sendBeacon(ENDPOINT_URL, blob);
        });
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

        // Layer 1: Click handler con preventDefault (per siti con <a> tags)
        setupEventDelegation();

        // Layer 2: Navigation API (per Bubble.io e framework con location.href)
        setupNavigationInterception();

        // Layer 3: Fallback window.open per browser senza Navigation API
        setupOutboundFallback();
    }

    // Esegui quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
