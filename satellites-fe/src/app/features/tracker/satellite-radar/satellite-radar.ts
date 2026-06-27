import {
  Component,
  computed,
  effect,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SatellitePass } from '../../../core/models/satellite.model';

@Component({
  selector: 'app-satellite-radar',
  imports: [DecimalPipe, DatePipe, FormsModule],
  templateUrl: './satellite-radar.html',
  styleUrl: './satellite-radar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SatelliteRadar {
  readonly pass = input.required<SatellitePass>();

  readonly currentIndex = signal<number>(0);

  readonly track = computed(() => this.pass().track || []);

  readonly currentPoint = computed(() => {
    const list = this.track();
    if (list.length === 0) return null;
    const idx = Math.min(this.currentIndex(), list.length - 1);
    return list[idx] || list[0];
  });

  readonly activeCelestialBodies = computed(() => {
    const bodies = this.pass().celestialBodies || [];
    return bodies.filter((b) => b.el_deg >= 0);
  });

  // Coordinates helper
  getCoords(az: number, el: number): { x: number; y: number } {
    const R = 120; // Radar radius in SVG pixels
    const cx = 150; // Center X
    const cy = 150; // Center Y
    const clampedEl = Math.max(0, el);
    const r = R * ((90 - clampedEl) / 90);
    // Convert azimuth to radians (0 deg is North/UP, 90 deg is East/RIGHT)
    const phi = (90 - az) * (Math.PI / 180);
    return {
      x: cx + r * Math.cos(phi),
      y: cy - r * Math.sin(phi),
    };
  };

  // Convert SVG coordinate for track path
  readonly trackPath = computed(() => {
    const list = this.track();
    if (list.length === 0) return '';
    return list
      .map((p, idx) => {
        const c = this.getCoords(p.az_deg, p.el_deg);
        return `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
      })
      .join(' ');
  });

  // Calculate coordinates for cardinal marks
  readonly cardinalCoords = computed(() => {
    return {
      N: this.getCoords(0, 0),
      E: this.getCoords(90, 0),
      S: this.getCoords(180, 0),
      O: this.getCoords(270, 0),
    };
  });

  // Calculate coordinate for yellow arrow pointer
  readonly pointerCoords = computed(() => {
    const pt = this.currentPoint();
    if (!pt) return null;
    return this.getCoords(pt.az_deg, pt.el_deg);
  });

  // Calculate points for the yellow arrowhead pointing outwards
  readonly arrowheadPoints = computed(() => {
    const coords = this.pointerCoords();
    if (!coords) return '';
    const cx = 150;
    const cy = 150;
    const dx = coords.x - cx;
    const dy = coords.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return ''; // Near zenith, no arrow direction needed

    const ux = dx / dist;
    const uy = dy / dist;
    const px = -uy;
    const py = ux;

    const tipX = coords.x;
    const tipY = coords.y;
    const baseX = coords.x - 10 * ux;
    const baseY = coords.y - 10 * uy;

    const leftX = baseX + 5 * px;
    const leftY = baseY + 5 * py;
    const rightX = baseX - 5 * px;
    const rightY = baseY - 5 * py;

    return `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`;
  });

  // Position for start, max, and end labels
  readonly pathMarks = computed(() => {
    const p = this.pass();
    const list = this.track();
    if (list.length === 0) return null;

    const riseC = this.getCoords(p.rise.az_deg, p.rise.el_deg);
    const peakC = this.getCoords(p.peak.az_deg, p.peak.el_deg);
    const setC = this.getCoords(p.set.az_deg, p.set.el_deg);

    return {
      rise: { x: riseC.x, y: riseC.y, time: p.rise.time, az: p.rise.az_deg },
      peak: { x: peakC.x, y: peakC.y, time: p.peak.time, az: p.peak.az_deg },
      set: { x: setC.x, y: setC.y, time: p.set.time, az: p.set.az_deg },
    };
  });

  // Reset index when pass changes
  constructor() {
    effect(() => {
      this.pass();
      this.currentIndex.set(0);
    });
  }

  // cardinal direction label helper
  azToCardinal(az: number): string {
    const CARDINAL = [
      'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'
    ];
    return CARDINAL[Math.round(az / 22.5) % 16]!;
  }
}
