# Lokaal HDMI-scherm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Laat de bestaande cast-kiosk-pagina rechtstreeks op een HDMI-scherm zien dat op de Pi zelf is aangesloten, via een bij het opstarten actieve systemd-service, zonder de bestaande Nest Hub-cast-flow te wijzigen.

**Architecture:** Een nieuwe `cage`-compositor + `chromium-browser --kiosk` combinatie, beheerd via een nieuwe root-owned systemd-unit (`hss-kiosk-display.service`), aan/uit-schakelbaar vanuit de webinterface. Hergebruikt de bestaande `?kiosk=1`-pagina en het live `cast_design_updated` WebSocket-mechanisme volledig — geen wijziging aan de rendering-laag.

**Tech Stack:** Node/TypeScript backend (`child_process.execSync`, `fs`), Express routes, React/TypeScript frontend. Nieuwe systeempakketten op de Pi: `cage`, `chromium-browser` (via `apt-get`, geïnstalleerd door de app zelf).

**Spec:** `docs/superpowers/specs/2026-08-24-local-hdmi-display-design.md`

## Global Constraints

- Service draait als `User=root` (zelfde precedent als `librespot-hss.service`), met `chromium-browser --no-sandbox` (verplicht voor Chromium onder root).
- `WantedBy=multi-user.target`, nooit `graphical.target` (Lite bereikt dat target nooit).
- Geen reboot nodig om te activeren — alleen `systemctl enable --now`.
- Alle nieuwe POST-routes vereisen `requireAudioPermission('admin:all')` (installeert pakketten, schrijft een root-owned systemd-unit).
- Niet-Linux (macOS dev-omgeving) valt terug op een virtuele/gesimuleerde flow, exact zoals `autoProvisionSystem` dat al doet — nooit een echte `apt-get`/`systemctl`-aanroep op een dev-machine.
- Geen wijziging aan `castSessionState`/`castSettingsState` — het lokale scherm is geen "cast target", het leest hetzelfde gedeelde ontwerp maar heeft geen eigen sessie-state.
- Servicenaam: exact `hss-kiosk-display.service`; unit-pad: `/etc/systemd/system/hss-kiosk-display.service`.

---

### Task 1: `PiSetupService` — kiosk-display provisioning

**Files:**
- Modify: `src/services/piSetup.ts`
- Test: `tests/kiosk-display.test.ts` (nieuw)

**Interfaces:**
- Produces:
  - `export interface KioskDisplayStatus { packagesInstalled: boolean; serviceEnabled: boolean; serviceActive: boolean; }`
  - `export function buildKioskDisplayUnit(webPort: number): string` — pure, geen side effects.
  - `PiSetupService.detectKioskDisplayStatus(): KioskDisplayStatus`
  - `PiSetupService.enableLocalKioskDisplay(webPort: number): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }>`
  - `PiSetupService.disableLocalKioskDisplay(): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }>`
  - Alle drie zijn methoden op de al bestaande `piSetup`-singleton (`export const piSetup = new PiSetupService();`, onderaan het bestand — niet wijzigen).

- [ ] **Step 1: Schrijf de eerste falende test — `buildKioskDisplayUnit`**

Maak `tests/kiosk-display.test.ts` aan met:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKioskDisplayUnit } from '../src/services/piSetup.ts';
import { piSetup } from '../src/services/piSetup.ts';

test('buildKioskDisplayUnit includes the given port in the kiosk URL', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /http:\/\/localhost:3000\/\?kiosk=1/);
});

test('buildKioskDisplayUnit falls back to port 3000 for an invalid port', () => {
  const unit = buildKioskDisplayUnit(-1);
  assert.match(unit, /http:\/\/localhost:3000\/\?kiosk=1/);
});

test('buildKioskDisplayUnit targets multi-user.target, never graphical.target', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /WantedBy=multi-user\.target/);
  assert.doesNotMatch(unit, /graphical\.target/);
});

test('buildKioskDisplayUnit runs chromium with --no-sandbox (required when running as root)', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /User=root/);
  assert.match(unit, /--no-sandbox/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/kiosk-display.test.ts`
Expected: FAIL — `buildKioskDisplayUnit` is not exported (does not exist yet).

- [ ] **Step 3: Implement `buildKioskDisplayUnit` and `KioskDisplayStatus`**

In `src/services/piSetup.ts`, add near the top (after the existing `ProvisioningLogEntry` interface, before `export class PiSetupService`):

```ts
export interface KioskDisplayStatus {
  packagesInstalled: boolean;
  serviceEnabled: boolean;
  serviceActive: boolean;
}

const KIOSK_DISPLAY_SERVICE_NAME = 'hss-kiosk-display';
const KIOSK_DISPLAY_UNIT_PATH = `/etc/systemd/system/${KIOSK_DISPLAY_SERVICE_NAME}.service`;

// webPort always comes from state.ts's own PORT constant server-side, but
// it still lands inside a double-quoted ExecStart= segment below — same
// defensive validation as the deviceName/bitrate handling in
// autoProvisionSystem, applied at the actual sink rather than trusting
// every future caller.
export function buildKioskDisplayUnit(webPort: number): string {
  const safePort = Number.isInteger(webPort) && webPort > 0 && webPort < 65536 ? webPort : 3000;
  return `[Unit]
Description=HSS Lokale Kiosk-weergave (HDMI)
After=network.target sound.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/cage -- /usr/bin/chromium-browser --kiosk --no-sandbox --ozone-platform=wayland --disable-infobars --noerrdialogs --incognito "http://localhost:${safePort}/?kiosk=1"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/kiosk-display.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing tests for `detectKioskDisplayStatus`/`enableLocalKioskDisplay`/`disableLocalKioskDisplay`**

Append to `tests/kiosk-display.test.ts`:

```ts
test('detectKioskDisplayStatus returns all-false without throwing on a non-Linux dev machine', () => {
  const status = piSetup.detectKioskDisplayStatus();
  assert.equal(status.packagesInstalled, false);
  assert.equal(status.serviceEnabled, false);
  assert.equal(status.serviceActive, false);
});

test('enableLocalKioskDisplay succeeds via the emulated path on a non-Linux dev machine', async () => {
  const result = await piSetup.enableLocalKioskDisplay(3000);
  assert.equal(result.success, true);
  assert.ok(result.logs.length > 0);
  assert.ok(result.logs.some((l) => l.step === 'Omgeving'));
});

test('disableLocalKioskDisplay succeeds via the emulated path on a non-Linux dev machine', async () => {
  const result = await piSetup.disableLocalKioskDisplay();
  assert.equal(result.success, true);
  assert.ok(result.logs.length > 0);
});
```

**Note voor de implementer:** deze drie tests draaien op de ontwikkelmachine (macOS, niet Linux) en testen daarom expliciet het `!this.isLinux`-emulatiepad — hetzelfde pad dat `autoProvisionSystem` al gebruikt voor zijn eigen niet-Linux-fallback (zie regel ~185-192 in het bestaande bestand). Dit is bewust: er is geen manier om de echte `apt-get`/`systemctl`-aanroepen op een niet-Pi-machine te testen, en dat hoeft ook niet — de emulatie-tak bewijst dat de functie een zinnig, niet-crashend resultaat teruggeeft ongeacht platform.

- [ ] **Step 6: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/kiosk-display.test.ts`
Expected: FAIL — `detectKioskDisplayStatus`/`enableLocalKioskDisplay`/`disableLocalKioskDisplay` do not exist yet on `piSetup`.

- [ ] **Step 7: Implement the three `PiSetupService` methods**

Inside `export class PiSetupService { ... }` in `src/services/piSetup.ts`, add these three public methods (place them after the existing `detectSetupStatus` method, before `autoProvisionSystem`):

```ts
  public detectKioskDisplayStatus(): KioskDisplayStatus {
    if (!this.isLinux) {
      return { packagesInstalled: false, serviceEnabled: false, serviceActive: false };
    }

    let packagesInstalled = false;
    try {
      execSync('which cage', { stdio: 'ignore' });
      execSync('dpkg -s chromium-browser', { stdio: 'ignore' });
      packagesInstalled = true;
    } catch {}

    let serviceEnabled = false;
    try {
      const out = execSync(`systemctl is-enabled ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      serviceEnabled = out === 'enabled';
    } catch {}

    let serviceActive = false;
    try {
      const out = execSync(`systemctl is-active ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      serviceActive = out === 'active';
    } catch {}

    return { packagesInstalled, serviceEnabled, serviceActive };
  }

  public async enableLocalKioskDisplay(webPort: number): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }> {
    const logs: ProvisioningLogEntry[] = [];
    const addLog = (step: string, status: ProvisioningLogEntry['status'], message: string) => {
      logs.push({ step, status, message, timestamp: new Date().toLocaleTimeString() });
    };

    addLog('Init', 'pending', 'Start installatie van lokaal kiosk-scherm...');

    if (!this.isLinux) {
      addLog('Omgeving', 'warning', 'Ontwikkelingsomgeving (niet-Linux). Installatie wordt virtueel gesimuleerd.');
      addLog('Pakketten', 'success', 'cage en chromium-browser geïnstalleerd (virtueel).');
      addLog('Systemd-unit', 'success', `${KIOSK_DISPLAY_UNIT_PATH} weggeschreven (virtueel).`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service ingeschakeld en gestart (virtueel).`);
      return { success: true, logs };
    }

    // 1. Packages
    const hasCage = (() => {
      try {
        execSync('which cage', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    const hasChromium = (() => {
      try {
        execSync('dpkg -s chromium-browser', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    if (!hasCage || !hasChromium) {
      addLog('Pakketten', 'pending', 'cage en/of chromium-browser ontbreken, installeren via apt-get...');
      try {
        execSync('apt-get install -y cage chromium-browser', { stdio: 'pipe' });
        addLog('Pakketten', 'success', 'cage en chromium-browser succesvol geïnstalleerd.');
      } catch (e: any) {
        addLog('Pakketten', 'error', `Installatie van cage/chromium-browser mislukt: ${e.message}`);
        return { success: false, logs };
      }
    } else {
      addLog('Pakketten', 'success', 'cage en chromium-browser zijn al geïnstalleerd.');
    }

    // 2. Systemd unit
    try {
      fs.writeFileSync(KIOSK_DISPLAY_UNIT_PATH, buildKioskDisplayUnit(webPort), 'utf8');
      addLog('Systemd-unit', 'success', `${KIOSK_DISPLAY_UNIT_PATH} weggeschreven.`);
    } catch (e: any) {
      addLog('Systemd-unit', 'error', `Kon systemd-unit niet schrijven: ${e.message}`);
      return { success: false, logs };
    }

    // 3. Enable + start
    try {
      execSync(`systemctl daemon-reload && systemctl enable --now ${KIOSK_DISPLAY_SERVICE_NAME}.service`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service ingeschakeld en gestart.`);
    } catch (e: any) {
      addLog('Service', 'error', `Kon service niet starten: ${e.message}`);
      return { success: false, logs };
    }

    // 4. Verify (best-effort — a missing screen is a warning, not a hard failure,
    // since the service stays enabled and retries on its own via Restart=on-failure)
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const active = execSync(`systemctl is-active ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (active === 'active') {
        addLog('Verificatie', 'success', 'Kiosk-scherm actief.');
      } else {
        addLog('Verificatie', 'warning', 'Service is ingeschakeld maar nog niet actief — controleer of er een scherm is aangesloten. De service blijft het opnieuw proberen.');
      }
    } catch {}

    return { success: true, logs };
  }

  public async disableLocalKioskDisplay(): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }> {
    const logs: ProvisioningLogEntry[] = [];
    const addLog = (step: string, status: ProvisioningLogEntry['status'], message: string) => {
      logs.push({ step, status, message, timestamp: new Date().toLocaleTimeString() });
    };

    if (!this.isLinux) {
      addLog('Omgeving', 'warning', 'Ontwikkelingsomgeving (niet-Linux). Uitschakelen wordt virtueel gesimuleerd.');
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service gestopt en uitgeschakeld (virtueel).`);
      return { success: true, logs };
    }

    try {
      execSync(`systemctl disable --now ${KIOSK_DISPLAY_SERVICE_NAME}.service 2>/dev/null || true`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service gestopt en uitgeschakeld.`);
      return { success: true, logs };
    } catch (e: any) {
      addLog('Service', 'error', `Kon service niet uitschakelen: ${e.message}`);
      return { success: false, logs };
    }
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/kiosk-display.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 9: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/services/piSetup.ts tests/kiosk-display.test.ts
git commit -m "feat: PiSetupService methods for the local HDMI kiosk display"
```

---

### Task 2: Backend routes

**Files:**
- Modify: `src/server/routes/system.ts`
- Modify: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: `piSetup.detectKioskDisplayStatus()`, `piSetup.enableLocalKioskDisplay(webPort: number)`, `piSetup.disableLocalKioskDisplay()` (all produced in Task 1); `requireAudioPermission`, `PORT`, `broadcastWebSocket` (already imported at the top of `system.ts` — `requireAudioPermission` and `PORT` already appear in the existing import line, `broadcastWebSocket` too).
- Produces: `GET /api/setup/kiosk-display`, `POST /api/setup/kiosk-display/enable`, `POST /api/setup/kiosk-display/disable` — consumed by Task 3's frontend component.

- [ ] **Step 1: Write the failing smoke tests**

In `tests/smoke.test.ts`, add after the existing `an unauthenticated user-registration attempt for the admin role is rejected` test (keeps the "regression guard for an admin-gated route" tests grouped together):

```ts
test('an unauthenticated request to enable the local kiosk display is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display/enable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to disable the local kiosk display is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display/disable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('GET /api/setup/kiosk-display is reachable without authentication (read-only status)', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.status.packagesInstalled, 'boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build && npm test`
Expected: build succeeds, then the 3 new smoke tests FAIL with 404 (routes don't exist yet). Note: `npm test` runs the full suite (spawns the real built server) — this is the existing convention in this codebase, there's no way to run `smoke.test.ts` against only the new routes in isolation.

- [ ] **Step 3: Implement the three routes**

In `src/server/routes/system.ts`, add after the existing `router.post('/api/setup/reboot', ...)` block (before the `// 10. Scripted Environment Code Generator` comment):

```ts
router.get('/api/setup/kiosk-display', (req, res) => {
  const status = piSetup.detectKioskDisplayStatus();
  res.json({ success: true, status });
});

// admin:all — installs system packages (cage, chromium-browser) and writes
// a root-owned systemd unit; not a task for a scoped integration key.
router.post('/api/setup/kiosk-display/enable', requireAudioPermission('admin:all'), async (req, res) => {
  const result = await piSetup.enableLocalKioskDisplay(PORT);
  if (result.success) {
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: 'Lokaal kiosk-scherm ingeschakeld' },
    });
  }
  res.json({ success: result.success, logs: result.logs, status: piSetup.detectKioskDisplayStatus() });
});

router.post('/api/setup/kiosk-display/disable', requireAudioPermission('admin:all'), async (req, res) => {
  const result = await piSetup.disableLocalKioskDisplay();
  if (result.success) {
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: 'Lokaal kiosk-scherm uitgeschakeld' },
    });
  }
  res.json({ success: result.success, logs: result.logs, status: piSetup.detectKioskDisplayStatus() });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build && npm test`
Expected: all tests pass, including the 3 new ones (total test count = previous total + 3).

- [ ] **Step 5: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/system.ts tests/smoke.test.ts
git commit -m "feat: /api/setup/kiosk-display routes for the local HDMI kiosk display"
```

---

### Task 3: Frontend — `KioskDisplayCard` component

**Files:**
- Create: `src/components/KioskDisplayCard.tsx`
- Modify: `src/components/NestHubCastManager.tsx:1-31` (add one import line), `src/components/NestHubCastManager.tsx:1424-1425` (render the new card)

**Interfaces:**
- Consumes: `GET /api/setup/kiosk-display`, `POST /api/setup/kiosk-display/enable`, `POST /api/setup/kiosk-display/disable` (produced in Task 2); `Badge`, `Card` from `./ui` (already exist, same imports `NestHubCastManager.tsx` already uses).
- Produces: `export const KioskDisplayCard: React.FC` — a fully self-contained component, no props (fetches its own status on mount, matching the `AuthTabSystemTime.tsx` pattern of a zero-prop self-contained tab component already established in this codebase).

- [ ] **Step 1: Create `src/components/KioskDisplayCard.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import { Badge, Card } from './ui';

interface ProvisioningLog {
  step: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

interface KioskDisplayStatus {
  packagesInstalled: boolean;
  serviceEnabled: boolean;
  serviceActive: boolean;
}

const logStatusColor: Record<ProvisioningLog['status'], string> = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-danger)',
  pending: 'var(--accent)',
};

// Boot-managed local HDMI kiosk display — shows the exact same ?kiosk=1
// page a Nest Hub gets cast to, but rendered directly on a screen attached
// to the Pi itself via a systemd-managed cage+chromium-browser process.
// See docs/superpowers/specs/2026-08-24-local-hdmi-display-design.md.
export const KioskDisplayCard: React.FC = () => {
  const [status, setStatus] = useState<KioskDisplayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ProvisioningLog[]>([]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/setup/kiosk-display').then((r) => r.json());
      if (res.status) setStatus(res.status);
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleToggle = async () => {
    setBusy(true);
    const enabling = !status?.serviceEnabled;
    setLogs([
      {
        step: 'Init',
        status: 'pending',
        message: enabling ? 'Lokaal scherm inschakelen...' : 'Lokaal scherm uitschakelen...',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    try {
      const res = await fetch(`/api/setup/kiosk-display/${enabling ? 'enable' : 'disable'}`, { method: 'POST' }).then((r) => r.json());
      if (res.logs) setLogs(res.logs);
      if (res.status) setStatus(res.status);
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { step: 'Fout', status: 'error', message: err.message || 'Onbekende fout', timestamp: new Date().toLocaleTimeString() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const badge = !status ? null : status.serviceActive ? (
    <Badge variant="success">Actief</Badge>
  ) : status.serviceEnabled ? (
    <Badge variant="warning">Scherm niet gevonden</Badge>
  ) : !status.packagesInstalled ? (
    <Badge variant="neutral">Nog niet geïnstalleerd</Badge>
  ) : (
    <Badge variant="neutral">Uitgeschakeld</Badge>
  );

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Monitor size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Lokaal HDMI-scherm
          </span>
        </div>
        {badge}
      </div>

      <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Toont dezelfde kiosk-weergave rechtstreeks op een scherm dat op de Pi zelf is aangesloten (HDMI),
        naast — of in plaats van — casten naar een Nest Hub. Start automatisch bij het opstarten van de Pi.
      </p>

      <button
        onClick={handleToggle}
        disabled={busy}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 16px',
          borderRadius: 'var(--radius-md)',
          background: status?.serviceEnabled ? 'rgba(251,113,133,0.12)' : 'var(--accent)',
          color: status?.serviceEnabled ? 'var(--status-danger)' : 'var(--on-accent)',
          border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
          font: 'var(--text-body-strong)',
        }}
      >
        {busy && <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />}
        {status?.serviceEnabled ? 'Lokaal scherm uitschakelen' : 'Lokaal scherm inschakelen'}
      </button>

      {logs.length > 0 && (
        <div
          className="scrollbar-thin"
          style={{
            marginTop: 14,
            padding: 14,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            maxHeight: 180,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            font: 'var(--text-mono-sm)',
          }}
        >
          {logs.map((log, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>[{log.timestamp}]</span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  flexShrink: 0,
                  color: logStatusColor[log.status],
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {log.step}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
```

- [ ] **Step 2: Wire it into `NestHubCastManager.tsx`**

Add the import — in `src/components/NestHubCastManager.tsx`, after the existing line `import { THEME_PRESETS } from '../services/themeManager.ts';` (line 30):

```tsx
import { KioskDisplayCard } from './KioskDisplayCard.tsx';
```

Then render it as the last card in the left column — find this exact existing text in `src/components/NestHubCastManager.tsx` (the end of the "4. Kleurenthema" card, immediately followed by the left column's closing `</div>`):

```tsx
            {castSettings.accentMode === 'custom' && (
              <div style={{ marginTop: 10 }}>
                <ColorField label="Aangepaste accentkleur" value={castSettings.customAccentColor} onChange={(v) => handleUpdateCastSettings({ customAccentColor: v })} />
              </div>
            )}
          </Card>
        </div>
```

Replace it with (adds `<KioskDisplayCard />` right after the theme `</Card>`, still inside the left column's `<div>`):

```tsx
            {castSettings.accentMode === 'custom' && (
              <div style={{ marginTop: 10 }}>
                <ColorField label="Aangepaste accentkleur" value={castSettings.customAccentColor} onChange={(v) => handleUpdateCastSettings({ customAccentColor: v })} />
              </div>
            )}
          </Card>

          <KioskDisplayCard />
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build`
Expected: succeeds, no new warnings beyond the pre-existing chunk-size warning.

- [ ] **Step 5: Manual browser verification**

This is a frontend-only UI change with no unit-test convention in this codebase (verified via browser, matching how every other frontend feature this session was checked). Start the local dev server (`npm run dev`), open the Cast tab, confirm:
- A new "Lokaal HDMI-scherm" card renders at the bottom of the left column, below "4. Kleurenthema".
- Badge shows "Nog niet geïnstalleerd" or "Uitgeschakeld" (dev machine is non-Linux, so `packagesInstalled` will be `false`).
- Clicking "Lokaal scherm inschakelen" shows the progress log list with the emulated log entries from Task 1's non-Linux fallback path, ending with a "success" status, and the badge updates.
- Clicking "Lokaal scherm uitschakelen" reverses it.

- [ ] **Step 6: Commit**

```bash
git add src/components/KioskDisplayCard.tsx src/components/NestHubCastManager.tsx
git commit -m "feat: local HDMI kiosk display toggle in the Cast tab"
```

---

## Final Verification (whole plan)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds.
- [ ] `npm test` — all tests pass (previous 49 + 3 smoke + 7 kiosk-display = 59).
- [ ] Manual browser check per Task 3 Step 5.
- [ ] Update `docs/API.md`'s Cast & Smart Display section with the three new endpoints, matching the existing documentation style for `/api/cast/*` in that same section.

**Explicitly out of scope for this plan** (per the spec's "Niet in scope" section): independent per-screen design, multiple simultaneous local displays, automating the underlying Wayland/DRM/Mesa stack beyond `cage`+`chromium-browser` themselves. Real-hardware verification (does `cage` actually pick up the HDMI output correctly, is `--no-sandbox` sufficient, does `apt-get install cage chromium-browser` succeed on a stock Bookworm Lite image) happens once the user's Raspberry Pi 3B+ test rig is ready — this plan produces working, deployable code, but the "Resterend risico" noted in the spec is validated on real hardware, not in this implementation pass.

**Deliberate deviation from the spec's testplan:** the spec's testplan mentions testing `POST .../enable` with a scoped (non-admin) API key expecting 403. This plan's Task 2 only tests the unauthenticated (401) case. Reason: no other `admin:all`-gated route in this codebase (`/api/nas/mount`, `/api/system/time`, `/api/setup/provision`, `/api/setup/reboot`) currently has a scoped-key 403 test either — `requireAudioPermission`'s permission check itself already has direct unit test coverage via `tests/security-hardening.test.ts`'s `computeGrantableKeyPermissions` tests. Adding hardware-route-specific depth here that no sibling route has would be scope creep inconsistent with this codebase's established test-depth convention, not a meaningful gap in coverage of the actual risk (self-granting `admin:all` is what's unit-tested; each route correctly *using* `requireAudioPermission('admin:all')` is a one-line, visually-verifiable wiring — same as its siblings).
