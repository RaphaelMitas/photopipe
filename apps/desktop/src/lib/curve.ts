export type CurvePoint = { x: number; y: number };

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

function normalized(points: CurvePoint[]): CurvePoint[] {
  const seen = new Set<number>();
  return points
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }))
    .sort((a, b) => a.x - b.x)
    .filter((point) => {
      if (seen.has(point.x)) return false;
      seen.add(point.x);
      return true;
    });
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  const sorted = normalized(points);
  if (sorted.length < 2) return true;
  return sorted.every((point) => Math.abs(point.y - point.x) < 1e-9);
}

// Fritsch–Carlson tangents: shape-preserving, no overshoot. The Swift core
// ships the same spline; fixtures/curve-samples.json pins both.
function tangents(pts: CurvePoint[]): number[] {
  const n = pts.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    delta.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }
  return m;
}

export function evaluateCurve(points: CurvePoint[], x: number): number {
  const pts = normalized(points);
  if (pts.length < 2) return clamp01(x);
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

  const m = tangents(pts);
  let segment = 0;
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    if (pts[i].x <= x) {
      segment = Math.min(i, pts.length - 2);
      break;
    }
  }
  const x0 = pts[segment].x;
  const h = pts[segment + 1].x - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y =
    (2 * t3 - 3 * t2 + 1) * pts[segment].y +
    (t3 - 2 * t2 + t) * h * m[segment] +
    (-2 * t3 + 3 * t2) * pts[segment + 1].y +
    (t3 - t2) * h * m[segment + 1];
  return clamp01(y);
}

export function sampleCurve(points: CurvePoint[], count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    evaluateCurve(points, i / (count - 1)),
  );
}
