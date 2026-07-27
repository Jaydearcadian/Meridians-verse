    /// Token ID type alias
    pub type TokenId = u64;

    /// Chain ID type alias
    pub type ChainId = u64;

    /// Ownership transfer record
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct OwnershipTransfer {
        pub from: AccountId,
        pub to: AccountId,
        pub timestamp: u64,
        pub transaction_hash: Hash,
    }

    /// Compliance information
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct ComplianceInfo {
        pub verified: bool,
        pub verification_date: u64,
        pub verifier: AccountId,
        pub compliance_type: String,
    }

    /// Legal document information
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct DocumentInfo {
        pub document_hash: Hash,
        pub document_type: String,
        pub upload_date: u64,
        pub uploader: AccountId,
    }

    /// Bridged token information
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct BridgedTokenInfo {
        pub original_chain: ChainId,
        pub original_token_id: TokenId,
        pub destination_chain: ChainId,
        pub destination_token_id: TokenId,
        pub bridged_at: u64,
        pub status: BridgingStatus,
    }

    /// Bridging status enum
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub enum BridgingStatus {
        Locked,
        Pending,
        InTransit,
        Completed,
        Failed,
        Recovering,
        Expired,
    }

    /// Error log entry for monitoring and debugging
    #[derive(Debug, Clone, PartialEq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct ErrorLogEntry {
        pub log_id: u64,
        pub error_code: String,
        pub message: String,
        pub account: AccountId,
        pub timestamp: u64,
        pub context: Vec<(String, String)>,
        pub prev_error_hash: Hash,
        pub entry_hash: Hash,
    }

    /// Per-account sliding window state for abusive caller detection.
    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct ErrorRateState {
        pub count: u64,
        pub window_start: u64,
    }

    /// Aggregated error telemetry exposed by the contract.
    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct ErrorStats {
        pub account: AccountId,
        pub total_errors: u64,
        pub window_error_count: u64,
        pub window_start: u64,
        pub error_limit: u64,
        pub window_duration_ms: u64,
        pub remaining_before_block: u64,
        pub is_rate_limited: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct Proposal {
        pub id: u64,
        pub token_id: TokenId,
        pub description_hash: Hash,
        pub quorum: u128,
        pub for_votes: u128,
        pub against_votes: u128,
        pub status: ProposalStatus,
        pub created_at: u64,
    }

    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub enum ProposalStatus {
        Open,
        Executed,
        Rejected,
        Closed,
    }

    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct Ask {
        pub token_id: TokenId,
        pub seller: AccountId,
        pub price_per_share: u128,
        pub amount: u128,
        pub created_at: u64,
    }

    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct TaxRecord {
        pub dividends_received: u128,
        pub shares_sold: u128,
        pub proceeds: u128,
    }
