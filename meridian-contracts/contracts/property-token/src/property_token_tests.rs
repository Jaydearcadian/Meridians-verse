
        use super::*;
        use ink::env::{test, DefaultEnvironment};

        fn setup_contract() -> PropertyToken {
            PropertyToken::new()
        }

        #[ink::test]
        fn test_constructor_works() {
            let contract = setup_contract();
            assert_eq!(contract.total_supply(), 0);
            assert_eq!(contract.current_token_id(), 0);
        }

        #[ink::test]
        fn test_register_property_with_token() {
            let mut contract = setup_contract();

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let result = contract.register_property_with_token(metadata.clone());
            assert!(result.is_ok());

            let token_id = result.expect("Token registration should succeed in test");
            assert_eq!(token_id, 1);
            assert_eq!(contract.total_supply(), 1);
        }

        #[ink::test]
        fn test_balance_of() {
            let mut contract = setup_contract();

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let _token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");
            let _caller = AccountId::from([1u8; 32]);

            // Set up mock caller for the test
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            assert_eq!(contract.balance_of(accounts.alice), 1);
        }

        #[ink::test]
        fn test_attach_legal_document() {
            let mut contract = setup_contract();

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let doc_hash = Hash::from([1u8; 32]);
            let doc_type = String::from("Deed");

            let result = contract.attach_legal_document(token_id, doc_hash, doc_type);
            assert!(result.is_ok());
        }

        #[ink::test]
        fn test_verify_compliance() {
            let mut contract = setup_contract();

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            let _accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(contract.admin());

            let result = contract.verify_compliance(token_id, true);
            assert!(result.is_ok());

            let compliance_info = contract
                .compliance_flags
                .get(&token_id)
                .expect("Compliance info should exist after verification");
            assert!(compliance_info.verified);
        }

        // ============================================================================
        // EDGE CASE TESTS
        // ============================================================================

        #[ink::test]
        fn test_transfer_from_nonexistent_token() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            let result = contract.transfer_from(accounts.alice, accounts.bob, 999);
            assert_eq!(result, Err(Error::TokenNotFound));
        }

        #[ink::test]
        fn test_transfer_from_unauthorized_caller() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            // Bob tries to transfer Alice's token without approval
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            let result = contract.transfer_from(accounts.alice, accounts.bob, token_id);
            assert_eq!(result, Err(Error::Unauthorized));
        }

        #[ink::test]
        fn test_approve_nonexistent_token() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            let result = contract.approve(accounts.bob, 999);
            assert_eq!(result, Err(Error::TokenNotFound));
        }

        #[ink::test]
        fn test_approve_unauthorized_caller() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            // Bob tries to approve without being owner or operator
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            let result = contract.approve(accounts.charlie, token_id);
            assert_eq!(result, Err(Error::Unauthorized));
        }

        #[ink::test]
        fn test_owner_of_nonexistent_token() {
            let contract = setup_contract();

            assert_eq!(contract.owner_of(0), None);
            assert_eq!(contract.owner_of(1), None);
            assert_eq!(contract.owner_of(u64::MAX), None);
        }

        #[ink::test]
        fn test_balance_of_nonexistent_account() {
            let contract = setup_contract();
            let nonexistent = AccountId::from([0xFF; 32]);

            assert_eq!(contract.balance_of(nonexistent), 0);
        }

        #[ink::test]
        fn test_attach_document_to_nonexistent_token() {
            let mut contract = setup_contract();
            let doc_hash = Hash::from([1u8; 32]);

            let result = contract.attach_legal_document(999, doc_hash, "Deed".to_string());
            assert_eq!(result, Err(Error::TokenNotFound));
        }

        #[ink::test]
        fn test_attach_document_unauthorized() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            // Bob tries to attach document
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            let doc_hash = Hash::from([1u8; 32]);
            let result = contract.attach_legal_document(token_id, doc_hash, "Deed".to_string());
            assert_eq!(result, Err(Error::Unauthorized));
        }

        #[ink::test]
        fn test_verify_compliance_nonexistent_token() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let result = contract.verify_compliance(999, true);
            assert_eq!(result, Err(Error::TokenNotFound));
        }

        #[ink::test]
        fn test_initiate_bridge_invalid_chain() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            // Try to bridge to unsupported chain
            let result = contract.initiate_bridge_multisig(
                token_id,
                999, // Invalid chain ID
                accounts.bob,
                2,    // required_signatures
                None, // timeout_blocks
            );

            assert_eq!(result, Err(Error::InvalidChain));
        }

        #[ink::test]
        fn test_initiate_bridge_nonexistent_token() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            let result = contract.initiate_bridge_multisig(
                999,          // nonexistent token_id
                2,            // destination_chain
                accounts.bob, // recipient
                2,            // required_signatures
                None,         // timeout_blocks
            );

            assert_eq!(result, Err(Error::TokenNotFound));
        }

        #[ink::test]
        fn test_sign_bridge_request_nonexistent() {
            let mut contract = setup_contract();
            let _accounts = test::default_accounts::<DefaultEnvironment>();

            let result = contract.sign_bridge_request(999, true);
            assert_eq!(result, Err(Error::InvalidRequest));
        }

        #[ink::test]
        fn test_register_multiple_properties_increments_ids() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            for i in 1..=10 {
                let metadata = PropertyMetadata {
                    location: format!("Property {}", i),
                    size: 1000 + i,
                    legal_description: format!("Description {}", i),
                    valuation: 100_000 + (i as u128 * 1000),
                    documents_url: format!("ipfs://prop{}", i),
                };

                let token_id = contract
                    .register_property_with_token(metadata)
                    .expect("Token registration should succeed in test");
                assert_eq!(token_id, i);
                assert_eq!(contract.total_supply(), i);
            }
        }

        #[ink::test]
        fn test_transfer_preserves_total_supply() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("123 Main St"),
                size: 1000,
                legal_description: String::from("Sample property"),
                valuation: 500000,
                documents_url: String::from("ipfs://sample-docs"),
            };

            let token_id = contract
                .register_property_with_token(metadata)
                .expect("Token registration should succeed in test");

            let initial_supply = contract.total_supply();

            contract
                .transfer_from(accounts.alice, accounts.bob, token_id)
                .expect("Transfer should succeed");

            // Total supply should remain constant
            assert_eq!(contract.total_supply(), initial_supply);
        }

        #[ink::test]
        fn test_balance_of_batch_empty_vectors() {
            let contract = setup_contract();

            let result = contract.balance_of_batch(Vec::new(), Vec::new());
            assert_eq!(result, Vec::<u128>::new());
        }

        #[ink::test]
        fn test_get_error_count_nonexistent() {
            let contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            let count = contract.get_error_count(accounts.alice, "NONEXISTENT".to_string());
            assert_eq!(count, 0);
        }

        #[ink::test]
        fn test_get_error_rate_nonexistent() {
            let contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            let rate = contract.get_error_rate(accounts.alice);
            assert_eq!(rate, 0);
        }

        #[ink::test]
        fn test_get_recent_errors_unauthorized() {
            let contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            // Non-admin tries to get errors
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            let errors = contract.get_recent_errors(10);
            assert_eq!(errors, Vec::new());
        }

        #[ink::test]
        fn test_error_log_cap_respected() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            test::set_caller::<DefaultEnvironment>(contract.admin());
            contract
                .set_error_limit(MAX_ERROR_LOG + 10)
                .expect("admin should update error limit");

            test::set_caller::<DefaultEnvironment>(accounts.bob);
            for token_id in 0..(MAX_ERROR_LOG + 5) {
                let result = contract.transfer_from(accounts.bob, accounts.charlie, token_id + 1_000);
                assert_eq!(result, Err(Error::TokenNotFound));
            }

            test::set_caller::<DefaultEnvironment>(contract.admin());
            let errors = contract.get_recent_errors((MAX_ERROR_LOG + 10) as u32);
            assert_eq!(errors.len(), MAX_ERROR_LOG as usize);
            assert_eq!(errors.first().expect("first retained error").log_id, 5);
            assert_eq!(
                errors.last().expect("last retained error").log_id,
                MAX_ERROR_LOG + 4
            );
        }

        #[ink::test]
        fn test_rate_limit_blocks_abusive_caller() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            test::set_caller::<DefaultEnvironment>(contract.admin());
            contract
                .set_error_limit(3)
                .expect("admin should update error limit");

            test::set_block_timestamp::<DefaultEnvironment>(1);
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            for _ in 0..3 {
                let result = contract.transfer_from(accounts.bob, accounts.charlie, 999);
                assert_eq!(result, Err(Error::TokenNotFound));
            }

            let stats = contract.get_error_stats(accounts.bob);
            assert_eq!(stats.total_errors, 3);
            assert_eq!(stats.window_error_count, 3);
            assert!(stats.is_rate_limited);
            assert_eq!(stats.remaining_before_block, 0);

            let blocked = contract.transfer_from(accounts.bob, accounts.charlie, 999);
            assert_eq!(blocked, Err(Error::RateLimited));

            test::set_caller::<DefaultEnvironment>(contract.admin());
            let errors = contract.get_recent_errors(10);
            assert_eq!(errors.len(), 3);

            test::set_block_timestamp::<DefaultEnvironment>(ERROR_WINDOW_DURATION_MS + 10);
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            let after_window = contract.transfer_from(accounts.bob, accounts.charlie, 999);
            assert_eq!(after_window, Err(Error::TokenNotFound));
        }

        fn verify_error_chain(entries: &[ErrorLogEntry]) -> bool {
            let zero_hash = Hash::from([0u8; 32]);

            for (index, entry) in entries.iter().enumerate() {
                let expected_prev = if index == 0 {
                    zero_hash
                } else {
                    entries[index - 1].entry_hash
                };

                if entry.prev_error_hash != expected_prev {
                    return false;
                }

                let recalculated = PropertyToken::hash_error_entry(
                    entry.log_id,
                    &entry.account,
                    &entry.error_code,
                    &entry.message,
                    entry.timestamp,
                    &entry.context,
                    &entry.prev_error_hash,
                );
                if entry.entry_hash != recalculated {
                    return false;
                }
            }

            true
        }

        #[ink::test]
        fn test_error_log_hash_chain_verifies() {
            let mut contract = setup_contract();
            let accounts = test::default_accounts::<DefaultEnvironment>();

            test::set_caller::<DefaultEnvironment>(contract.admin());
            contract
                .set_error_limit(10)
                .expect("admin should update error limit");

            test::set_caller::<DefaultEnvironment>(accounts.bob);
            for timestamp in 1..=3 {
                test::set_block_timestamp::<DefaultEnvironment>(timestamp);
                let result = contract.transfer_from(accounts.bob, accounts.charlie, 7_000 + timestamp);
                assert_eq!(result, Err(Error::TokenNotFound));
            }

            test::set_caller::<DefaultEnvironment>(contract.admin());
            let errors = contract.get_recent_errors(10);
            assert_eq!(errors.len(), 3);
            assert!(verify_error_chain(&errors));
        }

        // Helper: registers a property, verifies compliance, adds bob as operator,
        // and returns the token_id.
        fn setup_bridge_ready_token(contract: &mut PropertyToken) -> u64 {
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);

            let metadata = PropertyMetadata {
                location: String::from("Bridge St"),
                size: 1000,
                legal_description: String::from("Bridge test property"),
                valuation: 500000,
                documents_url: String::from("ipfs://bridge"),
            };
            let token_id = contract
                .register_property_with_token(metadata)
                .expect("registration should succeed");

            test::set_caller::<DefaultEnvironment>(contract.admin());
            contract
                .verify_compliance(token_id, true)
                .expect("compliance verification should succeed");
            contract
                .add_bridge_operator(accounts.bob)
                .expect("add operator should succeed");

            token_id
        }

        #[ink::test]
        fn test_duplicate_bridge_request_rejected() {
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let mut contract = setup_contract();
            let token_id = setup_bridge_ready_token(&mut contract);

            // First request must succeed
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let first = contract.initiate_bridge_multisig(
                token_id,
                2,
                accounts.bob,
                2,
                None,
            );
            assert!(first.is_ok(), "first bridge request should succeed");

            // Second request for the same token must be rejected
            let second = contract.initiate_bridge_multisig(
                token_id,
                2,
                accounts.bob,
                2,
                None,
            );
            assert_eq!(second, Err(Error::DuplicateBridgeRequest));
        }

        #[ink::test]
        fn test_pending_cleared_on_rejection() {
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let mut contract = setup_contract();
            let token_id = setup_bridge_ready_token(&mut contract);

            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let request_id = contract
                .initiate_bridge_multisig(token_id, 2, accounts.bob, 2, None)
                .expect("initiate should succeed");

            // Operator rejects
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            contract
                .sign_bridge_request(request_id, false)
                .expect("rejection should succeed");

            // A new request for the same token must now succeed (mapping entry cleared)
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let second = contract.initiate_bridge_multisig(
                token_id,
                2,
                accounts.bob,
                2,
                None,
            );
            assert!(second.is_ok(), "new request after rejection should succeed");
        }

        #[ink::test]
        fn test_retry_bridge_restores_pending_guard() {
            let accounts = test::default_accounts::<DefaultEnvironment>();
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let mut contract = setup_contract();
            let token_id = setup_bridge_ready_token(&mut contract);

            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let request_id = contract
                .initiate_bridge_multisig(token_id, 2, accounts.bob, 2, None)
                .expect("initiate should succeed");

            // Operator rejects -> mapping entry removed
            test::set_caller::<DefaultEnvironment>(accounts.bob);
            contract
                .sign_bridge_request(request_id, false)
                .expect("rejection should succeed");

            // Admin retries -> mapping entry must be restored
            test::set_caller::<DefaultEnvironment>(contract.admin());
            contract
                .recover_failed_bridge(request_id, RecoveryAction::RetryBridge)
                .expect("retry recovery should succeed");

            // Duplicate request must now be blocked again
            test::set_caller::<DefaultEnvironment>(accounts.alice);
            let dup = contract.initiate_bridge_multisig(
                token_id,
                2,
                accounts.bob,
                2,
                None,
            );
            assert_eq!(
                dup,
                Err(Error::DuplicateBridgeRequest),
                "duplicate should be blocked after retry recovery"
            );
        }
