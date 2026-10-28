import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Mic, RotateCcw, Save } from 'lucide-react';
import { HubConfig } from '../types';
import { Button, Card } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

// Mirrors DEFAULT_SILENCE_RMS_THRESHOLD / DEFAULT_LONG_SILENCE_SEC in
// src/services/audioRecognition.ts (that file is server-only —
// child_process/fs — so it can't be imported into this browser bundle;
// only used here to label/reset these fields).
const DEFAULT_SILENCE_THRESHOLD = 250;
const DEFAULT_LONG_SILENCE_SEC = 60;

interface AuthTabRecognitionProps {
  daemonConfig: HubConfig;
  setDaemonConfig: React.Dispatch<React.SetStateAction<HubConfig>>;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onFeedback: (msg: string) => void;
}

// Muziekherkenning (turntable/CD via USB mic)
export const AuthTabRecognition: React.FC<AuthTabRecognitionProps> = ({ daemonConfig, setDaemonConfig, onSaveConfig, onFeedback }) => {
  const [showAcoustidKey, setShowAcoustidKey] = useState(false);
  const [showAuddToken, setShowAuddToken] = useState(false);
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    fetch('/api/recognize/devices')
      .then((r) => r.json())
      .then((res) => {
        if (res.devices) setMicDevices(res.devices);
      })
      .catch(() => {});
  }, []);

  const handleSaveRecognition = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig({
      acoustidApiKey: daemonConfig.acoustidApiKey,
      auddApiToken: daemonConfig.auddApiToken,
      recognitionMicDevice: daemonConfig.recognitionMicDevice,
      recognitionSilenceThreshold: daemonConfig.recognitionSilenceThreshold,
      recognitionLongSilenceSec: daemonConfig.recognitionLongSilenceSec,
    });
    onFeedback('Herkenningsinstellingen opgeslagen!');
  };

  return (
    <Card padding={0}>
      <form onSubmit={handleSaveRecognition} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Muziekherkenning (LP/CD)</h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Herkent wat er op je platenspeler of CD-speler draait via een USB-microfoon, zodat de titel/artiest
              ook op de Nest Hub te zien is. Dit app speelt dit geluid niet af — de bron gaat rechtstreeks naar je
              versterker.
            </p>
          </div>
          <Button icon={<Save size={15} />}>Instellingen opslaan</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <div>
            <label style={labelStyle}>Microfoon (USB capture-apparaat)</label>
            <select
              value={daemonConfig.recognitionMicDevice || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, recognitionMicDevice: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            >
              <option value="">— Kies een apparaat —</option>
              {micDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            {micDevices.length === 0 && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
                Geen USB-microfoons gevonden. Sluit hem aan en herlaad deze pagina.
              </p>
            )}
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Stilte-drempel (RMS)</span>
              <button
                type="button"
                onClick={() => setDaemonConfig({ ...daemonConfig, recognitionSilenceThreshold: DEFAULT_SILENCE_THRESHOLD })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                <RotateCcw size={12} />
                Standaard ({DEFAULT_SILENCE_THRESHOLD})
              </button>
            </label>
            <input
              type="number"
              min={10}
              max={10000}
              placeholder={String(DEFAULT_SILENCE_THRESHOLD)}
              value={daemonConfig.recognitionSilenceThreshold ?? ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, recognitionSilenceThreshold: e.target.value === '' ? undefined : Number(e.target.value) })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
              Geluidsniveau waaronder een fragment als "stil" telt (nodig om een echte pauze tussen twee nummers te
              onderscheiden van muziek). Hoger bij een ruisige microfoon of rumoerige kamer, lager als pauzes tussen
              tracks niet worden opgemerkt. Standaard {DEFAULT_SILENCE_THRESHOLD}, getest tegen één specifieke
              USB-microfoon.
            </p>
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Stoppen na stilte (seconden)</span>
              <button
                type="button"
                onClick={() => setDaemonConfig({ ...daemonConfig, recognitionLongSilenceSec: DEFAULT_LONG_SILENCE_SEC })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                <RotateCcw size={12} />
                Standaard ({DEFAULT_LONG_SILENCE_SEC}s)
              </button>
            </label>
            <input
              type="number"
              min={5}
              max={3600}
              placeholder={String(DEFAULT_LONG_SILENCE_SEC)}
              value={daemonConfig.recognitionLongSilenceSec ?? ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, recognitionLongSilenceSec: e.target.value === '' ? undefined : Number(e.target.value) })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
              Hoe lang de bron onafgebroken stil moet zijn voordat dit als een echte stop geldt (niet zomaar een
              pauze tussen twee nummers) — daarna verdwijnt het laatst herkende nummer van het scherm. Zet dit
              hoger als je bijvoorbeeld een platenspeler gebruikt en het omdraaien van de plaat vaker als "gestopt"
              wordt gezien dan de bedoeling is.
            </p>
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>AudD API-token (aanbevolen voor mic-herkenning)</span>
              <button
                type="button"
                onClick={() => setShowAuddToken(!showAuddToken)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {showAuddToken ? <EyeOff size={12} /> : <Eye size={12} />}
                {showAuddToken ? 'Verbergen' : 'Tonen'}
              </button>
            </label>
            <input
              type={showAuddToken ? 'text' : 'password'}
              placeholder="Aan te maken op audd.io — herkent ook via microfoon"
              value={daemonConfig.auddApiToken || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, auddApiToken: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>AcoustID API-sleutel (alleen voor schoon lijnniveau-signaal)</span>
              <button
                type="button"
                onClick={() => setShowAcoustidKey(!showAcoustidKey)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {showAcoustidKey ? <EyeOff size={12} /> : <Eye size={12} />}
                {showAcoustidKey ? 'Verbergen' : 'Tonen'}
              </button>
            </label>
            <input
              type={showAcoustidKey ? 'text' : 'password'}
              placeholder="Gratis aan te maken op acoustid.org"
              value={daemonConfig.acoustidApiKey || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, acoustidApiKey: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>
        </div>

        <div style={{ padding: 16, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-body-strong)', color: 'var(--accent)', margin: 0 }}>
            <Mic size={15} />
            <span>Hoe werkt dit?</span>
          </h4>
          <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>
            Start "Platenspeler" of "CD-speler" luisteren bij Bronnen → Extern. Korte geluidsniveau-controles van
            2 seconden houden bij of het stil is; zodra na een stilte het geluid weer terugkomt, wordt binnen enkele
            seconden een fragment opgenomen, lokaal vergeleken met eerder herkende nummers (gratis, werkt zelfs
            offline), en alleen bij een nieuw nummer online opgezocht — eerst bij AudD (herkent ook via microfoon,
            kamergeluid en al), pas als dat niets vindt bij AcoustID. Herkende nummers blijven permanent bewaard,
            dus dezelfde plaatkant of cd kost nooit twee keer een opzoeking.
          </p>
        </div>
      </form>
    </Card>
  );
};
