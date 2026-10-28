# Muziekbibliotheek: overzicht, zoeken, detail, pills, state

Datum: 2026-08-23

## Aanleiding

Na het live gebruiken van de nieuwe Muziekbibliotheek-weergave (artiest →
album → song) kwamen zeven punten naar voren:

1. Instellingen toont geen overzicht van gekoppelde NAS-shares met
   bestandsaantal — het "Bronnen (0)"-label in de hoofdnavigatie telt in
   werkelijkheid opgeslagen afspeellijsten (`create-playlist`), niet
   NAS-inhoud, dus het blijft altijd 0 zodra je alleen via de nieuwe
   bibliotheek browst. Geen bug — een label dat het verkeerde meet, en een
   eerder besproken maar nooit gebouwd instellingenoverzicht.
2. Songs tonen de placeholder-hoes in plaats van de albumhoes die al
   bekend is op albumniveau.
3. Geen zoekfunctie binnen de bibliotheek.
4. Geen detailweergave per song.
5. Geen "pills" (kleine badges) voor extra data per song — te beginnen met
   lyrics vanuit Catalogic, uitbreidbaar naar andere databronnen later.
6. Geen manier om de grootte van de artwork-tegels aan te passen.
7. Een refresh valt terug naar het "Bestanden"-tabblad in plaats van op
   "Muziekbibliotheek" te blijven staan.

Gebruiker heeft drie scope-beslissingen al gemaakt:
- **NAS-overzicht**: bouw het echte overzicht (share-lijst + bestandsaantal
  in Instellingen), laat het "Bronnen"-label verder met rust.
- **State-persistentie**: alleen het hoofdtabblad (Muziekbibliotheek vs.
  Bestanden) hoeft een refresh te overleven — niet de navigatiediepte
  (welke artiest/album je net bekeek).
- **Lyrics-pill**: zet song-matching aan door de bestaande
  `/api/nas/enrich`-route te hergebruiken (die doet al
  `allowCatalogicLookup: true`) — geen nieuwe matchlogica.

## 1. NAS-overzicht in Instellingen

Nieuwe kaart in `AuthAndApiKeysView.tsx`, subtab "Netwerkschijf (NAS/SMB)",
vlak vóór de bestaande mount-form-kaart (regel ~1397).

**Backend**: `GET /api/nas/shares` bestaat al (`nas.ts:15`) en retourneert
elk share record (`name`, `host`, `mountPoint`, `status`, wachtwoord
gemaskeerd). Uitbreiden met een bestandsaantal per share:

```ts
router.get('/api/nas/shares', (req, res) => {
  const shares = getDbNetworkShares().map((s) => ({
    ...s,
    password: s.password ? '••••••••' : '',
    fileCount: getDbNasLibraryFileCountForShare(s.id, s.mountPoint),
  }));
  res.json({ success: true, shares });
});
```

**Correctie (gevonden tijdens de finale review van deze batch, niet
eerder opgemerkt):** de oorspronkelijke aanname hieronder — "`share_id`
staat al op elke `nas_library_index`-rij" — is feitelijk onjuist.
`share_id` wordt alleen gezet door het volledige-bibliotheek-scanpad
(`nasLibraryScan.ts`); rijen die ontstaan door te bláderen (de
bibliotheekweergave's songs-route, of de rauwe bestandenverkenner) hebben
`share_id = NULL`. Een naïeve `WHERE share_id = ?`-telling zou dus 0
blijven tonen voor elke NAS die alleen ooit doorbladerd is — precies de
klacht die deze hele batch motiveerde. `getDbNasLibraryFileCountForShare`
telt daarom zowel op `share_id` als op een `file_path LIKE
'<mountPoint>/%'`-prefixmatch:

```ts
export function getDbNasLibraryFileCountForShare(shareId: string, mountPoint: string): number {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM nas_library_index WHERE share_id = ? OR file_path LIKE ? || \'/%\'')
      .get(shareId, mountPoint) as any;
    return row?.count || 0;
  } catch (e) {
    return 0;
  }
}
```

**Frontend**: kaart met één regel per share: naam, protocol, host, status,
`{fileCount} bestanden geïndexeerd` (of "Nog niet gescand" bij 0 — expliciet
onderscheid, geen misleidende "0 bestanden" als er simpelweg nog nooit
gescand is). Fetch bij het openen van de NAS-subtab (`useEffect` op
`activeSubTab === 'nas'`, zelfde patroon als de bestaande scan-status
polling in dit bestand).

## 2. Songs erven albumhoes

`NasMusicLibrary.tsx`'s `openAlbum` kent het album se eigen `artworkUrl` al
(het is het argument dat binnenkomt). Na het laden van `res.songs`, elke
song zonder eigen bruikbare `coverUrl` (leeg, of exact de
`PLACEHOLDER_COVER`-URL) laten terugvallen op `album.artworkUrl`:

```ts
const openAlbum = async (album: LibraryAlbum) => {
  setCurrentAlbumName(album.name);
  setCurrentAlbumArtwork(album.artworkUrl);
  setLevel('songs');
  try {
    const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
    if (res.songs) {
      setSongs(
        res.songs.map((s: LibrarySong) => ({
          ...s,
          coverUrl: s.coverUrl && s.coverUrl !== PLACEHOLDER_COVER ? s.coverUrl : album.artworkUrl || s.coverUrl,
        })),
      );
    }
  } catch (e) {}
};
```

(Nieuwe `currentAlbumArtwork`-state nodig voor het detailpaneel uit §4, dat
het album-artwork ook los van een individuele song moet kunnen tonen.)

## 3. Zoeken binnen de bibliotheek

Eén zoekveld in de header, filtert **het huidige niveau** tegen wat al
geladen is (geen nieuwe route, geen server-round-trip) — snel, en dekt de
praktijk: je zoekt naar een artiest in de artiestengrid, of een song in de
songlijst die je al open hebt. Cross-niveau zoeken (bv. direct een song
zoeken zonder eerst artiest/album te kiezen) is een uitbreiding voor later,
niet in deze iteratie.

```ts
const [searchQuery, setSearchQuery] = useState('');

const visibleArtists = artists.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
const visibleAlbums = albums.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
const visibleSongs = songs.filter(
  (s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()) || s.artist.toLowerCase().includes(searchQuery.toLowerCase()),
);
```

Zoekveld wordt geleegd bij niveauwissel (`openArtist`/`openAlbum`/terug-knop
zetten `searchQuery` terug naar `''`) — zoeken binnen een net geopend
niveau begint schoon.

## 4. Song-detailweergave

Klikken op een songrij (niet op de play/queue-knoppen zelf) opent een
modal/paneel met wat al beschikbaar is: titel, artiest, album (met
albumhoes — groter dan de kleine 28px thumbnail in de lijst), duur,
bitrate, sample rate, bit depth, matchstatus (wel/niet Catalogic-gematcht),
en de pill-rij uit §5. Play/wachtrij-knoppen ook in het paneel beschikbaar.

Simpel `selectedSong: LibrarySong | null`-state, geen aparte route nodig —
alle velden zijn al onderdeel van `LibrarySong`/het bestaande
`resolveLocalTrack`-resultaat, op `catalogicSongId` na (zie §5, moet nog
worden doorgegeven).

## 5. Pills: lyrics vanuit Catalogic (uitbreidbaar)

### Songs matchen op bibliotheekniveau

`GET /api/nas/library/songs` roept nu `resolveLocalTrack(filePath, { allowCatalogicLookup: false })`
— nooit een Catalogic-match. Dat blijft ongewijzigd (geen nieuwe
matchlogica in die route, zoals de oorspronkelijke Global Constraint al
vastlegde). In plaats daarvan: **na** het tonen van de songlijst, dezelfde
`POST /api/nas/enrich`-route aanroepen die de rauwe bestandenverkenner al
gebruikt (`nas.ts:164`, roept al `resolveLocalTrack(filePath, { allowCatalogicLookup: true })`
aan) — identiek "snel tonen, dan verrijken"-patroon als overal elders in
deze feature, nul nieuwe matchcode.

```ts
const openAlbum = async (album: LibraryAlbum) => {
  // ...songs laden zoals hierboven...
  const paths = res.songs.map((s: LibrarySong) => s.path);
  if (paths.length > 0) {
    fetch('/api/nas/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
      .then((r) => r.json())
      .then((enrichRes) => {
        if (!enrichRes.tracks) return;
        setSongs((prev) =>
          prev.map((s) => (enrichRes.tracks[s.path] ? { ...s, catalogicSongId: enrichRes.tracks[s.path].catalogicSongId } : s)),
        );
      })
      .catch(() => {});
  }
};
```

`LibrarySong` krijgt een `catalogicSongId?: string | null`-veld.
`GET /api/nas/library/songs` geeft dit al mee (het zit al in
`resolveLocalTrack`'s returnwaarde, wordt alleen nog niet in de
`LibrarySong`-TypeScript-interface aan de frontend blootgesteld).

### Lyrics-beschikbaarheid opzoeken (nieuwe Catalogic-capability)

Geverifieerd tegen de Catalogic-broncode
(`catalogic/src/routes/lyrics.ts`): `GET /v1/songs/:songId/lyrics`
(optioneel `?locale=`/`?format=`) — publiek leesbaar (geen scope vereist
voor GET, alleen PUT/DELETE), retourneert `{ data: LyricsRow[] }`.

Nieuwe `catalogicClient.ts`-functie, zelfde best-effort-stijl als de rest:

```ts
export interface CatalogicLyrics {
  id: string;
  locale: string;
  format: 'plain' | 'lrc';
  text: string;
}

export async function lookupCatalogicLyrics(songId: string): Promise<CatalogicLyrics[] | undefined> {
  if (!config.enabled || !songId) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.url}/v1/songs/${encodeURIComponent(songId)}/lyrics`, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined; // transient failure — not "no lyrics"
    const body = (await res.json()) as { data: CatalogicLyrics[] };
    return body.data || [];
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
```

Retourneert `undefined` bij een transiente fout (zelfde error/no-match
discipline als de recente bugfix voor artist/album lookups — een tijdelijke
Catalogic-storing mag nooit permanent "geen lyrics" cachen), een lege array
bij een echte "geen lyrics voor deze song", en de array met tekst bij een
treffer.

### Opslag: `has_lyrics`/`lyrics_checked_at` op `nas_library_index`

Zelfde `checked_at IS NULL` = nooit gecontroleerd-discriminator als overal
elders in deze feature — zonder cache zou elke keer een album geopend
wordt élke song opnieuw een lyrics-lookup doen.

```sql
ALTER TABLE nas_library_index ADD COLUMN has_lyrics INTEGER;
ALTER TABLE nas_library_index ADD COLUMN lyrics_checked_at INTEGER;
```

Nieuwe route `POST /api/nas/library/enrich-lyrics` — body `{ paths: string[] }`,
zelfde concurrency-4-workerpatroon, alleen songs met een bekende
`catalogic_song_id` én `lyrics_checked_at IS NULL` oppakken (geen
Catalogic-aanroep voor een song die nog geen `catalogicSongId` heeft — die
komt pas na de `/api/nas/enrich`-stap hierboven, dus deze aanroep volgt
er ná in de frontend). Retourneert `{ [path]: { hasLyrics: boolean } }`.

### Pill-UI (uitbreidbaar systeem)

Kleine, generieke `Pill`-component (nieuw, in `NasMusicLibrary.tsx` of een
gedeeld `ui`-bestand als er al een geschikte plek is) — een rij van dit
soort badges in de songrij én het detailpaneel:

```tsx
function Pill({ label, active, onClick }: { label: string; active: boolean; onClick?: () => void }) {
  if (!active) return null;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px',
        borderRadius: 999,
        font: 'var(--text-mono-sm)',
        fontSize: 11,
        fontWeight: 600,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {label}
    </button>
  );
}
```

Voor deze iteratie: één pill, "Lyrics", zichtbaar wanneer
`song.hasLyrics === true`. Klikken op de pill in het detailpaneel haalt de
volledige tekst op (`lookupCatalogicLyrics` via een dunne route, of direct
de al-opgehaalde `has_lyrics`-check hergebruiken plus een aparte
"toon tekst"-aanroep) en toont die in een uitklapbaar tekstblok — geen
aparte lyrics-pagina.

**Uitbreidbaarheid voor later**: de pill-component en de
`enrich-lyrics`-achtige route-vorm (checked_at-cache, concurrency-4,
best-effort) zijn generiek genoeg om te hergebruiken voor toekomstige
databronnen (bv. audio-analyse, credits) — niet in deze iteratie gebouwd,
alleen zo opgezet dat het geen herontwerp vergt.

## 6. Artwork-grootte instelbaar

Slider (`<input type="range">`) in de header, stuurt een `tileSize`-state
(bv. 80–200px) die de grid's `gridTemplateColumns` bepaalt in plaats van de
huidige vaste Tailwind-breakpoints:

```ts
const [tileSize, setTileSize] = useState(120);
// ...
<div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`, gap: 14 }}>
```

Geldt voor de artiesten- en albumgrid (songlijst is toch al een lijst, geen
grid). Waarde persisteert mee in dezelfde localStorage-key als §7.

## 7. State-persistentie (hoofdtabblad)

Zelfde patroon dat al bestaat voor de "Muziekbibliotheek"/"Bestanden"
sub-tab-keuze in `PlaylistManager.tsx` (`localStorage.getItem('nas-sub-view')`)
— dat mechanisme werkt al correct voor het hoofdtabblad. Controleren dat
het daadwerkelijk de default is bij page-load (niet alleen bij een
in-app-wissel) en, indien nodig, `tileSize` er als tweede sleutel naast
zetten (`nas-tile-size`, of gecombineerd in één JSON-blob).

## Wat NIET in deze iteratie zit

- Cross-niveau zoeken (rechtstreeks een song zoeken zonder eerst
  artiest/album te kiezen).
- Navigatiediepte onthouden na een refresh (alleen het hoofdtabblad).
- Andere Catalogic-databronnen dan lyrics (audio-analyse, credits, etc.) —
  het pill-systeem is er wel klaar voor, maar er wordt nu alleen lyrics
  gebouwd.
- Lyrics tonen/bewerken vanuit HSS zelf (alleen lezen wat Catalogic al
  heeft — geen PUT-aanroepen, dat blijft Catalogic's eigen beheer).
