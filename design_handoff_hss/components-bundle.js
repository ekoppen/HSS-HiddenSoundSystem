// Soloist HiFi Hub design system — component bundle.
// Plain JS (React.createElement, no JSX) so it loads as an ordinary <script src>
// with no Babel-on-external-file step involved. Source of truth for JSX authoring
// intent lives in components/**/*.jsx; keep this file in sync when those change.
(function () {
  const h = React.createElement;

  const sizesBtn = {
    sm: { padding: '6px 12px', font: 'var(--text-label)', gap: 6 },
    md: { padding: '10px 18px', font: 'var(--text-body-strong)', gap: 8 },
  };
  const variantsBtn = {
    primary: { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid transparent' },
    secondary: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' },
    danger: { background: 'rgba(251,113,133,0.12)', color: 'var(--status-danger)', border: '1px solid rgba(251,113,133,0.3)' },
  };
  function Button({ variant = 'primary', size = 'md', icon, disabled, onClick, children }) {
    const s = sizesBtn[size] || sizesBtn.md;
    const v = variantsBtn[variant] || variantsBtn.primary;
    return h('button', {
      onClick: disabled ? undefined : onClick,
      disabled,
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
        padding: s.padding, font: s.font, letterSpacing: size === 'sm' ? 'var(--letter-label)' : 'normal',
        textTransform: size === 'sm' ? 'uppercase' : 'none', borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        transition: 'background var(--duration-fast) var(--ease-standard), transform var(--duration-fast)',
        ...v,
      },
    }, icon, h('span', null, children));
  }

  function IconButton({ icon, active, title, onClick, size = 36 }) {
    return h('button', {
      title, onClick,
      style: {
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', background: active ? 'var(--accent-soft)' : 'transparent',
        border: active ? '1px solid var(--accent-soft-strong)' : '1px solid transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer',
        transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast)',
      },
    }, icon);
  }

  const variantsBadge = {
    accent: { background: 'var(--accent-soft)', color: 'var(--accent)' },
    success: { background: 'rgba(52,211,153,0.14)', color: 'var(--status-success)' },
    warning: { background: 'rgba(245,158,11,0.14)', color: 'var(--status-warning)' },
    danger: { background: 'rgba(251,113,133,0.14)', color: 'var(--status-danger)' },
    neutral: { background: 'var(--bg-inset)', color: 'var(--text-secondary)' },
  };
  function Badge({ variant = 'neutral', icon, mono = true, children }) {
    const v = variantsBadge[variant] || variantsBadge.neutral;
    return h('span', {
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 'var(--radius-sm)',
        font: mono ? 'var(--text-mono-sm)' : 'var(--text-label)', letterSpacing: mono ? 0 : 'var(--letter-label)',
        textTransform: mono ? 'none' : 'uppercase', ...v,
      },
    }, icon, children);
  }

  function Card({ padding = 24, hoverable = false, children, style }) {
    return h('div', {
      style: {
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-card)', padding, transition: 'background var(--duration-base) var(--ease-standard), border-color var(--duration-base)',
        ...style,
      },
      onMouseEnter: hoverable ? (e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.borderColor = 'var(--border-default)'; } : undefined,
      onMouseLeave: hoverable ? (e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; } : undefined,
    }, children);
  }

  function Modal({ open, title, icon, subtitle, onClose, children, footer }) {
    if (!open) return null;
    return h('div', {
      style: { position: 'absolute', inset: 0, background: 'rgba(4,5,7,0.72)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 },
    }, h('div', {
      style: { width: '100%', maxWidth: 640, maxHeight: '85%', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-elevated)', overflow: 'hidden' },
    }, [
      h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' } }, [
        h('div', { key: 'l', style: { display: 'flex', alignItems: 'center', gap: 12 } }, [
          icon && h('div', { key: 'i', style: { width: 40, height: 40, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' } }, icon),
          h('div', { key: 't' }, [
            h('div', { key: 'title', style: { font: 'var(--text-title)', color: 'var(--text-primary)' } }, title),
            subtitle && h('div', { key: 'sub', style: { font: 'var(--text-body)', color: 'var(--text-muted)', marginTop: 2 } }, subtitle),
          ]),
        ]),
        h('button', { key: 'x', onClick: onClose, style: { width: 34, height: 34, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' } }, '\u2715'),
      ]),
      h('div', { key: 'body', style: { padding: 24, overflowY: 'auto' } }, children),
      footer && h('div', { key: 'ft', style: { padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-inset)' } }, footer),
    ]));
  }

  function Tabs({ items, activeId, onChange }) {
    return h('nav', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, items.map((tab) => {
      const isActive = tab.id === activeId;
      return h('button', {
        key: tab.id, onClick: () => onChange(tab.id),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 'var(--radius-md)',
          font: 'var(--text-body-strong)', fontWeight: isActive ? 600 : 500, whiteSpace: 'nowrap', cursor: 'pointer',
          background: isActive ? 'var(--accent-soft)' : 'transparent', color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
          border: '1px solid ' + (isActive ? 'var(--accent-soft-strong)' : 'transparent'),
          transition: 'all var(--duration-fast) var(--ease-standard)',
        },
      }, [tab.icon, h('span', { key: 'l' }, tab.label)]);
    }));
  }

  function Slider({ value, min = 0, max = 100, onChange, label, valueLabel }) {
    const pct = ((value - min) / (max - min)) * 100;
    return h('div', { style: { width: '100%' } }, [
      (label || valueLabel) && h('div', { key: 'hd', style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } }, [
        label && h('span', { key: 'l', style: { font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' } }, label),
        valueLabel && h('span', { key: 'v', style: { font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' } }, valueLabel),
      ]),
      h('div', { key: 'track', style: { position: 'relative', height: 4, borderRadius: 'var(--radius-full)', background: 'var(--bg-inset)' } }, [
        h('div', { key: 'fill', style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', borderRadius: 'var(--radius-full)', background: 'var(--accent)' } }),
        h('input', {
          key: 'input', type: 'range', min, max, value, onChange: (e) => onChange(Number(e.target.value)),
          style: { position: 'absolute', inset: '-8px 0', width: '100%', height: 20, appearance: 'none', background: 'transparent', cursor: 'pointer', margin: 0 },
        }),
        h('div', { key: 'knob', style: { position: 'absolute', top: '50%', left: 'calc(' + pct + '% - 7px)', transform: 'translateY(-50%)', width: 14, height: 14, borderRadius: '50%', background: 'var(--on-accent)', border: '2px solid var(--accent)', boxShadow: 'var(--shadow-card)', pointerEvents: 'none' } }),
      ]),
    ]);
  }

  function ProgressBar({ pct, label, tone = 'accent' }) {
    const color = tone === 'accent' ? 'var(--accent)' : 'var(--status-' + tone + ')';
    return h('div', { style: { width: '100%' } }, [
      label && h('div', { key: 'l', style: { font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginBottom: 6 } }, label),
      h('div', { key: 'track', style: { height: 6, borderRadius: 'var(--radius-full)', background: 'var(--bg-inset)', overflow: 'hidden' } },
        h('div', { style: { height: '100%', width: pct + '%', background: color, borderRadius: 'var(--radius-full)', transition: 'width var(--duration-base) var(--ease-standard)' } })),
    ]);
  }

  function SpecStat({ label, value, tone = 'primary' }) {
    const color = tone === 'primary' ? 'var(--text-primary)' : 'var(--' + tone + ')';
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } }, [
      h('span', { key: 'l', style: { font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' } }, label),
      h('span', { key: 'v', style: { font: 'var(--text-mono)', fontWeight: 600, color } }, value),
    ]);
  }

  function SpectrumBars({ values, active = true, bars = 16 }) {
    const data = values && values.length ? values : Array.from({ length: bars }, () => 8);
    return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 } },
      data.map((val, i) => h('div', {
        key: i,
        style: {
          flex: 1, height: Math.max(4, val) + '%', borderRadius: 2,
          background: 'linear-gradient(to top, var(--meter-1), var(--meter-2) 60%, var(--meter-3))',
          opacity: active ? 0.95 : 0.25, transition: 'height var(--duration-fast) linear, opacity var(--duration-base)',
        },
      })));
  }

  const THEME_META = {
    obsidian: { name: 'Obsidian Indigo', category: 'Standaard', accent: '#6366f1', bg: '#101216', meters: ['#4f46e5', '#6366f1', '#38bdf8'] },
    slate: { name: 'Nordic Slate', category: 'Studio', accent: '#4fa3c7', bg: '#0e1218', meters: ['#3b87aa', '#4fa3c7', '#8fd4ec'] },
    emerald: { name: 'Spotify Emerald', category: 'Streaming', accent: '#10b981', bg: '#0b1712', meters: ['#0c9268', '#10b981', '#6ee7b7'] },
    copper: { name: 'Vintage Tube', category: 'Audiophile Retro', accent: '#c8781f', bg: '#161009', meters: ['#a8631a', '#c8781f', '#eab06a'] },
  };
  function ThemeSwitchCard({ themeId, active, onSelect }) {
    const t = THEME_META[themeId];
    if (!t) return null;
    return h('div', {
      onClick: () => onSelect(themeId),
      style: {
        position: 'relative', cursor: 'pointer', padding: 16, borderRadius: 'var(--radius-lg)', background: t.bg,
        border: '1px solid ' + (active ? t.accent : 'var(--border-default)'),
        boxShadow: active ? '0 0 0 1px ' + t.accent + ' inset' : 'none', transition: 'border-color var(--duration-fast)',
      },
    }, [
      h('div', { key: 'top', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
        h('span', { key: 'cat', style: { font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: t.accent, background: t.accent + '22', padding: '3px 8px', borderRadius: 'var(--radius-sm)' } }, t.category),
        active && h('span', { key: 'act', style: { font: 'var(--text-mono-sm)', color: t.accent } }, 'ACTIEF'),
      ]),
      h('div', { key: 'name', style: { font: 'var(--text-subtitle)', color: '#f4f5f7', marginTop: 10 } }, t.name),
      h('div', { key: 'sw', style: { display: 'flex', gap: 6, marginTop: 14 } }, [
        h('div', { key: 'dot', style: { width: 20, height: 20, borderRadius: '50%', background: t.accent } }),
        h('div', { key: 'bar', style: { flex: 1, height: 12, borderRadius: 6, background: 'linear-gradient(to right,' + t.meters.join(',') + ')' } }),
      ]),
    ]);
  }

  function Toggle({ checked, onChange, label, description }) {
    return h('div', {
      onClick: () => onChange(!checked),
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer', padding: (label || description) ? '2px 0' : 0 },
    }, [
      (label || description) && h('div', { key: 'txt', style: { minWidth: 0 } }, [
        label && h('div', { key: 'l', style: { font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' } }, label),
        description && h('div', { key: 'd', style: { font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 } }, description),
      ]),
      h('div', {
        key: 'sw',
        style: {
          width: 38, height: 22, borderRadius: 'var(--radius-full)', flexShrink: 0, position: 'relative',
          background: checked ? 'var(--accent)' : 'var(--bg-inset)', border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-default)'),
          transition: 'background var(--duration-fast) var(--ease-standard)',
        },
      }, h('div', { style: { position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left var(--duration-fast) var(--ease-standard)' } })),
    ]);
  }

  window.SoloistDS = { Button, IconButton, Badge, Card, Modal, Tabs, Slider, ProgressBar, SpecStat, SpectrumBars, ThemeSwitchCard, Toggle };
})();
