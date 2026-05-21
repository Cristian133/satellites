import 'dotenv/config';
import type { GoogleGenAI } from '@google/genai' with { "resolution-mode": "import" };
import { openDatabase, searchSatellites, getTleByNoradId } from './db.js';

// ─── Clase CustomAgent ────────────────────────────────────────────────────────
// Una clase reutilizable de agente que automatiza el bucle de razonamiento
// y la ejecución de herramientas (Function Calling) usando el SDK oficial de Gemini.
class CustomAgent {
  constructor(
    public name: string,
    public systemInstruction: string,
    public tools: any[] = [],
    public toolExecutors: Record<string, Function> = {}
  ) { }

  async run(task: string, ai: GoogleGenAI): Promise<string> {
    console.log(`\n\x1b[36m🤖 [${this.name}] Iniciando tarea:\x1b[0m "${task}"`);

    const contents: any[] = [{ role: 'user', parts: [{ text: task }] }];
    let step = 0;
    const maxSteps = 5;

    while (step < maxSteps) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
          systemInstruction: this.systemInstruction,
          tools: this.tools.length > 0 ? [{ functionDeclarations: this.tools }] : undefined
        }
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error(`[${this.name}] No se recibió ninguna respuesta válida del modelo.`);
      }

      // Añadimos el pensamiento/respuesta del modelo al historial de la conversación
      contents.push(candidate.content);

      const calls = response.functionCalls;
      if (calls && calls.length > 0) {
        console.log(`\n\x1b[33m🔍 [${this.name}] Pensamiento del agente: Requiere ejecutar herramientas.\x1b[0m`);

        const toolParts: any[] = [];
        for (const call of calls) {
          const name = call.name;
          if (!name) {
            console.warn(`⚠️  [${this.name}] Nombre de función vacío recibido del modelo.`);
            continue;
          }
          console.log(`⚙️  [${this.name}] Ejecutando herramienta local: \x1b[35m"${name}"\x1b[0m con parámetros:`, JSON.stringify(call.args));
          const executor = this.toolExecutors[name];
          if (!executor) {
            throw new Error(`[${this.name}] Herramienta "${name}" no está registrada en el ejecutor.`);
          }

          let result;
          try {
            result = await executor(call.args);
            console.log(`✅ [${this.name}] Herramienta ejecutada con éxito. Resultados obtenidos.`);
          } catch (err: any) {
            console.error(`❌ [${this.name}] Error en la ejecución de la herramienta:`, err.message);
            result = { error: err.message };
          }

          toolParts.push({
            functionResponse: {
              name: name,
              response: result
            }
          });
        }

        // Enviamos el resultado de las herramientas de vuelta en la conversación
        contents.push({
          role: 'tool',
          parts: toolParts
        });

        step++;
      } else {
        // El agente ha terminado de razonar y devuelve la respuesta en texto
        return response.text || '';
      }
    }

    throw new Error(`[${this.name}] Se ha excedido el límite máximo de pasos de herramientas (${maxSteps}).`);
  }
}

// ─── Inicialización de Base de Datos y Herramientas locales ────────────────────
const db = openDatabase();

// Declaración de herramientas para Gemini en formato JSON Schema
const searchSatellitesDeclaration = {
  name: 'searchSatellites',
  description: 'Busca satélites en la base de datos local por nombre o por su NORAD ID. Retorna una lista con la información básica de los satélites coincidentes.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: 'El término de búsqueda (ej. "ISS", "weather", "25544")' },
      limit: { type: 'INTEGER', description: 'Límite opcional de resultados (por defecto 10)' }
    },
    required: ['query']
  }
};

const getTleByNoradIdDeclaration = {
  name: 'getTleByNoradId',
  description: 'Obtiene los datos completos de órbita y TLE (Two-Line Element) de un satélite dado su NORAD ID.',
  parameters: {
    type: 'OBJECT',
    properties: {
      noradId: { type: 'INTEGER', description: 'El identificador NORAD del satélite (ej. 25544)' }
    },
    required: ['noradId']
  }
};

// Implementación ejecutable de las herramientas
const toolExecutors: Record<string, Function> = {
  searchSatellites: async (args: { query: string; limit?: number }) => {
    const results = searchSatellites(db, args.query, args.limit || 10);
    return { satellites: results };
  },
  getTleByNoradId: async (args: { noradId: number }) => {
    const record = getTleByNoradId(db, Number(args.noradId));
    if (!record) {
      return { error: `Satélite con NORAD ID ${args.noradId} no encontrado en la base de datos.` };
    }
    return { tleRecord: record };
  }
};

// ─── Definición de los 2 Agentes Especialistas ────────────────────────────────

// Agente 1: Analista Orbital (con herramientas de base de datos)
const orbitAnalyst = new CustomAgent(
  "OrbitAnalyst",
  `Eres un astrofísico experto en mecánica orbital y satélites espaciales.
Tu objetivo es analizar satélites reales en la base de datos y extraer sus parámetros clave de órbita.
Tienes herramientas para buscar satélites y para ver su TLE completo.
Siempre debes:
1. Buscar el satélite solicitado si no dispones de su ID.
2. Obtener su TLE detallado.
3. Analizar su periodo orbital, su inclinación y estimar si es una órbita LEO, MEO o GEO.
Estructura tu reporte de forma técnica y muy rigurosa.`,
  [searchSatellitesDeclaration, getTleByNoradIdDeclaration],
  toolExecutors
);

// Agente 2: Diseñador de Visualización CesiumJS (sin herramientas, solo razonamiento y diseño)
const cesiumVisualizer = new CustomAgent(
  "CesiumVisualizer",
  `Eres un diseñador UX/UI especializado en gráficos 3D interactivos y aplicaciones espaciales en CesiumJS.
Tu objetivo es diseñar una configuración visual impecable, premium e inmersiva para mostrar el satélite en un globo terrestre 3D.
Recibirás un informe orbital técnico del analista de órbita. Basado en las características del satélite (inclinación, grupo, órbita):
1. Diseña una paleta de colores coherente (colores de órbita, punto de posición, zona de visibilidad terrestre).
2. Define estilos de visualización en CesiumJS (grosor de línea de órbita, si es línea continua o discontinua, frecuencia de pulso luminoso).
3. Redacta una justificación estética y técnica del diseño que conecte la física del satélite con la experiencia visual del usuario.
Genera SIEMPRE al final de tu respuesta un bloque JSON válido estructurado así:
{
  "theme": "futuristic-cyan | emerald-earth | deepspace-violet | solar-gold",
  "styles": {
    "orbitColor": "rgba(r,g,b,a)",
    "orbitWidth": number,
    "orbitDashed": boolean,
    "glowColor": "rgba(r,g,b,a)",
    "groundTrackColor": "rgba(r,g,b,a)"
  }
}`
);

// ─── Orquestador Principal del Pipeline de Colaboración ────────────────────────
async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("\n\x1b[31m❌ ERROR: La variable de entorno GEMINI_API_KEY no está definida.\x1b[0m");
    console.error("Por favor ejecuta la demo proporcionando tu API key de Google Gemini:");
    console.error("GEMINI_API_KEY=\"tu_api_key\" npm run demo-agents\n");
    process.exit(1);
  }

  // Instanciamos el cliente SDK oficial
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  console.log("\x1b[34m========================================================\x1b[0m");
  console.log("\x1b[34m🛰️  INICIANDO PIPELINE DE AGENTES DE SATÉLITES CON GEMINI 🛰️\x1b[0m");
  console.log("\x1b[34m========================================================\x1b[0m");

  // Definimos el satélite a investigar (por ejemplo, la estación espacial china Tiangong o la ISS)
  const targetSatellite = "ISS";
  console.log(`\n\x1b[32m[Sistema]: El usuario solicita analizar y diseñar la vista para "${targetSatellite}".\x1b[0m`);

  try {
    // 1. Ejecutamos el Agente 1: Analista Orbital
    const analystPrompt = `Busca el satélite "${targetSatellite}", obtén su TLE y realiza un diagnóstico técnico completo de su órbita actual.`;
    const orbitalReport = await orbitAnalyst.run(analystPrompt, ai);

    console.log("\n\x1b[32m========================================================\x1b[0m");
    console.log("\x1b[32m📊 INFORME TÉCNICO GENERADO POR EL ANALISTA ORBITAL:\x1b[0m");
    console.log("\x1b[32m========================================================\x1b[0m");
    console.log(orbitalReport);

    // 2. Ejecutamos el Agente 2: Diseñador CesiumJS (usando la salida del primer agente como entrada)
    const visualizerPrompt = `Toma este informe técnico orbital de un satélite real y genera su configuración de diseño visual premium en CesiumJS:\n\n${orbitalReport}`;
    const visualizationDesign = await cesiumVisualizer.run(visualizerPrompt, ai);

    console.log("\n\x1b[32m========================================================\x1b[0m");
    console.log("\x1b[32m🎨 PROPUESTA DE DISEÑO 3D GENERADA POR EL VISUALIZADOR:\x1b[0m");
    console.log("\x1b[32m========================================================\x1b[0m");
    console.log(visualizationDesign);

    console.log("\n\x1b[34m========================================================\x1b[0m");
    console.log("\x1b[34m🎉 PIPELINE COMPLETADO EXITOSAMENTE CON AMBOS AGENTES 🎉\x1b[0m");
    console.log("\x1b[34m========================================================\x1b[0m");

  } catch (error: any) {
    console.error("\n\x1b[31m❌ Ha ocurrido un error inesperado durante el pipeline:\x1b[0m", error.message);
  } finally {
    db.close();
  }
}

main();
