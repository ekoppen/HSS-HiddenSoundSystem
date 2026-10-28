import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Card, Toggle } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

// System date/time/timezone — the Pi's own clock, not per-browser time.
export const AuthTabSystemTime: React.FC = () => {
  const [timeInfo, setTimeInfo] = useState<any>(null);
  const [manualDateTime, setManualDateTime] = useState('');
  const [timeFeedback, setTimeFeedback] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system/time')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setTimeInfo(res);
      })
      .catch(() => {});
  }, []);

  const postTimeSettings = async (body: Record<string, unknown>, successMessage: string) => {
    try {
      const res = await fetch('/api/system/time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.success) {
        setTimeInfo(res);
        setTimeFeedback(successMessage);
      } else {
        setTimeFeedback(res.error || 'Kon instelling niet opslaan');
      }
    } catch (e) {
      setTimeFeedback('Kon instelling niet opslaan');
    }
    setTimeout(() => setTimeFeedback(null), 3000);
  };

  const handleSetTimezone = (tz: string) => postTimeSettings({ timezone: tz }, 'Tijdzone bijgewerkt!');
  const handleToggleNtp = (enabled: boolean) => postTimeSettings({ ntpEnabled: enabled }, enabled ? 'Automatische tijdsynchronisatie ingeschakeld!' : 'Automatische tijdsynchronisatie uitgeschakeld!');

  const handleSetManualTime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDateTime) return;
    await postTimeSettings({ dateTime: manualDateTime.replace('T', ' ') + ':00' }, 'Systeemtijd ingesteld!');
  };

  return (
    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Datum, tijd & tijdzone</h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              De systeemklok van de Raspberry Pi zelf — gebruikt voor logs, bestandstijden en de klok op het
              Cast-scherm. Niet de tijd die je browser toont.
            </p>
          </div>
        </div>

        {timeInfo && (
          <div
            style={{
              padding: 16,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>
              {new Date(timeInfo.localTime).toLocaleString('nl-NL', { dateStyle: 'full', timeStyle: 'medium' })}
            </div>
            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
              {timeInfo.ntpSynced
                ? 'Gesynchroniseerd via NTP'
                : timeInfo.ntpEnabled
                ? 'NTP ingeschakeld, nog niet gesynchroniseerd'
                : 'NTP uitgeschakeld — handmatige tijd'}
            </div>
          </div>
        )}

        <div>
          <label style={labelStyle}>Tijdzone</label>
          <select
            value={timeInfo?.timezone || ''}
            onChange={(e) => handleSetTimezone(e.target.value)}
            style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
          >
            {!timeInfo?.timezones?.includes(timeInfo?.timezone) && timeInfo?.timezone && (
              <option value={timeInfo.timezone}>{timeInfo.timezone}</option>
            )}
            {(timeInfo?.timezones || []).map((tz: string) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div style={{ padding: 16, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          <Toggle
            checked={!!timeInfo?.ntpEnabled}
            onChange={handleToggleNtp}
            label="Automatische tijdsynchronisatie (NTP)"
            description="Aanbevolen — houdt de systeemklok gesynchroniseerd via internet. Zet dit uit om de tijd hieronder handmatig in te stellen."
          />
        </div>

        {!timeInfo?.ntpEnabled && (
          <form onSubmit={handleSetManualTime} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Datum & tijd handmatig instellen</label>
              <input
                type="datetime-local"
                value={manualDateTime}
                onChange={(e) => setManualDateTime(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <Button icon={<Save size={15} />}>Instellen</Button>
          </form>
        )}

        {timeFeedback && (
          <div
            style={{
              padding: 12,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-soft-strong)',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
              color: 'var(--accent)',
            }}
          >
            {timeFeedback}
          </div>
        )}
      </div>
    </Card>
  );
};
