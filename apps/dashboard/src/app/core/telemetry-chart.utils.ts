export interface TimeSeriesSample {
  label: string;
  value: number;
}

export interface TimeSeriesPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

export interface TimeSeriesTick {
  y: number;
  label: string;
}

export interface TimeSeriesXLabel {
  x: number;
  label: string;
}

export interface TimeSeriesGeometry {
  linePath: string;
  areaPath: string;
  points: TimeSeriesPoint[];
  min: number;
  max: number;
  yTicks: TimeSeriesTick[];
  xLabels: TimeSeriesXLabel[];
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveBounds(
  values: number[],
  options?: { min?: number; max?: number }
): { min: number; max: number; span: number } {
  const finiteValues = values.filter((val) => Number.isFinite(val));
  const boundedInput = finiteValues.length > 0 ? finiteValues : [0];
  const rawMin = options?.min ?? Math.min(...boundedInput);
  const rawMax = options?.max ?? Math.max(...boundedInput);
  const min = Number.isFinite(rawMin) ? rawMin : 0;
  const baseMax = Number.isFinite(rawMax) ? Math.max(min, rawMax) : min;
  const rawSpan = baseMax - min;
  const span = rawSpan > 0 ? rawSpan : Math.max(1, Math.abs(baseMax) * 0.25);
  const max = rawSpan > 0 ? baseMax : roundCoord(min + span);
  return { min, max, span };
}

/**
 * Builds Grafana-style time-series SVG geometry with axis ticks and plotted data points.
 */
export function buildTimeSeriesGeometry(
  samples: TimeSeriesSample[],
  width = 420,
  height = 130,
  options?: { min?: number; max?: number; unit?: string }
): TimeSeriesGeometry {
  if (samples.length === 0) {
    return {
      linePath: '',
      areaPath: '',
      points: [],
      min: 0,
      max: 0,
      yTicks: [],
      xLabels: []
    };
  }

  const padLeft = 6;
  const padRight = 6;
  const padTop = 8;
  const padBottom = 8;
  const usableWidth = Math.max(1, width - padLeft - padRight);
  const usableHeight = Math.max(1, height - padTop - padBottom);
  const values = samples.map((s) => s.value);
  const { min, max, span } = resolveBounds(values, options);
  const unit = options?.unit ?? '';

  const points: TimeSeriesPoint[] = samples.map((sample, idx) => {
    const safeValue = Number.isFinite(sample.value) ? sample.value : min;
    const x =
      samples.length === 1
        ? roundCoord(padLeft + usableWidth / 2)
        : roundCoord(padLeft + (idx / (samples.length - 1)) * usableWidth);
    const ratio = (safeValue - min) / span;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const y = roundCoord(padTop + usableHeight * (1 - clampedRatio));
    return { x, y, value: safeValue, label: sample.label };
  });

  const linePath =
    points.length === 1
      ? `M ${padLeft},${points[0]!.y} L ${padLeft + usableWidth},${points[0]!.y}`
      : points.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`).join(' ');

  const bottomY = roundCoord(padTop + usableHeight);
  const startX = points.length === 1 ? padLeft : (points[0]?.x ?? padLeft);
  const endX =
    points.length === 1 ? padLeft + usableWidth : (points[points.length - 1]?.x ?? padLeft);
  const areaPath = `${linePath} L ${endX},${bottomY} L ${startX},${bottomY} Z`;

  const midValue = roundCoord(min + span / 2);
  const yTicks: TimeSeriesTick[] = [
    { y: padTop, label: `${roundCoord(max)}${unit}` },
    { y: roundCoord(padTop + usableHeight / 2), label: `${midValue}${unit}` },
    { y: bottomY, label: `${roundCoord(min)}${unit}` }
  ];

  const xLabels: TimeSeriesXLabel[] = [];
  if (points.length === 1) {
    xLabels.push({ x: points[0]!.x, label: points[0]!.label });
  } else {
    const midIdx = Math.floor((points.length - 1) / 2);
    const first = points[0]!;
    const mid = points[midIdx]!;
    const last = points[points.length - 1]!;
    xLabels.push({ x: first.x, label: first.label });
    if (midIdx > 0 && midIdx < points.length - 1) {
      xLabels.push({ x: mid.x, label: mid.label });
    }
    xLabels.push({ x: last.x, label: last.label });
  }

  return {
    linePath,
    areaPath,
    points,
    min,
    max,
    yTicks,
    xLabels
  };
}
