import "dotenv/config";
import type { GoogleGenAI } from "@google/genai" with { "resolution-mode": "import" };
import { openDatabase, searchSatellites, getTleByNoradId } from "../satellites-be/src/db.js";

// ─── Clase CustomAgent ────────────────────────────────────────────────────────
class CustomAgent {
  constructor(
    public name: string,
    public systemInstruction: string,
    public tools: unknown[]           = [],
    public toolExecutors: Record<string, Function> = {}
  ) {}

  async run(task: string, ai: GoogleGenAI): Promise<string> {
    console.log(`\n\x1b[36m🤖 [${this.name}] Iniciando tarea:\x1b[0m "${task}"`);

    const contents: unknown[] = [{ role: "user", parts: [{ text: task }] }];
    let step = 0;
    const maxSteps = 5;

    while (step < maxSteps) {
      const response = await (ai as any).models.generateContent({
        model:    "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction: this.systemInstruction,
          tools: this.tools.length > 0 ? [{ functionDeclarations: this.tools }] : undefined,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) throw new Error(`[${this.name}] No se recibió ninguna respuesta válida del modelo.`);

      contents.push(candidate.content);

      const calls = response.functionCalls;
      if (calls && calls.length > 0) {
        console.log(`\n\x1b[33m🔍 [${this.name}] Pensamiento del agente: Requiere ejecutar herramientas.\x1b[0m`);

        const toolParts: unknown[] = [];
        for (const call of calls) {
          const name = call.name;
          if (!name) { console.warn(`⚠️  [${this.name}] Nombre de función vacío.`); continue; }

          console.log(`⚙️  [${this.name}] Ejecutando: \x1b[35m"${name}"\x1b[0m con`, JSON.stringify(call.args));
          const executor = this.toolExecutors[name];
          if (!executor) throw new Error(`[${this.name}] Herramienta "${name}" no registrada.`);

          let result;
          try {
            result = await executor(call.args);
          } catch (err: unknown) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }

          toolParts.push({ functionResponse: { name, response: result } });
        }

        contents.push({ role: "tool", parts: toolParts });
        step++;
      } else {
        return response.text || "";
      }
    }

    throw new Error(`[${this.name}] Límite de ${maxSteps} pasos superado.`);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const db = openDatabase();

const searchDeclaration = {
  name: "searchSatellites",
  description: "Busca satélites en la BD local por nombre o NORAD ID.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING",  description: "Término de búsqueda" },
      limit: { type: "INTEGER", description: "Límite de resultados" },
    },
    required: ["query"],
  },
};

const getTleDeclaration = {
  name: "getTleByNoradId",
  description: "Obtiene el TLE completo de un satélite por su NORAD ID.",
  parameters: {
    type: "OBJECT",
    properties: {
      noradId: { type: "INTEGER", description: "NORAD ID del satélite" },
    },
    required: ["noradId"],
  },
};

const toolExecutors: Record<string, Function> = {
  searchSatellites: async (args: { query: string; limit?: number }) =>
    ({ satellites: searchSatellites(db, args.query, args.limit || 10) }),
  getTleByNoradId: async (args: { noradId: number }) => {
    const record = getTleByNoradId(db, Number(args.noradId));
    return record ? { tleRecord: record } : { error: `Satélite ${args.noradId} no encontrado.` };
  },
};

const orbitAnalyst    = new CustomAgent("OrbitAnalyst", "Eres un astrofísico experto en mecánica orbital.", [searchDeclaration, getTleDeclaration], toolExecutors);
const cesiumVisualizer = new CustomAgent("CesiumVisualizer", "Eres un diseñador UX/UI especializado en CesiumJS.");

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY no definida.");
    process.exit(1);
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const targetSatellite = "ISS";
  console.log(`\n\x1b[32m[Sistema]: Analizando "${targetSatellite}".\x1b[0m`);

  try {
    const orbitalReport      = await orbitAnalyst.run(`Busca "${targetSatellite}", obtén su TLE y analiza su órbita.`, ai);
    console.log("\n📊 INFORME ORBITAL:\n", orbitalReport);

    const visualizationDesign = await cesiumVisualizer.run(`Diseña la visualización para este satélite:\n\n${orbitalReport}`, ai);
    console.log("\n🎨 DISEÑO VISUAL:\n", visualizationDesign);
  } catch (error: unknown) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}

main();
