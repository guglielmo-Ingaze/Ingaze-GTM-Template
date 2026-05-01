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
        if (!base) return null;
        const urlLower = url.toLowerCase();
        const baseLower = base.toLowerCase();
        const idx = urlLower.indexOf(baseLower);
        if (idx === -1) return null;

        let remainder = url.substring(idx + base.length);

        // Se la base terminava esplicitamente con "=", è un parametro esatto (es. ?job=)
        if (baseLower.endsWith('=')) {
            let id = remainder.split('&')[0].split('#')[0];
            id = id.replace(/^\/+|\/+$/g, '');
            return id || null;
        }

        remainder = remainder.replace(/^\/+/, '');

        // Se inizia con "?", significa che l'ID è passato come query parameter
        if (remainder.startsWith('?')) {
            try {
                const params = new URLSearchParams(remainder.split('#')[0]);

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

    function getJobId() {
        return extractJobId(window.location.href, jobOfferUrl);
    }

    function getPageType() {
        const currentUrlFull = window.location.href.toLowerCase();

        // 1. Identifica 'job_detail' usando jobOfferUrl
        if (jobOfferUrl && extractJobId(currentUrlFull, jobOfferUrl) !== null) {
            return 'job_detail';
        }

        // 2. Identifica 'career_home' usando careerSiteUrl
        // Rimuoviamo query e hash per fare il check pulito della root
        const currentBase = currentUrlFull.split('?')[0].split('#')[0].replace(/\/$/, '');

        if (careerSiteUrl) {
            const baseCareer = careerSiteUrl.toLowerCase().split('?')[0].split('#')[0].replace(/\/$/, '');
            if (currentBase === baseCareer) {
                return 'career_home';
            }
        }

        return 'other';
    }

    /**
     * Core: Invia l'evento al Middleware (Cloudflare Worker)
     */
    function sendEvent(eventType) {
        const payload = {
            Timestamp: new Date().toISOString(),
            Workspace_ID: workspaceId,
            Session_ID: getSessionId(),
            Event_Type: eventType,
            Page_URL: window.location.href,
            UTM_Source: getUtmSource(),
            Page_Type: getPageType(),
            Job_ID: getJobId()
        };

        // Il fetch con keepalive: true è lo standard moderno e non soffre
        // dei problemi di CORS/Preflight che sendBeacon ha con i payload JSON.
        fetch(ENDPOINT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(err => console.warn('[Ingaze] Errore invio evento:', err));
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
            // Trova l'elemento <a> o <button> più vicino al click
            const target = e.target.closest('a, button, input[type="button"], input[type="submit"]');
            if (!target) return;

            // Usa target.href per i tag <a> per ottenere l'URL *assoluto* e non relativo.
            // Se è un bottone che non ha href, ma contiene un <a>, cerca l'<a> all'interno.
            let url = target.href || target.getAttribute('href') || target.getAttribute('data-link');
            if (!url && target.tagName.toLowerCase() !== 'a') {
                const innerA = target.querySelector('a');
                if (innerA) url = innerA.href;
            }

            // 1. Controllo Outbound ATS Click
            if (isAtsLink(url)) {
                sendEvent('outbound_ats_click');
                return;
            }

            // 2. Controllo Apply Click
            if (isApplyButton(target)) {
                sendEvent('apply_click');
                return;
            }

            // 3. Controllo Job Click
            if (target.tagName.toLowerCase() === 'a' && isJobDetailLink(url, target)) {
                sendEvent('job_click');
                return;
            }
        });
    }

    /**
     * Init logic
     */
    function init() {
        parseUtms();

        // Traccia la page_view al caricamento
        sendEvent('page_view');

        // Imposta l'ascolto dei click
        setupEventDelegation();
    }

    // Esegui quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
