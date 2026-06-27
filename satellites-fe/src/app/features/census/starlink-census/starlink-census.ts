import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { SatelliteService } from '../../../core/services/satellite.service';
import { StarlinkCensusResult } from '../../../core/models/satellite.model';

@Component({
  selector: 'app-starlink-census',
  imports: [CommonModule, DecimalPipe, DatePipe],
  templateUrl: './starlink-census.html',
  styleUrl: './starlink-census.scss',
})
export class StarlinkCensus implements OnInit {
  private readonly service = inject(SatelliteService);

  readonly censusData = signal<StarlinkCensusResult | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly activeTab = signal<'metrics' | 'launches' | 'critical'>('metrics');

  // Interactive Chart Tooltip
  readonly hoveredPoint = signal<{ name: string; alt: number; date: Date; x: number; y: number } | null>(null);

  ngOnInit(): void {
    this.loadCensus();
  }

  loadCensus(): void {
    this.loading.set(true);
    this.error.set(null);

    this.service.getStarlinkCensus().subscribe({
      next: (data) => {
        this.censusData.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('[StarlinkCensus] Error fetching census data:', err);
        this.error.set(err?.error?.error ?? err?.message ?? 'Error cargando datos de Starlink');
        this.loading.set(false);
      },
    });
  }

  // Helper to generate SVG path for the Ascent Profile
  get svgPath(): string {
    const data = this.censusData();
    if (!data || !data.recentLaunches || data.recentLaunches.length === 0) return '';

    // Sort by epoch ascending (chronological order)
    const sorted = [...data.recentLaunches].sort((a, b) => a.epochMs - b.epochMs);
    const w = 600;
    const h = 220;
    const padding = 30;

    const minAlt = 250;
    const maxAlt = 560;

    const points = sorted.map((sat, i) => {
      const x = padding + (i / (sorted.length - 1)) * (w - 2 * padding);
      // Map alt to height (higher altitude -> lower Y coordinate in SVG)
      const y = h - padding - ((sat.altKm - minAlt) / (maxAlt - minAlt)) * (h - 2 * padding);
      return { x, y };
    });

    return points.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      // Smooth curve using cubic bezier control points or simple line
      return `${acc} L ${p.x} ${p.y}`;
    }, '');
  }

  get chartPoints() {
    const data = this.censusData();
    if (!data || !data.recentLaunches || data.recentLaunches.length === 0) return [];

    const sorted = [...data.recentLaunches].sort((a, b) => a.epochMs - b.epochMs);
    const w = 600;
    const h = 220;
    const padding = 30;

    const minAlt = 250;
    const maxAlt = 560;

    return sorted.map((sat, i) => {
      const x = padding + (i / (sorted.length - 1)) * (w - 2 * padding);
      const y = h - padding - ((sat.altKm - minAlt) / (maxAlt - minAlt)) * (h - 2 * padding);
      return {
        x,
        y,
        name: sat.name,
        alt: sat.altKm,
        date: new Date(sat.epochMs),
      };
    });
  }

  showTooltip(event: MouseEvent, pt: any): void {
    this.hoveredPoint.set({
      name: pt.name,
      alt: pt.alt,
      date: pt.date,
      x: pt.x,
      y: pt.y - 10,
    });
  }

  hideTooltip(): void {
    this.hoveredPoint.set(null);
  }
}
