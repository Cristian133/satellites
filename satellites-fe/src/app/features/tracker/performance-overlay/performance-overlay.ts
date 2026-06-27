import { Component, ChangeDetectionStrategy, inject, input, signal, computed, DoCheck } from '@angular/core';
import { PerformanceMonitorService } from '../../../core/services/performance-monitor.service';

@Component({
  selector: 'app-performance-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="perf-card" role="status" aria-label="Tablero de telemetría de rendimiento">
      <!-- Encabezado con efecto de brillo -->
      <div class="perf-header">
        <div class="header-title">
          <span class="pulse-dot" [class.stressed]="isStressed()"></span>
          <h3>TELEMETRÍA DE RENDIMIENTO</h3>
        </div>
        <button class="toggle-btn" (click)="toggleExpand()" [attr.aria-expanded]="expanded()" aria-label="Minimizar panel">
          {{ expanded() ? '▼' : '▲' }}
        </button>
      </div>

      @if (expanded()) {
        <div class="perf-body">
          <!-- Métrica 1: FPS -->
          <div class="metric-row">
            <span class="label">Tasa de Refresco:</span>
            <span class="value" [class.low-fps]="fps() < 30" [class.med-fps]="fps() >= 30 && fps() < 55">
              {{ fps() }} FPS
            </span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar fps-bar" [style.width.%]="(fps() / 60) * 100" [class.warning]="fps() < 45" [class.critical]="fps() < 30"></div>
          </div>

          <!-- Métrica 2: Angular Change Detection -->
          <div class="metric-row">
            <span class="label">Ciclos de Detección (CD):</span>
            <span class="value" [class.high-cd]="cdCycles() > 10">
              {{ cdCycles() }}/s
            </span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar cd-bar" [style.width.%]="mathMin((cdCycles() / 15) * 100, 100)" [class.critical]="cdCycles() > 10"></div>
          </div>

          <!-- Métrica 3: Memoria (si está disponible) -->
          @if (memoryMb() !== null) {
            <div class="metric-row">
              <span class="label">Memoria JS Heap:</span>
              <span class="value">{{ memoryMb() }} MB</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar mem-bar" [style.width.%]="mathMin((memoryMb()! / 500) * 100, 100)"></div>
            </div>
          } @else {
            <div class="metric-row unavailable">
              <span class="label">Memoria JS Heap:</span>
              <span class="value">No soportado</span>
            </div>
          }

          <!-- Sección de Test de Estrés (Stress Test GPU/CPU) -->
          <div class="stress-section">
            <h4>Test de Estrés de Renderizado (Cesium)</h4>
            <p class="stress-desc">
              Inyecta satélites en tiempo real para evaluar el rendimiento físico y gráfico en la GPU.
            </p>

            <div class="stress-controls">
              <button class="stress-btn" [class.active]="activeStress() === 100" (click)="triggerStress(100)">+100 Sat</button>
              <button class="stress-btn" [class.active]="activeStress() === 500" (click)="triggerStress(500)">+500 Sat</button>
              <button class="stress-btn alert" [class.active]="activeStress() === 2000" (click)="triggerStress(2000)">+2000 Sat</button>
            </div>

            @if (activeStress() > 0) {
              <div class="stress-status">
                <span class="stress-active-label">Satélites simulados:</span>
                <span class="stress-active-val">{{ activeStress() }}</span>
                <button class="stop-btn" (click)="stopStress()">Detener Test</button>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 1000;
      pointer-events: auto;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .perf-card {
      width: 290px;
      background: rgba(10, 15, 28, 0.72);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      color: #e2e8f0;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
      padding: 14px;
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      overflow: hidden;
    }

    .perf-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: #10b981; /* Verde */
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.6s infinite ease-in-out;
    }

    .pulse-dot.stressed {
      background-color: #ef4444; /* Rojo */
      box-shadow: 0 0 8px #ef4444;
    }

    h3 {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #94a3b8;
    }

    .toggle-btn {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 10px;
      padding: 2px 6px;
      transition: color 0.2s;
    }

    .toggle-btn:hover {
      color: #cbd5e1;
    }

    .perf-body {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: slideDown 0.2s ease-out;
    }

    .metric-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }

    .metric-row.unavailable {
      opacity: 0.5;
    }

    .label {
      color: #94a3b8;
    }

    .value {
      font-family: monospace;
      font-weight: 700;
      color: #38bdf8; /* Celeste */
    }

    .low-fps {
      color: #f87171 !important; /* Rojo */
    }

    .med-fps {
      color: #fbbf24 !important; /* Ámbar */
    }

    .high-cd {
      color: #fb7185 !important; /* Rosa/Alerta */
    }

    .progress-bar-container {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 2px;
      overflow: hidden;
      margin-top: -4px;
    }

    .progress-bar {
      height: 100%;
      border-radius: 2px;
      transition: width 0.4s cubic-bezier(0.1, 0.8, 0.2, 1);
    }

    .fps-bar {
      background: linear-gradient(90deg, #3b82f6, #10b981);
    }

    .fps-bar.warning {
      background: #fbbf24;
    }

    .fps-bar.critical {
      background: #ef4444;
    }

    .cd-bar {
      background: #818cf8;
    }

    .cd-bar.critical {
      background: #f43f5e;
    }

    .mem-bar {
      background: #a855f7;
    }

    .stress-section {
      margin-top: 6px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 8px;
    }

    h4 {
      margin: 0 0 4px 0;
      font-size: 11px;
      font-weight: 600;
      color: #cbd5e1;
    }

    .stress-desc {
      margin: 0 0 10px 0;
      font-size: 10px;
      color: #64748b;
      line-height: 1.4;
    }

    .stress-controls {
      display: flex;
      gap: 6px;
    }

    .stress-btn {
      flex: 1;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      padding: 6px 0;
      font-size: 10px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .stress-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.16);
      color: #fff;
    }

    .stress-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: #38bdf8;
      color: #38bdf8;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
    }

    .stress-btn.alert.active {
      background: rgba(244, 63, 94, 0.15);
      border-color: #f43f5e;
      color: #f43f5e;
      box-shadow: 0 0 8px rgba(244, 63, 94, 0.25);
    }

    .stress-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 11px;
    }

    .stress-active-label {
      color: #94a3b8;
    }

    .stress-active-val {
      font-weight: 700;
      color: #ef4444;
      font-family: monospace;
    }

    .stop-btn {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      font-size: 10px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }

    .stop-btn:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.5);
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
    }

    @keyframes slideDown {
      from { height: 0; opacity: 0; }
      to { height: auto; opacity: 1; }
    }
  `]
})
export class PerformanceOverlay implements DoCheck {
  readonly viewer = input<any>();

  private readonly perfService = inject(PerformanceMonitorService);

  readonly expanded = signal(true);

  // Exponer señales del servicio de rendimiento
  readonly fps = this.perfService.fps;
  readonly memoryMb = this.perfService.memoryMb;
  readonly cdCycles = this.perfService.cdCyclesPerSec;
  readonly activeStress = this.perfService.activeStressSatellites;

  readonly isStressed = computed(() => this.activeStress() > 0);

  /**
   * Se ejecuta en cada ciclo de detección de cambios de Angular.
   * Nos permite registrar y contabilizar los ciclos del framework.
   */
  ngDoCheck(): void {
    this.perfService.recordCdCycle();
  }

  toggleExpand(): void {
    this.expanded.update(e => !e);
  }

  triggerStress(count: number): void {
    const v = this.viewer();
    if (v) {
      this.perfService.startStressTest(v, count);
    } else {
      console.warn('[PerformanceOverlay] El visor de Cesium no está disponible aún.');
    }
  }

  stopStress(): void {
    const v = this.viewer();
    if (v) {
      this.perfService.stopStressTest(v);
    }
  }

  // Helpers para usar en el template
  mathMin(a: number, b: number): number {
    return Math.min(a, b);
  }
}
