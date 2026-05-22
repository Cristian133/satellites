import { Injectable, NgZone, inject, signal, computed, OnDestroy } from '@angular/core';

export interface PerformanceMetrics {
  fps: number;
  memoryMb: number | null;
  cdCyclesPerSec: number;
  activeStressSatellites: number;
}

@Injectable({
  providedIn: 'root'
})
export class PerformanceMonitorService implements OnDestroy {
  private readonly ngZone = inject(NgZone);

  // Signals para las métricas reactivas
  private readonly _fps = signal(60);
  private readonly _memoryMb = signal<number | null>(null);
  private readonly _cdCyclesCount = signal(0);
  private readonly _cdCyclesPerSec = signal(0);
  private readonly _stressCount = signal(0);

  // Selectores reactivos públicos
  readonly fps = computed(() => this._fps());
  readonly memoryMb = computed(() => this._memoryMb());
  readonly cdCyclesPerSec = computed(() => this._cdCyclesPerSec());
  readonly activeStressSatellites = computed(() => this._stressCount());

  private animationFrameId: number | null = null;
  private intervalId: any = null;
  private stressEntities: any[] = [];

  constructor() {
    this.startMonitoring();
  }

  ngOnDestroy(): void {
    this.stopMonitoring();
  }

  /**
   * Incrementa el contador de ciclos de Detección de Cambios.
   * Se invoca desde los hooks del ciclo de vida del componente (ej. ngDoCheck).
   */
  recordCdCycle(): void {
    this._cdCyclesCount.update(c => c + 1);
  }

  /**
   * Activa el loop de monitoreo corriendo FUERA de la zona de Angular
   * para evitar disparar bucles infinitos de change detection.
   */
  private startMonitoring(): void {
    this.ngZone.runOutsideAngular(() => {
      // 1. Monitoreo de FPS a través de requestAnimationFrame
      let lastTime = performance.now();
      let frameCount = 0;

      const measureFps = (now: number) => {
        frameCount++;
        const delta = now - lastTime;

        if (delta >= 1000) {
          const currentFps = Math.round((frameCount * 1000) / delta);
          this._fps.set(Math.min(currentFps, 60)); // Tope de refresco a 60
          frameCount = 0;
          lastTime = now;
        }
        this.animationFrameId = requestAnimationFrame(measureFps);
      };
      this.animationFrameId = requestAnimationFrame(measureFps);

      // 2. Monitoreo de Memoria y Ciclos de CD cada 1 segundo
      this.intervalId = setInterval(() => {
        // Medir memoria si está soportado en el navegador (Chrome/Edge)
        const perf = performance as any;
        if (perf.memory) {
          const usedMemory = Math.round(perf.memory.usedJSHeapSize / (1024 * 1024));
          this._memoryMb.set(usedMemory);
        } else {
          this._memoryMb.set(null);
        }

        // Medir y reiniciar frecuencia de CD por segundo
        const currentCd = this._cdCyclesCount();
        this._cdCyclesPerSec.set(currentCd);
        this._cdCyclesCount.set(0);
      }, 1000);
    });
  }

  private stopMonitoring(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Ejecuta un Test de Estrés inyectando satélites artificiales animados
   * directamente en la escena de Cesium.
   */
  startStressTest(viewer: any, count: number): void {
    this.ngZone.runOutsideAngular(() => {
      // Limpiar test anterior si existe
      this.stopStressTest(viewer);

      if (count <= 0) return;

      console.log(`Iniciando Stress Test: Añadiendo ${count} entidades satelitales a Cesium...`);
      
      // Importar dinámicamente o usar referencias de Cesium cargadas globalmente
      // Para mayor robustez, creamos entidades animadas con CallbackProperty
      const Color = (window as any).Cesium?.Color || {
        fromRandom: () => ({ withAlpha: () => null })
      };
      const Cartesian3 = (window as any).Cesium?.Cartesian3;
      const NearFarScalar = (window as any).Cesium?.NearFarScalar;
      
      const newEntities: any[] = [];
      const startTime = Date.now();

      for (let i = 0; i < count; i++) {
        // Parámetros orbitales aleatorios
        const inclination = Math.random() * Math.PI;
        const raan = Math.random() * Math.PI * 2;
        const altitude = 400 + Math.random() * 2000; // km
        const periodMs = 60000 + Math.random() * 120000; // velocidad exagerada para animación rápida
        const satColor = Color.fromRandom({ alpha: 1.0 });

        const entity = viewer.entities.add({
          name: `STRESS-SAT-${i}`,
          position: new (window as any).Cesium.CallbackProperty((time: any, result: any) => {
            // Calcular posición circular 3D dinámica en función del tiempo transcurrido
            const elapsed = (Date.now() - startTime) / periodMs;
            const angle = elapsed * Math.PI * 2;

            // Rotaciones 3D sencillas para simular órbitas inclinadas
            const r = 6378.137 + altitude; // Radio terrestre + altitud
            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle) * Math.cos(inclination);
            const z = r * Math.sin(angle) * Math.sin(inclination);

            // Rotar sobre RAAN (eje Z)
            const rx = x * Math.cos(raan) - y * Math.sin(raan);
            const ry = x * Math.sin(raan) + y * Math.cos(raan);
            const rz = z;

            return Cartesian3.fromKilometers(rx, ry, rz, viewer.scene.globe.ellipsoid, result);
          }, false),
          point: {
            pixelSize: 6,
            color: satColor,
            outlineColor: Color.BLACK,
            outlineWidth: 1,
            scaleByDistance: new NearFarScalar(1.5e2, 2.0, 1.5e7, 0.5),
          }
        });

        newEntities.push(entity);
      }

      this.stressEntities = newEntities;
      this._stressCount.set(count);
    });
  }

  /**
   * Elimina todos los satélites inyectados por el Test de Estrés.
   */
  stopStressTest(viewer: any): void {
    if (this.stressEntities.length === 0) return;

    this.ngZone.runOutsideAngular(() => {
      console.log(`Deteniendo Stress Test: Eliminando ${this.stressEntities.length} entidades de Cesium...`);
      for (const entity of this.stressEntities) {
        viewer.entities.remove(entity);
      }
      this.stressEntities = [];
      this._stressCount.set(0);
    });
  }
}
