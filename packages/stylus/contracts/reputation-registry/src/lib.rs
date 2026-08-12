//!
//! ChambaChain — `ReputationRegistry` en Stylus (Rust).
//!
//! Registro de atestaciones de reputacion para trabajadores informales/gig.
//!
//! Decision de diseño central: el `score` lo escribe un **oracle autorizado**
//! (nuestro backend, que corrio el analisis de IA sobre la evidencia), nunca el
//! propio trabajador. Esa restriccion es lo que convierte al contrato en el
//! mecanismo de confianza del sistema y no en un simple almacen de datos.
//!

// Allow `cargo stylus export-abi` to generate a main function.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![cfg_attr(not(any(test, feature = "export-abi")), no_std)]

#[macro_use]
extern crate alloc;

use alloc::vec::Vec;

/// Import items from the SDK. The prelude contains common traits and macros.
use stylus_sdk::{
    alloy_primitives::{Address, FixedBytes, U256, U64, U8},
    alloy_sol_types::sol,
    prelude::*,
    stylus_core::log,
};

sol! {
    /// Emitido cada vez que un oracle registra una atestacion para un trabajador.
    event AttestationSubmitted(
        address indexed worker,
        address indexed oracle,
        uint8 score,
        bytes32 evidenceHash,
        uint64 timestamp
    );

    /// Emitido cuando el owner autoriza o revoca un oracle.
    event OracleUpdated(address indexed oracle, bool authorized);

    /// El caller no es el owner del registro.
    error NotOwner();
    /// El caller no es un oracle autorizado.
    error NotAuthorizedOracle();
    /// El score debe estar en el rango 0-100.
    error InvalidScore();
}

/// Error types for the contract.
/// Sin `Debug`: los structs de error que genera `sol!` no lo implementan.
#[derive(SolidityError)]
pub enum RegistryError {
    NotOwner(NotOwner),
    NotAuthorizedOracle(NotAuthorizedOracle),
    InvalidScore(InvalidScore),
}

// Define persistent storage using the Solidity ABI.
// `ReputationRegistry` will be the entrypoint.
sol_storage! {
    /// Una atestacion individual generada por la IA y firmada por un oracle.
    pub struct Attestation {
        uint8 score;
        uint64 timestamp;
        bytes32 evidence_hash;
    }

    #[entrypoint]
    pub struct ReputationRegistry {
        address owner;
        mapping(address => Attestation[]) worker_history;
        mapping(address => bool) authorized_oracles;
    }
}

/// Helpers internos (fuera del bloque `#[public]`, por eso no se exponen en el ABI).
impl ReputationRegistry {
    fn only_owner(&self) -> Result<(), RegistryError> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(RegistryError::NotOwner(NotOwner {}));
        }
        Ok(())
    }
}

/// Declare that `ReputationRegistry` is a contract with the following external methods.
#[public]
impl ReputationRegistry {
    /// Inicializa el registro. El owner queda autorizado como oracle para
    /// simplificar el arranque (el backend puede usar esa misma llave).
    #[constructor]
    pub fn constructor(&mut self, initial_owner: Address) {
        self.owner.set(initial_owner);
        self.authorized_oracles.insert(initial_owner, true);
    }

    /// Owner del registro (unico que puede gestionar oracles).
    pub fn owner(&self) -> Address {
        self.owner.get()
    }

    /// Indica si una address puede escribir atestaciones.
    pub fn is_oracle(&self, account: Address) -> bool {
        self.authorized_oracles.get(account)
    }

    /// Autoriza a una address a escribir atestaciones. Solo owner.
    pub fn add_oracle(&mut self, oracle: Address) -> Result<(), RegistryError> {
        self.only_owner()?;
        self.authorized_oracles.insert(oracle, true);
        log(
            self.vm(),
            OracleUpdated {
                oracle,
                authorized: true,
            },
        );
        Ok(())
    }

    /// Revoca a un oracle. Solo owner.
    pub fn remove_oracle(&mut self, oracle: Address) -> Result<(), RegistryError> {
        self.only_owner()?;
        self.authorized_oracles.insert(oracle, false);
        log(
            self.vm(),
            OracleUpdated {
                oracle,
                authorized: false,
            },
        );
        Ok(())
    }

    /// Registra una atestacion para `worker`.
    ///
    /// Solo un oracle autorizado puede llamarla: el trabajador NO puede
    /// auto-asignarse un score.
    pub fn submit_attestation(
        &mut self,
        worker: Address,
        score: u8,
        evidence_hash: FixedBytes<32>,
    ) -> Result<(), RegistryError> {
        let sender = self.vm().msg_sender();
        if !self.authorized_oracles.get(sender) {
            return Err(RegistryError::NotAuthorizedOracle(NotAuthorizedOracle {}));
        }
        if score > 100 {
            return Err(RegistryError::InvalidScore(InvalidScore {}));
        }

        let timestamp = self.vm().block_timestamp();

        // Bloque acotado para liberar el prestamo mutable antes de emitir el log.
        {
            let mut history = self.worker_history.setter(worker);
            let mut entry = history.grow();
            entry.score.set(U8::from(score));
            entry.timestamp.set(U64::from(timestamp));
            entry.evidence_hash.set(evidence_hash);
        }

        log(
            self.vm(),
            AttestationSubmitted {
                worker,
                oracle: sender,
                score,
                evidenceHash: evidence_hash,
                timestamp,
            },
        );

        Ok(())
    }

    /// Ultimo score registrado para `worker`. Devuelve 0 si no tiene historial.
    pub fn get_latest_score(&self, worker: Address) -> u8 {
        let history = self.worker_history.getter(worker);
        let len = history.len();
        if len == 0 {
            return 0;
        }
        match history.getter(len - 1) {
            Some(entry) => entry.score.get().to::<u8>(),
            None => 0,
        }
    }

    /// Cantidad de atestaciones acumuladas por `worker`.
    pub fn get_history_length(&self, worker: Address) -> U256 {
        U256::from(self.worker_history.getter(worker).len())
    }

    /// Atestacion puntual: `(score, timestamp, evidence_hash)`.
    /// Devuelve ceros si el indice esta fuera de rango.
    pub fn get_attestation(&self, worker: Address, index: U256) -> (u8, u64, FixedBytes<32>) {
        let history = self.worker_history.getter(worker);
        let len = history.len();
        if index >= U256::from(len) {
            return (0, 0, FixedBytes::<32>::ZERO);
        }
        match history.getter(index.to::<usize>()) {
            Some(entry) => (
                entry.score.get().to::<u8>(),
                entry.timestamp.get().to::<u64>(),
                entry.evidence_hash.get(),
            ),
            None => (0, 0, FixedBytes::<32>::ZERO),
        }
    }

    /// Historial completo de `worker` como lista de `(score, timestamp, evidence_hash)`.
    pub fn get_history(&self, worker: Address) -> Vec<(u8, u64, FixedBytes<32>)> {
        let history = self.worker_history.getter(worker);
        let len = history.len();
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            if let Some(entry) = history.getter(i) {
                out.push((
                    entry.score.get().to::<u8>(),
                    entry.timestamp.get().to::<u64>(),
                    entry.evidence_hash.get(),
                ));
            }
        }
        out
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use stylus_sdk::testing::*;

    fn hash(byte: u8) -> FixedBytes<32> {
        FixedBytes::<32>::from([byte; 32])
    }

    #[test]
    fn constructor_sets_owner_and_authorizes_it() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = vm.msg_sender();
        contract.constructor(owner);

        assert_eq!(contract.owner(), owner);
        assert!(contract.is_oracle(owner));
        assert_eq!(contract.get_latest_score(owner), 0);
        assert_eq!(contract.get_history_length(owner), U256::ZERO);
    }

    #[test]
    fn oracle_can_submit_and_history_accumulates() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = vm.msg_sender();
        contract.constructor(owner);

        let worker = Address::from([7u8; 20]);

        assert!(
            contract.submit_attestation(worker, 72, hash(0xaa)).is_ok(),
            "el owner es oracle, deberia poder escribir"
        );
        assert_eq!(contract.get_latest_score(worker), 72);
        assert_eq!(contract.get_history_length(worker), U256::from(1));

        assert!(
            contract.submit_attestation(worker, 88, hash(0xbb)).is_ok(),
            "segunda atestacion"
        );
        assert_eq!(contract.get_latest_score(worker), 88);
        assert_eq!(contract.get_history_length(worker), U256::from(2));

        // El historial conserva el orden cronologico.
        let (score0, _, evidence0) = contract.get_attestation(worker, U256::ZERO);
        assert_eq!(score0, 72);
        assert_eq!(evidence0, hash(0xaa));

        let history = contract.get_history(worker);
        assert_eq!(history.len(), 2);
        assert_eq!(history[1].0, 88);
        assert_eq!(history[1].2, hash(0xbb));
    }

    #[test]
    fn non_oracle_cannot_submit() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = Address::from([1u8; 20]);
        contract.constructor(owner);

        // msg_sender por defecto no es el owner, por lo tanto no es oracle.
        let worker = Address::from([7u8; 20]);
        let result = contract.submit_attestation(worker, 90, hash(0xcc));

        assert!(result.is_err(), "un no-oracle no puede escribir un score");
        assert_eq!(contract.get_history_length(worker), U256::ZERO);
    }

    #[test]
    fn score_above_100_is_rejected() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = vm.msg_sender();
        contract.constructor(owner);

        let worker = Address::from([7u8; 20]);
        assert!(contract.submit_attestation(worker, 101, hash(0xdd)).is_err());
        assert_eq!(contract.get_history_length(worker), U256::ZERO);
    }

    #[test]
    fn owner_manages_oracles() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = vm.msg_sender();
        contract.constructor(owner);

        let backend = Address::from([9u8; 20]);
        assert!(!contract.is_oracle(backend));

        assert!(contract.add_oracle(backend).is_ok(), "owner puede autorizar");
        assert!(contract.is_oracle(backend));

        assert!(contract.remove_oracle(backend).is_ok(), "owner puede revocar");
        assert!(!contract.is_oracle(backend));
    }

    #[test]
    fn out_of_range_attestation_returns_zeros() {
        let vm = TestVM::default();
        let mut contract = ReputationRegistry::from(&vm);

        let owner = vm.msg_sender();
        contract.constructor(owner);

        let worker = Address::from([7u8; 20]);
        let (score, timestamp, evidence) = contract.get_attestation(worker, U256::from(5));
        assert_eq!(score, 0);
        assert_eq!(timestamp, 0);
        assert_eq!(evidence, FixedBytes::<32>::ZERO);
    }
}
