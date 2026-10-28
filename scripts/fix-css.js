import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import culori from 'culori';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'dist/assets');

if (fs.existsSync(assetsDir)) {
  const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'));

  for (const file of cssFiles) {
    const filePath = path.join(assetsDir, file);
    let css = fs.readFileSync(filePath, 'utf8');

    let count = 0;
    css = css.replace(/oklch\(([^)]+)\)/g, (match, p1) => {
      try {
        let [colorPart, alphaPart] = p1.split('/');
        let parts = colorPart.trim().split(/\s+/);
        if (parts.length >= 3) {
          let l = parseFloat(parts[0]);
          if (parts[0].includes('%')) l = l / 100;
          let c = parseFloat(parts[1]);
          let h = parseFloat(parts[2]);
          let alpha = alphaPart ? parseFloat(alphaPart.trim()) : undefined;

          const obj = { mode: 'oklch', l, c, h };
          if (alpha !== undefined) obj.alpha = alpha;

          const rgbObj = culori.rgb(obj);
          if (rgbObj) {
            count++;
            const r = Math.round(Math.max(0, Math.min(255, (rgbObj.r || 0) * 255)));
            const g = Math.round(Math.max(0, Math.min(255, (rgbObj.g || 0) * 255)));
            const b = Math.round(Math.max(0, Math.min(255, (rgbObj.b || 0) * 255)));
            if (alpha !== undefined && alpha < 1) {
              return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }
            return `rgb(${r}, ${g}, ${b})`;
          }
        }
      } catch (e) {}
      return match;
    });

    fs.writeFileSync(filePath, css, 'utf8');
    console.log(`[CSS Fix] Converted ${count} oklch colors to RGB in ${file}`);
  }
}
