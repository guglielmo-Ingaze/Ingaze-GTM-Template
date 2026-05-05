# Ingaze GTM Custom Template

Questo è il Custom Template ufficiale per Google Tag Manager di **Ingaze**.
Permette di integrare in pochi minuti il tracciamento cookieless della candidate journey, l'analisi del funnel e i click verso gli ATS.

## 🚀 Architettura

L'integrazione di Ingaze si divide in tre parti, per garantire massima sicurezza e performance:

1. **Il Template GTM (Questo Repository):** Un'interfaccia semplice per l'utente, che inietta in modo sicuro e autorizzato lo script del "pixel" Ingaze.
2. **Il Pixel Ingaze:** Un file JavaScript (es. `pixel.js`) ospitato su CDN (jsDelivr) che esegue l'Event Delegation sul sito, intercetta click e analizza gli UTM. Il codice sorgente del pixel *non* è incluso in questo template per ragioni di architettura, ma viene caricato dinamicamente.
3. **Il Middleware (Cloudflare Worker):** Il pixel invia i dati strutturati a un vostro Cloudflare Worker (es. `api.ingaze.com`). Il Worker agisce da scudo (CORS, validazione payload, rate limiting) e infine inoltra i dati puliti all'endpoint su **Bubble.io**.

### Dove ospitare il `pixel.js`?
La soluzione migliore, più stabile e gratuita per ospitare il file JavaScript statico (`pixel.js`) è **GitHub + jsDelivr**.
1. Caricate il file `pixel.js` in questa stessa repository GitHub.
2. Il file sarà automaticamente disponibile tramite la CDN jsDelivr: `https://cdn.jsdelivr.net/gh/<user>/<repo>@main/pixel.js`.
3. *(Alternativa)*: Cloudflare Pages o un Cloudflare Worker dedicato alla delivery di asset statici.

## 📥 Installazione

1. Scarica il file `template.tpl`.
2. Vai su **Google Tag Manager** -> **Modelli** (Templates) -> **Nuovo** sotto "Modelli tag".
3. Clicca sui 3 pallini in alto a destra e seleziona **Importa**.
4. Seleziona il file `template.tpl` e salva.
5. Ora puoi creare un nuovo Tag utilizzando il modello "Ingaze Pixel".

### Configurazione del Tag

Il Tag richiede il minor sforzo cognitivo possibile. Sono presenti due campi:
- **Workspace ID (Obbligatorio):** Il tuo identificativo univoco su Ingaze (es. `ing_12345`).
- **Dominio ATS Esterno (Opzionale):** Se usi un ATS esterno, inserisci il dominio base per tracciare correttamente gli `outbound_ats_click`.

## 🗂 Lista Domini ATS Supportati

In fase di onboarding, o durante la configurazione del Tag, l'utente può specificare il provider ATS. Il pixel ascolterà i click in uscita verso questi domini noti (tra cui i principali player nel mercato italiano):

- **Zucchetti**
- **Inrecruiting**
- **Allibo**
- **Personio**
- **Workday**
- **Greenhouse**
- **Lever**

## 🏷 Tassonomia Keyword "Apply"

Per tracciare i click sulle "Conversioni pure" (evento `apply_click` su bottoni nativi), il pixel ascolta i click sugli elementi che contengono (nel testo o negli attributi `aria-label`/`title`) le seguenti parole chiave.

### Italiano
- "Candidati"
- "Invia candidatura"
- "Invia CV"
- "Candidati ora"
- "Applica"

### Inglese
- "Apply"
- "Apply now"
- "Submit application"
- "Submit resume"
- "Send application"

## 🛡️ Permessi (Web Permissions)

Il template GTM richiede autorizzazioni minime per garantire la sicurezza del sito:
- **Inject Script (`inject_script`):** Esclusivamente verso i domini `https://cdn.jsdelivr.net/gh/*` e `https://api.ingaze.com/*`.
- **Accesso Variabili Globali (`access_globals`):** Autorizzazione di *sola scrittura* per esporre `ingazeWorkspaceId` e `ingazeAtsDomain` nell'oggetto `window`, permettendo al pixel di leggere la configurazione senza accedere ai cookie o al Data Layer aziendale.
- **Console Logging (`logging`):** Per loggare lo stato di caricamento ("Pixel loaded successfully").
