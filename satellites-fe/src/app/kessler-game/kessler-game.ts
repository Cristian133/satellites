import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  computed,
  ViewChild,
} from '@angular/core';
import { DecimalPipe, PercentPipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  buildModuleUrl,
  Cartesian3,
  Color,
  Math as CesiumMath,
  PointPrimitive,
  PointPrimitiveCollection,
  TileMapServiceImageryProvider,
  ImageryLayer,
  Viewer,
} from 'cesium';

interface PlayerState {
  name: string;
  activeSatellites: number;
  cumulativeProfit: number;
  lastTurnProfit: number;
  lastEcoPercentage: number;
  lastLaunchVolume: number;
  color: Color;
  cssColor: string;
}

interface HistoryRecord {
  year: number;
  debris: number;
  collisionRisk: number;
  alphaSatellites: number;
  betaSatellites: number;
  gammaSatellites: number;
  alphaProfit: number;
  betaProfit: number;
  gammaProfit: number;
}

interface OrbitParticle {
  id: string;
  type: 'alpha' | 'beta' | 'gamma' | 'debris';
  semiMajorAxis: number;
  inclination: number;
  raan: number; // Right ascension of ascending node
  meanAnomaly: number; // Current angle in orbit
  speed: number;
  primitive: PointPrimitive;
}

@Component({
  selector: 'app-kessler-game',
  imports: [FormsModule, DecimalPipe, PercentPipe, CurrencyPipe],
  templateUrl: './kessler-game.html',
  styleUrl: './kessler-game.scss',
})
export class KesslerGame implements AfterViewInit, OnDestroy {
  private readonly ngZone = inject(NgZone);

  @ViewChild('cesiumContainer', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;

  private viewer?: Viewer;
  private pointPrimitives?: PointPrimitiveCollection;
  private particles: OrbitParticle[] = [];
  private renderListener?: () => void;
  private animationFrameId?: number;

  // ── CONFIGURACIÓN DEL JUEGO ──
  readonly gameMode = signal<'setup' | 'running' | 'gameover' | 'victory'>('setup');
  
  // Parámetros iniciales
  readonly targetYears = signal<number>(20); // Límite de años configurable
  readonly baseDebris = signal<number>(800); // Escombros iniciales

  // Estado del juego
  readonly currentYear = signal<number>(2026);
  readonly startYear = 2026;
  readonly debrisCount = signal<number>(800);
  readonly collisionRisk = computed(() => {
    const debris = this.debrisCount();
    // Probabilidad de colisión anual por satélite: P_c = 1 - e^(-lambda * Debris)
    const risk = 1 - Math.exp(-0.00018 * debris);
    return Math.min(risk, 0.95);
  });

  // Logs didácticos de eventos
  readonly gameLogs = signal<string[]>([
    'Bienvenido al Simulador de Kessler.',
    'Establece el Tratado de Duración y haz clic en "Iniciar Simulación" para comenzar.'
  ]);

  // Historial para gráficas o análisis
  readonly history = signal<HistoryRecord[]>([]);

  // Regulación
  readonly regulatorTax = signal<number>(0); // Impuesto de desorbita ($0k a $60k por satélite barato)

  // Jugadores (Signals de estado)
  readonly alpha = signal<PlayerState>({
    name: 'AlphaNet (Tú)',
    activeSatellites: 150,
    cumulativeProfit: 0,
    lastTurnProfit: 0,
    lastEcoPercentage: 100,
    lastLaunchVolume: 100,
    color: Color.SPRINGGREEN,
    cssColor: '#00ff7f',
  });

  readonly beta = signal<PlayerState>({
    name: 'BetaNet (IA Reactiva)',
    activeSatellites: 150,
    cumulativeProfit: 0,
    lastTurnProfit: 0,
    lastEcoPercentage: 80,
    lastLaunchVolume: 100,
    color: Color.CYAN,
    cssColor: '#00ffff',
  });

  readonly gamma = signal<PlayerState>({
    name: 'GammaNet (IA Egoísta)',
    activeSatellites: 150,
    cumulativeProfit: 0,
    lastTurnProfit: 0,
    lastEcoPercentage: 40,
    lastLaunchVolume: 150,
    color: Color.DODGERBLUE,
    cssColor: '#1e90ff',
  });

  // Decisiones de este turno del Usuario
  readonly userLaunchVolume = signal<number>(100);
  readonly userEcoPercentage = signal<number>(100);
  readonly userCleanBudget = signal<number>(0); // En Millones ($M)

  // ── MATRIZ DE TEORÍA DE JUEGOS DINÁMICA ──
  // Calcula los pagos esperados para un lanzamiento estándar de 100 satélites
  // en función del nivel de escombros actual y del impuesto regulador.
  readonly payoffMatrix = computed(() => {
    const _debris = this.debrisCount(); // read to establish reactive dependency
    const risk = this.collisionRisk();
    const tax = this.regulatorTax() * 1000; // a dólares

    // Constantes financieras
    const revPerSat = 15000;
    const costEco = 130000;
    const costCheap = 100000 + tax;
    const colPenalty = 200000;

    // Escenarios de colisión estimados por cuadrante (adicional a fallos técnicos)
    // 1. Ambos Eco: Riesgo de basura esp. bajo (+0.02 al riesgo base)
    const riskBothEco = risk * 0.9;
    // 2. Uno Eco, Uno Cheap: Riesgo medio (+0.06)
    const riskOneCheap = risk * 1.2;
    // 3. Ambos Cheap: Riesgo severo (+0.12)
    const riskBothCheap = risk * 1.6;

    // Calcular pagos netos esperados por satélite lanzado en 1 año
    // Pago = Ingreso - Costo - PérdidaEsperadaPorColision
    // (Pérdida esperada = Probabilidad de colisión * Costo del satélite + multa)

    // CUADRANTE: Ambos Sostenible (Eco, Eco)
    const valBothEco = revPerSat - (costEco / 10) - (riskBothEco * colPenalty); // costo amortizado en 10 años
    
    // CUADRANTE: Tú Eco, Competidor Egoísta (Eco, Cheap)
    const valYouEcoCompCheap = revPerSat - (costEco / 10) - (riskOneCheap * colPenalty);
    const valCompCheapYouEco = revPerSat - (costCheap / 10) - (riskOneCheap * colPenalty);

    // CUADRANTE: Tú Egoísta, Competidor Eco (Cheap, Eco)
    const valYouCheapCompEco = revPerSat - (costCheap / 10) - (riskOneCheap * colPenalty);
    const valCompEcoYouCheap = revPerSat - (costEco / 10) - (riskOneCheap * colPenalty);

    // CUADRANTE: Ambos Egoístas (Cheap, Cheap)
    const valBothCheap = revPerSat - (costCheap / 10) - (riskBothCheap * colPenalty);

    // Escalar a 100 satélites para que se vea más impactante ($M)
    const scale = 100 / 1000000;

    // Estructurar matriz
    const matrix = {
      ecoEco: { you: valBothEco * scale * 10, comp: valBothEco * scale * 10 },
      ecoCheap: { you: valYouEcoCompCheap * scale * 10, comp: valCompCheapYouEco * scale * 10 },
      cheapEco: { you: valYouCheapCompEco * scale * 10, comp: valCompEcoYouCheap * scale * 10 },
      cheapCheap: { you: valBothCheap * scale * 10, comp: valBothCheap * scale * 10 },
      nash: 'Egoísta / Egoísta',
      pareto: 'Sostenible / Sostenible',
    };

    // Determinar Nash Equilibrium analíticamente
    // Si valYouCheapCompEco > valBothEco (Egoísta domina a Sostenible cuando el otro es Eco)
    // Y valBothCheap > valYouEcoCompCheap (Egoísta domina a Sostenible cuando el otro es Egoísta)
    // Entonces Egoísta/Egoísta es el Nash.
    // Si el impuesto es muy alto, Sostenible/Sostenible puede convertirse en Nash!
    const youPreferCheapIfEco = valYouCheapCompEco > valBothEco;
    const youPreferCheapIfCheap = valBothCheap > valYouEcoCompCheap;
    const compPreferCheapIfEco = valCompCheapYouEco > valBothEco;
    const compPreferCheapIfCheap = valBothCheap > valCompEcoYouCheap;

    if (!youPreferCheapIfEco && !youPreferCheapIfCheap && !compPreferCheapIfEco && !compPreferCheapIfCheap) {
      matrix.nash = 'Sostenible / Sostenible';
    } else if (youPreferCheapIfEco && youPreferCheapIfCheap && compPreferCheapIfEco && compPreferCheapIfCheap) {
      matrix.nash = 'Egoísta / Egoísta';
    } else {
      matrix.nash = 'Mixto / Inestable';
    }

    return matrix;
  });

  // ── INICIALIZACIÓN ──
  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.initCesium();
      this.generateInitialParticles();
      this.startOrbitalAnimation();
    });
  }

  ngOnDestroy(): void {
    if (this.renderListener) {
      this.renderListener();
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
  }

  private initCesium(): void {
    this.viewer = new Viewer(this.containerRef.nativeElement, {
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(
          buildModuleUrl('Assets/Textures/NaturalEarthII/'),
          { fileExtension: 'jpg' }
        )
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
    });

    this.viewer.scene.globe.depthTestAgainstTerrain = false;
    this.viewer.scene.globe.enableLighting = true;

    // Configurar cámara inicial elevada para ver órbita LEO completa
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-30, 15, 14000000), // 14,000 km altitud
    });

    // Colección de Point Primitives para alto rendimiento
    this.pointPrimitives = this.viewer.scene.primitives.add(
      new PointPrimitiveCollection()
    );
  }

  // ── LÓGICA DE SIMULACIÓN ORBITAL (CESIUM RENDERING) ──

  private generateInitialParticles(): void {
    if (!this.pointPrimitives) return;

    this.particles = [];
    this.pointPrimitives.removeAll();

    // 1. Satélites Alpha (Tú) - Verdes
    this.spawnSatellites(this.alpha().activeSatellites, 'alpha', Color.SPRINGGREEN);
    // 2. Satélites Beta (IA 1) - Cian
    this.spawnSatellites(this.beta().activeSatellites, 'beta', Color.CYAN);
    // 3. Satélites Gamma (IA 2) - Azul
    this.spawnSatellites(this.gamma().activeSatellites, 'gamma', Color.DODGERBLUE);
    // 4. Escombros iniciales - Rojos
    this.spawnDebris(this.baseDebris());
  }

  private spawnSatellites(count: number, type: 'alpha' | 'beta' | 'gamma', color: Color): void {
    if (!this.pointPrimitives) return;

    for (let i = 0; i < count; i++) {
      // Órbitas circulares aleatorias en LEO (altitud 400 a 900 km)
      const alt = 400 + Math.random() * 500;
      const semiMajorAxis = 6371 + alt; // Radio Tierra + Altitud
      const inclination = CesiumMath.toRadians(30 + Math.random() * 60); // 30 a 90 grados
      const raan = Math.random() * Math.PI * 2;
      const meanAnomaly = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.01; // velocidad de rotación angular

      const primitive = this.pointPrimitives.add({
        position: Cartesian3.ZERO,
        color: color,
        pixelSize: 4.5,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
      });

      this.particles.push({
        id: `${type}-${i}-${Math.random()}`,
        type,
        semiMajorAxis,
        inclination,
        raan,
        meanAnomaly,
        speed,
        primitive,
      });
    }
  }

  private spawnDebris(count: number): void {
    if (!this.pointPrimitives) return;

    const redColor = Color.RED.clone();

    for (let i = 0; i < count; i++) {
      const alt = 350 + Math.random() * 650; // Órbita LEO algo más dispersa
      const semiMajorAxis = 6371 + alt;
      const inclination = CesiumMath.toRadians(Math.random() * 180); // Inclinación caótica (0 a 180)
      const raan = Math.random() * Math.PI * 2;
      const meanAnomaly = Math.random() * Math.PI * 2;
      const speed = 0.03 + Math.random() * 0.02; // Escombros a veces más rápidos o erráticos

      const primitive = this.pointPrimitives.add({
        position: Cartesian3.ZERO,
        color: redColor,
        pixelSize: 3,
      });

      this.particles.push({
        id: `debris-${i}-${Math.random()}`,
        type: 'debris',
        semiMajorAxis,
        inclination,
        raan,
        meanAnomaly,
        speed,
        primitive,
      });
    }
  }

  private startOrbitalAnimation(): void {
    const update = () => {
      if (!this.viewer || this.viewer.isDestroyed()) return;

      const pLength = this.particles.length;
      for (let i = 0; i < pLength; i++) {
        const p = this.particles[i];
        p.meanAnomaly += p.speed * 0.1; // Animación suave paso del tiempo

        // Ecuación paramétrica de órbita circular tridimensional
        const R = p.semiMajorAxis * 1000; // Convertir a metros para Cesium
        const theta = p.meanAnomaly;

        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        const cosRaan = Math.cos(p.raan);
        const sinRaan = Math.sin(p.raan);
        const cosInc = Math.cos(p.inclination);
        const sinInc = Math.sin(p.inclination);

        // Coordenadas cartesianas orbitales rotadas a ECEF simplificado
        const x = R * (cosTheta * cosRaan - sinTheta * sinRaan * cosInc);
        const y = R * (cosTheta * sinRaan + sinTheta * cosRaan * cosInc);
        const z = R * (sinTheta * sinInc);

        if (p.primitive) {
          p.primitive.position = new Cartesian3(x, y, z);
        }
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  // ── INICIAR JUEGO ──
  startGame(): void {
    this.debrisCount.set(this.baseDebris());
    this.currentYear.set(this.startYear);
    this.history.set([]);
    
    // Inicializar estados de los jugadores
    this.alpha.set({
      name: 'AlphaNet (Tú)',
      activeSatellites: 150,
      cumulativeProfit: 0,
      lastTurnProfit: 0,
      lastEcoPercentage: 100,
      lastLaunchVolume: 100,
      color: Color.SPRINGGREEN,
      cssColor: '#00ff7f',
    });

    this.beta.set({
      name: 'BetaNet (IA Reactiva)',
      activeSatellites: 150,
      cumulativeProfit: 0,
      lastTurnProfit: 0,
      lastEcoPercentage: 80,
      lastLaunchVolume: 100,
      color: Color.CYAN,
      cssColor: '#00ffff',
    });

    this.gamma.set({
      name: 'GammaNet (IA Egoísta)',
      activeSatellites: 150,
      cumulativeProfit: 0,
      lastTurnProfit: 0,
      lastEcoPercentage: 40,
      lastLaunchVolume: 150,
      color: Color.DODGERBLUE,
      cssColor: '#1e90ff',
    });

    this.gameLogs.set([
      `Simulación iniciada. Duración acordada: ${this.targetYears()} años.`,
      `Estado de LEO: ${this.debrisCount()} piezas de escombros en órbita. Riesgo de colisión base: ${(this.collisionRisk() * 100).toFixed(2)}%.`
    ]);

    this.ngZone.runOutsideAngular(() => {
      this.generateInitialParticles();
    });

    this.gameMode.set('running');
  }

  // ── AVANCE DEL TURNO (LOGICA DE TEORÍA DE JUEGOS Y FISICA) ──
  nextTurn(): void {
    if (this.gameMode() !== 'running') return;

    const year = this.currentYear();
    const debris = this.debrisCount();
    const cRisk = this.collisionRisk();
    const tax = this.regulatorTax() * 1000; // Impuesto por satélite barato ($)

    // 1. Obtener elecciones del usuario
    const userVol = this.userLaunchVolume();
    const userEco = this.userEcoPercentage();
    const userClean = this.userCleanBudget() * 1000000; // a dólares

    // 2. IA BetaNet (IA Reactiva / Adapta)
    // Sigue una estrategia de Tit-for-Tat / Cooperación Condicional:
    // Si el usuario coopera (>60% eco) BetaNet coopera y lanza de forma sostenible.
    // Si el usuario es egoísta, BetaNet responde bajando su estándar ecológico y lanzando más barato para no perder mercado.
    let betaVol = 100;
    let betaEco = 80;
    const lastUserEco = this.alpha().lastEcoPercentage;

    if (lastUserEco >= 70) {
      // El usuario cooperó, BetaNet coopera activamente e invierte algo en limpieza si la órbita peligra
      betaEco = Math.min(95, lastUserEco + 10);
      betaVol = debris > 1500 ? 50 : 100; // reduce lanzamientos si la órbita se congestiona
    } else {
      // Castigo por falta de cooperación del usuario
      betaEco = Math.max(20, lastUserEco - 10);
      betaVol = 150; // guerra de volumen barato
    }
    // Si el impuesto regulador es muy alto, incluso la IA reactiva se pasa a 100% Eco por viabilidad financiera
    if (tax >= 30000) betaEco = Math.max(betaEco, 90);
    
    // BetaNet también invierte en limpieza de forma pública si tiene ganancias acumuladas altas
    const betaClean = debris > 1800 && this.beta().cumulativeProfit > 15000000 ? 2000000 : 0;

    // 3. IA GammaNet (IA Egoísta / Oportunista)
    // Busca maximizar rentabilidad inmediata. Ignora sostenibilidad a menos que la órbita esté colapsando.
    let gammaVol = 150;
    let gammaEco = 30;
    if (debris > 2200) {
      gammaEco = 70; // sube estándar en pánico
      gammaVol = 50; // frena por colisiones
    } else if (debris > 1400) {
      gammaEco = 50;
      gammaVol = 100;
    }
    if (tax >= 40000) gammaEco = Math.max(gammaEco, 95); // la regulación los dobla
    const gammaClean = 0; // El polizón perfecto: jamás paga por limpiar basura, deja que otros lo hagan

    // 4. Cálculos del Bucle del Juego (Año por Año)
    const newLogs: string[] = [`=== AÑO SIMULADO: ${year} ===`];

    // Pérdidas por fallos técnicos estándar (durante el año)
    // Satélites baratos fallan 5% anual, eco 1%.
    const userCheapSats = userVol * (1 - userEco / 100);
    const _userEcoSats = userVol * (userEco / 100);
    const betaCheapSats = betaVol * (1 - betaEco / 100);
    const _betaEcoSats = betaVol * (betaEco / 100);
    const gammaCheapSats = gammaVol * (1 - gammaEco / 100);
    const _gammaEcoSats = gammaVol * (gammaEco / 100);

    // Nuevas partículas creadas por residuos técnicos estándar
    // Cheap sat fallidos van a escombros. Eco sat fallidos desorbitan a salvo (cero escombros).
    const newTechnicalDebris = 
      Math.round(userCheapSats * 0.05 * 50) + 
      Math.round(betaCheapSats * 0.05 * 50) + 
      Math.round(gammaCheapSats * 0.05 * 50);

    // 5. Simulación Estocástica de Colisiones (Kessler chain reaction)
    let userCollisions = 0;
    let betaCollisions = 0;
    let gammaCollisions = 0;

    const satsAlphaBefore = this.alpha().activeSatellites + userVol;
    const satsBetaBefore = this.beta().activeSatellites + betaVol;
    const satsGammaBefore = this.gamma().activeSatellites + gammaVol;

    // Ejecutar pruebas de colisión para cada satélite activo
    for (let i = 0; i < satsAlphaBefore; i++) {
      if (Math.random() < cRisk) userCollisions++;
    }
    for (let i = 0; i < satsBetaBefore; i++) {
      if (Math.random() < cRisk) betaCollisions++;
    }
    for (let i = 0; i < satsGammaBefore; i++) {
      if (Math.random() < cRisk) gammaCollisions++;
    }
    const totalCollisions = userCollisions + betaCollisions + gammaCollisions;

    // Nuevos escombros generados por colisiones (Kessler cascade)
    const newCollisionDebris = totalCollisions * 150;

    if (totalCollisions > 0) {
      newLogs.push(`⚠ ¡DESASTRE! Se detectaron ${totalCollisions} colisiones orbitales este año.`);
      if (userCollisions > 0) {
        newLogs.push(`💥 Tu empresa (AlphaNet) perdió ${userCollisions} satélites en colisiones.`);
      }
      if (betaCollisions > 0 || gammaCollisions > 0) {
        newLogs.push(`💥 Competidores perdieron ${betaCollisions + gammaCollisions} satélites combinados.`);
      }

      // Detonar visualización de explosiones en Cesium
      this.triggerCollisionVisualEffects(totalCollisions);
    } else {
      newLogs.push('✓ Órbita tranquila. No se registraron colisiones catastróficas este año.');
    }

    // 6. Impacto de la Limpieza (ADR)
    const totalCleanBudget = userClean + betaClean + gammaClean;
    const debrisCleaned = Math.round((totalCleanBudget / 10000000) * 50);
    
    if (debrisCleaned > 0) {
      newLogs.push(`♻ Las misiones de Limpieza Activa (ADR) retiraron ${debrisCleaned} piezas de basura espacial.`);
    }

    // 7. Actualización neta de escombros orbitales
    let currentDebris = Math.max(0, debris + newTechnicalDebris + newCollisionDebris - debrisCleaned);
    
    // Si Kessler está activo, la acumulación es masiva
    const isKesslerActive = currentDebris > 3000;
    if (isKesslerActive) {
      const cascadeDebris = Math.round(currentDebris * 0.12);
      currentDebris += cascadeDebris;
      newLogs.push(`🔥 ALERTA ROJA: Kessler activo. Choques en cadena añaden +${cascadeDebris} piezas de forma incontrolable.`);
    }

    this.debrisCount.set(currentDebris);

    // 8. Finanzas del Turno
    // Fórmulas financieras por jugador
    const calcTurnProfit = (
      initialSats: number,
      launched: number,
      ecoPct: number,
      destroyed: number,
      cleanBudget: number
    ) => {
      const activeEnd = Math.max(0, initialSats + launched - destroyed);
      
      // Ingresos: $15k por satélite activo
      const revenue = activeEnd * 15000;
      
      // Costos de lanzamiento
      const ecoCount = launched * (ecoPct / 100);
      const cheapCount = launched * (1 - ecoPct / 100);
      const launchCosts = (ecoCount * 130000) + (cheapCount * (100000 + tax));
      
      // Costos de mantenimiento anual
      const maintenance = activeEnd * 2000;

      // Penalizaciones por colisión ($200k por destrucción)
      const penalty = destroyed * 200000;

      return {
        profit: revenue - launchCosts - maintenance - penalty - cleanBudget,
        finalSats: activeEnd,
      };
    };

    const userResults = calcTurnProfit(this.alpha().activeSatellites, userVol, userEco, userCollisions, userClean);
    const betaResults = calcTurnProfit(this.beta().activeSatellites, betaVol, betaEco, betaCollisions, betaClean);
    const gammaResults = calcTurnProfit(this.gamma().activeSatellites, gammaVol, gammaEco, gammaCollisions, gammaClean);

    // Registrar logs de ganancias
    newLogs.push(`Finanzas de AlphaNet: Ganancia del turno: $${(userResults.profit / 1000000).toFixed(2)}M. Satélites activos: ${userResults.finalSats}.`);

    // Actualizar estados reactivos
    this.alpha.update((s) => ({
      ...s,
      activeSatellites: userResults.finalSats,
      lastTurnProfit: userResults.profit,
      cumulativeProfit: s.cumulativeProfit + userResults.profit,
      lastEcoPercentage: userEco,
      lastLaunchVolume: userVol,
    }));

    this.beta.update((s) => ({
      ...s,
      activeSatellites: betaResults.finalSats,
      lastTurnProfit: betaResults.profit,
      cumulativeProfit: s.cumulativeProfit + betaResults.profit,
      lastEcoPercentage: betaEco,
      lastLaunchVolume: betaVol,
    }));

    this.gamma.update((s) => ({
      ...s,
      activeSatellites: gammaResults.finalSats,
      lastTurnProfit: gammaResults.profit,
      cumulativeProfit: s.cumulativeProfit + gammaResults.profit,
      lastEcoPercentage: gammaEco,
      lastLaunchVolume: gammaVol,
    }));

    // 9. Actualizar historial de la gráfica
    this.history.update((h) => [
      ...h,
      {
        year: year,
        debris: currentDebris,
        collisionRisk: this.collisionRisk(),
        alphaSatellites: userResults.finalSats,
        betaSatellites: betaResults.finalSats,
        gammaSatellites: gammaResults.finalSats,
        alphaProfit: this.alpha().cumulativeProfit,
        betaProfit: this.beta().cumulativeProfit,
        gammaProfit: this.gamma().cumulativeProfit,
      },
    ]);

    // Combinar logs
    this.gameLogs.update((logs) => [...newLogs, ...logs]);

    // 10. Regenerar representación de Cesium
    this.ngZone.runOutsideAngular(() => {
      this.updateCesiumParticles();
    });

    // 11. Incrementar año y chequear fin de juego
    const nextYear = year + 1;
    this.currentYear.set(nextYear);

    const elapsed = nextYear - this.startYear;
    if (isKesslerActive && (userResults.finalSats === 0 && betaResults.finalSats === 0 && gammaResults.finalSats === 0)) {
      this.gameMode.set('gameover');
      this.gameLogs.update((logs) => [
        '☠ COLAPSO TOTAL. Kessler Syndrome ha inutilizado permanentemente la órbita terrestre. Todos los operadores espaciales se han ido a la bancarrota. La Tragedia de los Comunes ha vencido.',
        ...logs
      ]);
    } else if (elapsed >= this.targetYears()) {
      this.gameMode.set('victory');
      // Determinar quién tiene más ganancias
      const maxProf = Math.max(
        this.alpha().cumulativeProfit,
        this.beta().cumulativeProfit,
        this.gamma().cumulativeProfit
      );
      let winnerMsg = '';
      if (maxProf === this.alpha().cumulativeProfit) {
        winnerMsg = '🏆 ¡Victoria! Has ganado el tratado espacial, acumulando más ganancias que tus competidores.';
      } else {
        winnerMsg = '❌ Fin del tratado. Has sido superado financieramente por un competidor de IA.';
      }
      this.gameLogs.update((logs) => [winnerMsg, 'Fin del periodo establecido por el Tratado Internacional.', ...logs]);
    }
  }

  private updateCesiumParticles(): void {
    if (!this.pointPrimitives) return;

    // Volvemos a sincronizar los recuentos de partículas
    this.pointPrimitives.removeAll();
    this.particles = [];

    // Regenerar satélites de cada empresa según recuento actual
    this.spawnSatellites(this.alpha().activeSatellites, 'alpha', Color.SPRINGGREEN);
    this.spawnSatellites(this.beta().activeSatellites, 'beta', Color.CYAN);
    this.spawnSatellites(this.gamma().activeSatellites, 'gamma', Color.DODGERBLUE);

    // Regenerar escombros actuales
    this.spawnDebris(this.debrisCount());
  }

  // EFECTOS VISUALES DE EXPLOSIÓN EN CESIUM
  private triggerCollisionVisualEffects(collisionCount: number): void {
    if (!this.viewer) return;

    const count = Math.min(collisionCount, 4); // Capped para no congelar la pantalla
    for (let k = 0; k < count; k++) {
      // Pick a random orbital position to showcase an explosion
      const alt = 450 + Math.random() * 300;
      const r = (6371 + alt) * 1000;
      const angle = Math.random() * Math.PI * 2;
      const inc = Math.random() * Math.PI;

      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);
      const cosInc = Math.cos(inc);
      const sinInc = Math.sin(inc);

      const x = r * cosAngle * sinInc;
      const y = r * sinAngle * sinInc;
      const z = r * cosInc;

      const collPos = new Cartesian3(x, y, z);

      // Crear flash esférico naranja luminoso que crece y se disipa
      let scale = 1.0;
      const explosionEntity = this.viewer.entities.add({
        position: collPos,
        ellipsoid: {
          radii: new Cartesian3(150000, 150000, 150000), // 150km de radio inicial
          material: Color.ORANGERED.withAlpha(0.6),
          outline: false,
        },
      });

      // Animación del flash
      const pulseInterval = setInterval(() => {
        if (!this.viewer) {
          clearInterval(pulseInterval);
          return;
        }

        scale += 0.35;
        const currentRadius = 150000 * scale;
        const alpha = Math.max(0, 0.6 - (scale - 1) * 0.12);

        if (explosionEntity.ellipsoid) {
          explosionEntity.ellipsoid.radii = new Cartesian3(currentRadius, currentRadius, currentRadius) as any;
          explosionEntity.ellipsoid.material = Color.ORANGERED.withAlpha(alpha) as any;
        }

        if (alpha <= 0) {
          clearInterval(pulseInterval);
          this.viewer.entities.remove(explosionEntity);
        }
      }, 50);
    }
  }

  // ── MÉTODOS DE SOPORTE E INTERFAZ ──
  resetGame(): void {
    this.gameMode.set('setup');
    this.currentYear.set(this.startYear);
    this.debrisCount.set(this.baseDebris());
    this.gameLogs.set([
      'Simulación reseteada. Configura las opciones para arrancar nuevamente.'
    ]);
    this.ngZone.runOutsideAngular(() => {
      this.generateInitialParticles();
    });
  }

  setPreset(type: 'short' | 'medium' | 'sandbox'): void {
    if (type === 'short') {
      this.targetYears.set(10);
    } else if (type === 'medium') {
      this.targetYears.set(20);
    } else {
      this.targetYears.set(50);
    }
  }

  get lastHistoryRecord(): HistoryRecord | null {
    const hist = this.history();
    return hist.length > 0 ? hist[hist.length - 1] : null;
  }
}
