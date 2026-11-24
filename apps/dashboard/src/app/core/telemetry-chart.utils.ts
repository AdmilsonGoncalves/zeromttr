export interface SparklineGeometry {
  linePath: string;
  areaPath: string;
  lastX: number;
  lastY: number;
  min: number;
  max: number;
}

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

export interface GaugeArcGeometry {
  trackPath: string;
  valuePath: string;
  clampedPercent: number;
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveBounds(
  values: number[],
  options?: { min?: number; max?: number }
): { min: number; max: number; span: number } {
  const rawMin = options?.min ?? Math.min(...values);
  const rawMax = options?.max ?? Math.max(...values);
  const min = Number.isFinite(rawMin) ? rawMin : 0;
  const max = Number.isFinite(rawMax) ? Math.max(min, rawMax) : min;
  const span = max - min > 0 ? max - min : Math.max(1, Math.abs(max) * 0.25);
  return { min, max, span };
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: roundCoord(cx + radius * Math.cos(rad)),
    y: roundCoord(cy + radius * Math.sin(rad))
  };
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x},${start.y} A ${radius},${radius} 0 ${largeArcFlag} 1 ${end.x},${end.y}`;
}

/**
 * Builds SVG line and area paths for compact card sparklines.
 */
export function buildSparklineGeometry(
  values: number[],
  width = 120,
  height = 28,
  options?: { min?: number; max?: number }
): SparklineGeometry {
  if (values.length === 0) {
    return {
      linePath: '',
      areaPath: '',
      lastX: 0,
      lastY: height,
      min: 0,
      max: 0
    };
  }

  const padY = 3;
  const usableHeight = Math.max(1, height - padY * 2);
  const { min, max, span } = resolveBounds(values, options);

  const toY = (val: number): number => {
    const ratio = (val - min) / span;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    return roundCoord(padY + usableHeight * (1 - clampedRatio));
  };

  if (values.length === 1) {
    const y = toY(values[0] ?? 0);
    return {
      linePath: `M 0,${y} L ${width},${y}`,
      areaPath: `M 0,${y} L ${width},${y} L ${width},${height} L 0,${height} Z`,
      lastX: width,
      lastY: y,
      min,
      max
    };
  }

  const coords = values.map((val, idx) => {
    const x = roundCoord((idx / (values.length - 1)) * width);
    const y = toY(val);
    return { x, y };
  });

  const linePath = coords.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`).join(' ');
  const last = coords[coords.length - 1] ?? { x: width, y: height };
  const areaPath = `${linePath} L ${last.x},${height} L 0,${height} Z`;

  return {
    linePath,
    areaPath,
    lastX: last.x,
    lastY: last.y,
    min,
    max
  };
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
    const x =
      samples.length === 1
        ? roundCoord(padLeft + usableWidth / 2)
        : roundCoord(padLeft + (idx / (samples.length - 1)) * usableWidth);
    const ratio = (sample.value - min) / span;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const y = roundCoord(padTop + usableHeight * (1 - clampedRatio));
    return { x, y, value: sample.value, label: sample.label };
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

/**
 * Builds a 240-degree Grafana-inspired semi-circular gauge arc path.
 */
export function buildGaugeArcGeometry(
  percent: number,
  radius = 36,
  cx = 48,
  cy = 46
): GaugeArcGeometry {
  const clampedPercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const startAngle = -120;
  const totalSweep = 240;
  const trackPath = describeArc(cx, cy, radius, startAngle, startAngle + totalSweep);
  const sweep = (clampedPercent / 100) * totalSweep;
  const valuePath =
    clampedPercent > 0 ? describeArc(cx, cy, radius, startAngle, startAngle + sweep) : '';

  return {
    trackPath,
    valuePath,
    clampedPercent: roundCoord(clampedPercent)
  };
}
