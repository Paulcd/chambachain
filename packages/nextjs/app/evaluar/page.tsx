"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";

type EvaluateResponse = {
  score: number;
  reasoning: string;
  evidenceHash: string;
  txHash: string;
  explorerUrl: string | null;
  oracle: string;
  contractAddress: string;
  network: string;
};

const PLACEHOLDER = `Pega aqui tus reseñas, descripciones de trabajos y testimonios de clientes. Por ejemplo:

"Hice 340 entregas en Rappi entre marzo y agosto de 2025, calificacion promedio 4.8. Reseña de cliente: 'Llego antes de la hora y el pedido venia completo'. Tambien pinte 3 departamentos en San Miguel para la Sra. Rojas, que me volvio a contratar en julio."`;

const scoreColor = (score: number) => {
  if (score >= 71) return "text-success";
  if (score >= 46) return "text-warning";
  return "text-error";
};

const Evaluar: NextPage = () => {
  const { address: connectedAddress, isConnected } = useAccount();
  const [evidence, setEvidence] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isConnected && evidence.trim().length >= 20 && !isLoading;

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker: connectedAddress, evidence }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "La evaluacion fallo.");
      setResult(data as EvaluateResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center grow pt-10 px-5 pb-10">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Enviar evidencia</h1>
        <p className="opacity-80 mb-6">
          La IA evalua tu evidencia y un oracle autorizado registra el score on-chain. Tu no puedes asignarte un
          puntaje a ti mismo: esa es justamente la garantia que hace verificable tu reputacion.
        </p>

        {!isConnected ? (
          <div className="alert alert-warning mb-6">
            <span>Conecta tu wallet para registrar una atestacion a tu nombre.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-6">
            <span className="font-medium">Trabajador:</span>
            <Address address={connectedAddress} />
          </div>
        )}

        <textarea
          className="textarea textarea-bordered w-full h-64 text-base"
          placeholder={PLACEHOLDER}
          value={evidence}
          onChange={e => setEvidence(e.target.value)}
          disabled={isLoading}
        />

        <div className="flex items-center justify-between mt-2 mb-6">
          <span className="text-sm opacity-70">{evidence.trim().length} caracteres (minimo 20)</span>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {isLoading && <span className="loading loading-spinner loading-sm" />}
            {isLoading ? "Evaluando y registrando..." : "Evaluar y registrar"}
          </button>
        </div>

        {error && (
          <div className="alert alert-error mb-6">
            <span className="break-all">{error}</span>
          </div>
        )}

        {result && (
          <div className="card bg-base-100 shadow-lg">
            <div className="card-body">
              <div className="flex items-baseline gap-3">
                <span className={`text-6xl font-bold ${scoreColor(result.score)}`}>{result.score}</span>
                <span className="text-xl opacity-70">/ 100</span>
              </div>

              <div className="mt-4">
                <h3 className="font-bold mb-1">Analisis de la IA</h3>
                <p className="opacity-90">{result.reasoning}</p>
              </div>

              <div className="divider my-2" />

              <div className="text-sm space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span className="font-medium">Red:</span>
                  <span className="opacity-80">{result.network}</span>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-medium">Oracle firmante:</span>
                  <Address address={result.oracle as `0x${string}`} />
                </div>
                <div>
                  <span className="font-medium">Hash de la evidencia:</span>
                  <p className="font-mono text-xs break-all opacity-80">{result.evidenceHash}</p>
                </div>
                <div>
                  <span className="font-medium">Transaccion:</span>
                  <p className="font-mono text-xs break-all opacity-80">{result.txHash}</p>
                </div>
              </div>

              <div className="card-actions justify-end mt-4 gap-2">
                {result.explorerUrl ? (
                  <a className="btn btn-sm btn-outline" href={result.explorerUrl} target="_blank" rel="noreferrer">
                    Ver en Arbiscan
                  </a>
                ) : (
                  <Link className="btn btn-sm btn-outline" href={`/blockexplorer/transaction/${result.txHash}`}>
                    Ver en el explorador local
                  </Link>
                )}
                <Link className="btn btn-sm btn-primary" href="/mi-reputacion">
                  Ver mi reputacion
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Evaluar;
