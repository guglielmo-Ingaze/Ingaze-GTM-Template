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

        return fetch(ENDPOINT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
            let url = target.href || target.getAttribute('href') || target.getAttribute('data-link');
            if (!url && target.tagName.toLowerCase() !== 'a') {
                const innerA = target.querySelector('a');
                if (innerA) url = innerA.href;
            }

            // Determina il tipo di evento e se causa navigazione
            let eventType = null;
            let navigatesAway = false;

            if (isAtsLink(url)) {
                eventType = 'outbound_ats_click';
                navigatesAway = true;
            } else if (isApplyButton(target)) {
                eventType = 'apply_click';
            } else if (target.tagName.toLowerCase() === 'a' && isJobDetailLink(url, target)) {
                eventType = 'job_click';
                navigatesAway = true;
            }

            if (!eventType) return;

            // Per i click che causano navigazione (job_click, outbound_ats_click):
            // Blocchiamo la navigazione del browser, inviamo l'evento di tracking,
            // poi navighiamo programmaticamente. Questo è l'approccio standard
            // usato da Google Analytics, Facebook Pixel, ecc.
            // I link che aprono in nuova tab (_blank) non hanno questo problema
            // perché la pagina corrente non viene scaricata.
            const opensInNewTab = target.target === '_blank';

            if (navigatesAway && url && !opensInNewTab) {
                e.preventDefault();

                let hasNavigated = false;
                const doNavigate = function () {
                    if (hasNavigated) return;
                    hasNavigated = true;
                    window.location.href = url;
                };

                // Invia l'evento con l'URL di destinazione come contesto,
                // poi naviga (sia in caso di successo che di errore).
                sendEvent(eventType, url)
                    .then(doNavigate)
                    .catch(doNavigate);

                // Timeout di sicurezza: non bloccare mai la navigazione
                // per più di 300ms, anche se l'endpoint è lento.
                setTimeout(doNavigate, 300);
            } else {
                // Eventi che non causano navigazione (apply_click)
                // o link che aprono in nuova tab: invio normale.
                sendEvent(eventType, navigatesAway ? url : undefined);
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
