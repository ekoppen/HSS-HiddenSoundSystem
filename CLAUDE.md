# HSS — projectinstructies

Haal aan het begin van elke sessie de projectnotitie op (staat in Trilium,
laadt niet automatisch mee zoals de oude Obsidian-vault deed):

```bash
~/.claude/scripts/trilium-note.sh get HSS
```

Daarin staan de *waarom*-laag bij eerdere beslissingen, de twee installaties
(hiddensound en de tuinhuis-Pi) en de werkende volgorde om uit te rollen,
inclusief de valkuilen die daar al eens tijd gekost hebben. Lees hem vóór je
iets op een Pi doet.

## Vaste punten

- **Twee installaties, één repo.** `hiddensound` cast naar een Nest Hub, de
  tuinhuis-Pi drijft een lokaal HDMI-kioskscherm. Een wijziging aan het
  kioskscherm raakt dus altijd allebei — en die twee gedragen zich anders
  (`isCasting` is op het tuinhuis voor altijd false).
- **Uitrollen doe je met de hand**, zie de notitie. `scripts/deploy.sh` is
  onbruikbaar zodra er al gepulld is.
- **Testen:** `npm test` draait node:test via tsx. De suites die
  `better-sqlite3` of een draaiende server nodig hebben, falen op een Mac —
  dat is de omgeving, niet de code. De pure unit-tests horen wel te slagen.
- **Stille fouten zijn hier de vijand.** Een dood knopje, een leeg scherm, een
  lijst die leeg blijft: het patroon is telkens dat er iets faalt zonder dat
  ook maar iets dat zegt. Nieuwe faalpaden loggen (`console.error`) of melden
  via `src/services/healthLog.ts`.
