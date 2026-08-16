// Stand-in artwork for the browser build, which has no core to render real
// photos: a synthetic landscape per file, so the grid and the README
// screenshots read as a shoot instead of a wall of gradients.

// The sun stays warm in every sky, the way it does in a photo; only the light
// it throws on the horizon changes.
const SKIES = [
  { sky: 222, horizon: 28, sun: 34, glow: 62 }, // sunset
  { sky: 252, horizon: 318, sun: 24, glow: 55 }, // dusk
  { sky: 205, horizon: 196, sun: 46, glow: 40 }, // clear day
  { sky: 268, horizon: 20, sun: 30, glow: 58 }, // dawn
];

function rng(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

function ridge(rand: () => number, base: number, amp: number, steps: number) {
  const points = ["0,400", `0,${(base - amp * rand()).toFixed(0)}`];
  for (let i = 1; i <= steps; i += 1) {
    points.push(
      `${((600 / steps) * i).toFixed(0)},${(base - amp * rand()).toFixed(0)}`,
    );
  }
  points.push("600,400");
  return points.join(" ");
}

export function placeholderFor(path: string): string {
  // Seeded on the file name alone: a photo's thumbnail and its render are
  // different cache paths, and they have to come back the same landscape.
  const rand = rng(path.split("/").pop() ?? path);
  const {
    sky,
    horizon: warm,
    sun: sunHue,
    glow,
  } = SKIES[Math.floor(rand() * SKIES.length)];
  const line = 220 + Math.round(rand() * 60);
  const sunX = 80 + Math.round(rand() * 440);
  const sunR = 20 + Math.round(rand() * 14);
  const sunY = line - 34 - Math.round(rand() * 74);
  const water = rand() < 0.45;
  const land = (l: number) => `hsl(${sky} 24% ${l}%)`;
  const shore = line + 14;
  const ripples = [14, 32, 54]
    .map(
      (dy, i) =>
        `<ellipse cx='${sunX}' cy='${shore + dy}' rx='${28 + i * 16}' ry='1.5' fill='hsl(${sunHue} 88% 86%)' opacity='${0.22 - i * 0.07}'/>`,
    )
    .join("");

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'>
<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'>
<stop offset='0' stop-color='hsl(${sky} 52% 17%)'/>
<stop offset='0.62' stop-color='hsl(${sky} 44% 32%)'/>
<stop offset='1' stop-color='hsl(${warm} ${glow}% 54%)'/>
</linearGradient>
<radialGradient id='sun'>
<stop offset='0.36' stop-color='hsl(${sunHue} 92% 92%)'/>
<stop offset='0.44' stop-color='hsl(${sunHue} 88% 74% / 0.7)'/>
<stop offset='1' stop-color='hsl(${sunHue} 84% 64% / 0)'/>
</radialGradient>
<radialGradient id='glint'>
<stop offset='0' stop-color='hsl(${sunHue} 88% 84% / 0.34)'/>
<stop offset='1' stop-color='hsl(${sunHue} 88% 84% / 0)'/>
</radialGradient>
<linearGradient id='lake' x1='0' y1='0' x2='0' y2='1'>
<stop offset='0' stop-color='hsl(${warm} ${glow - 30}% 25%)'/>
<stop offset='1' stop-color='hsl(${sky} 42% 9%)'/>
</linearGradient>
<radialGradient id='vig' cx='0.5' cy='0.45' r='0.75'>
<stop offset='0.55' stop-color='rgba(0,0,0,0)'/>
<stop offset='1' stop-color='rgba(0,0,0,0.45)'/>
</radialGradient></defs>
<rect width='600' height='400' fill='url(#sky)'/>
<circle cx='${sunX}' cy='${sunY}' r='${Math.round(sunR * 2.4)}' fill='url(#sun)'/>
<ellipse cx='${(sunX + 180) % 600}' cy='${sunY - 40}' rx='150' ry='11' fill='hsl(${warm} 70% 74%)' opacity='0.16'/>
<ellipse cx='${(sunX + 380) % 600}' cy='${sunY + 30}' rx='190' ry='8' fill='hsl(${warm} 70% 76%)' opacity='0.12'/>
<polygon points='${ridge(rand, line, 90, 4)}' fill='${land(33)}'/>
<polygon points='${ridge(rand, shore, 62, 6)}' fill='${land(21)}'/>
${
  water
    ? `<rect y='${shore}' width='600' height='${400 - shore}' fill='url(#lake)'/>
<clipPath id='below'><rect y='${shore}' width='600' height='${400 - shore}'/></clipPath>
<ellipse cx='${sunX}' cy='${shore}' rx='${sunR + 22}' ry='${Math.round((400 - shore) * 0.8)}' fill='url(#glint)' clip-path='url(#below)'/>${ripples}`
    : `<polygon points='${ridge(rand, line + 44, 38, 9)}' fill='${land(10)}'/>`
}
<rect width='600' height='400' fill='url(#vig)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
