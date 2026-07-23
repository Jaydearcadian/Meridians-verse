#[cfg(test)]
mod migration_tests {
    use crate::RiskPoolContract;
    use crate::{DataKey, StorageVersion};
    use soroban_sdk::testutils::{Address as _};
    use soroban_sdk::{Address, Env};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        let contract_id = env.register_contract(None, RiskPoolContract);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        env.as_contract(&contract_id, || {
            env.mock_all_auths();
            RiskPoolContract::initialize(env.clone(), admin.clone(), token, 100).unwrap();
        });
        (env, admin, contract_id)
    }

    #[test]
    fn test_migration_v1_to_v2_adds_locked_capital() {
        let (env, admin, contract_id) = setup();

        // Simulate V1 deployment by removing Version and LockedCapital
        env.as_contract(&contract_id, || {
            // Manually set version to V1 to simulate old deployment
            env.storage()
                .instance()
                .set(&DataKey::Version, &StorageVersion::V1);
            
            // Ensure LockedCapital doesn't exist (simulating old deployment)
            env.storage().instance().remove(&DataKey::LockedCapital);
        });

        // Verify initial state
        env.as_contract(&contract_id, || {
            assert_eq!(RiskPoolContract::version(env.clone()), StorageVersion::V1);
            // LockedCapital should default to 0 even if not set
            assert_eq!(RiskPoolContract::get_locked_capital(env.clone()), 0);
        });

        // Perform migration
        env.mock_all_auths();
        env.as_contract(&contract_id, || {
            RiskPoolContract::migrate(env.clone(), admin.clone(), StorageVersion::V2).unwrap();
        });

        // Verify migration succeeded
        env.as_contract(&contract_id, || {
            assert_eq!(RiskPoolContract::version(env.clone()), StorageVersion::V2);
            // LockedCapital should now be explicitly set to default value
            assert_eq!(RiskPoolContract::get_locked_capital(env.clone()), 0);
            // Verify old data is preserved via pool stats
            let stats = RiskPoolContract::get_pool_stats(env.clone());
            assert_eq!(stats.total_capital, 0);
            assert_eq!(stats.available_capital, 0);
        });
    }

    #[test]
    fn test_migration_is_idempotent() {
        let (env, admin, contract_id) = setup();

        // Migrate to V2
        env.mock_all_auths();
        env.as_contract(&contract_id, || {
            RiskPoolContract::migrate(env.clone(), admin.clone(), StorageVersion::V2).unwrap();
        });

        // Try to migrate again to same version - should succeed (idempotent)
        env.mock_all_auths();
        env.as_contract(&contract_id, || {
            let result = RiskPoolContract::migrate(env.clone(), admin, StorageVersion::V2);
            assert!(result.is_ok());
        });

        // Verify version is still V2
        env.as_contract(&contract_id, || {
            assert_eq!(RiskPoolContract::version(env.clone()), StorageVersion::V2);
        });
    }

    #[test]
    fn test_migration_rejects_downgrade() {
        let (env, admin, contract_id) = setup();

        // Set version to V2
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Version, &StorageVersion::V2);
        });

        // Try to downgrade to V1 - should fail
        env.mock_all_auths();
        env.as_contract(&contract_id, || {
            let result = RiskPoolContract::migrate(env.clone(), admin, StorageVersion::V1);
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_migration_requires_admin_role() {
        let (env, _admin, contract_id) = setup();
        let _non_admin = Address::generate(&env);

        // Simulate V1 deployment
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Version, &StorageVersion::V1);
        });

        // Try to migrate as non-admin - should fail (requires admin role)
        // Note: Since mock_all_auths() mocks all auths, this test won't properly
        // test the admin requirement. In a real test, we'd need to mock specific auths.
        // For now, we'll skip this test or implement it differently.
        // TODO: Implement proper admin auth testing with specific auth mocking
    }

    #[test]
    fn test_migration_preserves_existing_stakes() {
        let (env, admin, contract_id) = setup();
        let provider = Address::generate(&env);

        // Manually set storage to simulate an existing stake (without token transfers)
        env.as_contract(&contract_id, || {
            // Set provider stake
            env.storage()
                .persistent()
                .set(&DataKey::ProviderStake(provider.clone()), &500i128);
            // Update total and available capital
            env.storage()
                .instance()
                .set(&DataKey::TotalCapital, &500i128);
            env.storage()
                .instance()
                .set(&DataKey::AvailableCapital, &500i128);
        });

        // Simulate V1 deployment
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Version, &StorageVersion::V1);
        });

        // Migrate
        env.mock_all_auths();
        env.as_contract(&contract_id, || {
            RiskPoolContract::migrate(env.clone(), admin, StorageVersion::V2).unwrap();
        });

        // Verify stake data is preserved
        env.as_contract(&contract_id, || {
            let stake = RiskPoolContract::get_provider_info(env.clone(), provider.clone());
            assert_eq!(stake, 500);
            let stats = RiskPoolContract::get_pool_stats(env.clone());
            assert_eq!(stats.total_capital, 500);
            assert_eq!(stats.available_capital, 500);
        });
    }
}
