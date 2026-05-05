# Ingaze GTM Custom Template

Questo è il Custom Template ufficiale per Google Tag Manager di **Ingaze**.
Permette di integrare in pochi minuti il tracciamento cookieless della candidate journey, l'analisi del funnel e i click verso gli ATS.

## 📥 Installazione

1. Scarica il file `template.tpl`.
2. Vai su **Google Tag Manager** -> **Modelli** (Templates) -> **Nuovo** sotto "Modelli tag".
3. Clicca sui 3 pallini in alto a destra e seleziona **Importa**.
4. Seleziona il file `template.tpl` e salva.
5. Ora puoi creare un nuovo Tag utilizzando il modello "Ingaze Pixel".

## ⚙️ Configurazione del Tag

La configurazione del Tag è progettata per richiedere il minor sforzo possibile. Sono presenti i seguenti campi:

* **Workspace ID (Obbligatorio):** Il tuo identificativo univoco su Ingaze (es. `ing_12345`).
* **Dominio ATS Esterno (Opzionale):** Se usi un ATS esterno, inserisci il dominio base. Questo permette al sistema di riconoscere e tracciare correttamente i click in uscita (`outbound_ats_click`) verso la tua piattaforma di recruiting.
* **Link del Sito Carriera (Obbligatorio):** L'URL principale della tua pagina "Lavora con noi" o del career site (es. `https://www.tuosito.com/careers`). **Perché lo chiediamo?** Serve al pixel per mappare l'inizio della candidate journey, permettendo di isolare l'analisi del traffico pertinente al recruiting rispetto al resto del sito aziendale.
* **Link di un'Offerta di Lavoro (Obbligatorio):** Un URL di esempio di una pagina di dettaglio di un annuncio (es. `https://www.tuosito.com/careers/marketing-manager`). **Perché lo chiediamo?** Permette al nostro sistema di comprendere e mappare la struttura delle tue URL. In questo modo il pixel riconoscerà in automatico le visualizzazioni specifiche delle Job Description.

## 🗂 Lista Domini ATS Supportati

In fase di onboarding o durante la configurazione del Tag, è possibile specificare il provider ATS. Il pixel ascolterà automaticamente i click in uscita verso questi domini noti (che includono i principali player nel mercato italiano e internazionale):

* Zucchetti
* Inrecruiting
* Allibo
* Personio
* Workday
* Greenhouse
* Lever

## 🏷 Tassonomia Keyword "Apply"

Per tracciare in automatico le "Conversioni pure" (evento `apply_click` su bottoni nativi), il pixel intercetta i click sugli elementi che contengono (nel testo o negli attributi `aria-label`/`title`) le seguenti parole chiave.

### Italiano
* Candidati
* Invia candidatura
* Invia CV
* Candidati ora
* Applica

### Inglese
* Apply
* Apply now
* Submit application
* Submit resume
* Send application

## 🛡️ Permessi (Web Permissions)

Il template GTM richiede autorizzazioni minime per garantire la totale sicurezza del sito web:

* **Inject Script (`inject_script`):** Esclusivamente verso i domini sicuri e necessari al caricamento del pixel Ingaze.
* **Accesso Variabili Globali (`access_globals`):** Autorizzazione di *sola scrittura* per esporre la configurazione base nell'oggetto `window`, permettendo al pixel di leggere i settaggi senza accedere in alcun modo ai tuoi cookie o al Data Layer aziendale.
* **Console Logging (`logging`):** Utilizzato unicamente per loggare lo stato di caricamento ("Pixel loaded successfully") e facilitare il debug.
