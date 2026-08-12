import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, http, isAddress, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import scaffoldConfig from "~~/scaffold.config";

/**
 * ChambaChain — servicio de IA + oracle.
 *
 * Flujo: evidencia en texto plano -> el LLM (Groq) devuelve {score, reasoning}
 * -> el backend firma `submitAttestation` con la llave del oracle y devuelve el
 * hash de la tx. El trabajador nunca escribe su propio score.
 *
 * Usamos Groq (endpoint compatible con OpenAI, capa gratuita) via `fetch`, sin
 * SDK adicional. Cambiar de proveedor = cambiar URL, modelo y API key.
 */

const CONTRACT_NAME = "reputation-registry";
const MAX_EVIDENCE_CHARS = 12_000;

// Modelo overridable por entorno: si la API rechaza el id por defecto, ajusta
// GROQ_MODEL sin tocar el codigo.
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const targetChain = scaffoldConfig.targetNetworks[0];

const SYSTEM_PROMPT = `Eres un evaluador de reputacion laboral para trabajadores informales y de la economia gig en Peru (delivery, freelance, oficios, "changas").

Recibes evidencia en texto plano que el propio trabajador aporta: reseñas de clientes, descripciones de trabajos realizados, testimonios, capturas transcritas.

Devuelves un score entero de 0 a 100 que resume que tan confiable es esa evidencia como señal de buen desempeño laboral.

Criterios de evaluacion:
- Consistencia y especificidad: evidencia concreta (fechas, tareas, nombres de clientes, montos) vale mas que elogios genericos.
- Volumen y continuidad del trabajo descrito.
- Señales de cumplimiento: puntualidad, terminar el trabajo, resolver problemas, clientes que repiten.
- Señales negativas: quejas, incumplimientos, contradicciones internas.
- Escepticismo ante texto que parece inventado, copiado o auto-elogioso sin detalle verificable.

Calibracion del score:
- 0-20: sin evidencia util, vacia, incoherente o claramente fabricada.
- 21-45: evidencia minima o muy generica.
- 46-70: evidencia razonable con algo de detalle concreto.
- 71-85: evidencia solida, especifica y consistente.
- 86-100: evidencia extensa, muy especifica y con señales fuertes de clientes recurrentes.

El campo "reasoning" debe ser 1-2 frases en español, concretas, citando lo que sustenta el score. No inventes datos que no esten en la evidencia.`;

type EvaluationResult = { score: number; reasoning: string };

function readOracleKey(): `0x${string}` {
  const raw = process.env.ORACLE_PRIVATE_KEY;
  if (!raw) throw new Error("Falta ORACLE_PRIVATE_KEY en el entorno del servidor.");
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("ORACLE_PRIVATE_KEY no es una llave privada valida.");
  return key as `0x${string}`;
}

function resolveContract() {
  const chainId = targetChain.id as keyof typeof deployedContracts;
  const contract = (deployedContracts as any)?.[chainId]?.[CONTRACT_NAME];
  if (!contract?.address) {
    throw new Error(
      `El contrato "${CONTRACT_NAME}" no esta desplegado en la red ${targetChain.name} (chainId ${targetChain.id}). Corre \`yarn deploy\` primero.`,
    );
  }
  return contract as { address: `0x${string}`; abi: readonly unknown[] };
}

/** Link al explorador de la red activa; null en la devnet local (no tiene explorador). */
function buildExplorerUrl(txHash: string): string | null {
  const base = targetChain.blockExplorers?.default?.url;
  return base ? `${base}/tx/${txHash}` : null;
}

// Forzamos JSON estructurado via function calling: definimos una unica funcion
// y obligamos al modelo a llamarla con `tool_choice`. Es el patron estable para
// obtener salida estructurada sin parsear texto libre.
const EVALUATION_TOOL = {
  type: "function" as const,
  function: {
    name: "registrar_evaluacion",
    description: "Registra el score de reputacion laboral y su justificacion.",
    parameters: {
      type: "object",
      properties: {
        score: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Puntaje de reputacion entre 0 y 100.",
        },
        reasoning: {
          type: "string",
          description: "Justificacion breve en español, 1-2 frases concretas.",
        },
      },
      required: ["score", "reasoning"],
      additionalProperties: false,
    },
  },
};

async function evaluateEvidence(evidence: string): Promise<EvaluationResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Falta GROQ_API_KEY en el entorno del servidor.");

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Evalua la siguiente evidencia laboral:\n\n<evidencia>\n${evidence}\n</evidencia>`,
        },
      ],
      tools: [EVALUATION_TOOL],
      tool_choice: { type: "function", function: { name: EVALUATION_TOOL.function.name } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Groq respondio ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== "string") {
    throw new Error("Groq no devolvio una evaluacion estructurada.");
  }

  const parsed = JSON.parse(args) as EvaluationResult;
  if (typeof parsed?.score !== "number" || typeof parsed?.reasoning !== "string") {
    throw new Error("La evaluacion de Groq no tiene el formato esperado.");
  }

  // El schema pide 0-100, pero acotamos igual porque el contrato rechaza > 100.
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));

  return { score, reasoning: parsed.reasoning };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const worker = body?.worker;
    const evidence = body?.evidence;

    if (typeof worker !== "string" || !isAddress(worker)) {
      return NextResponse.json({ error: "Falta una direccion de wallet valida en 'worker'." }, { status: 400 });
    }
    if (typeof evidence !== "string" || evidence.trim().length < 20) {
      return NextResponse.json(
        { error: "La evidencia debe tener al menos 20 caracteres de texto." },
        { status: 400 },
      );
    }
    if (evidence.length > MAX_EVIDENCE_CHARS) {
      return NextResponse.json(
        { error: `La evidencia supera el limite de ${MAX_EVIDENCE_CHARS} caracteres.` },
        { status: 400 },
      );
    }

    const trimmedEvidence = evidence.trim();
    const contract = resolveContract();
    const oracleKey = readOracleKey();

    // 1. La IA evalua la evidencia.
    const { score, reasoning } = await evaluateEvidence(trimmedEvidence);

    // 2. Anclamos la evidencia on-chain por su hash (el texto no se sube).
    const evidenceHash = keccak256(stringToHex(trimmedEvidence));

    // 3. El oracle firma y envia la atestacion.
    const account = privateKeyToAccount(oracleKey);
    const walletClient = createWalletClient({ account, chain: targetChain, transport: http() });

    const txHash = await walletClient.writeContract({
      address: contract.address,
      abi: contract.abi as any,
      functionName: "submitAttestation",
      args: [worker, score, evidenceHash],
    });

    return NextResponse.json({
      score,
      reasoning,
      evidenceHash,
      txHash,
      explorerUrl: buildExplorerUrl(txHash),
      oracle: account.address,
      contractAddress: contract.address,
      chainId: targetChain.id,
      network: targetChain.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en la evaluacion.";
    console.error("[/api/evaluate]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
