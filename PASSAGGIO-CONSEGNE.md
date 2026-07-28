# RTA / Assistente di equalizzazione — passaggio di consegne

## Cos'è

Webapp single-file che usa il microfono del dispositivo per analizzare la risposta in frequenza di un impianto audio e produrre consigli di equalizzazione motivati in linguaggio comune.

- **File:** `rta-equalizzazione.html` (~29 KB)
- **Stack:** HTML + CSS + JavaScript vanilla. Web Audio API. **Zero dipendenze esterne, zero build step, funziona offline.**
- **Lingua interfaccia:** italiano.
- **Target:** mobile-first, testato come layout fino a 380 px; funziona anche desktop.

## Come funziona (catena di misura)

1. `getUserMedia` con `echoCancellation`, `noiseSuppression`, `autoGainControl` **tutti false** — indispensabile, altrimenti il telefono "corregge" il segnale e la misura non vale nulla.
2. `AnalyserNode`, `fftSize = 16384`, `smoothingTimeConstant = 0` (lo smoothing è fatto a mano).
3. `getFloatFrequencyData` → potenza per bin → **somma di potenza per banda di 1/3 d'ottava** (31 bande ISO da 20 Hz a 20 kHz). La somma, non la media: così il rumore rosa risulta piatto.
4. Normalizzazione: si sottrae la media delle bande tra 50 Hz e 10 kHz → curva relativa, centrata sullo 0. Non è SPL assoluto e non pretende di esserlo.
5. **Analisi a tempo:** il pulsante avvia un accumulo lineare della potenza per 10/20/30 s con countdown a schermo. Al termine il risultato viene congelato in `frozen` e il referto resta fermo.
6. Confronto con la curva obiettivo → deviazione per banda → aggregazione in 10 bande d'ottava (`octDev`) → aggregazione in 5 zone d'ascolto (`ZONES`) per il testo in linguaggio comune.

## Strutture dati chiave (tutte in cima allo `<script>`)

| Nome | Cosa contiene |
|---|---|
| `CENTERS` | 31 frequenze centrali ISO di 1/3 d'ottava |
| `TARGETS` | 4 curve obiettivo (`flat`, `pa`, `speech`, `hifi`), definite su 10 punti d'ottava, interpolate in log-frequenza |
| `OCT` | le 10 bande d'ottava usate per i consigli numerici |
| `ZONES` | 5 zone d'ascolto (sub / bassi / medi / medio-alti / alti). Per ognuna: 3 varianti testuali per eccesso e 3 per difetto (intensità crescente), più titolo e spiegazione lunga |
| `WHY` | descrizione breve per ciascuna delle 10 bande d'ottava, versione eccesso e difetto |

**Il testo dei consigli è tutto lì dentro.** Per cambiare il tono o il vocabolario dei referti si tocca solo `ZONES` e `WHY`, non la logica.

## Funzioni principali

- `startMic()` / `stopMic()` — ciclo di vita audio
- `buildBands(sr, binCount)` — mappa bande → intervalli di bin FFT
- `power()` / `toDb()` / `normalize()` — catena di misura
- `loop()` — rAF: display live oppure accumulo se `analyzing`, più `checkFeedback()` se `ringActive`
- `begin()` / `finish()` — sessione di analisi a tempo, con scarto della misura se troppi frame sotto −52 dBFS o sopra −2 dBFS
- `report(sp)` — genera headline sintetica, blocchi in linguaggio comune, dettaglio numerico, rilevamento picchi stretti
- `draw(sp)` — canvas: barre che crescono *dalla* curva obiettivo (ambra = eccesso, ciano = difetto), più marker rosso sulla banda in feedback se `ringActive`
- `makePink()` — rumore rosa (Paul Kellet) su buffer di 8 s in loop
- `startRing()` / `stopRing()` — ciclo di vita del rilevatore di fischio
- `checkFeedback()` — chiamata ogni frame quando `ringActive`: per ogni banda 100 Hz&ndash;8 kHz calcola la prominenza rispetto alle 4 bande vicine, ne tiene una media mobile veloce (`ringFast`, α 0.45) e una lenta (`ringSlow`, α 0.035); se la veloce supera 6.5 dB e supera la lenta di oltre 3.5 dB per almeno 5 frame consecutivi, segnala la banda come possibile innesco
- `recordRingHit(b)` / `renderRingHits()` — tengono e mostrano l'elenco delle frequenze già trovate nella sessione corrente (deduplicate per banda, tenuto il valore massimo)
- `setEqMode(simple)` — passa tra dettaglio parametrico e 3 bande, ricalcola il referto corrente se c'è una misura congelata
- `setGateMode(g)` — passa tra rumore fisso e parlato reale, bloccato durante un'analisi in corso (`analyzing`)

## Rilevatore di fischio (feedback) — come funziona e perché

Pensato per il "ring out" da fare prima di un'adunanza: si alza lentamente il guadagno del canale (podio o leggio) mentre l'oratore parla normale, e l'app segnala in tempo reale la frequenza che sta per innescare, prima che si senta il fischio. Non usa la misura mediata a tempo (10/20/30 s) del referto principale: gira in parallelo, frame per frame, sulla stessa curva smussata (`smooth`) già calcolata per il display live.

La logica è la stessa del rilevamento "picco stretto" già usato in `report()` (prominenza rispetto alla media delle 4 bande vicine, range 100 Hz&ndash;8 kHz, dove i microfoni da palco effettivamente innescano), ma qui si guarda la *velocità di salita* invece del solo valore assoluto: una risonanza di stanza stabile non fa scattare l'alert, un innesco che sta montando sì. Quando una banda è confermata, viene aggiunta a un elenco (chip) che resta visibile per tutta la sessione, utile perché in una sala reale il gain-before-feedback si trova di solito su più frequenze in sequenza, non una sola.

Soglie tarate a mano (da verificare sul campo, sono il punto più probabile da aggiustare):
- prominenza media veloce > 6.5 dB **e** differenza fast−slow > 3.5 dB per innescare l'alert
- richiede 5 frame consecutivi "caldi" (circa 80 ms a 60 fps) prima di confermare, per non scattare su consonanti dure (T, S) o rumori impulsivi
- se il telefono supporta la vibrazione, vibra 120 ms a ogni nuova conferma

Limiti noti: è un'euristica acustica, non una vera misura di margine di guadagno (non conosce il gain reale del mixer); su un fonico esperto è un aiuto, non un sostituto dell'orecchio. Va provato con un vero ring test in sala prima di fidarsene durante un'adunanza vera.

## Due modalità: Sala del Regno e Avanzata

L'app si apre in **Sala del Regno** (modalità guidata) ed è la modalità pensata per l'uso reale: chi la usa non deve conoscere nulla di audio. La scelta è salvata in `localStorage` (`rtaAppMode`), quindi chi installa l'app la ritrova come l'ha lasciata.

**Sala del Regno (easy)**
- Preset bloccati e applicati da `setAppMode("easy")`: curva **speech**, **gate mode** attivo, **EQ a 3 bande**, durata **20 s**. Il rumore rosa viene fermato se attivo.
- Restano visibili solo: pulsante microfono, un unico pulsante grande **Analizza la sala**, i due pulsanti di media/azzeramento, il grafico, il rilevatore di fischio e il referto.
- Card guidata "Cosa fare, passo per passo" con 5 passi in linguaggio comune.
- Il dettaglio delle correzioni si apre già espanso (`cardsDetails.open=true`) con il titolo "Cosa toccare sul mixer".
- Testi di note e referto riscritti senza gergo (niente dBFS, Q, cancellazioni di fase).

**Avanzata (pro)**
- Sblocca tutti i controlli originali: durata 10/20/30 s, rumore rosa, modalità di misura, curva obiettivo, dettaglio parametrico/3 bande.
- Passando da easy a pro le impostazioni correnti **non vengono resettate**: restano quelle dei preset finché non le cambi. Questo è voluto (nulla cambia sotto i piedi, si sbloccano solo i comandi).

**Implementazione.** Una classe sul `<body>` (`easy` / `pro`) più due classi di visibilità: `.proOnly` è nascosto in easy, `.easyOnly` è nascosto in pro. Le etichette condivise passano da `runLabel()` e `posLabel()`, così i pulsanti e i testi del referto restano coerenti con la modalità attiva. `setAppMode()` è bloccata durante un'analisi in corso.

## EQ semplificata a 3 bande — come funziona e perché

Toggle "Dettaglio correzioni" nella sezione controlli: **Parametrico** (comportamento originale, fino a 31 bande fini più i picchi stretti Q&asymp;10) oppure **3 bande**, pensata per i mixer da Sala del Regno che hanno solo bassi/medi/alti a shelf, senza parametrico.

In modalità 3 bande, `report()` non genera più le card fini né i picchi stretti (un taglio Q&asymp;10 non è comunque realizzabile su uno shelf): raggruppa le 10 bande d'ottava (`OCT`) in tre gruppi definiti in `BROAD`, media le deviazioni di ciascun gruppo, e produce una sola card per gruppo se la media supera 2 dB di soglia:
- **Bassi** = bande 31.5/63/125/250 Hz
- **Medi** = bande 500/1000/2000 Hz
- **Alti** = bande 4000/8000/16000 Hz

Il testo delle card (`BROAD[].hi`/`.lo`) è scritto per chi non conosce il gergo audio ("gira la manopola dei bassi verso il taglio"), non per un fonico. Cambiare la soglia di 2 dB o i confini dei tre gruppi si tocca solo in `BROAD`, non nella logica di `report()`.

## Misura "a gate" sul parlato reale — come funziona e perché

Toggle "Modalità di misura": **Rumore fisso** (comportamento originale: accumula ogni frame per tutta la durata, pensato per rumore rosa o programma continuo) oppure **Parlato reale**, pensata per tarare l'EQ durante un discorso vero, con le pause naturali tra una frase e l'altra.

In modalità gate, in `loop()` un frame entra nell'accumulo (`acc`/`accN`) solo se il livello supera `GATE_DB` (−48 dBFS): i momenti di silenzio tra le frasi vengono ignorati invece di sporcare la media. Di conseguenza anche il controllo di validità in `finish()` cambia: invece di scartare la misura quando la frazione di frame "deboli" supera il 40% (pensato per un segnale continuo, dove è sintomo di volume basso), in gate mode si scarta solo se **meno del 25% dei frame totali** ha superato la soglia (`accN/frames<0.25`, messaggio "Troppo poco parlato catturato"): con pause normali di conversazione è facile restare sopra quella soglia, un discorso quasi tutto silenzioso no. Il controllo di saturazione (clipping) resta invariato in entrambe le modalità.

Il cambio di modalità è bloccato mentre un'analisi è in corso (`analyzing`), per non alterare una misura a metà.

## Soglie e parametri tarati a mano

- Consiglio numerico emesso se |dev| > 1,5 dB (3 dB sotto i 63 Hz e sopra i 16 kHz, dove il mic è inaffidabile)
- Correzione limitata a ±9 dB
- Picco stretto = banda che supera di oltre 7 dB la media delle 4 bande vicine, solo tra 100 Hz e 8 kHz → suggerito parametrico Q≈10
- Soglie zone: 2,5 dB per i sub, 2 dB per gli alti, 1,5 dB per il resto
- Intensità del linguaggio: <soglia+1,5 → "un po'"; <6 dB → forma neutra; ≥6 dB → "decisamente"
- EQ 3 bande: consiglio emesso se |media di gruppo| > 2 dB
- Modalità "parlato reale": soglia di attivazione `GATE_DB=-48` dBFS; misura scartata se meno del 25% dei frame è sopra soglia

## Limiti noti (dichiarati anche nell'interfaccia)

- Microfono non calibrato: sotto 50 Hz e sopra 12 kHz le letture sono indicative
- Nessuna misura di fase, tempo di riverbero o RT60
- I buchi stretti nei bassi sono cancellazioni della sala e non si correggono con l'EQ
- La media multi-posizione è aritmetica sui dB, non sulle potenze (scelta voluta: pesa meno i picchi isolati)

## Deploy

Il microfono richiede **contesto sicuro**: HTTPS oppure `file://` locale. Non funziona su `http://` remoto.
Percorso previsto: GitHub Pages → aggiunta alla home del telefono. Nessuna build, si carica il file e basta.

## Cose da fare, in ordine di utilità

**Fatto (28/07/2026):** rilevatore di fischio (feedback) in tempo reale — vedi sezione dedicata sopra. Pensato per l'uso principale dell'app: voci di oratori su mixer analogico/digitale in una Sala del Regno.

**Fatto (28/07/2026):** installabilità reale — `manifest.json`, `sw.js` (service worker) e icone (`icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon-32.png`). Vedi sezione dedicata sotto.

**Fatto (28/07/2026):** EQ semplificata a 3 bande e misura "a gate" sul parlato reale — vedi le due sezioni dedicate sopra.

**Fatto (28/07/2026):** separazione in **due modalità**, Sala del Regno (guidata) e Avanzata — vedi sezione dedicata sopra. Nel farlo è emerso e stato corretto un bug del service worker che impediva agli aggiornamenti di arrivare agli utenti.

Priorità rimaste, pensate per lo stesso caso d'uso (parlato dal vivo, mixer semplice, sala di culto):

1. **Esportazione del referto** (testo o PNG del grafico) da mandare a chi opera il mixer, se non è la stessa persona che tiene il telefono.
2. **Persistenza delle misure** in `localStorage`, con nome della sala — utile per chi gira più congregazioni.
3. **Confronto prima/dopo:** salvare una misura come riferimento e mostrare le due curve sovrapposte per verificare l'effetto delle correzioni applicate.
4. **Curva obiettivo personalizzabile** dall'utente, trascinando i punti sul grafico.
5. **Correzione della risposta del microfono:** permettere il caricamento di un file di calibrazione, se si vuole usare un mic di misura esterno.

## Installabilità (PWA) — come funziona

- `manifest.json`: nome, icone, `display:"standalone"`, `theme_color`/`background_color` coerenti con la UI (`#16181a`/`#101214`).
- `sw.js`: service worker, cache versione `rta-eq-v3`, precarica la shell (`index.html`, manifest, icone). Registrato in fondo allo `<script>` di `rta-equalizzazione.html` con `navigator.serviceWorker.register("sw.js")`, avvolto in un controllo `"serviceWorker" in navigator` e un `.catch(()=>{})` silenzioso: se il service worker non parte (es. `file://` locale, dove i service worker non sono supportati) l'app funziona comunque, solo senza cache offline garantita.

### ⚠️ Strategia di cache — attenzione, qui è già stato commesso un errore

La prima versione era **cache-first per tutto**: risultato, una volta installata l'app, **gli aggiornamenti non arrivavano più**. Si pubblicava una nuova versione su Pages e il telefono continuava a mostrare quella vecchia, all'infinito. Sistemato in due passaggi (entrambi necessari):

1. **Network-first per l'HTML**: il documento si prende sempre dalla rete, la cache serve solo come fallback offline. Il resto (icone, manifest) resta cache-first.
2. **Bypass della cache HTTP del browser**: non bastava il punto 1, perché `fetch()` può restituire l'HTML dalla cache HTTP di GitHub Pages (`max-age`) e l'utente vedeva comunque la versione vecchia. Servono `fetch(req, {cache:"no-store"})` nel fetch handler e `new Request(u, {cache:"reload"})` nel precache di `install`.

**Regola operativa: a ogni rilascio, alza il numero di versione in `const CACHE`** (`rta-eq-v3` → `v4` …). È quello che fa scattare la pulizia delle cache vecchie in `activate`. Dopo una pubblicazione, per verificare davvero che l'aggiornamento passi, ricarica **due volte** (la prima attiva il nuovo service worker, la seconda mostra il contenuto nuovo).
- Icone: `icon.svg` è il sorgente (barre di uno spettro ambra/ciano su sfondo scuro, con la linea tratteggiata dell'obiettivo, in stile con la UI); esportate in PNG con cairosvg a 512, 192, 180 (apple-touch-icon) e 32 px (favicon). Sono full-bleed e il contenuto rientra nella "safe zone" delle icone maskable, quindi lo stesso file serve sia per `purpose:"any"` che `"maskable"`.
- **Su Android/Chrome desktop:** con manifest + service worker attivi, il browser offre "Installa app"/"Aggiungi a schermata Home" con l'icona vera.
- **Su iOS/Safari:** "Aggiungi a Home" ha sempre funzionato per qualsiasi sito, ma senza i meta tag `apple-touch-icon` e `apple-mobile-web-app-capable` usava uno screenshot della pagina invece dell'icona ed apriva dentro Safari. Ora usa l'icona vera e apre a schermo intero come app.

## Nota operativa per la prossima sessione

Il filesystem del container non sopravvive tra una chat e l'altra: **scarica `rta-equalizzazione.html` e ricaricalo** nella nuova conversazione, oppure mettilo in un repo e lavoraci da lì.
