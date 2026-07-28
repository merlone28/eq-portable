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

## Rilevatore di fischio (feedback) — come funziona e perché

Pensato per il "ring out" da fare prima di un'adunanza: si alza lentamente il guadagno del canale (podio o leggio) mentre l'oratore parla normale, e l'app segnala in tempo reale la frequenza che sta per innescare, prima che si senta il fischio. Non usa la misura mediata a tempo (10/20/30 s) del referto principale: gira in parallelo, frame per frame, sulla stessa curva smussata (`smooth`) già calcolata per il display live.

La logica è la stessa del rilevamento "picco stretto" già usato in `report()` (prominenza rispetto alla media delle 4 bande vicine, range 100 Hz&ndash;8 kHz, dove i microfoni da palco effettivamente innescano), ma qui si guarda la *velocità di salita* invece del solo valore assoluto: una risonanza di stanza stabile non fa scattare l'alert, un innesco che sta montando sì. Quando una banda è confermata, viene aggiunta a un elenco (chip) che resta visibile per tutta la sessione, utile perché in una sala reale il gain-before-feedback si trova di solito su più frequenze in sequenza, non una sola.

Soglie tarate a mano (da verificare sul campo, sono il punto più probabile da aggiustare):
- prominenza media veloce > 6.5 dB **e** differenza fast−slow > 3.5 dB per innescare l'alert
- richiede 5 frame consecutivi "caldi" (circa 80 ms a 60 fps) prima di confermare, per non scattare su consonanti dure (T, S) o rumori impulsivi
- se il telefono supporta la vibrazione, vibra 120 ms a ogni nuova conferma

Limiti noti: è un'euristica acustica, non una vera misura di margine di guadagno (non conosce il gain reale del mixer); su un fonico esperto è un aiuto, non un sostituto dell'orecchio. Va provato con un vero ring test in sala prima di fidarsene durante un'adunanza vera.

## Soglie e parametri tarati a mano

- Consiglio numerico emesso se |dev| > 1,5 dB (3 dB sotto i 63 Hz e sopra i 16 kHz, dove il mic è inaffidabile)
- Correzione limitata a ±9 dB
- Picco stretto = banda che supera di oltre 7 dB la media delle 4 bande vicine, solo tra 100 Hz e 8 kHz → suggerito parametrico Q≈10
- Soglie zone: 2,5 dB per i sub, 2 dB per gli alti, 1,5 dB per il resto
- Intensità del linguaggio: <soglia+1,5 → "un po'"; <6 dB → forma neutra; ≥6 dB → "decisamente"

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

Priorità pensate per lo stesso caso d'uso (parlato dal vivo, mixer semplice, sala di culto):

1. **Traduzione dei consigli per mixer a 3 bande:** oggi l'app ragiona per bande fini (fino a 31) presupponendo un parametrico. Molti mixer da Sala del Regno hanno solo bassi/medi/alti shelf. Aggiungere una modalità che riduce i consigli fini a un'unica indicazione per banda larga.
2. **Misura "a gate" durante il parlato reale:** invece di scartare l'intera misura se ci sono troppi frame sotto soglia (pause tra una frase e l'altra), accumulare solo i frame sopra una soglia di attivazione. Permetterebbe di tarare durante un discorso vero senza rumore rosa.
3. **Esportazione del referto** (testo o PNG del grafico) da mandare a chi opera il mixer, se non è la stessa persona che tiene il telefono.
4. **Persistenza delle misure** in `localStorage`, con nome della sala — utile per chi gira più congregazioni.
5. **Confronto prima/dopo:** salvare una misura come riferimento e mostrare le due curve sovrapposte per verificare l'effetto delle correzioni applicate.
6. **Curva obiettivo personalizzabile** dall'utente, trascinando i punti sul grafico.
7. **Correzione della risposta del microfono:** permettere il caricamento di un file di calibrazione, se si vuole usare un mic di misura esterno.

## Installabilità (PWA) — come funziona

- `manifest.json`: nome, icone, `display:"standalone"`, `theme_color`/`background_color` coerenti con la UI (`#16181a`/`#101214`).
- `sw.js`: service worker cache-first con fallback di rete, cache versione `rta-eq-v1`, precarica la shell (`index.html`, manifest, icone). Registrato in fondo allo `<script>` di `rta-equalizzazione.html` con `navigator.serviceWorker.register("sw.js")`, avvolto in un controllo `"serviceWorker" in navigator` e un `.catch(()=>{})` silenzioso: se il service worker non parte (es. `file://` locale, dove i service worker non sono supportati) l'app funziona comunque, solo senza cache offline garantita.
- Icone: `icon.svg` è il sorgente (barre di uno spettro ambra/ciano su sfondo scuro, con la linea tratteggiata dell'obiettivo, in stile con la UI); esportate in PNG con cairosvg a 512, 192, 180 (apple-touch-icon) e 32 px (favicon). Sono full-bleed e il contenuto rientra nella "safe zone" delle icone maskable, quindi lo stesso file serve sia per `purpose:"any"` che `"maskable"`.
- **Su Android/Chrome desktop:** con manifest + service worker attivi, il browser offre "Installa app"/"Aggiungi a schermata Home" con l'icona vera.
- **Su iOS/Safari:** "Aggiungi a Home" ha sempre funzionato per qualsiasi sito, ma senza i meta tag `apple-touch-icon` e `apple-mobile-web-app-capable` usava uno screenshot della pagina invece dell'icona ed apriva dentro Safari. Ora usa l'icona vera e apre a schermo intero come app.

## Nota operativa per la prossima sessione

Il filesystem del container non sopravvive tra una chat e l'altra: **scarica `rta-equalizzazione.html` e ricaricalo** nella nuova conversazione, oppure mettilo in un repo e lavoraci da lì.
