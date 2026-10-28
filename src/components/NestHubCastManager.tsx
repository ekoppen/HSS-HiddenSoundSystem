import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  BarChart2,
  Bookmark,
  Cast,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
  Copy,
  Disc,
  Disc3,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Monitor,
  Move,
  Palette,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  StopCircle,
  Sun,
  Trash2,
  Tv,
  Type as TypeIcon,
  Volume2,
  Zap,
} from 'lucide-react';
import { THEME_PRESETS } from '../services/themeManager.ts';
import { KioskDisplayCard } from './KioskDisplayCard.tsx';
import { getEnabledLayoutOrder } from '../services/castLayoutOrder.ts';
import { Badge, Button, Card, Slider, Toggle } from '../components/ui';
import {
  AnchorH,
  AnchorV,
  CastDesignPreset,
  CastDevice,
  CastLayout,
  CastSessionState,
  CastSettings,
  CustomFont,
  PlaybackState,
  ThemeId,
} from '../types.ts';

interface NestHubCastManagerProps {
  playback: PlaybackState;
  currentThemeId: ThemeId;
  onOpenCastKioskDirect: (layout: CastLayout, themeId: ThemeId) => void;
}

const LAYOUTS: { id: CastLayout; name: string; desc: string }[] = [
  { id: 'kiosk_touch', name: 'Touch Kiosk Controller', desc: 'Grote knoppen, volumeschuif en bronkeuze' },
  { id: 'artwork_focus', name: 'Artwork Focus', desc: 'Draaiende plaat en groot albumhoes-beeld' },
  { id: 'audiophile_spectrum', name: 'Audiophile Spectrum HUD', desc: 'Real-time FFT analyzer en DAC telemetrie' },
  { id: 'ambient_clock', name: 'Ambient Klok & Track', desc: 'Grote klok met zachte albumhoes op de achtergrond' },
  { id: 'custom_design', name: 'Eigen ontwerp', desc: 'Volledig aanpasbaar — achtergrond, vinyl, klok & effecten' },
];

/** Small segmented-control button — ported from the design handoff's inline SegButton. */
const SegButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      flex: 1,
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm)',
      font: 'var(--text-mono-sm)',
      fontWeight: 600,
      cursor: 'pointer',
      background: active ? 'var(--accent-soft)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      border: '1px solid ' + (active ? 'var(--accent-soft-strong)' : 'var(--border-default)'),
    }}
  >
    {children}
  </button>
);

/** Collapsible per-element settings block — each screen element (art, text, clock,
 * spectrum) gets its own expand/collapse plus, for elements that can be
 * hidden entirely, an on/off switch right in the header so enabling and configuring
 * don't need separate controls in separate places. */
const ElementSection = React.forwardRef<
  HTMLDetailsElement,
  {
    icon: React.ReactNode;
    title: string;
    defaultOpen?: boolean;
    toggle?: { checked: boolean; onChange: (v: boolean) => void };
    children: React.ReactNode;
  }
>(({ icon, title, defaultOpen = true, toggle, children }, ref) => (
  <details ref={ref} open={defaultOpen} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, paddingBottom: 2 }}>
    {/* <summary> needs flex to lay out the toggle + chevron, which as a side effect
        suppresses the browser's native disclosure triangle (it only draws with the
        default list-item display) — so this draws its own and rotates it off the
        details element's own [open] attribute, no extra state needed. */}
    <summary className="hss-details-summary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {icon}
        {title}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {toggle && (
          <span onClick={(e) => e.stopPropagation()}>
            <Toggle checked={toggle.checked} onChange={toggle.onChange} />
          </span>
        )}
        <ChevronDown className="hss-details-chevron" size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </span>
    </summary>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14, marginBottom: 4 }}>{children}</div>
  </details>
));

/** Small color swatch input — used for per-element color settings (e.g. clock text). */
const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 40, height: 28, padding: 0, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
    />
  </div>
);

const ANCHOR_H_OPTIONS: AnchorH[] = ['left', 'center', 'right'];
const ANCHOR_V_OPTIONS: AnchorV[] = ['top', 'center', 'bottom'];

/** Quick-fill starting points for a gradient background — a preset button just
 * writes its pair straight into bgGradientColors/standbyBgGradientColors, same
 * as how a saved design preset applies (handleApplyPreset below): no separate
 * "which preset is active" field to keep in sync with manual edits after. */
const GRADIENT_PRESETS: { label: string; colors: [string, string] }[] = [
  { label: 'Middernacht', colors: ['#1e293b', '#000000'] },
  { label: 'Zonsondergang', colors: ['#f97316', '#7c3aed'] },
  { label: 'Oceaan', colors: ['#0ea5e9', '#1e3a8a'] },
  { label: 'Smaragd', colors: ['#10b981', '#064e3b'] },
  { label: 'Amber', colors: ['#f59e0b', '#78350f'] },
];

/** Row of clickable gradient-preview swatches — click applies both colors at once. */
const GradientPresetPicker: React.FC<{ onPick: (colors: [string, string]) => void }> = ({ onPick }) => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {GRADIENT_PRESETS.map((p) => (
      <button
        key={p.label}
        type="button"
        title={p.label}
        onClick={() => onPick(p.colors)}
        style={{
          width: 36,
          height: 28,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-default)',
          cursor: 'pointer',
          background: `linear-gradient(90deg, ${p.colors[0]}, ${p.colors[1]})`,
        }}
      />
    ))}
  </div>
);

/** 3x3 grid picker for an element's anchor point — which edge/corner of the
 * screen it's positioned from, before the offset sliders nudge it further.
 * Picking the point nearest where an element should sit gives it room to move
 * freely toward the opposite side; an element anchored at an edge has almost
 * none left to move further past that same edge. */
const AnchorPicker: React.FC<{ anchorH: AnchorH; anchorV: AnchorV; onChange: (h: AnchorH, v: AnchorV) => void }> = ({ anchorH, anchorV, onChange }) => (
  <div>
    <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Ankerpunt</span>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gridTemplateRows: 'repeat(3, 28px)', gap: 4, marginTop: 6 }}>
      {ANCHOR_V_OPTIONS.map((v) =>
        ANCHOR_H_OPTIONS.map((h) => {
          const active = h === anchorH && v === anchorV;
          return (
            <button
              key={`${h}-${v}`}
              type="button"
              onClick={() => onChange(h, v)}
              title={`${h} / ${v}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-default)'),
                background: active ? 'var(--accent-soft)' : 'var(--bg-inset)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? 'var(--accent)' : 'var(--text-muted)' }} />
            </button>
          );
        })
      )}
    </div>
  </div>
);

interface CastContentEditorProps {
  settings: CastSettings;
  onUpdate: (partial: Partial<CastSettings>) => void;
  onClose: () => void;
}

/** Embeds the real kiosk page (the exact component the Nest Hub casts) scaled
 * to fit, instead of a hand-maintained mockup — the mockup never actually
 * reflected which of the 5 layouts was selected (always looked identical),
 * which is the class of bug a second, independent render of the same JSX
 * can't help but eventually drift into. Also picks up live design changes
 * for free: the kiosk page already listens for cast_design_updated over its
 * own WebSocket connection. */
const LiveKioskPreview: React.FC<{ layout: CastLayout; themeId: ThemeId; trueWidth: number; trueHeight: number; previewMode?: boolean; standby?: boolean; sourcePickerOpen?: boolean; draftSettings?: CastSettings }> = ({
  layout,
  themeId,
  trueWidth,
  trueHeight,
  previewMode,
  standby,
  sourcePickerOpen,
  draftSettings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / trueWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [trueWidth]);

  // Editor "Toepassen"-knop: unsaved edits no longer trigger the real
  // cast_design_updated broadcast (that now only fires on Toepassen), so the
  // preview iframe gets them pushed directly instead — see the matching
  // 'cast-preview-settings' listener in NestHubCastView.tsx.
  const postDraft = () => {
    if (previewMode && draftSettings) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'cast-preview-settings', settings: draftSettings }, window.location.origin);
    }
  };
  useEffect(postDraft, [previewMode, draftSettings]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <iframe
        ref={iframeRef}
        key={`${layout}-${themeId}-${standby ? 'standby' : 'live'}-${sourcePickerOpen ? 'sp' : 'nosp'}`}
        src={`/?kiosk=1&layout=${layout}&theme=${themeId}${previewMode ? '&preview=1' : ''}${standby ? '&standby=1' : ''}${sourcePickerOpen ? '&sourcepicker=1' : ''}`}
        title="Kiosk live voorbeeld"
        onLoad={postDraft}
        style={{
          width: trueWidth,
          height: trueHeight,
          border: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // The editor preview needs clicks to reach in so elements can be
          // click-to-selected (see the postMessage bridge in CastContentEditor);
          // every other embedding (the read-only status card, standby preview)
          // stays inert as before.
          pointerEvents: previewMode ? 'auto' : 'none',
        }}
      />
    </div>
  );
};

/** Full-screen "Inhoud & vormgeving" overlay — how the cast content looks, not device/automation logic.
 *
 * Edits are local-only (draft state below) until "Toepassen" is clicked — the
 * live preview picks them up instantly via postMessage (see LiveKioskPreview),
 * but real cast/kiosk screens only ever see a saved, applied design: no more
 * pushing a fetch + WS broadcast to every screen on each slider tick. */
const CastContentEditor: React.FC<CastContentEditorProps> = ({ settings: initialSettings, onUpdate: onApply, onClose }) => {
  const [settings, setSettings] = useState<CastSettings>(initialSettings);
  const [isDirty, setIsDirty] = useState(false);
  const onUpdate = (partial: Partial<CastSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    setIsDirty(true);
  };
  const handleApply = () => {
    onApply(settings);
    setIsDirty(false);
  };
  const [editorPreviewModel, setEditorPreviewModel] = useState<'hub7' | 'hub10'>('hub7');
  const [editorPreviewStandby, setEditorPreviewStandby] = useState(false);
  const [editorPreviewSourcePicker, setEditorPreviewSourcePicker] = useState(false);
  const [designPresets, setDesignPresets] = useState<CastDesignPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [fontUploadError, setFontUploadError] = useState<string | null>(null);

  // Lets clicking an element in the live preview (postMessage from the iframe —
  // see the click overlays in NestHubCastView.tsx) jump straight to and expand
  // its settings section, instead of having to hunt for it in the sidebar.
  const elementSectionRefs = useRef<Record<string, HTMLDetailsElement | null>>({});
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'cast-preview-select') return;
      const el = elementSectionRefs.current[e.data.element];
      if (!el) return;
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    fetch('/api/cast/presets')
      .then((r) => r.json())
      .then((d) => {
        if (d.presets) setDesignPresets(d.presets);
      })
      .catch((e) => console.warn('Kon ontwerp-presets niet laden:', e));
  }, []);

  const handleSavePreset = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    setPresetBusy(true);
    try {
      // Deliberately excludes device targeting and automation timers — a preset
      // is "the look", not which Hub it casts to or when it auto-starts/stops.
      const { targetDeviceId, targetDeviceIp, targetDeviceName, layout, autoReCast, autoCastOnPlay, autoStopOnPause, autoStopDelaySec, autoStopReleasesDevice, menuIdleTimeoutSec, ...visualSettings } = settings;
      const res = await fetch('/api/cast/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, settings: visualSettings }),
      }).then((r) => r.json());
      if (res.presets) setDesignPresets(res.presets);
      setNewPresetName('');
    } catch (e) {
      console.warn('Preset opslaan mislukt:', e);
    } finally {
      setPresetBusy(false);
    }
  };

  const handleApplyPreset = (preset: CastDesignPreset) => {
    onUpdate(preset.settings);
  };

  const handleDeletePreset = async (id: string) => {
    try {
      const res = await fetch(`/api/cast/presets/${id}`, { method: 'DELETE' }).then((r) => r.json());
      if (res.presets) setDesignPresets(res.presets);
    } catch (e) {
      console.warn('Preset verwijderen mislukt:', e);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-page)', zIndex: 60, overflowY: 'auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 32px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          position: 'sticky',
          top: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Tv size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Inhoud & vormgeving</span>
          {isDirty && (
            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>· niet-toegepaste wijzigingen</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="primary" icon={<Check size={14} />} onClick={handleApply} disabled={!isDirty}>
            Toepassen
          </Button>
          <button
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </header>

      {/* A real @media query + CSS grid, not flexbox's implicit
          content-driven wrap — the earlier flex-wrap approach depended on
          the summed intrinsic minimum widths of both columns' content
          ever fitting the viewport (unpredictable in practice), and a
          flex-basis in px rather than a true 50/50 split left the preview
          much smaller than the settings column once they *did* sit side
          by side. Grid's two equal 1fr tracks give an actual half/half
          split, not a fixed-vs-grow pairing. Below 900px: stacked,
          preview first. At/above 900px: side by side, preview sticky on
          the right, each column exactly half the width. */}
      <style>{`
        .cce-row { display: flex; flex-direction: column; gap: 24px; }
        .cce-preview-col { order: 1; }
        .cce-settings-col { order: 2; }
        @media (min-width: 900px) {
          .cce-row { display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
          .cce-preview-col { order: 2; min-width: 0; }
          .cce-settings-col { order: 1; min-width: 0; }
        }
      `}</style>
      <div style={{ maxWidth: 1480, margin: '0 auto', padding: '28px 32px 60px' }}>
        <div className="cce-row">
          {/* Not first in reading order — the settings column (below) comes
              first in the DOM/tab order, the CSS class's `order` just
              places this on the right visually at 900px+ (see the <style>
              block above). Sticky so the preview stays in view while the
              settings column scrolls past it. No explicit width — the
              grid's two equal 1fr tracks (see the <style> block) already
              give this column exactly half the row. */}
          <div className="cce-preview-col" style={{ position: 'sticky', top: 76, zIndex: 5 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
              <span
                style={{
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Live voorbeeld — {editorPreviewModel === 'hub7' ? 'Nest Hub 7" 1024×600' : 'Nest Hub Max 10" 1280×800'}
                {editorPreviewStandby ? ' · Standby' : ''}
              </span>
              <div style={{ display: 'flex', background: 'var(--bg-inset)', padding: 3, borderRadius: 'var(--radius-md)', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => setEditorPreviewModel('hub7')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: editorPreviewModel === 'hub7' ? 'var(--accent)' : 'transparent',
                    color: editorPreviewModel === 'hub7' ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  7-inch
                </button>
                <button
                  type="button"
                  onClick={() => setEditorPreviewModel('hub10')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: editorPreviewModel === 'hub10' ? 'var(--accent)' : 'transparent',
                    color: editorPreviewModel === 'hub10' ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  10-inch Max
                </button>
                {/* Independent of the size choice above (both axes can
                    combine) — toggles the preview iframe into the standby
                    view (?standby=1, read by NestHubCastView's isStandby
                    init) so the Standby-scherm card's settings can
                    actually be seen live instead of edited blind. */}
                <button
                  type="button"
                  onClick={() => setEditorPreviewStandby((v) => !v)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: editorPreviewStandby ? 'var(--accent)' : 'transparent',
                    color: editorPreviewStandby ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  Standby
                </button>
                {/* Forces the preview's SourcePicker modal open (?sourcepicker=1,
                    read by NestHubCastView's isSourcePickerOpen init) — without
                    this, judging the "Grootte" slider under Bronnenkiezer means
                    guessing, since that popover is normally closed until tapped
                    and clicks inside the preview iframe aren't a reliable way to
                    open it while editing. */}
                <button
                  type="button"
                  onClick={() => setEditorPreviewSourcePicker((v) => !v)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: editorPreviewSourcePicker ? 'var(--accent)' : 'transparent',
                    color: editorPreviewSourcePicker ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  Bron kiezen
                </button>
              </div>
            </div>
            <div
              style={{
                padding: 14,
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div
                style={{
                  aspectRatio: editorPreviewModel === 'hub7' ? '1024/600' : '1280/800',
                  width: '100%',
                  margin: '0 auto',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  overflow: 'hidden',
                }}
              >
                <LiveKioskPreview
                  layout="custom_design"
                  themeId={settings.themeId}
                  trueWidth={editorPreviewModel === 'hub7' ? 1024 : 1280}
                  trueHeight={editorPreviewModel === 'hub7' ? 600 : 800}
                  previewMode
                  standby={editorPreviewStandby}
                  sourcePickerOpen={editorPreviewSourcePicker}
                  draftSettings={settings}
                />
              </div>
            </div>
          </Card>
          </div>

          {/* Settings column — order 1 puts it on the left visually at
              900px+ (see the <style> block above) despite coming first in
              the DOM either way. */}
          {/* Plain single-column stack, not a grid — auto-fit's empty
              tracks (when the column count it computes exceeds the actual
              number of cards) were leaving visible blank space to the
              side of narrower cards instead of every card genuinely
              filling the settings column's width. Flex removes the
              possibility entirely: every card is always exactly 100%. */}
          <div className="cce-settings-col" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Bookmark size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Opgeslagen ontwerpen
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {designPresets.length === 0 && (
                  <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    Nog geen opgeslagen ontwerpen — stel het scherm hieronder in en bewaar het als preset.
                  </p>
                )}
                {designPresets.map((preset) => (
                  <div
                    key={preset.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-inset)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preset.name}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Button variant="secondary" size="sm" onClick={() => handleApplyPreset(preset)}>
                        Toepassen
                      </Button>
                      <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => handleDeletePreset(preset.id)}>
                        Verwijder
                      </Button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePreset();
                    }}
                    placeholder="Naam voor huidig ontwerp…"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      background: 'var(--bg-inset)',
                      color: 'var(--text-primary)',
                      font: 'var(--text-mono-sm)',
                    }}
                  />
                  <Button variant="primary" size="sm" onClick={handleSavePreset} disabled={presetBusy || !newPresetName.trim()}>
                    Opslaan
                  </Button>
                </div>
              </div>
            </Card>

            {/* Only while previewing standby (see the toggle in the preview
                header above) — its settings are meaningless to look at
                while the preview shows the normal view, same reasoning as
                hiding the normal-view-only sections below while standby is
                what's actually being previewed. */}
            {editorPreviewStandby && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Standby-scherm
                </span>
              </div>
              <p style={{ margin: '0 0 14px', font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                Verschijnt wanneer er niets afspeelt (zie Automatisering hieronder) en "Nest Hub echt
                vrijgeven" daar uit staat — ongeacht welke layout hierboven actief is.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)' }}>Achtergrond</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SegButton active={settings.standbyBgStyle === 'solid'} onClick={() => onUpdate({ standbyBgStyle: 'solid' })}>Effen</SegButton>
                  <SegButton active={settings.standbyBgStyle === 'glow'} onClick={() => onUpdate({ standbyBgStyle: 'glow' })}>Gloed</SegButton>
                  <SegButton active={settings.standbyBgStyle === 'gradient'} onClick={() => onUpdate({ standbyBgStyle: 'gradient' })}>Verloop</SegButton>
                  <SegButton active={settings.standbyBgStyle === 'album_art'} onClick={() => onUpdate({ standbyBgStyle: 'album_art' })}>Album art</SegButton>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <SegButton active={settings.standbyBgStyle === 'custom_image'} onClick={() => onUpdate({ standbyBgStyle: 'custom_image' })}>
                    <ImageIcon size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                    Eigen afbeelding
                  </SegButton>
                  <label
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      font: 'var(--text-mono-sm)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    Uploaden…
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          onUpdate({ standbyBgStyle: 'custom_image', standbyCustomBgImageUrl: String(reader.result) });
                        };
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {settings.standbyBgStyle === 'solid' && (
                  <ColorField label="Kleur" value={settings.standbyBgColor} onChange={(v) => onUpdate({ standbyBgColor: v })} />
                )}
                {settings.standbyBgStyle === 'glow' && (
                  <>
                    <ColorField label="Kleur" value={settings.standbyBgGlowColor} onChange={(v) => onUpdate({ standbyBgGlowColor: v })} />
                    <Slider label="Intensiteit" value={settings.standbyBgGlowIntensity} min={0} max={100} onChange={(v) => onUpdate({ standbyBgGlowIntensity: v })} valueLabel={settings.standbyBgGlowIntensity + '%'} />
                  </>
                )}
                {settings.standbyBgStyle === 'gradient' && (
                  <>
                    <GradientPresetPicker onPick={(colors) => onUpdate({ standbyBgGradientColors: colors })} />
                    <ColorField label="Kleur 1" value={settings.standbyBgGradientColors[0]} onChange={(v) => onUpdate({ standbyBgGradientColors: [v, settings.standbyBgGradientColors[1]] })} />
                    <ColorField label="Kleur 2" value={settings.standbyBgGradientColors[1]} onChange={(v) => onUpdate({ standbyBgGradientColors: [settings.standbyBgGradientColors[0], v] })} />
                    <Slider label="Hoek" value={settings.standbyBgGradientAngle} min={0} max={360} onChange={(v) => onUpdate({ standbyBgGradientAngle: v })} valueLabel={settings.standbyBgGradientAngle + '°'} />
                  </>
                )}
                {(settings.standbyBgStyle === 'album_art' || settings.standbyBgStyle === 'custom_image') && (
                  <>
                    <Slider label="Zichtbaarheid" value={settings.standbyBgOpacity} min={10} max={100} onChange={(v) => onUpdate({ standbyBgOpacity: v })} valueLabel={settings.standbyBgOpacity + '%'} />
                    <Slider label="Blur" value={settings.standbyBgBlur} min={0} max={100} onChange={(v) => onUpdate({ standbyBgBlur: v })} valueLabel={settings.standbyBgBlur + 'px'} />
                    <Slider label="Overlay (verduistering)" value={settings.standbyBgOverlayOpacity} min={0} max={100} onChange={(v) => onUpdate({ standbyBgOverlayOpacity: v })} valueLabel={settings.standbyBgOverlayOpacity + '%'} />
                  </>
                )}

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Lettertype</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SegButton active={settings.standbyFontFamily === 'sans'} onClick={() => onUpdate({ standbyFontFamily: 'sans' })}>Standaard</SegButton>
                  <SegButton active={settings.standbyFontFamily === 'system'} onClick={() => onUpdate({ standbyFontFamily: 'system' })}>Systeem</SegButton>
                  <SegButton active={settings.standbyFontFamily === 'mono'} onClick={() => onUpdate({ standbyFontFamily: 'mono' })}>Mono</SegButton>
                  <SegButton active={settings.standbyFontFamily === 'serif'} onClick={() => onUpdate({ standbyFontFamily: 'serif' })}>
                    <span style={{ fontFamily: 'Georgia, serif' }}>Serif</span>
                  </SegButton>
                  <SegButton active={settings.standbyFontFamily === 'poppins'} onClick={() => onUpdate({ standbyFontFamily: 'poppins' })}>
                    <span style={{ fontFamily: "'Poppins', sans-serif" }}>Poppins</span>
                  </SegButton>
                  <SegButton active={settings.standbyFontFamily === 'playfair'} onClick={() => onUpdate({ standbyFontFamily: 'playfair' })}>
                    <span style={{ fontFamily: "'Playfair Display', serif" }}>Playfair</span>
                  </SegButton>
                  <SegButton active={settings.standbyFontFamily === 'bebas'} onClick={() => onUpdate({ standbyFontFamily: 'bebas' })}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Bebas Neue</span>
                  </SegButton>
                  {settings.customFonts.map((f) => (
                    <SegButton key={f.id} active={settings.standbyFontFamily === f.id} onClick={() => onUpdate({ standbyFontFamily: f.id })}>
                      {f.name}
                    </SegButton>
                  ))}
                </div>
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Eigen lettertypes upload je bij "Tekst" verderop — die lijst is gedeeld, de keuze hierboven niet.
                </p>

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Accentkleur</div>
                <Toggle
                  checked={settings.standbyUseCustomAccent}
                  onChange={(v) => onUpdate({ standbyUseCustomAccent: v })}
                  label="Eigen accentkleur"
                  description="Uit: volgt het gekozen thema, net als de rest van het scherm"
                />
                {settings.standbyUseCustomAccent && (
                  <ColorField label="Accentkleur" value={settings.standbyAccentColor} onChange={(v) => onUpdate({ standbyAccentColor: v })} />
                )}

                <Toggle
                  checked={settings.standbyShowTrack}
                  onChange={(v) => onUpdate({ standbyShowTrack: v })}
                  label="Laatst gespeelde nummer tonen"
                  description="Albumhoes, titel en artiest, in plaats van de 'Gereed'-tekst"
                />

                <Toggle
                  checked={settings.standbyShowVolume}
                  onChange={(v) => onUpdate({ standbyShowVolume: v })}
                  label="Volume tonen"
                  description="Live volumebalk — zo zie je het niveau (en wat de draaiknop doet) voordat er iets speelt"
                />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>
                  Positie (Standby-label, nummer, volume)
                </div>
                <AnchorPicker
                  anchorH={settings.standbyClockAnchorH}
                  anchorV={settings.standbyClockAnchorV}
                  onChange={(h, v) => onUpdate({ standbyClockAnchorH: h, standbyClockAnchorV: v })}
                />
                <Slider label="Verschuiving horizontaal" value={settings.standbyClockOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ standbyClockOffsetX: v })} valueLabel={settings.standbyClockOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.standbyClockOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ standbyClockOffsetY: v })} valueLabel={settings.standbyClockOffsetY + 'px'} />
              </div>
            </Card>
            )}

            {editorPreviewStandby && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Standby-scherm: tijd & datum
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                  Los van elkaar instelbaar — elk met eigen grootte, kleur en positie.
                </p>

                <Toggle checked={settings.standbyShowTime} onChange={(v) => onUpdate({ standbyShowTime: v })} label="Tijd tonen" />
                {settings.standbyShowTime && (
                  <>
                    <Slider label="Grootte" value={settings.standbyTimeSize} min={30} max={320} onChange={(v) => onUpdate({ standbyTimeSize: v })} valueLabel={settings.standbyTimeSize + 'px'} />
                    <Slider label="Letterspacing" value={settings.standbyTimeLetterSpacing} min={-10} max={40} onChange={(v) => onUpdate({ standbyTimeLetterSpacing: v })} valueLabel={settings.standbyTimeLetterSpacing + 'px'} />
                    <ColorField label="Kleur" value={settings.standbyTimeColor} onChange={(v) => onUpdate({ standbyTimeColor: v })} />
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)' }}>Effect</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <SegButton active={settings.standbyTimeEffect === 'none'} onClick={() => onUpdate({ standbyTimeEffect: 'none' })}>Geen</SegButton>
                      <SegButton active={settings.standbyTimeEffect === 'aurora'} onClick={() => onUpdate({ standbyTimeEffect: 'aurora' })}>Aurora</SegButton>
                      <SegButton active={settings.standbyTimeEffect === 'folded'} onClick={() => onUpdate({ standbyTimeEffect: 'folded' })}>Gevouwen</SegButton>
                      <SegButton active={settings.standbyTimeEffect === 'reflect'} onClick={() => onUpdate({ standbyTimeEffect: 'reflect' })}>Spiegeling</SegButton>
                      <SegButton active={settings.standbyTimeEffect === 'sliced'} onClick={() => onUpdate({ standbyTimeEffect: 'sliced' })}>Gesneden</SegButton>
                    </div>
                    {settings.standbyTimeEffect === 'aurora' && (
                      <>
                        <ColorField label="Aurora kleur 1" value={settings.standbyTimeAuroraColors[0]} onChange={(v) => onUpdate({ standbyTimeAuroraColors: [v, settings.standbyTimeAuroraColors[1], settings.standbyTimeAuroraColors[2]] })} />
                        <ColorField label="Aurora kleur 2" value={settings.standbyTimeAuroraColors[1]} onChange={(v) => onUpdate({ standbyTimeAuroraColors: [settings.standbyTimeAuroraColors[0], v, settings.standbyTimeAuroraColors[2]] })} />
                        <ColorField label="Aurora kleur 3" value={settings.standbyTimeAuroraColors[2]} onChange={(v) => onUpdate({ standbyTimeAuroraColors: [settings.standbyTimeAuroraColors[0], settings.standbyTimeAuroraColors[1], v] })} />
                      </>
                    )}
                    {settings.standbyTimeEffect === 'reflect' && (
                      <>
                        <Slider label="Afstand" value={settings.standbyTimeReflectDistance} min={-200} max={150} onChange={(v) => onUpdate({ standbyTimeReflectDistance: v })} valueLabel={settings.standbyTimeReflectDistance + 'px'} />
                        <Slider label="Intensiteit" value={settings.standbyTimeReflectOpacity} min={0} max={100} onChange={(v) => onUpdate({ standbyTimeReflectOpacity: v })} valueLabel={settings.standbyTimeReflectOpacity + '%'} />
                      </>
                    )}
                    {settings.standbyTimeEffect === 'sliced' && (
                      <>
                        <Slider label="Ruimte tussen helften" value={settings.standbyTimeSlicedVerticalGap} min={-60} max={120} onChange={(v) => onUpdate({ standbyTimeSlicedVerticalGap: v })} valueLabel={settings.standbyTimeSlicedVerticalGap + 'px'} />
                        <Slider label="Horizontale verschuiving" value={settings.standbyTimeSlicedGap} min={-40} max={40} onChange={(v) => onUpdate({ standbyTimeSlicedGap: v })} valueLabel={settings.standbyTimeSlicedGap + 'px'} />
                        <ColorField label="Kleur onderste helft" value={settings.standbyTimeSlicedColor} onChange={(v) => onUpdate({ standbyTimeSlicedColor: v })} />
                      </>
                    )}
                    {settings.standbyTimeEffect === 'folded' && (
                      <>
                        <Slider label="Scheve stand (skew)" value={settings.standbyTimeFoldedSkew} min={-30} max={30} onChange={(v) => onUpdate({ standbyTimeFoldedSkew: v })} valueLabel={settings.standbyTimeFoldedSkew + '°'} />
                        <Slider label="Rotatie" value={settings.standbyTimeFoldedRotation} min={-30} max={30} onChange={(v) => onUpdate({ standbyTimeFoldedRotation: v })} valueLabel={settings.standbyTimeFoldedRotation + '°'} />
                        <Slider label="Vouwhoek" value={settings.standbyTimeFoldedCreaseSkew} min={0} max={45} onChange={(v) => onUpdate({ standbyTimeFoldedCreaseSkew: v })} valueLabel={settings.standbyTimeFoldedCreaseSkew + '°'} />
                        <Slider label="Verschuiving bovenste helft" value={settings.standbyTimeFoldedOffset} min={-30} max={30} onChange={(v) => onUpdate({ standbyTimeFoldedOffset: v })} valueLabel={settings.standbyTimeFoldedOffset + 'px'} />
                        <ColorField label="Basiskleur" value={settings.standbyTimeFoldedBaseColor} onChange={(v) => onUpdate({ standbyTimeFoldedBaseColor: v })} />
                        <ColorField label="Kleur bovenste helft" value={settings.standbyTimeFoldedTopColor} onChange={(v) => onUpdate({ standbyTimeFoldedTopColor: v })} />
                        <ColorField label="Kleur onderste helft" value={settings.standbyTimeFoldedBottomColor} onChange={(v) => onUpdate({ standbyTimeFoldedBottomColor: v })} />
                      </>
                    )}
                    <AnchorPicker
                      anchorH={settings.standbyTimeAnchorH}
                      anchorV={settings.standbyTimeAnchorV}
                      onChange={(h, v) => onUpdate({ standbyTimeAnchorH: h, standbyTimeAnchorV: v })}
                    />
                    <Slider label="Verschuiving horizontaal" value={settings.standbyTimeOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ standbyTimeOffsetX: v })} valueLabel={settings.standbyTimeOffsetX + 'px'} />
                    <Slider label="Verschuiving verticaal" value={settings.standbyTimeOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ standbyTimeOffsetY: v })} valueLabel={settings.standbyTimeOffsetY + 'px'} />
                  </>
                )}

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }} />

                <Toggle checked={settings.standbyShowDate} onChange={(v) => onUpdate({ standbyShowDate: v })} label="Datum tonen" />
                {settings.standbyShowDate && (
                  <>
                    <Slider label="Grootte" value={settings.standbyDateSize} min={8} max={64} onChange={(v) => onUpdate({ standbyDateSize: v })} valueLabel={settings.standbyDateSize + 'px'} />
                    <Slider label="Letterspacing" value={settings.standbyDateLetterSpacing} min={-5} max={20} onChange={(v) => onUpdate({ standbyDateLetterSpacing: v })} valueLabel={settings.standbyDateLetterSpacing + 'px'} />
                    <ColorField label="Kleur" value={settings.standbyDateColor} onChange={(v) => onUpdate({ standbyDateColor: v })} />
                    <AnchorPicker
                      anchorH={settings.standbyDateAnchorH}
                      anchorV={settings.standbyDateAnchorV}
                      onChange={(h, v) => onUpdate({ standbyDateAnchorH: h, standbyDateAnchorV: v })}
                    />
                    <Slider label="Verschuiving horizontaal" value={settings.standbyDateOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ standbyDateOffsetX: v })} valueLabel={settings.standbyDateOffsetX + 'px'} />
                    <Slider label="Verschuiving verticaal" value={settings.standbyDateOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ standbyDateOffsetY: v })} valueLabel={settings.standbyDateOffsetY + 'px'} />
                  </>
                )}
              </div>
            </Card>
            )}

            {/* Normal-view-only from here down (Achtergrond through
                Effecten/Onderdelen) — none of it applies to the standby
                screen, which has its own "Standby-scherm" card above. */}
            {!editorPreviewStandby && (
            <>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Palette size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Achtergrond
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SegButton active={settings.bgStyle === 'solid'} onClick={() => onUpdate({ bgStyle: 'solid' })}>Effen</SegButton>
                  <SegButton active={settings.bgStyle === 'glow'} onClick={() => onUpdate({ bgStyle: 'glow' })}>Gloed</SegButton>
                  <SegButton active={settings.bgStyle === 'gradient'} onClick={() => onUpdate({ bgStyle: 'gradient' })}>Verloop</SegButton>
                  <SegButton active={settings.bgStyle === 'album_art'} onClick={() => onUpdate({ bgStyle: 'album_art' })}>Album art</SegButton>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <SegButton active={settings.bgStyle === 'custom_image'} onClick={() => onUpdate({ bgStyle: 'custom_image' })}>
                    <ImageIcon size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                    Eigen afbeelding
                  </SegButton>
                  <label
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      font: 'var(--text-mono-sm)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    Uploaden…
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          onUpdate({ bgStyle: 'custom_image', customBgImageUrl: String(reader.result) });
                        };
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {settings.bgStyle === 'solid' && (
                  <ColorField label="Kleur" value={settings.bgColor} onChange={(v) => onUpdate({ bgColor: v })} />
                )}
                {settings.bgStyle === 'glow' && (
                  <>
                    <ColorField label="Kleur" value={settings.bgGlowColor} onChange={(v) => onUpdate({ bgGlowColor: v })} />
                    <Slider label="Intensiteit" value={settings.bgGlowIntensity} min={0} max={100} onChange={(v) => onUpdate({ bgGlowIntensity: v })} valueLabel={settings.bgGlowIntensity + '%'} />
                  </>
                )}
                {settings.bgStyle === 'gradient' && (
                  <>
                    <GradientPresetPicker onPick={(colors) => onUpdate({ bgGradientColors: colors })} />
                    <ColorField label="Kleur 1" value={settings.bgGradientColors[0]} onChange={(v) => onUpdate({ bgGradientColors: [v, settings.bgGradientColors[1]] })} />
                    <ColorField label="Kleur 2" value={settings.bgGradientColors[1]} onChange={(v) => onUpdate({ bgGradientColors: [settings.bgGradientColors[0], v] })} />
                    <Slider label="Hoek" value={settings.bgGradientAngle} min={0} max={360} onChange={(v) => onUpdate({ bgGradientAngle: v })} valueLabel={settings.bgGradientAngle + '°'} />
                  </>
                )}
                {(settings.bgStyle === 'album_art' || settings.bgStyle === 'custom_image') && (
                  <Slider
                    label="Zichtbaarheid"
                    value={settings.bgOpacity}
                    min={10}
                    max={100}
                    onChange={(v) => onUpdate({ bgOpacity: v })}
                    valueLabel={settings.bgOpacity + '%'}
                  />
                )}
                {(settings.bgStyle === 'album_art' || settings.bgStyle === 'custom_image') && (
                  <>
                    <Slider
                      label="Blur"
                      value={settings.bgBlur}
                      min={0}
                      max={100}
                      onChange={(v) => onUpdate({ bgBlur: v })}
                      valueLabel={settings.bgBlur + 'px'}
                    />
                    <Slider
                      label="Overlay (verduistering)"
                      value={settings.bgOverlayOpacity}
                      min={0}
                      max={100}
                      onChange={(v) => onUpdate({ bgOverlayOpacity: v })}
                      valueLabel={settings.bgOverlayOpacity + '%'}
                    />
                  </>
                )}
              </div>
            </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Move size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Onderdelen
                </span>
              </div>

              <ElementSection ref={(el) => { elementSectionRefs.current.art = el; }} icon={<ImageIcon size={13} />} title="Art / plaat" defaultOpen>
                <div style={{ display: 'flex', gap: 6 }}>
                  <SegButton active={settings.artDisplayMode === 'flat'} onClick={() => onUpdate({ artDisplayMode: 'flat' })}>
                    Plat
                  </SegButton>
                  <SegButton active={settings.artDisplayMode === 'vinyl'} onClick={() => onUpdate({ artDisplayMode: 'vinyl' })}>
                    <Disc size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                    Vinyl
                  </SegButton>
                  <SegButton active={settings.artDisplayMode === 'cd'} onClick={() => onUpdate({ artDisplayMode: 'cd' })}>
                    <Disc3 size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                    CD
                  </SegButton>
                  <SegButton active={settings.artDisplayMode === 'auto'} onClick={() => onUpdate({ artDisplayMode: 'auto' })}>
                    <Sparkles size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                    Auto
                  </SegButton>
                </div>
                {settings.artDisplayMode === 'auto' && (
                  <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    Volgt de echte bron: platenspeler toont vinyl (met de instellingen hieronder bij "Vinyl"), cd
                    toont een cd, Spotify/NAS/radio tonen plat. Kies "Plat", "Vinyl" of "CD" hierboven om die
                    instellingen aan te passen — Auto heeft zelf niets in te stellen, het kiest alleen welke van de
                    drie op dat moment geldt.
                  </p>
                )}

                {/* Each display mode's size/fill/hole settings only show while that exact
                    mode is selected above — 'auto' has none of its own to show, it purely
                    picks at runtime which of these three already-configured looks applies. */}
                {settings.artDisplayMode === 'flat' && (
                  <>
                    <Slider
                      label="Grootte"
                      value={settings.flatArtSize}
                      min={48}
                      max={900}
                      onChange={(v) => onUpdate({ flatArtSize: v })}
                      valueLabel={settings.flatArtSize + 'px'}
                    />
                    <Slider label="Hoekradius" value={settings.artRadius} min={0} max={32} onChange={(v) => onUpdate({ artRadius: v })} valueLabel={settings.artRadius + 'px'} />
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                    <AnchorPicker anchorH={settings.flatArtAnchorH} anchorV={settings.flatArtAnchorV} onChange={(h, v) => onUpdate({ flatArtAnchorH: h, flatArtAnchorV: v })} />
                    <Slider label="Verschuiving horizontaal" value={settings.flatArtOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ flatArtOffsetX: v })} valueLabel={settings.flatArtOffsetX + 'px'} />
                    <Slider label="Verschuiving verticaal" value={settings.flatArtOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ flatArtOffsetY: v })} valueLabel={settings.flatArtOffsetY + 'px'} />
                  </>
                )}

                {settings.artDisplayMode === 'vinyl' && (
                  <>
                    <Slider
                      label="Grootte"
                      value={settings.vinylArtSize}
                      min={48}
                      max={900}
                      onChange={(v) => onUpdate({ vinylArtSize: v })}
                      valueLabel={settings.vinylArtSize + 'px'}
                    />
                    <Slider
                      label="Vulling"
                      value={settings.vinylFillPct}
                      min={15}
                      max={98}
                      onChange={(v) => onUpdate({ vinylFillPct: v })}
                      valueLabel={settings.vinylFillPct + '%'}
                    />
                    <Slider
                      label="Middengaatje"
                      value={settings.vinylHoleSizePct}
                      min={2}
                      max={40}
                      onChange={(v) => onUpdate({ vinylHoleSizePct: v })}
                      valueLabel={settings.vinylHoleSizePct + '%'}
                    />
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                    <AnchorPicker anchorH={settings.vinylArtAnchorH} anchorV={settings.vinylArtAnchorV} onChange={(h, v) => onUpdate({ vinylArtAnchorH: h, vinylArtAnchorV: v })} />
                    <Slider label="Verschuiving horizontaal" value={settings.vinylArtOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ vinylArtOffsetX: v })} valueLabel={settings.vinylArtOffsetX + 'px'} />
                    <Slider label="Verschuiving verticaal" value={settings.vinylArtOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ vinylArtOffsetY: v })} valueLabel={settings.vinylArtOffsetY + 'px'} />
                  </>
                )}

                {settings.artDisplayMode === 'cd' && (
                  <>
                    <Slider
                      label="Grootte"
                      value={settings.cdArtSize}
                      min={48}
                      max={900}
                      onChange={(v) => onUpdate({ cdArtSize: v })}
                      valueLabel={settings.cdArtSize + 'px'}
                    />
                    <Slider
                      label="Vulling"
                      value={settings.cdFillPct}
                      min={15}
                      max={98}
                      onChange={(v) => onUpdate({ cdFillPct: v })}
                      valueLabel={settings.cdFillPct + '%'}
                    />
                    <Slider
                      label="Middengaatje"
                      value={settings.cdHoleSizePct}
                      min={2}
                      max={40}
                      onChange={(v) => onUpdate({ cdHoleSizePct: v })}
                      valueLabel={settings.cdHoleSizePct + '%'}
                    />
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                    <AnchorPicker anchorH={settings.cdArtAnchorH} anchorV={settings.cdArtAnchorV} onChange={(h, v) => onUpdate({ cdArtAnchorH: h, cdArtAnchorV: v })} />
                    <Slider label="Verschuiving horizontaal" value={settings.cdArtOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ cdArtOffsetX: v })} valueLabel={settings.cdArtOffsetX + 'px'} />
                    <Slider label="Verschuiving verticaal" value={settings.cdArtOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ cdArtOffsetY: v })} valueLabel={settings.cdArtOffsetY + 'px'} />
                  </>
                )}

                <Toggle checked={settings.artShadow} onChange={(v) => onUpdate({ artShadow: v })} label="Schaduw" description="Zachte drop shadow onder de art" />
                {(settings.artDisplayMode === 'vinyl' || settings.artDisplayMode === 'cd' || settings.artDisplayMode === 'auto') && (
                  <Toggle
                    checked={settings.discSpin}
                    onChange={(v) => onUpdate({ discSpin: v })}
                    label="Draaianimatie"
                    description="Plaat/cd draait rond terwijl er wordt afgespeeld"
                  />
                )}
                <Toggle
                  checked={settings.transitionAnimation}
                  onChange={(v) => onUpdate({ transitionAnimation: v })}
                  label="Overgangsanimatie bij CD/LP-wissel"
                  description="Schuift de art buiten beeld tijdens het herkennen van een nieuwe track op een externe bron, en weer terug zodra 'm gevonden is"
                />
                <Slider label="Volgorde (z-index)" value={settings.artZIndex} min={0} max={10} onChange={(v) => onUpdate({ artZIndex: v })} valueLabel={String(settings.artZIndex)} />
              </ElementSection>

              <ElementSection ref={(el) => { elementSectionRefs.current.text = el; }} icon={<TypeIcon size={13} />} title="Tekst" defaultOpen>
                <div style={{ display: 'flex', gap: 6 }}>
                  <SegButton active={settings.align === 'left'} onClick={() => onUpdate({ align: 'left' })}>Links</SegButton>
                  <SegButton active={settings.align === 'center'} onClick={() => onUpdate({ align: 'center' })}>Gecentreerd</SegButton>
                </div>
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Lettertype (hele weergave)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SegButton active={settings.fontFamily === 'sans'} onClick={() => onUpdate({ fontFamily: 'sans' })}>Standaard</SegButton>
                  <SegButton active={settings.fontFamily === 'system'} onClick={() => onUpdate({ fontFamily: 'system' })}>Systeem</SegButton>
                  <SegButton active={settings.fontFamily === 'mono'} onClick={() => onUpdate({ fontFamily: 'mono' })}>Mono</SegButton>
                  <SegButton active={settings.fontFamily === 'serif'} onClick={() => onUpdate({ fontFamily: 'serif' })}>
                    <span style={{ fontFamily: 'Georgia, serif' }}>Serif</span>
                  </SegButton>
                  <SegButton active={settings.fontFamily === 'poppins'} onClick={() => onUpdate({ fontFamily: 'poppins' })}>
                    <span style={{ fontFamily: "'Poppins', sans-serif" }}>Poppins</span>
                  </SegButton>
                  <SegButton active={settings.fontFamily === 'playfair'} onClick={() => onUpdate({ fontFamily: 'playfair' })}>
                    <span style={{ fontFamily: "'Playfair Display', serif" }}>Playfair</span>
                  </SegButton>
                  <SegButton active={settings.fontFamily === 'bebas'} onClick={() => onUpdate({ fontFamily: 'bebas' })}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Bebas Neue</span>
                  </SegButton>
                  {settings.customFonts.map((f) => (
                    <SegButton key={f.id} active={settings.fontFamily === f.id} onClick={() => onUpdate({ fontFamily: f.id })}>
                      {f.name}
                    </SegButton>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <label
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      font: 'var(--text-mono-sm)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    Eigen lettertype uploaden…
                    <input
                      type="file"
                      accept=".woff2,.woff,.ttf,.otf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        e.target.value = '';
                        if (file.size > 2 * 1024 * 1024) {
                          setFontUploadError('Lettertype is te groot (max 2MB).');
                          return;
                        }
                        const ext = file.name.split('.').pop()?.toLowerCase();
                        if (!ext || !['woff2', 'woff', 'ttf', 'otf'].includes(ext)) {
                          setFontUploadError('Onbekend bestandstype — gebruik .woff2, .woff, .ttf of .otf.');
                          return;
                        }
                        setFontUploadError(null);
                        const reader = new FileReader();
                        reader.onload = () => {
                          const id = 'font-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                          const newFont: CustomFont = { id, name: file.name.replace(/\.[^.]+$/, ''), dataUrl: String(reader.result), format: ext as CustomFont['format'] };
                          onUpdate({ customFonts: [...settings.customFonts, newFont], fontFamily: id });
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>woff2, woff, ttf of otf — max 2MB</span>
                </div>
                {fontUploadError && (
                  <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--status-danger)' }}>{fontUploadError}</p>
                )}
                {settings.customFonts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {settings.customFonts.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-inset)',
                        }}
                      >
                        <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <button
                          onClick={() =>
                            onUpdate({
                              customFonts: settings.customFonts.filter((x) => x.id !== f.id),
                              fontFamily: settings.fontFamily === f.id ? 'sans' : settings.fontFamily,
                            })
                          }
                          title="Lettertype verwijderen"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--text-muted)', flexShrink: 0 }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Slider label="Titelgrootte" value={settings.titleSize} min={14} max={96} onChange={(v) => onUpdate({ titleSize: v })} valueLabel={settings.titleSize + 'px'} />
                <Slider label="Titel letterspacing" value={settings.titleLetterSpacing} min={-5} max={20} onChange={(v) => onUpdate({ titleLetterSpacing: v })} valueLabel={settings.titleLetterSpacing + 'px'} />
                <Slider label="Titel regelhoogte" value={settings.titleLineHeight} min={80} max={200} onChange={(v) => onUpdate({ titleLineHeight: v })} valueLabel={(settings.titleLineHeight / 100).toFixed(2)} />
                <ColorField label="Titelkleur" value={settings.titleColor} onChange={(v) => onUpdate({ titleColor: v })} />
                <Slider label="Artiestgrootte" value={settings.artistSize} min={10} max={96} onChange={(v) => onUpdate({ artistSize: v })} valueLabel={settings.artistSize + 'px'} />
                <Slider label="Artiest letterspacing" value={settings.artistLetterSpacing} min={-5} max={20} onChange={(v) => onUpdate({ artistLetterSpacing: v })} valueLabel={settings.artistLetterSpacing + 'px'} />
                <Slider label="Artiest regelhoogte" value={settings.artistLineHeight} min={80} max={200} onChange={(v) => onUpdate({ artistLineHeight: v })} valueLabel={(settings.artistLineHeight / 100).toFixed(2)} />
                <ColorField label="Artiestkleur" value={settings.artistColor} onChange={(v) => onUpdate({ artistColor: v })} />
                <Toggle checked={settings.textShadow} onChange={(v) => onUpdate({ textShadow: v })} label="Tekstschaduw" description="Zachte schaduw voor leesbaarheid op een drukke achtergrond" />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.textAnchorH} anchorV={settings.textAnchorV} onChange={(h, v) => onUpdate({ textAnchorH: h, textAnchorV: v })} />
                <Slider label="Breedte" value={settings.textWidth} min={200} max={1100} onChange={(v) => onUpdate({ textWidth: v })} valueLabel={settings.textWidth + 'px'} />
                <Slider label="Verschuiving horizontaal" value={settings.textOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ textOffsetX: v })} valueLabel={settings.textOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.textOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ textOffsetY: v })} valueLabel={settings.textOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.textZIndex} min={0} max={10} onChange={(v) => onUpdate({ textZIndex: v })} valueLabel={String(settings.textZIndex)} />
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.clock = el; }}
                icon={<Clock size={13} />}
                title="Klok & datum"
                defaultOpen={settings.showClock}
                toggle={{ checked: settings.showClock, onChange: (v) => onUpdate({ showClock: v }) }}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <SegButton active={settings.clockStyle === 'small'} onClick={() => onUpdate({ clockStyle: 'small' })}>
                    Klein (inline)
                  </SegButton>
                  <SegButton active={settings.clockStyle === 'large'} onClick={() => onUpdate({ clockStyle: 'large' })}>
                    Groot (gestapeld)
                  </SegButton>
                </div>
                <Slider label="Lettergrootte" value={settings.clockSize} min={10} max={96} onChange={(v) => onUpdate({ clockSize: v })} valueLabel={settings.clockSize + 'px'} />
                <Slider label="Letterspacing" value={settings.clockLetterSpacing} min={-5} max={20} onChange={(v) => onUpdate({ clockLetterSpacing: v })} valueLabel={settings.clockLetterSpacing + 'px'} />
                <ColorField label="Kleur" value={settings.clockColor} onChange={(v) => onUpdate({ clockColor: v })} />
                <Toggle checked={settings.clockShadow} onChange={(v) => onUpdate({ clockShadow: v })} label="Schaduw/gloed" description="Zachte tekstschaduw voor leesbaarheid" />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.clockAnchorH} anchorV={settings.clockAnchorV} onChange={(h, v) => onUpdate({ clockAnchorH: h, clockAnchorV: v })} />
                <Slider label="Verschuiving horizontaal" value={settings.clockOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ clockOffsetX: v })} valueLabel={settings.clockOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.clockOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ clockOffsetY: v })} valueLabel={settings.clockOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.clockZIndex} min={0} max={10} onChange={(v) => onUpdate({ clockZIndex: v })} valueLabel={String(settings.clockZIndex)} />
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.spectrum = el; }}
                icon={<Activity size={13} />}
                title="Frequentiespectrum"
                defaultOpen={settings.showSpectrum}
                toggle={{ checked: settings.showSpectrum, onChange: (v) => onUpdate({ showSpectrum: v }) }}
              >
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>16-band FFT visualizer, onder de titel/artiest.</p>
                <Slider label="Breedte" value={settings.spectrumWidth} min={60} max={800} onChange={(v) => onUpdate({ spectrumWidth: v })} valueLabel={settings.spectrumWidth + 'px'} />
                <Slider label="Hoogte" value={settings.spectrumHeight} min={16} max={160} onChange={(v) => onUpdate({ spectrumHeight: v })} valueLabel={settings.spectrumHeight + 'px'} />
                <Slider label="Doorzichtigheid" value={settings.spectrumOpacity} min={10} max={100} onChange={(v) => onUpdate({ spectrumOpacity: v })} valueLabel={settings.spectrumOpacity + '%'} />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.spectrumAnchorH} anchorV={settings.spectrumAnchorV} onChange={(h, v) => onUpdate({ spectrumAnchorH: h, spectrumAnchorV: v })} />
                <Slider label="Verschuiving horizontaal" value={settings.spectrumOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ spectrumOffsetX: v })} valueLabel={settings.spectrumOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.spectrumOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ spectrumOffsetY: v })} valueLabel={settings.spectrumOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.spectrumZIndex} min={0} max={10} onChange={(v) => onUpdate({ spectrumZIndex: v })} valueLabel={String(settings.spectrumZIndex)} />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Visualisatiestijl</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SegButton active={settings.spectrumStyle === 'bars'} onClick={() => onUpdate({ spectrumStyle: 'bars' })}>Staafjes</SegButton>
                  <SegButton active={settings.spectrumStyle === 'waveform'} onClick={() => onUpdate({ spectrumStyle: 'waveform' })}>Golfvorm</SegButton>
                  <SegButton active={settings.spectrumStyle === 'led_matrix'} onClick={() => onUpdate({ spectrumStyle: 'led_matrix' })}>LED-matrix</SegButton>
                </div>
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Geldt overal waar het spectrum getoond wordt, ook op de vaste layouts — kleuren volgen altijd het gekozen thema.</p>
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.controls = el; }}
                icon={<Play size={13} />}
                title="Bedieningsknoppen"
                defaultOpen={settings.showControls}
                toggle={{ checked: settings.showControls, onChange: (v) => onUpdate({ showControls: v }) }}
              >
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Play/pauze, vorige/volgende, onder de titel/artiest.</p>
                <Toggle checked={settings.showLike !== false} onChange={(v) => onUpdate({ showLike: v })} label="Hartje (favorieten)" description="Bewaart wat er speelt — ook bij radio of platenspeler, waar de andere knoppen niets doen" />
                <Toggle checked={settings.showQueue} onChange={(v) => onUpdate({ showQueue: v })} label="Wachtrij-knop" description="Snelle toegang tot afspeellijsten" />
                <Toggle checked={settings.showSourceSwitcher} onChange={(v) => onUpdate({ showSourceSwitcher: v })} label="Bronkeuze (DAC output)" description="Wissel audio-uitgang vanaf het scherm" />
                <Slider label="Grootte" value={settings.controlsSize} min={12} max={40} onChange={(v) => onUpdate({ controlsSize: v })} valueLabel={settings.controlsSize + 'px'} />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.controlsAnchorH} anchorV={settings.controlsAnchorV} onChange={(h, v) => onUpdate({ controlsAnchorH: h, controlsAnchorV: v })} />
                <Slider label="Verschuiving horizontaal" value={settings.controlsOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ controlsOffsetX: v })} valueLabel={settings.controlsOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.controlsOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ controlsOffsetY: v })} valueLabel={settings.controlsOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.controlsZIndex} min={0} max={10} onChange={(v) => onUpdate({ controlsZIndex: v })} valueLabel={String(settings.controlsZIndex)} />
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.sourcePicker = el; }}
                icon={<ArrowLeftRight size={13} />}
                title="Bronnenkiezer"
                defaultOpen={false}
              >
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                  Het "Bron kiezen"-scherm (Radio/NAS/Spotify/Extern) dat opent vanaf het bronkeuze-knopje.
                </p>
                <Slider label="Grootte" value={settings.sourcePickerScale} min={100} max={200} onChange={(v) => onUpdate({ sourcePickerScale: v })} valueLabel={settings.sourcePickerScale + '%'} />
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.volume = el; }}
                icon={<Volume2 size={13} />}
                title="Volume"
                defaultOpen={settings.showVolume}
                toggle={{ checked: settings.showVolume, onChange: (v) => onUpdate({ showVolume: v }) }}
              >
                <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Mute-knop en schuifregelaar.</p>
                <Slider label="Breedte" value={settings.volumeSize} min={60} max={300} onChange={(v) => onUpdate({ volumeSize: v })} valueLabel={settings.volumeSize + 'px'} />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.volumeAnchorH} anchorV={settings.volumeAnchorV} onChange={(h, v) => onUpdate({ volumeAnchorH: h, volumeAnchorV: v })} />
                <Slider label="Verschuiving horizontaal" value={settings.volumeOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ volumeOffsetX: v })} valueLabel={settings.volumeOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.volumeOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ volumeOffsetY: v })} valueLabel={settings.volumeOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.volumeZIndex} min={0} max={10} onChange={(v) => onUpdate({ volumeZIndex: v })} valueLabel={String(settings.volumeZIndex)} />
              </ElementSection>

              <ElementSection
                ref={(el) => { elementSectionRefs.current.progress = el; }}
                icon={<BarChart2 size={13} />}
                title="Voortgangsbalk"
                defaultOpen={settings.showProgress}
                toggle={{ checked: settings.showProgress, onChange: (v) => onUpdate({ showProgress: v }) }}
              >
                <Slider label="Breedte" value={settings.progressWidth} min={60} max={900} onChange={(v) => onUpdate({ progressWidth: v })} valueLabel={settings.progressWidth + 'px'} />
                <Slider label="Dikte" value={settings.progressHeight} min={2} max={24} onChange={(v) => onUpdate({ progressHeight: v })} valueLabel={settings.progressHeight + 'px'} />

                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', marginTop: 4 }}>Positie</div>
                <AnchorPicker anchorH={settings.progressAnchorH} anchorV={settings.progressAnchorV} onChange={(h, v) => onUpdate({ progressAnchorH: h, progressAnchorV: v })} />
                <Slider label="Verschuiving horizontaal" value={settings.progressOffsetX} min={-400} max={400} onChange={(v) => onUpdate({ progressOffsetX: v })} valueLabel={settings.progressOffsetX + 'px'} />
                <Slider label="Verschuiving verticaal" value={settings.progressOffsetY} min={-400} max={400} onChange={(v) => onUpdate({ progressOffsetY: v })} valueLabel={settings.progressOffsetY + 'px'} />
                <Slider label="Volgorde (z-index)" value={settings.progressZIndex} min={0} max={10} onChange={(v) => onUpdate({ progressZIndex: v })} valueLabel={String(settings.progressZIndex)} />
              </ElementSection>

              <p style={{ margin: '14px 0 0', font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                Hogere volgorde ligt bovenop — zet tekst hoger dan art om 'm over de draaiende plaat te laten vallen.
              </p>
          </Card>

            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Layers size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Effecten
                </span>
              </div>
              <Toggle checked={settings.glow} onChange={(v) => onUpdate({ glow: v })} label="Binnenrand gloed" description="Subtiele accentgloed langs de randen" />
            </Card>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const NestHubCastManager: React.FC<NestHubCastManagerProps> = ({
  playback,
  currentThemeId,
  onOpenCastKioskDirect,
}) => {
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedLayout, setSelectedLayout] = useState<CastLayout>('kiosk_touch');
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(currentThemeId);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [castSession, setCastSession] = useState<CastSessionState>({
    isCasting: false,
    isStandby: false,
    activeDeviceId: null,
    activeLayout: 'kiosk_touch',
    startedAt: null,
    castUrl: '',
  });
  const [castSettings, setCastSettings] = useState<CastSettings>({
    targetDeviceId: 'cast-nesthub-kitchen',
    targetDeviceIp: '',
    targetDeviceName: '',
    layout: 'kiosk_touch',
    themeId: currentThemeId,
    accentMode: 'theme',
    customAccentColor: '#6366f1',
    showControls: true,
    showLike: true,
    showSpectrum: true,
    showQueue: true,
    showSourceSwitcher: true,
    showVolume: true,
    volumeSize: 120,
    volumeAnchorH: 'right',
    volumeAnchorV: 'bottom',
    volumeOffsetX: -130,
    volumeOffsetY: -80,
    volumeZIndex: 1,
    showClock: true,
    autoReCast: true,
    autoCastOnPlay: true,
    autoStopOnPause: true,
    autoStopDelaySec: 0,
    autoStopReleasesDevice: false,
    menuIdleTimeoutSec: 20,
    bgStyle: 'solid',
    bgOpacity: 60,
    bgBlur: 60,
    bgOverlayOpacity: 50,
    bgColor: '#08090c',
    bgGlowColor: '#6366f1',
    bgGlowIntensity: 35,
    bgGradientColors: ['#08090c', '#000000'],
    bgGradientAngle: 160,
    standbyBgStyle: 'glow',
    standbyBgOpacity: 60,
    standbyBgBlur: 60,
    standbyBgOverlayOpacity: 50,
    standbyBgColor: '#08090c',
    standbyBgGlowColor: '#f59e0b',
    standbyBgGlowIntensity: 20,
    standbyBgGradientColors: ['#08090c', '#000000'],
    standbyBgGradientAngle: 160,
    standbyFontFamily: 'sans',
    standbyUseCustomAccent: false,
    standbyAccentColor: '#f59e0b',
    standbyShowTrack: false,
    standbyShowVolume: true,
    standbyClockAnchorH: 'center',
    standbyClockAnchorV: 'center',
    standbyClockOffsetX: 0,
    standbyClockOffsetY: 110,
    standbyShowTime: true,
    standbyTimeSize: 96,
    standbyTimeLetterSpacing: -2,
    standbyTimeEffect: 'none',
    standbyTimeAuroraColors: ['#4f46e5', '#6366f1', '#38bdf8'],
    standbyTimeReflectDistance: 0,
    standbyTimeReflectOpacity: 20,
    standbyTimeSlicedGap: 2,
    standbyTimeSlicedVerticalGap: 10,
    standbyTimeSlicedColor: '#f59e0b',
    standbyTimeFoldedSkew: 8,
    standbyTimeFoldedRotation: -8,
    standbyTimeFoldedCreaseSkew: 13,
    standbyTimeFoldedOffset: 0,
    standbyTimeFoldedBaseColor: '#c88c7c',
    standbyTimeFoldedTopColor: '#f7f5f0',
    standbyTimeFoldedBottomColor: '#d4cec2',
    standbyTimeColor: '#ffffff',
    standbyTimeAnchorH: 'center',
    standbyTimeAnchorV: 'center',
    standbyTimeOffsetX: 0,
    standbyTimeOffsetY: -50,
    standbyShowDate: true,
    standbyDateSize: 16,
    standbyDateColor: '#cbd5e1',
    standbyDateLetterSpacing: 2,
    standbyDateAnchorH: 'center',
    standbyDateAnchorV: 'center',
    standbyDateOffsetX: 0,
    standbyDateOffsetY: 25,
    artRadius: 10,
    artShadow: true,
    artDisplayMode: 'flat',
    discSpin: true,
    transitionAnimation: false,
    artZIndex: 1,
    flatArtSize: 76,
    vinylArtSize: 220,
    cdArtSize: 180,
    flatArtAnchorH: 'left',
    flatArtAnchorV: 'center',
    flatArtOffsetX: 0,
    flatArtOffsetY: 0,
    vinylArtAnchorH: 'left',
    vinylArtAnchorV: 'center',
    vinylArtOffsetX: 0,
    vinylArtOffsetY: 0,
    cdArtAnchorH: 'left',
    cdArtAnchorV: 'center',
    cdArtOffsetX: 0,
    cdArtOffsetY: 0,
    vinylFillPct: 40,
    cdFillPct: 92,
    vinylHoleSizePct: 10,
    cdHoleSizePct: 6,
    align: 'left',
    fontFamily: 'sans',
    customFonts: [],
    textAnchorH: 'left',
    textAnchorV: 'center',
    textOffsetX: 130,
    textOffsetY: 0,
    textZIndex: 1,
    textWidth: 700,
    titleSize: 20,
    titleColor: '#ffffff',
    titleLetterSpacing: -1,
    titleLineHeight: 110,
    artistSize: 16,
    artistColor: '#cbd5e1',
    artistLetterSpacing: 0,
    artistLineHeight: 120,
    textShadow: false,
    glow: false,
    clockStyle: 'small',
    clockAnchorH: 'right',
    clockAnchorV: 'top',
    clockOffsetX: 0,
    clockOffsetY: 0,
    clockZIndex: 1,
    clockSize: 26,
    clockColor: '#ffffff',
    clockLetterSpacing: -1,
    clockShadow: false,
    spectrumAnchorH: 'left',
    spectrumAnchorV: 'center',
    spectrumOffsetX: 130,
    spectrumOffsetY: 90,
    spectrumZIndex: 1,
    spectrumHeight: 40,
    spectrumWidth: 220,
    controlsAnchorH: 'left',
    controlsAnchorV: 'center',
    controlsOffsetX: 130,
    controlsOffsetY: 150,
    controlsZIndex: 1,
    controlsSize: 20,
    sourcePickerScale: 100,
    spectrumOpacity: 100,
    spectrumStyle: 'bars',
    showProgress: true,
    progressAnchorH: 'left',
    progressAnchorV: 'bottom',
    progressOffsetX: 0,
    progressOffsetY: 0,
    progressZIndex: 1,
    progressWidth: 300,
    progressHeight: 6,
  });
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [previewDeviceModel, setPreviewDeviceModel] = useState<'hub7' | 'hub10'>('hub7');
  const [previewStandby, setPreviewStandby] = useState(false);
  const [contentEditorOpen, setContentEditorOpen] = useState<boolean>(false);

  // Load cast devices & session status
  useEffect(() => {
    fetchDevices();
    fetchCastSession();
    fetchCastSettings();
  }, []);

  const fetchDevices = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/cast/devices').then((r) => r.json());
      if (res.devices) {
        setDevices(res.devices);
        if (res.devices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(res.devices[0].id);
        }
      }
    } catch (e) {
      console.warn('Could not fetch cast devices:', e);
    } finally {
      setIsScanning(false);
    }
  };

  const fetchCastSession = async () => {
    try {
      const res = await fetch('/api/cast/session').then((r) => r.json());
      if (res.session) {
        setCastSession(res.session);
      }
    } catch (e) {
      console.warn('Could not fetch cast session status:', e);
    }
  };

  const fetchCastSettings = async () => {
    try {
      const res = await fetch('/api/cast/settings').then((r) => r.json());
      if (res.settings) {
        // Merged onto the current defaults, not replaced outright — a settings
        // blob saved before a new CastSettings field existed (e.g. customFonts)
        // would otherwise come back without it and crash the first .map() over
        // an undefined array.
        setCastSettings((prev) => ({ ...prev, ...res.settings }));
        // selectedLayout/selectedThemeId are separate local picker state —
        // saving a layout persisted it to castSettings.layout correctly, but
        // nothing synced the picker itself, so it silently reset to its
        // hardcoded default on every refresh even though the save had worked.
        if (res.settings.layout) setSelectedLayout(res.settings.layout);
        if (res.settings.themeId) setSelectedThemeId(res.settings.themeId);
      }
    } catch (e) {
      console.warn('Could not fetch cast settings:', e);
    }
  };

  const handleUpdateCastSettings = async (partial: Partial<CastSettings>) => {
    const updated = { ...castSettings, ...partial };
    setCastSettings(updated);
    try {
      await fetch('/api/cast/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setActionFeedback('Auto-Cast instellingen opgeslagen!');
      setTimeout(() => setActionFeedback(null), 2500);
    } catch (e) {
      console.warn('Update cast settings failed:', e);
    }
  };

  const enabledLayoutOrder = getEnabledLayoutOrder(castSettings.layoutOrder);
  const toggleLayoutEnabled = (id: CastLayout, enabled: boolean) => {
    const next = enabled ? [...enabledLayoutOrder, id] : enabledLayoutOrder.filter((x) => x !== id);
    handleUpdateCastSettings({ layoutOrder: next });
  };
  const moveLayoutOrder = (id: CastLayout, dir: -1 | 1) => {
    const idx = enabledLayoutOrder.indexOf(id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= enabledLayoutOrder.length) return;
    const next = [...enabledLayoutOrder];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    handleUpdateCastSettings({ layoutOrder: next });
  };

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || devices[0];
  const activeTheme = THEME_PRESETS[selectedThemeId] || THEME_PRESETS.obsidian!;

  // Formulate the live cast URL
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://192.168.1.100:3000';
  const generatedCastUrl = `${origin}/?view=cast&layout=${selectedLayout}&theme=${selectedThemeId}`;

  // Formulate the catt command
  const targetDeviceArg = selectedDevice ? `"${selectedDevice.name}"` : '"Nest Hub Keuken"';
  const cattCommand = `catt -d ${targetDeviceArg} cast_site "${generatedCastUrl}"`;

  const handleStartCast = async () => {
    if (!selectedDevice) return;
    try {
      setActionFeedback(`Bezig met casten naar ${selectedDevice.name} via catt...`);
      const res = await fetch('/api/cast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.id,
          deviceName: selectedDevice.name,
          deviceIp: selectedDevice.ip,
          layout: selectedLayout,
          themeId: selectedThemeId,
          castUrl: generatedCastUrl,
        }),
      }).then((r) => r.json());

      if (res.success) {
        setCastSession(res.session);
        setActionFeedback(`Succesvol verbonden! Weergave actief op ${selectedDevice.name}`);
      } else {
        setActionFeedback(`Cast fout: ${res.error || 'Kon niet verbinden'}`);
      }
      setTimeout(() => setActionFeedback(null), 4000);
    } catch (err: any) {
      setActionFeedback(`Fout bij casten: ${err.message}`);
    }
  };

  // Tapping the physical Nest Hub's screen doesn't reliably reach the
  // casted page's JS at all — catt's `cast_site` mirrors a generic webpage
  // rather than registering a real Cast Receiver app, and Google's platform
  // owns touch handling on the device itself above that layer. This is the
  // reliable alternative: exit standby from here instead, works from any
  // browser on the network.
  const handleWake = async () => {
    try {
      await fetch('/api/cast/wake', { method: 'POST' });
      setCastSession((s) => ({ ...s, isStandby: false }));
      setActionFeedback('Standby verlaten.');
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (e) {
      console.warn('Wake failed:', e);
    }
  };

  const handleStopCast = async () => {
    try {
      await fetch('/api/cast/stop', { method: 'POST' });
      setCastSession({
        isCasting: false,
        isStandby: false,
        activeDeviceId: null,
        activeLayout: 'kiosk_touch',
        startedAt: null,
        castUrl: '',
      });
      setActionFeedback('Cast sessie gestopt.');
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (e) {
      console.warn('Stop cast failed:', e);
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(cattCommand);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header card */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--accent-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Tv size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Cast</span>
            </div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
              Richt in wat je Google Nest Hub laat zien terwijl je muziek streamt, via <code>catt</code>
            </p>
          </div>
          <Badge
            variant={castSession.isCasting ? 'success' : 'neutral'}
            icon={
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: castSession.isCasting ? 'var(--status-success)' : 'var(--text-muted)',
                }}
              />
            }
          >
            {castSession.isCasting ? 'ACTIEF AAN HET CASTEN' : 'STANDBY'}
          </Badge>
        </div>
      </Card>

      {actionFeedback && (
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--radius-md)',
            background: 'rgba(52,211,153,0.1)',
            border: '1px solid rgba(52,211,153,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            font: 'var(--text-mono-sm)',
            color: 'var(--status-success)',
          }}
        >
          <Check size={14} />
          <span>{actionFeedback}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 24 }}>
        {/* Left column: device, layout, automation, theme */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                1. Cast apparaat ({devices.length})
              </span>
              <button
                onClick={fetchDevices}
                disabled={isScanning}
                title="Scan opnieuw naar apparaten"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
              >
                <RefreshCw
                  size={13}
                  style={{
                    color: isScanning ? 'var(--accent)' : 'var(--text-muted)',
                    animation: isScanning ? 'spin 1s linear infinite' : undefined,
                  }}
                />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {devices.map((device) => {
                const sel = device.id === selectedDeviceId;
                return (
                  <div
                    key={device.id}
                    onClick={() => {
                      setSelectedDeviceId(device.id);
                      handleUpdateCastSettings({ targetDeviceId: device.id, targetDeviceIp: device.ip, targetDeviceName: device.name });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      background: sel ? 'var(--accent-soft)' : 'var(--bg-inset)',
                      border: '1px solid ' + (sel ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Tv size={16} style={{ color: sel ? 'var(--accent)' : 'var(--text-muted)' }} />
                      <div>
                        <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>{device.name}</div>
                        <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                          {device.ip} · {device.model} · {device.room}
                        </div>
                      </div>
                    </div>
                    {sel && <Check size={15} style={{ color: 'var(--accent)' }} />}
                  </div>
                );
              })}
              {devices.length === 0 && (
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: 12 }}>
                  Geen apparaten gevonden. Klik op de scan-knop om opnieuw te zoeken.
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Sliders size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                2. Weergave layout
              </span>
            </div>
            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>Weergave waarmee gecast wordt gestart:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {LAYOUTS.filter((l) => enabledLayoutOrder.includes(l.id)).map((l) => {
                const sel = l.id === selectedLayout;
                return (
                  <div
                    key={l.id}
                    onClick={() => {
                      setSelectedLayout(l.id);
                      handleUpdateCastSettings({ layout: l.id });
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      background: sel ? 'var(--accent-soft)' : 'var(--bg-inset)',
                      border: '1px solid ' + (sel ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                    }}
                  >
                    <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>{l.name}</div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>{l.desc}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '18px 0 10px' }}>
              Swipe-carousel: welke weergaves horizontaal swipen bereikt, en in welke volgorde.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LAYOUTS.map((l) => {
                const idx = enabledLayoutOrder.indexOf(l.id);
                const enabled = idx !== -1;
                return (
                  <div
                    key={l.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-inset)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleLayoutEnabled(l.id, e.target.checked)}
                    />
                    <div style={{ flex: 1, font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>{l.name}</div>
                    <button
                      onClick={() => moveLayoutOrder(l.id, -1)}
                      disabled={!enabled || idx === 0}
                      style={{ opacity: !enabled || idx === 0 ? 0.3 : 1, cursor: !enabled || idx === 0 ? 'default' : 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 2 }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveLayoutOrder(l.id, 1)}
                      disabled={!enabled || idx === enabledLayoutOrder.length - 1}
                      style={{ opacity: !enabled || idx === enabledLayoutOrder.length - 1 ? 0.3 : 1, cursor: !enabled || idx === enabledLayoutOrder.length - 1 ? 'default' : 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 2 }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Zap size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                3. Automatisering
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Toggle
                checked={castSettings.autoCastOnPlay}
                onChange={(v) => handleUpdateCastSettings({ autoCastOnPlay: v })}
                label="Automatisch casten bij afspelen"
                description={`Start het scherm zodra muziek begint op ${selectedDevice?.name || 'je Nest Hub'}`}
              />
              <Toggle
                checked={castSettings.autoStopOnPause}
                onChange={(v) => handleUpdateCastSettings({ autoStopOnPause: v })}
                label="Automatisch stoppen als er niets speelt"
                description={castSettings.autoStopReleasesDevice ? 'Nest Hub keert terug naar het startscherm' : 'Toont dit app\'s eigen standby-klokscherm'}
              />
              {castSettings.autoStopOnPause && (
                <>
                  <Slider
                    label="Wachttijd voor standby"
                    value={castSettings.autoStopDelaySec}
                    min={0}
                    max={300}
                    onChange={(v) => handleUpdateCastSettings({ autoStopDelaySec: v })}
                    valueLabel={castSettings.autoStopDelaySec === 0 ? 'Direct' : `${castSettings.autoStopDelaySec}s`}
                  />
                  <Toggle
                    checked={castSettings.autoStopReleasesDevice}
                    onChange={(v) => handleUpdateCastSettings({ autoStopReleasesDevice: v })}
                    label="Nest Hub echt vrijgeven"
                    description="In plaats van het standby-klokscherm te tonen: sluit de cast-sessie helemaal, zodat het apparaat weer vrij is voor iets anders"
                  />
                </>
              )}
              <Slider
                label="Menu's automatisch sluiten"
                value={castSettings.menuIdleTimeoutSec}
                min={0}
                max={120}
                onChange={(v) => handleUpdateCastSettings({ menuIdleTimeoutSec: v })}
                valueLabel={castSettings.menuIdleTimeoutSec === 0 ? 'Uit' : `${castSettings.menuIdleTimeoutSec}s`}
              />
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Palette size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                4. Kleurenthema voor Nest Hub scherm
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {Object.values(THEME_PRESETS).map((t) => {
                const active = selectedThemeId === t.id && (castSettings.accentMode || 'theme') === 'theme';
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedThemeId(t.id);
                      handleUpdateCastSettings({ themeId: t.id, accentMode: 'theme' });
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      background: active ? 'var(--accent-soft)' : 'var(--bg-inset)',
                      border: '1px solid ' + (active ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accentColor, flexShrink: 0 }} />
                      <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.name.split(' ')[0]}
                      </span>
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => handleUpdateCastSettings({ accentMode: 'auto_albumart' })}
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: castSettings.accentMode === 'auto_albumart' ? 'var(--accent-soft)' : 'var(--bg-inset)',
                  border: '1px solid ' + (castSettings.accentMode === 'auto_albumart' ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ImageIcon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Albumart
                  </span>
                </div>
              </button>
              <button
                onClick={() => handleUpdateCastSettings({ accentMode: 'custom' })}
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: castSettings.accentMode === 'custom' ? 'var(--accent-soft)' : 'var(--bg-inset)',
                  border: '1px solid ' + (castSettings.accentMode === 'custom' ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: castSettings.customAccentColor, flexShrink: 0, border: '1px solid var(--border-default)' }} />
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Aangepast
                  </span>
                </div>
              </button>
            </div>
            {castSettings.accentMode === 'auto_albumart' && (
              <p style={{ margin: '10px 0 0', font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                De accentkleur (tekst, knoppen, randen, gloed) volgt live de dominante kleur van de albumhoes van het huidige nummer.
              </p>
            )}
            {castSettings.accentMode === 'custom' && (
              <div style={{ marginTop: 10 }}>
                <ColorField label="Aangepaste accentkleur" value={castSettings.customAccentColor} onChange={(v) => handleUpdateCastSettings({ customAccentColor: v })} />
              </div>
            )}
          </Card>

          <KioskDisplayCard />
        </div>

        {/* Right column: live preview + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Monitor size={13} />
                Live voorbeeld — {previewDeviceModel === 'hub7' ? 'Nest Hub 7" 1024×600' : 'Nest Hub Max 10" 1280×800'}
              </span>
              <div style={{ display: 'flex', background: 'var(--bg-inset)', padding: 3, borderRadius: 'var(--radius-md)', gap: 2 }}>
                <button
                  onClick={() => setPreviewDeviceModel('hub7')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: previewDeviceModel === 'hub7' ? 'var(--accent)' : 'transparent',
                    color: previewDeviceModel === 'hub7' ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  7-inch
                </button>
                <button
                  onClick={() => setPreviewDeviceModel('hub10')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: previewDeviceModel === 'hub10' ? 'var(--accent)' : 'transparent',
                    color: previewDeviceModel === 'hub10' ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  10-inch Max
                </button>
                <button
                  onClick={() => setPreviewStandby((v) => !v)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-mono-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: previewStandby ? 'var(--accent)' : 'transparent',
                    color: previewStandby ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  Standby
                </button>
              </div>
            </div>

            <div style={{ padding: 14, background: 'var(--bg-inset)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
              <div
                style={{
                  aspectRatio: previewDeviceModel === 'hub7' ? '1024/600' : '1280/800',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  overflow: 'hidden',
                }}
              >
                <LiveKioskPreview
                  layout={selectedLayout}
                  themeId={selectedThemeId}
                  trueWidth={previewDeviceModel === 'hub7' ? 1024 : 1280}
                  trueHeight={previewDeviceModel === 'hub7' ? 600 : 800}
                  standby={previewStandby}
                />
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" icon={<Sliders size={14} />} onClick={() => setContentEditorOpen(true)}>
              Inhoud & vormgeving bewerken
            </Button>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {castSession.isCasting ? (
              <Button variant="danger" icon={<StopCircle size={14} />} onClick={handleStopCast}>
                Stop casten
              </Button>
            ) : (
              <Button variant="primary" icon={<Cast size={14} />} onClick={handleStartCast}>
                Cast naar {selectedDevice?.name || 'apparaat'}
              </Button>
            )}
            {castSession.isStandby && (
              <Button variant="primary" icon={<Sun size={14} />} onClick={handleWake}>
                Standby verlaten
              </Button>
            )}
            <Button variant="secondary" icon={<ExternalLink size={14} />} onClick={() => onOpenCastKioskDirect(selectedLayout, selectedThemeId)}>
              Test in browser
            </Button>
          </div>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, font: 'var(--text-mono-sm)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                <Code size={13} style={{ color: 'var(--accent)' }} />
                Handmatig catt terminal commando
              </span>
              <button
                onClick={handleCopyCommand}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--accent)',
                  font: 'var(--text-mono-sm)',
                }}
              >
                {copiedCmd ? <Check size={13} style={{ color: 'var(--status-success)' }} /> : <Copy size={13} />}
                <span>{copiedCmd ? 'Gekopieerd!' : 'Kopieer'}</span>
              </button>
            </div>
            <pre
              style={{
                padding: 12,
                background: 'var(--bg-inset)',
                color: 'var(--accent)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                font: 'var(--text-mono-sm)',
                overflowX: 'auto',
                margin: 0,
              }}
            >
              {cattCommand}
            </pre>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 10 }}>
              Tip: met "Automatisch casten bij afspelen" aan hoef je dit commando nooit handmatig in te voeren.
            </p>
          </Card>
        </div>
      </div>

      {contentEditorOpen && (
        <CastContentEditor
          settings={castSettings}
          onUpdate={handleUpdateCastSettings}
          onClose={() => setContentEditorOpen(false)}
        />
      )}
    </div>
  );
};
