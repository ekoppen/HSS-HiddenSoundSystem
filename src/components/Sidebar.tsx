import React, { useState } from 'react';
import { BookOpen, Cast, ChevronLeft, ChevronRight, Cpu, Heart, Key, Palette, Radio, Router, Sliders, Sparkles, Volume2, Wand2, Wifi } from 'lucide-react';
import { SystemStats } from '../types';

interface Tab {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

const TABS: Tab[] = [
  { id: 'player', label: 'Afspelen', icon: Radio },
  { id: 'favorites', label: 'Favorieten', icon: Heart },
  { id: 'cast', label: 'Cast', icon: Cast },
  { id: 'volume-dac', label: 'Audio', icon: Volume2 },
  { id: 'playlists', label: 'Bronnen', icon: Sliders },
  { id: 'advanced-audio', label: 'Equalizer', icon: Sparkles },
  { id: 'auth-api', label: 'Instellingen', icon: Key },
  { id: 'scripts', label: 'Systeem', icon: Cpu },
  { id: 'websocket-stream', label: 'Live', icon: Wifi },
];

export { TABS };

interface SidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onOpenThemeModal: () => void;
  onOpenHubSwitcher: () => void;
  onOpenSetupWizard: () => void;
  onOpenApiDocs: () => void;
  systemStats: SystemStats;
  /** The device's actual name on the network (hubConfig.spotifyDeviceName,
   * e.g. "HSSwoonkamer") — shown as the sidebar title instead of the
   * generic app name, so it's obvious which physical device you're
   * looking at when more than one is running. */
  deviceName?: string;
  /** Shows a small dot on the Systeem nav item — a new git commit sits on
   * origin/main that this deploy hasn't pulled yet (see the periodic check
   * in state.ts and the "Nu updaten" button on that page). */
  updateAvailable?: boolean;
  /** Same dot, but red/urgent — a previously-silent failure (ALSA mixer not
   * found, a DB write that failed, mpv refusing to start...) is currently
   * active. Takes priority over updateAvailable's amber when both are true. */
  hasHealthIssues?: boolean;
  /** Below the md breakpoint the sidebar renders as a slide-over drawer
   * instead of a permanent column (232px permanently eating well over half
   * of a phone's width made the app unusable there) — these control that
   * drawer's open state from the hamburger button in App.tsx's header. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const COLLAPSE_STORAGE_KEY = 'hss_sidebar_collapsed';

// Sidebar footer's secondary actions (Thema, Hubs, Setup wizard, API docs) —
// occasional/admin actions that don't need a permanent full-width bar on
// every tab, just one click away here instead.
const FooterAction: React.FC<{ icon: React.ReactNode; label: string; collapsed: boolean; onClick: () => void }> = ({
  icon,
  label,
  collapsed,
  onClick,
}) => (
  <button
    onClick={onClick}
    title={label}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: collapsed ? 'center' : 'flex-start',
      gap: 10,
      padding: collapsed ? '9px' : '9px 12px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      color: 'var(--text-secondary)',
      font: 'var(--text-body-strong)',
      fontSize: 13,
      cursor: 'pointer',
    }}
  >
    {icon}
    {!collapsed && <span>{label}</span>}
  </button>
);

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenThemeModal, onOpenHubSwitcher, onOpenSetupWizard, onOpenApiDocs, systemStats, deviceName, updateAvailable, hasHealthIssues, mobileOpen, onCloseMobile }) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const selectTab = (tabId: string) => {
    onTabChange(tabId);
    onCloseMobile();
  };

  return (
    <>
      {/* Backdrop — mobile only (md:hidden), closes the drawer on tap.
          Desktop never renders this since mobileOpen has no meaning there. */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="md:hidden"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39 }}
        />
      )}
      <aside
        className={`fixed md:relative inset-y-0 left-0 md:inset-auto z-40 md:z-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        style={{
          width: collapsed ? 72 : 232,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-subtle)',
          // Mobile drawer is position:fixed, so it escapes App.tsx's root
          // safe-area padding — pin it in from the Dynamic Island / home
          // indicator directly. Overriding inset-y-0's top/bottom:0; resolves
          // to plain 0 on desktop (position:relative there) and non-notch
          // devices, so no minHeight fallback needed either.
          top: 'env(safe-area-inset-top)',
          bottom: 'env(safe-area-inset-bottom)',
          transition: 'width var(--duration-fast, 150ms) var(--ease-standard, ease), transform 200ms ease-in-out',
        }}
      >
      <button
        onClick={toggleCollapsed}
        title={collapsed ? 'Menu uitklappen' : 'Menu inklappen'}
        style={{
          position: 'absolute',
          top: 24,
          right: -12,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: collapsed ? '24px 17px 20px' : '24px 20px 20px' }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Radio size={18} style={{ color: 'var(--accent)' }} />
        </div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            {/* Title on its own row — a version badge sharing this row with
                the title text only fits at exactly this sidebar width, so
                as soon as it wraps (any narrower viewport, a longer device
                name, etc.) the badge visually collides with the wrapped
                second line. The subtitle row has room. Truncated with an
                ellipsis rather than wrapped — deviceName's length isn't
                bounded the way a fixed app name is. */}
            <span
              style={{
                display: 'block',
                font: 'var(--text-title)',
                fontSize: 16,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={deviceName || 'HSS HiddenSoundSystem'}
            >
              {deviceName || 'HSS HiddenSoundSystem'}
            </span>
            <div className="flex items-center gap-2" style={{ marginTop: 2, minWidth: 0 }}>
              <span
                style={{
                  font: 'var(--text-mono-sm)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={systemStats.piModel}
              >
                {systemStats.piModel || 'Raspberry Pi'}
              </span>
              <span
                style={{
                  font: 'var(--text-mono-sm)',
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                v2.4
              </span>
            </div>
          </div>
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px', flex: 1 }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              title={collapsed ? tab.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 11,
                padding: collapsed ? '10px' : '10px 12px',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-body-strong)',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                border: '1px solid ' + (isActive ? 'var(--accent-soft-strong)' : 'transparent'),
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                <Icon size={16} />
                {tab.id === 'scripts' && (hasHealthIssues || updateAvailable) && (
                  <span
                    title={hasHealthIssues ? 'Systeemwaarschuwing actief' : 'Update beschikbaar'}
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: hasHealthIssues ? 'var(--status-danger)' : 'var(--status-warning)',
                      border: '1.5px solid var(--bg-surface)',
                    }}
                  />
                )}
              </span>
              {!collapsed && <span>{tab.label}</span>}
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <FooterAction
          icon={<Palette size={16} style={{ color: 'var(--accent)' }} />}
          label="Thema"
          collapsed={collapsed}
          onClick={onOpenThemeModal}
        />
        <FooterAction
          icon={<Router size={16} style={{ color: 'var(--accent)' }} />}
          label="Hubs"
          collapsed={collapsed}
          onClick={onOpenHubSwitcher}
        />
        <FooterAction
          icon={<Wand2 size={16} style={{ color: 'var(--accent)' }} />}
          label="Setup wizard"
          collapsed={collapsed}
          onClick={onOpenSetupWizard}
        />
        <FooterAction
          icon={<BookOpen size={16} style={{ color: 'var(--accent)' }} />}
          label="API docs"
          collapsed={collapsed}
          onClick={onOpenApiDocs}
        />
        {!collapsed && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              font: 'var(--text-mono-sm)',
              color: 'var(--text-muted)',
              padding: '0 12px',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--status-success)',
                flexShrink: 0,
              }}
            />
            <span>
              CPU {Math.round(systemStats.cpuTempC)}°C · {systemStats.streamBitrate}kbps
            </span>
          </div>
        )}
      </div>
      </aside>
    </>
  );
};
