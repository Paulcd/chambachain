"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress, isConnected } = useAccount();

  return (
    <div className="flex flex-col items-center grow pt-10 px-5 pb-10">
      <div className="w-full max-w-3xl">
        <h1 className="text-center mb-6">
          <span className="block text-2xl mb-2">Reputación laboral verificable</span>
          <span className="block text-5xl font-bold">ChambaChain</span>
        </h1>

        <p className="text-center text-lg opacity-90 mb-8">
          Los trabajadores informales y de la economía gig en Perú no tienen forma de acumular una reputación que se
          mueva con ellos entre plataformas. ChambaChain registra atestaciones de confianza on-chain, generadas por un
          análisis de IA sobre la evidencia que el trabajador aporta.
        </p>

        {isConnected && (
          <div className="flex justify-center items-center gap-2 mb-8">
            <span className="font-medium">Conectado como:</span>
            <Address address={connectedAddress} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <Link className="btn btn-primary btn-lg" href="/evaluar">
            Enviar evidencia
          </Link>
          <Link className="btn btn-outline btn-lg" href="/mi-reputacion">
            Ver mi reputación
          </Link>
        </div>

        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h2 className="card-title">Cómo funciona</h2>
            <ol className="list-decimal list-inside space-y-2 opacity-90">
              <li>El trabajador conecta su wallet y pega su evidencia en texto plano.</li>
              <li>Un modelo de IA analiza esa evidencia y produce un score de 0 a 100 con su justificación.</li>
              <li>
                Un <strong>oracle autorizado</strong> —nuestro backend, que corrió la IA— firma la transacción y escribe
                la atestación en el contrato Stylus.
              </li>
              <li>El score y su historial quedan on-chain en Arbitrum, verificables por cualquier plataforma.</li>
            </ol>

            <div className="alert alert-info mt-4">
              <span>
                El trabajador <strong>no</strong> puede auto-asignarse un score: solo direcciones autorizadas pueden
                escribir en el registro. Esa restricción es el mecanismo de confianza del sistema.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
