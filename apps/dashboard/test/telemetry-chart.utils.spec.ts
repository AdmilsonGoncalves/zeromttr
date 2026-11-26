import { describe, expect, it } from 'vitest';
import { buildTimeSeriesGeometry } from '../src/app/core/telemetry-chart.utils.js';

describe('telemetry-chart.utils', () => {
  describe('buildTimeSeriesGeometry', () => {
    it('should_compute_points_area_y_ticks_and_x_labels_for_samples', () => {
      const geo = buildTimeSeriesGeometry(
        [
          { label: '11:00:00', value: 18 },
          { label: '11:00:02', value: 420 },
          { label: '11:00:04', value: 1500 }
        ],
        400,
        120,
        { min: 0, unit: 'ms' }
      );

      expect(geo.points).toHaveLength(3);
      expect(geo.linePath).toContain('M ');
      expect(geo.areaPath).toContain('Z');
      expect(geo.yTicks.length).toBeGreaterThanOrEqual(2);
      expect(geo.xLabels.length).toBeGreaterThanOrEqual(2);
      expect(geo.max).toBe(1500);
    });

    it('should_keep_monotonic_y_ticks_for_zero_and_constant_series', () => {
      const zeroGeo = buildTimeSeriesGeometry(
        [
          { label: '11:00:00', value: 0 },
          { label: '11:00:02', value: 0 }
        ],
        420,
        145,
        { min: 0, unit: 'ms' }
      );

      expect(zeroGeo.max).toBe(1);
      expect(zeroGeo.yTicks.map((tick) => tick.label)).toEqual(['1ms', '0.5ms', '0ms']);

      const constantGeo = buildTimeSeriesGeometry(
        [
          { label: '11:00:00', value: 100 },
          { label: '11:00:02', value: 100 }
        ],
        420,
        145,
        { unit: 'ms' }
      );

      expect(constantGeo.min).toBe(100);
      expect(constantGeo.max).toBe(125);
      expect(constantGeo.yTicks.map((tick) => tick.label)).toEqual(['125ms', '112.5ms', '100ms']);
    });

    it('should_sanitize_non_finite_sample_values_without_emitting_nan_coordinates', () => {
      const geo = buildTimeSeriesGeometry(
        [
          { label: '11:00:00', value: Number.NaN },
          { label: '11:00:02', value: Number.POSITIVE_INFINITY },
          { label: '11:00:04', value: 40 }
        ],
        400,
        120,
        { min: 0, unit: 'ms' }
      );

      expect(geo.linePath).not.toContain('NaN');
      expect(geo.areaPath).not.toContain('NaN');
      expect(geo.points.every((pt) => Number.isFinite(pt.y) && Number.isFinite(pt.value))).toBe(
        true
      );
    });

    it('should_handle_empty_samples_gracefully', () => {
      const geo = buildTimeSeriesGeometry([], 400, 120);
      expect(geo.points).toEqual([]);
      expect(geo.linePath).toBe('');
      expect(geo.areaPath).toBe('');
    });
  });
});
