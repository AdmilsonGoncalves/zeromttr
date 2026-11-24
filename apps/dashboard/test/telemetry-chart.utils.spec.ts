import { describe, expect, it } from 'vitest';
import {
  buildGaugeArcGeometry,
  buildSparklineGeometry,
  buildTimeSeriesGeometry
} from '../src/app/core/telemetry-chart.utils.js';

describe('telemetry-chart.utils', () => {
  describe('buildSparklineGeometry', () => {
    it('should_return_empty_paths_when_values_array_is_empty', () => {
      const geo = buildSparklineGeometry([], 120, 28);
      expect(geo.linePath).toBe('');
      expect(geo.areaPath).toBe('');
      expect(geo.min).toBe(0);
      expect(geo.max).toBe(0);
    });

    it('should_render_horizontal_sparkline_for_single_sample_without_nan', () => {
      const geo = buildSparklineGeometry([12.5], 120, 28, { min: 0, max: 25 });
      expect(geo.linePath).toMatch(/^M 0,\d+(\.\d+)? L 120,\d+(\.\d+)?$/);
      expect(geo.areaPath).toContain('Z');
      expect(Number.isFinite(geo.lastX)).toBe(true);
      expect(Number.isFinite(geo.lastY)).toBe(true);
    });

    it('should_scale_multi_point_series_from_left_to_right_within_bounds', () => {
      const geo = buildSparklineGeometry([0, 50, 100], 100, 30, { min: 0, max: 100 });
      expect(geo.linePath.startsWith('M 0,')).toBe(true);
      expect(geo.lastX).toBe(100);
      expect(geo.lastY).toBeLessThan(10);
      expect(geo.min).toBe(0);
      expect(geo.max).toBe(100);
    });
  });

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

    it('should_handle_empty_samples_gracefully', () => {
      const geo = buildTimeSeriesGeometry([], 400, 120);
      expect(geo.points).toEqual([]);
      expect(geo.linePath).toBe('');
      expect(geo.areaPath).toBe('');
    });
  });

  describe('buildGaugeArcGeometry', () => {
    it('should_clamp_percent_and_produce_valid_svg_arc_paths', () => {
      const zero = buildGaugeArcGeometry(-10);
      expect(zero.clampedPercent).toBe(0);
      expect(zero.trackPath).toContain('A ');
      expect(zero.valuePath).toBe('');

      const half = buildGaugeArcGeometry(50);
      expect(half.clampedPercent).toBe(50);
      expect(half.valuePath).toContain('A ');

      const over = buildGaugeArcGeometry(150);
      expect(over.clampedPercent).toBe(100);
      expect(over.valuePath).toContain('A ');
    });
  });
});
