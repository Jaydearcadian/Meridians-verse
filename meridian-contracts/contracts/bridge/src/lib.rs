#![no_std]

mod storage;
mod types;
mod validation;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, String, Vec};

use storage::{DataKey, MAX_HISTORY_ITEMS};
use types::{
    BridgeConfig, BridgeOperationStatus, BridgeTransaction, ChainBridgeInfo,
    InboundBridgeMessage, MultisigBridgeRequest, PropertyMetadata, RecoveryAction,
};
use validation::{
    require_admin, require_future_timestamp, require_non_zero_address, require_non_zero_u128,
    require_non_zero_u32, require_non_zero_u64, require_not_paused, require_operator,
    require_supported_chain, require_valid_signatures,
};

const CONTRACT_VERSION: u32 = 1;
const MAX_SUPPORTED_CHAINS: u32 = 20;
const MAX_OPERATORS: u32 = 10;

#[contract]
pub struct PropertyBridge;

#[contractimpl]
impl PropertyBridge {
    pub fn init(
        env: Env,
        admin: Address,
        supported_chains: Vec<u32>,
        min_signatures: u32,
        max_signatures: u32,
        default_timeout: u64,
        gas_limit: u64,
        service_fee: i128,
        fee_token: Address, 
        fee_recipient: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        require_non_zero_address(&admin);
        require_non_zero_address(&fee_token);
        require_non_zero_address(&fee_recipient);
        if supported_chains.is_empty() {
            panic!("At least one supported chain is required");
        }
        require_non_zero_u32(min_signatures, "min_signatures");
        require_non_zero_u32(max_signatures, "max_signatures");
        require_non_zero_u64(default_timeout, "default_timeout");
        require_non_zero_u64(gas_limit, "gas_limit");

        if supported_chains.len() > MAX_SUPPORTED_CHAINS {
            panic!("Too many chains");
        }
        for chain_id in supported_chains.iter() {
            require_non_zero_u32(chain_id, "supported_chain");
        }
        if min_signatures > max_signatures {
            panic!("min_signatures cannot exceed max_signatures");
        }

        let config = BridgeConfig {
            supported_chains: supported_chains.clone(),
            min_signatures_required: min_signatures,
            max_signatures_required: max_signatures,
            default_timeout_seconds: default_timeout,
            gas_limit_per_bridge: gas_limit,
            emergency_pause: false,
            metadata_preservation: true,
            service_fee,
            fee_token,
            fee_recipient,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Version, &CONTRACT_VERSION);
        env.storage().instance().set(&DataKey::ReqCounter, &0u64);
        env.storage().instance().set(&DataKey::TxCounter, &0u64);

        let mut operators = Vec::new(&env);
        operators.push_back(admin.clone());
        env.storage().instance().set(&DataKey::Operators, &operators);

        for chain_id in supported_chains.iter() {
            let chain_info = ChainBridgeInfo {
                chain_id,
                chain_name: String::from_str(&env, "Chain"),
                bridge_contract_address: String::from_str(&env, ""),
                is_active: true,
                gas_multiplier: 100,
                confirmation_blocks: 6,
                supported_tokens: Vec::new(&env),
            };
            env.storage()
                .persistent()
                .set(&DataKey::ChainInfo(chain_id), &chain_info);
        }
        
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("init")),
            (admin, min_signatures, max_signatures),
        );
    }

    pub fn initiate_bridge_multisig(
        env: Env,
        caller: Address,
        token_id: u64,
        destination_chain: u32,
        recipient: Address,
        required_signatures: u32,
        timeout_seconds: Option<u64>,
        metadata: PropertyMetadata,
        nonce: u64,
    ) -> u64 {
        caller.require_auth();
        require_non_zero_address(&caller);
        require_non_zero_address(&recipient);
        require_non_zero_u64(token_id, "token_id");
        require_non_zero_u32(required_signatures, "required_signatures");
        require_non_zero_u64(metadata.size, "metadata.size");
        require_non_zero_u128(metadata.valuation, "metadata.valuation");
        if let Some(seconds) = timeout_seconds {
            require_non_zero_u64(seconds, "timeout_seconds");
        }

        let current_nonce: u64 = env.storage().persistent().get(&DataKey::Nonce(caller.clone())).unwrap_or(0);
        if nonce != current_nonce + 1 {
            panic!("Invalid nonce");
        }
        env.storage().persistent().set(&DataKey::Nonce(caller.clone()), &nonce);

        let config: BridgeConfig = env.storage().instance().get(&DataKey::Config)
            .unwrap_or_else(|| panic!("Contract not initialized"));

        if config.service_fee > 0 {
            use soroban_sdk::token;
            let client = token::Client::new(&env, &config.fee_token);
            client.transfer(&caller, &config.fee_recipient, &config.service_fee);
        }
        require_not_paused(&env);
        require_supported_chain(&config, destination_chain);
        require_valid_signatures(&config, required_signatures);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReqCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::ReqCounter, &counter);

        let now = env.ledger().timestamp();
        let expires_at = timeout_seconds.map(|s| now + s);
        
        if let Some(expiry) = expires_at {
            require_future_timestamp(expiry, now, "expires_at");
        }

        let request = MultisigBridgeRequest {
            request_id: counter,
            token_id,
            source_chain: 1,
            destination_chain,
            sender: caller.clone(),
            recipient,
            required_signatures,
            signatures: Vec::new(&env),
            created_at: now,
            expires_at,
            status: BridgeOperationStatus::Pending,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Request(counter), &request);

        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("created")),
            (counter, token_id, caller),
        );

        counter
    }

    pub fn sign_bridge_request(env: Env, operator: Address, request_id: u64, approve: bool) {
        operator.require_auth();
        require_non_zero_address(&operator);
        require_non_zero_u64(request_id, "request_id");
        require_operator(&env, &operator);
        require_not_paused(&env);

        let mut request: MultisigBridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::Request(request_id))
            .expect("Request not found");

        if let Some(expires_at) = request.expires_at {
            if env.ledger().timestamp() > expires_at {
                panic!("Request expired");
            }
        }

        if request.signatures.contains(operator.clone()) {
            panic!("Already signed");
        }

        request.signatures.push_back(operator.clone());

        if !approve {
            request.status = BridgeOperationStatus::Failed;
        } else if request.signatures.len() >= request.required_signatures {
            request.status = BridgeOperationStatus::Locked;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Request(request_id), &request);
        
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("signed")),
            (request_id, operator, approve),
        );
    }

    pub fn execute_bridge(env: Env, operator: Address, request_id: u64) {
        operator.require_auth();
        require_non_zero_address(&operator);
        require_non_zero_u64(request_id, "request_id");
        require_operator(&env, &operator);
        require_not_paused(&env);

        let mut request: MultisigBridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::Request(request_id))
            .expect("Request not found");

        if request.status != BridgeOperationStatus::Locked {
            panic!("Request not ready");
        }

        let tx_hash = env
            .crypto()
            .sha256(&Bytes::from_slice(&env, &request_id.to_be_bytes()));

        let mut tx_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TxCounter)
            .unwrap_or(0);
        tx_counter += 1;
        env.storage().instance().set(&DataKey::TxCounter, &tx_counter);

        let sender = request.sender.clone();

        let transaction = BridgeTransaction {
            transaction_id: tx_counter,
            token_id: request.token_id,
            source_chain: request.source_chain,
            destination_chain: request.destination_chain,
            sender: sender.clone(),
            recipient: request.recipient.clone(),
            transaction_hash: tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
            gas_used: 0,
            status: BridgeOperationStatus::InTransit,
            metadata: request.metadata.clone(),
        };

        request.status = BridgeOperationStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Request(request_id), &request);
        env.storage()
            .persistent()
            .set(&DataKey::VerifiedTx(tx_hash.clone()), &true);

        let mut history: Vec<BridgeTransaction> = env
            .storage()
            .persistent()
            .get(&DataKey::History(sender.clone()))
            .unwrap_or(Vec::new(&env));

        if history.len() >= MAX_HISTORY_ITEMS {
            history.remove(0);
        }
        history.push_back(transaction);
        env.storage()
            .persistent()
            .set(&DataKey::History(sender), &history);

        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("executed")),
            (request_id, tx_hash),
        );
    }

    pub fn recover_failed_bridge(
        env: Env,
        admin: Address,
        request_id: u64,
        recovery_action: RecoveryAction,
    ) {
        admin.require_auth();
        require_non_zero_address(&admin);
        require_non_zero_u64(request_id, "request_id");
        require_admin(&env, &admin);
        require_not_paused(&env);

        let mut request: MultisigBridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::Request(request_id))
            .expect("Request not found");

        if !matches!(
            request.status,
            BridgeOperationStatus::Failed | BridgeOperationStatus::Expired
        ) {
            panic!("Request not in failed state");
        }

        match recovery_action {
            RecoveryAction::RetryBridge => {
                request.status = BridgeOperationStatus::Pending;
                request.signatures = Vec::new(&env);
            }
            RecoveryAction::CancelBridge
            | RecoveryAction::UnlockToken
            | RecoveryAction::RefundGas => {
                request.status = BridgeOperationStatus::Failed;
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Request(request_id), &request);
        
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("recover")),
            request_id,
        );
    }

    pub fn set_pause(env: Env, admin: Address, paused: bool) {
        admin.require_auth();
        require_non_zero_address(&admin);
        require_admin(&env, &admin);

        let mut config: BridgeConfig = env.storage().instance().get(&DataKey::Config)
            .unwrap_or_else(|| panic!("Contract not initialized"));
        config.emergency_pause = paused;
        env.storage().instance().set(&DataKey::Config, &config);
        
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("pause")),
            paused,
        );
    }

    pub fn add_operator(env: Env, admin: Address, operator: Address) {
        admin.require_auth();
        require_non_zero_address(&admin);
        require_non_zero_address(&operator);
        require_admin(&env, &admin);

        let mut operators: Vec<Address> =
            env.storage().instance().get(&DataKey::Operators)
                .unwrap_or_else(|| panic!("Contract not initialized"));
        
        if operators.len() >= MAX_OPERATORS {
            panic!("Too many operators");
        }

        if !operators.contains(operator.clone()) {
            operators.push_back(operator.clone());
            env.storage().instance().set(&DataKey::Operators, &operators);
            
            env.events().publish(
                (symbol_short!("bridge"), symbol_short!("opadd")),
                operator,
            );
        }
    }

    pub fn remove_operator(env: Env, admin: Address, operator: Address) {
        admin.require_auth();
        require_non_zero_address(&admin);
        require_non_zero_address(&operator);
        require_admin(&env, &admin);

        let operators: Vec<Address> =
            env.storage().instance().get(&DataKey::Operators)
                .unwrap_or_else(|| panic!("Contract not initialized"));
        
        let config: BridgeConfig = env.storage().instance().get(&DataKey::Config)
            .unwrap_or_else(|| panic!("Contract not initialized"));

        if operators.len() <= config.min_signatures_required {
            panic!("Cannot remove operator: minimum signature requirement would not be met");
        }

        let mut new_operators = Vec::new(&env);
        for op in operators.iter() {
            if op != operator {
                new_operators.push_back(op);
            }
        }
        env.storage().instance().set(&DataKey::Operators, &new_operators);
        
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("oprm")),
            operator,
        );
    }

    pub fn set_confirmation_depth(env: Env, admin: Address, depth: u32) {
        admin.require_auth();
        require_non_zero_address(&admin);
        require_admin(&env, &admin);
        require_non_zero_u32(depth, "confirmation_depth");
        env.storage()
            .instance()
            .set(&DataKey::ConfirmationDepth, &depth);
        env.events().publish(
            (symbol_short!("bridge"), symbol_short!("confdepth")),
            depth,
        );
    }

    pub fn claim_bridge_message(
        env: Env,
        caller: Address,
        message: InboundBridgeMessage,
    ) -> u64 {
        caller.require_auth();
        require_non_zero_address(&caller);

        let config: BridgeConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic!("Contract not initialized"));
        require_not_paused(&env);
        require_supported_chain(&config, message.source_chain);

        // 1. Prevent double execution via processed-message set
        if env
            .storage()
            .persistent()
            .has(&DataKey::ProcessedMessage(message.message_hash.clone()))
        {
            panic!("Message already processed");
        }

        // 2. Validate per-(source_chain, sender) monotonic nonce
        let expected_nonce: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::InboundNonce(
                message.source_chain,
                message.sender.clone(),
            ))
            .unwrap_or(1);
        if message.nonce != expected_nonce {
            panic!("Invalid inbound nonce");
        }

        // 3. Finality / confirmation-depth check
        let confirmation_depth: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ConfirmationDepth)
            .unwrap_or(10);
        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < message.source_ledger + confirmation_depth as u64 {
            panic!("Message not yet final");
        }

        // 4. Mark message as processed
        env.storage().persistent().set(
            &DataKey::ProcessedMessage(message.message_hash.clone()),
            &true,
        );

        // 5. Increment inbound nonce
        env.storage().persistent().set(
            &DataKey::InboundNonce(message.source_chain, message.sender.clone()),
            &(message.nonce + 1),
        );

        // 6. Create bridge transaction record
        let mut tx_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TxCounter)
            .unwrap_or(0);
        tx_counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::TxCounter, &tx_counter);

        let transaction = BridgeTransaction {
            transaction_id: tx_counter,
            token_id: message.token_id,
            source_chain: message.source_chain,
            destination_chain: message.destination_chain,
            sender: message.sender.clone(),
            recipient: message.recipient.clone(),
            transaction_hash: message.message_hash.clone(),
            timestamp: env.ledger().timestamp(),
            gas_used: 0,
            status: BridgeOperationStatus::Completed,
            metadata: message.metadata,
        };

        let mut history: Vec<BridgeTransaction> = env
            .storage()
            .persistent()
            .get(&DataKey::History(message.recipient.clone()))
            .unwrap_or(Vec::new(&env));
        if history.len() >= MAX_HISTORY_ITEMS {
            history.remove(0);
        }
        history.push_back(transaction);
        env.storage()
            .persistent()
            .set(&DataKey::History(message.recipient.clone()), &history);

        env.events().publish(
            (
                symbol_short!("bridge"),
                symbol_short!("claimed"),
            ),
            (
                tx_counter,
                message.message_hash,
                message.source_chain,
                message.sender,
            ),
        );

        tx_counter
    }
}

#[contractimpl]
impl PropertyBridge {
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(CONTRACT_VERSION)
    }

    pub fn get_config(env: Env) -> BridgeConfig {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .expect("Contract not initialized")
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized")
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<MultisigBridgeRequest> {
        env.storage().persistent().get(&DataKey::Request(request_id))
    }

    pub fn get_history(env: Env, address: Address) -> Vec<BridgeTransaction> {
        env.storage()
            .persistent()
            .get(&DataKey::History(address))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_chain_info(env: Env, chain_id: u32) -> Option<ChainBridgeInfo> {
        env.storage().persistent().get(&DataKey::ChainInfo(chain_id))
    }

    pub fn is_operator(env: Env, address: Address) -> bool {
        let operators: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Operators)
            .unwrap_or(Vec::new(&env));
        operators.contains(address)
    }

    pub fn get_nonce(env: Env, address: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Nonce(address))
            .unwrap_or(0)
    }

    pub fn get_confirmation_depth(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ConfirmationDepth)
            .unwrap_or(10)
    }

    pub fn get_inbound_nonce(env: Env, source_chain: u32, sender: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::InboundNonce(source_chain, sender))
            .unwrap_or(1)
    }

    pub fn is_message_processed(env: Env, message_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ProcessedMessage(message_hash))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let mut chains = Vec::new(&env);
        chains.push_back(1u32);
        chains.push_back(2u32);

        let contract_addr = env.register_contract(None, PropertyBridge);
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        env.mock_all_auths();
        client.init(
            &admin,
            &chains,
            &1u32,
            &3u32,
            &60u64,
            &1_000_000u64,
            &100i128,
            &token,
            &fee_recipient,
        );
        client.set_confirmation_depth(&admin, &5u32);
        env.ledger().with_mut(|li| li.sequence_number = 100);
        (env, contract_addr)
    }

    fn make_message(
        env: &Env,
        source_chain: u32,
        sender: &Address,
        nonce: u64,
        message_hash: BytesN<32>,
        source_ledger: u64,
        recipient: &Address,
    ) -> InboundBridgeMessage {
        InboundBridgeMessage {
            source_chain,
            sender: sender.clone(),
            nonce,
            message_hash,
            source_ledger,
            destination_chain: 1,
            recipient: recipient.clone(),
            token_id: 100,
            metadata: PropertyMetadata {
                location: String::from_str(env, "NYC"),
                size: 1000,
                legal_description: String::from_str(env, "Unit 1A"),
                valuation: 500_000,
                documents_url: String::from_str(env, "https://example.com"),
            },
        }
    }

    #[test]
    fn test_claim_bridge_message_success() {
        let (env, contract_addr) = setup();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let hash = env.crypto().sha256(&Bytes::from_slice(&env, &1u64.to_be_bytes()));
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        let msg = make_message(&env, 2, &sender, 1, hash.clone(), 95, &recipient);
        let tx_id = client.claim_bridge_message(&admin, &msg);
        assert_eq!(tx_id, 1);
        assert!(client.is_message_processed(&hash));
        assert_eq!(client.get_inbound_nonce(&2, &sender), 2);
    }

    #[test]
    fn test_finality_passes_at_exact_depth() {
        let (env, contract_addr) = setup();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let hash = env.crypto().sha256(&Bytes::from_slice(&env, &1u64.to_be_bytes()));
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        let msg = make_message(&env, 2, &sender, 1, hash.clone(), 95, &recipient);
        let tx_id = client.claim_bridge_message(&admin, &msg);
        assert_eq!(tx_id, 1);
        assert!(client.is_message_processed(&hash));
    }

    #[test]
    fn test_sequential_nonces_accepted() {
        let (env, contract_addr) = setup();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        for i in 1..=3u64 {
            let hash = env
                .crypto()
                .sha256(&Bytes::from_slice(&env, &i.to_be_bytes()));
            let msg = make_message(&env, 2, &sender, i, hash.clone(), 95, &recipient);
            let tx_id = client.claim_bridge_message(&admin, &msg);
            assert_eq!(tx_id, i);
            assert!(client.is_message_processed(&hash));
        }
        assert_eq!(client.get_inbound_nonce(&2, &sender), 4);
    }

    #[test]
    fn test_initial_state() {
        let (env, contract_addr) = setup();
        let client = PropertyBridgeClient::new(&env, &contract_addr);
        let sender = Address::generate(&env);
        let hash = env.crypto().sha256(&Bytes::from_slice(&env, &99u64.to_be_bytes()));
        assert_eq!(client.get_confirmation_depth(), 5);
        assert_eq!(client.get_inbound_nonce(&2, &sender), 1);
        assert!(!client.is_message_processed(&hash));
    }

    #[test]
    fn test_multiple_chains_independent_nonces() {
        let (env, contract_addr) = setup();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        let hash1 = env.crypto().sha256(&Bytes::from_slice(&env, &10u64.to_be_bytes()));
        let msg1 = make_message(&env, 1, &sender, 1, hash1.clone(), 95, &recipient);
        client.claim_bridge_message(&admin, &msg1);
        assert_eq!(client.get_inbound_nonce(&1, &sender), 2);
        assert_eq!(client.get_inbound_nonce(&2, &sender), 1);

        let hash2 = env.crypto().sha256(&Bytes::from_slice(&env, &20u64.to_be_bytes()));
        let msg2 = make_message(&env, 2, &sender, 1, hash2.clone(), 95, &recipient);
        client.claim_bridge_message(&admin, &msg2);
        assert_eq!(client.get_inbound_nonce(&1, &sender), 2);
        assert_eq!(client.get_inbound_nonce(&2, &sender), 2);
        assert!(client.is_message_processed(&hash1));
        assert!(client.is_message_processed(&hash2));
    }

    #[test]
    fn test_history_recorded() {
        let (env, contract_addr) = setup();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let client = PropertyBridgeClient::new(&env, &contract_addr);

        assert!(client.get_history(&recipient).is_empty());

        let hash = env.crypto().sha256(&Bytes::from_slice(&env, &7u64.to_be_bytes()));
        let msg = make_message(&env, 2, &sender, 1, hash, 95, &recipient);
        client.claim_bridge_message(&admin, &msg);

        let history = client.get_history(&recipient);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get_unchecked(0).source_chain, 2);
    }
}
