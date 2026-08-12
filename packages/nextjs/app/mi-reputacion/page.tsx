"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

type Attestation = readonly [number, bigint, `0x${string}`];

const scoreColor = (score: number) => {
  if (score >= 71) return "text-success";
  if (score >= 46) return "text-warning";
  return "text-error";
};

const formatDate = (timestamp: bigint) => {
  if (timestamp === 0n) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleString("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const MiReputacion: NextPage = () => {
  const { address: connectedAddress, isConnected } = useAccount();

  const { data: latestScore, isLoading: loadingScore } = useScaffoldReadContract({
    contractName: "reputation-registry",
    functionName: "getLatestScore",
    args: [connectedAddress],
  });

  const { data: history, isLoading: loadingHistory } = useScaffoldReadContract({
    contractName: "reputation-registry",
    functionName: "getHistory",
    args: [connectedAddress],
  });

  const attestations = (history ?? []) as readonly Attestation[];
  // El contrato guarda el historial en orden cronologico; lo mostramos al reves
  // para que la atestacion mas reciente quede arriba.
  const timeline = [...attestations].reverse();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center grow pt-10 px-5">
        <div className="w-full max-w-3xl">
          <h1 className="text-3xl font-bold mb-4">Mi reputación</h1>
          <div className="alert alert-warning">
            <span>Conecta tu wallet para ver tu historial de atestaciones.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center grow pt-10 px-5 pb-10">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Mi reputación</h1>
        <div className="flex items-center gap-2 mb-6">
          <span className="font-medium">Trabajador:</span>
          <Address address={connectedAddress} />
        </div>

        <div className="card bg-base-100 shadow-lg mb-8">
          <div className="card-body items-center text-center">
            <span className="text-sm uppercase tracking-wide opacity-70">Score actual</span>
            {loadingScore ? (
              <span className="loading loading-spinner loading-lg" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className={`text-7xl font-bold ${scoreColor(Number(latestScore ?? 0))}`}>
                  {Number(latestScore ?? 0)}
                </span>
                <span className="text-2xl opacity-70">/ 100</span>
              </div>
            )}
            <span className="opacity-70">
              {attestations.length} {attestations.length === 1 ? "atestación registrada" : "atestaciones registradas"}
            </span>
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-4">Línea de tiempo</h2>

        {loadingHistory ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="card bg-base-100 shadow">
            <div className="card-body items-center text-center">
              <p className="opacity-80">Todavía no tienes atestaciones on-chain.</p>
              <Link className="btn btn-primary btn-sm mt-2" href="/evaluar">
                Enviar mi primera evidencia
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {timeline.map(([score, timestamp, evidenceHash], index) => (
              <div key={`${evidenceHash}-${index}`} className="card bg-base-100 shadow">
                <div className="card-body py-4 flex-row items-center gap-4">
                  <div className={`text-4xl font-bold w-20 text-center ${scoreColor(score)}`}>{score}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Atestación #{timeline.length - index}
                      {index === 0 && <span className="badge badge-primary badge-sm ml-2">más reciente</span>}
                    </p>
                    <p className="text-sm opacity-70">{formatDate(timestamp)}</p>
                    <p className="font-mono text-xs opacity-60 break-all mt-1">{evidenceHash}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MiReputacion;
