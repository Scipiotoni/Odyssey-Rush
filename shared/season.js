// Seasons, shared by server (cold, snowfall, footprints) and client (visuals).
// year runs 0..4: 0 spring, 1 summer, 2 autumn, 3 winter. Each season lasts SEASON_DAYS game days.
export const SEASON_DAYS = 2;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_ICONS = ['🌸', '☀️', '🍂', '❄️'];
export const FOOTPRINT_LIFE = 3600; // seconds until a footprint has filled back in

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function seasonInfo(year) {
  const y = ((year % 4) + 4) % 4, s = Math.floor(y), f = y - s; // f: progress through the season
  // snow cover builds over the first quarter of winter, melts over the first quarter of spring
  const snow = s === 3 ? smooth(0.02, 0.25, f) : s === 0 ? 1 - smooth(0.0, 0.25, f) : 0;
  // hoarfrost in late autumn and all winter
  const frost = s === 2 ? smooth(0.7, 1, f) * 0.6 : s === 3 ? 1 : s === 0 ? 1 - smooth(0, 0.2, f) : 0;
  // leaf colour: turns through autumn, dull brown under the winter snow, fresh again in spring
  const autumn = s === 2 ? smooth(0.0, 0.45, f) : s === 3 ? 0.55 : s === 0 ? 0.55 * (1 - smooth(0.1, 0.35, f)) : 0;
  // flowers
  const bloom = s === 0 ? smooth(0.2, 0.5, f) * 1.2 : s === 1 ? 1 : s === 2 ? 1 - smooth(0.1, 0.6, f) : 0;
  const cold = [0.1, 0, 0.18, 0.5][s];
  return { season: s, name: SEASONS[s], progress: f, snow, frost, autumn, bloom, cold };
}
