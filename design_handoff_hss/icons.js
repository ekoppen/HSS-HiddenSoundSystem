// Local icon set — vendored to avoid CDN reliability issues with lucide-react's UMD build.
// Simple stroke-based glyphs (24x24, stroke=currentColor, matches Lucide's visual weight),
// not copied from Lucide's path data. Covers the icons this design system actually uses.
(function () {
  const h = React.createElement;
  function svg(size, children, extra) {
    return h('svg', Object.assign({
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    }, extra), children);
  }
  function icon(renderChildren) {
    return function Icon({ size = 20, style, fill }) {
      return svg(size, renderChildren(fill), { style });
    };
  }

  const Radio = icon(() => [h('circle', { key: 1, cx: 12, cy: 12, r: 2 }), h('path', { key: 2, d: 'M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4' })]);
  const Cast = icon(() => [h('path', { key: 1, d: 'M3 6h13a2 2 0 0 1 2 2v9M3 14a4 4 0 0 1 4 4M3 10a8 8 0 0 1 8 8' }), h('circle', { key: 2, cx: 4, cy: 18, r: 1 })]);
  const Volume2 = icon(() => [h('path', { key: 1, d: 'M5 9v6h4l5 5V4L9 9H5z' }), h('path', { key: 2, d: 'M17.5 8.5a5 5 0 0 1 0 7M20 6a9 9 0 0 1 0 12' })]);
  const Sliders = icon(() => [h('line', { key: 1, x1: 4, y1: 6, x2: 20, y2: 6 }), h('circle', { key: 2, cx: 9, cy: 6, r: 2 }), h('line', { key: 3, x1: 4, y1: 12, x2: 20, y2: 12 }), h('circle', { key: 4, cx: 15, cy: 12, r: 2 }), h('line', { key: 5, x1: 4, y1: 18, x2: 20, y2: 18 }), h('circle', { key: 6, cx: 7, cy: 18, r: 2 })]);
  const Sparkles = icon(() => [h('path', { key: 1, d: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18' })]);
  const Key = icon(() => [h('circle', { key: 1, cx: 8, cy: 15, r: 4 }), h('path', { key: 2, d: 'M10.8 12.2 19 4M16 8l2 2M13 11l2 2' })]);
  const Cpu = icon(() => [h('rect', { key: 1, x: 6, y: 6, width: 12, height: 12, rx: 2 }), h('rect', { key: 2, x: 9, y: 9, width: 6, height: 6 }), h('path', { key: 3, d: 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3' })]);
  const Wifi = icon(() => [h('path', { key: 1, d: 'M2 8.5a16 16 0 0 1 20 0M5.5 12a11 11 0 0 1 13 0M9 15.5a6 6 0 0 1 6 0' }), h('circle', { key: 2, cx: 12, cy: 19, r: 1 })]);
  const Palette = icon(() => [h('circle', { key: 1, cx: 12, cy: 12, r: 9 }), h('circle', { key: 2, cx: 8.5, cy: 10.5, r: 1.2, fill: 'currentColor' }), h('circle', { key: 3, cx: 12, cy: 8, r: 1.2, fill: 'currentColor' }), h('circle', { key: 4, cx: 15.5, cy: 10.5, r: 1.2, fill: 'currentColor' })]);
  const Shuffle = icon(() => [h('path', { key: 1, d: 'M3 6h3l9 12h3M17 6h3v3M3 18h3l4-5.5' }), h('path', { key: 2, d: 'M20 6l-3 3M17 15l3 3v-3' })]);
  const Rewind = icon(() => [h('path', { key: 1, d: 'M12 5 4 12l8 7V5zM21 5l-8 7 8 7V5z' })]);
  const Play = icon((fill) => [h('path', { key: 1, d: 'M6 4l14 8-14 8V4z', fill: fill || 'none' })]);
  const Pause = icon((fill) => [h('rect', { key: 1, x: 6, y: 4, width: 4, height: 16, fill: fill || 'none' }), h('rect', { key: 2, x: 14, y: 4, width: 4, height: 16, fill: fill || 'none' })]);
  const FastForward = icon(() => [h('path', { key: 1, d: 'M12 5l8 7-8 7V5zM3 5l8 7-8 7V5z' })]);
  const Repeat = icon(() => [h('path', { key: 1, d: 'M4 8h13a2 2 0 0 1 2 2v3M20 16H7a2 2 0 0 1-2-2V11' }), h('path', { key: 2, d: 'M7 5l-3 3 3 3M17 19l3-3-3-3' })]);
  const ListMusic = icon(() => [h('line', { key: 1, x1: 4, y1: 6, x2: 15, y2: 6 }), h('line', { key: 2, x1: 4, y1: 12, x2: 15, y2: 12 }), h('line', { key: 3, x1: 4, y1: 18, x2: 11, y2: 18 }), h('circle', { key: 4, cx: 18, cy: 15, r: 2.5 }), h('path', { key: 5, d: 'M20.5 15V6l-3 1' })]);
  const Disc = icon(() => [h('circle', { key: 1, cx: 12, cy: 12, r: 9 }), h('circle', { key: 2, cx: 12, cy: 12, r: 2.5 })]);
  const HardDrive = icon(() => [h('line', { key: 1, x1: 3, y1: 13, x2: 21, y2: 13 }), h('path', { key: 2, d: 'M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z' }), h('circle', { key: 3, cx: 8, cy: 17, r: 0.8, fill: 'currentColor' })]);
  const Search = icon(() => [h('circle', { key: 1, cx: 10.5, cy: 10.5, r: 6.5 }), h('line', { key: 2, x1: 20, y1: 20, x2: 15.5, y2: 15.5 })]);
  const Plus = icon(() => [h('line', { key: 1, x1: 12, y1: 5, x2: 12, y2: 19 }), h('line', { key: 2, x1: 5, y1: 12, x2: 19, y2: 12 })]);
  const RefreshCw = icon(() => [h('path', { key: 1, d: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16' }), h('path', { key: 2, d: 'M21 3v5h-5M3 21v-5h5' })]);
  const Trash2 = icon(() => [h('path', { key: 1, d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }), h('line', { key: 2, x1: 10, y1: 11, x2: 10, y2: 17 }), h('line', { key: 3, x1: 14, y1: 11, x2: 14, y2: 17 })]);
  const Tv = icon(() => [h('rect', { key: 1, x: 3, y: 6, width: 18, height: 12, rx: 2 }), h('path', { key: 2, d: 'M8 21h8M12 18v3' })]);
  const Check = icon(() => [h('path', { key: 1, d: 'M4 12.5l5 5 11-11' })]);
  const Zap = icon((fill) => [h('path', { key: 1, d: 'M12 2 4 14h6l-1 8 9-13h-6l1-7z', fill: fill || 'none' })]);
  const Image = icon(() => [h('rect', { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('circle', { key: 2, cx: 8.5, cy: 9.5, r: 1.5 }), h('path', { key: 3, d: 'M21 16l-5.5-5.5L4 21' })]);
  const Type = icon(() => [h('polyline', { key: 1, points: '5,7 5,4 19,4 19,7' }), h('line', { key: 2, x1: 12, y1: 4, x2: 12, y2: 20 }), h('line', { key: 3, x1: 9, y1: 20, x2: 15, y2: 20 })]);
  const Layers = icon(() => [h('path', { key: 1, d: 'M12 3 3 8l9 5 9-5-9-5z' }), h('path', { key: 2, d: 'M3 13l9 5 9-5' })]);

  window.Icons = { Radio, Cast, Volume2, Sliders, Sparkles, Key, Cpu, Wifi, Palette, Shuffle, Rewind, Play, Pause, FastForward, Repeat, ListMusic, Disc, HardDrive, Search, Plus, RefreshCw, Trash2, Tv, Check, Zap, Image, Type, Layers };
})();
