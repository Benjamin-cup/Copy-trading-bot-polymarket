import {
    calculateOrderSize,
    getTradeMultiplier,
    validateCopyStrategyConfig,
    getRecommendedConfig,
    parseTieredMultipliers,
    CopyStrategy,
    type CopyStrategyConfig,
    type OrderSizeCalculation,
} from '../../config/copyStrategy';

describe('Copy Strategy Configuration', () => {
    describe('calculateOrderSize', () => {
        const baseConfig: CopyStrategyConfig = {
            strategy: CopyStrategy.PERCENTAGE,
            copySize: 10.0,
            maxOrderSizeUSD: 100.0,
            minOrderSizeUSD: 1.0,
        };

        it('should calculate percentage-based order size correctly', () => {
            const result: OrderSizeCalculation = calculateOrderSize(
                baseConfig,
                100.0, // traderOrderSize
                50.0,  // availableBalance
                0      // currentPositionSize
            );

            expect(result.traderOrderSize).toBe(100.0);
            expect(result.baseAmount).toBe(10.0); // 10% of 100
            expect(result.finalAmount).toBe(10.0);
            expect(result.strategy).toBe(CopyStrategy.PERCENTAGE);
            expect(result.cappedByMax).toBe(false);
            expect(result.reducedByBalance).toBe(false);
            expect(result.belowMinimum).toBe(false);
            expect(result.reasoning).toContain('10% of $100.00 = $10.00');
        });

        it('should calculate fixed amount correctly', () => {
            const fixedConfig: CopyStrategyConfig = {
                ...baseConfig,
                strategy: CopyStrategy.FIXED,
                copySize: 25.0,
            };

            const result = calculateOrderSize(fixedConfig, 100.0, 50.0, 0);

            expect(result.baseAmount).toBe(25.0);
            expect(result.finalAmount).toBe(25.0);
            expect(result.reasoning).toContain('Fixed amount: $25.00');
        });

        it('should calculate adaptive percentage correctly', () => {
            const adaptiveConfig: CopyStrategyConfig = {
                ...baseConfig,
                strategy: CopyStrategy.ADAPTIVE,
                copySize: 10.0,
                adaptiveMinPercent: 5.0,
                adaptiveMaxPercent: 15.0,
                adaptiveThreshold: 200.0,
            };

            // Small order (< threshold): should use higher percentage
            const smallOrder = calculateOrderSize(adaptiveConfig, 50.0, 100.0, 0);
            expect(smallOrder.baseAmount).toBeGreaterThan(5.0); // Higher percentage

            // Large order (> threshold): should use lower percentage
            const largeOrder = calculateOrderSize(adaptiveConfig, 500.0, 100.0, 0);
            expect(largeOrder.baseAmount).toBeLessThan(5.0); // Lower percentage
        });

        it('should apply maximum order size limit', () => {
            const result = calculateOrderSize(
                { ...baseConfig, maxOrderSizeUSD: 5.0 },
                100.0, // traderOrderSize
                50.0,  // availableBalance
                0      // currentPositionSize
            );

            expect(result.finalAmount).toBe(5.0);
            expect(result.cappedByMax).toBe(true);
            expect(result.reasoning).toContain('Capped at max $5.00');
        });

        it('should apply balance reduction', () => {
            const result = calculateOrderSize(
                baseConfig,
                100.0, // traderOrderSize
                5.0,   // availableBalance (insufficient)
                0      // currentPositionSize
            );

            expect(result.finalAmount).toBe(4.95); // 5.0 * 0.99
            expect(result.reducedByBalance).toBe(true);
            expect(result.reasoning).toContain('Reduced to fit balance');
        });

        it('should apply position size limit', () => {
            const configWithPositionLimit: CopyStrategyConfig = {
                ...baseConfig,
                maxPositionSizeUSD: 50.0,
            };

            const result = calculateOrderSize(
                configWithPositionLimit,
                100.0, // traderOrderSize
                100.0, // availableBalance
                45.0   // currentPositionSize (45 + 10 > 50)
            );

            expect(result.finalAmount).toBe(5.0); // 50 - 45
            expect(result.reasoning).toContain('Reduced to fit position limit');
        });

        it('should skip orders below minimum size', () => {
            const result = calculateOrderSize(
                { ...baseConfig, minOrderSizeUSD: 20.0 },
                100.0, // traderOrderSize
                50.0,  // availableBalance
                0      // currentPositionSize
            );

            expect(result.finalAmount).toBe(0);
            expect(result.belowMinimum).toBe(true);
            expect(result.reasoning).toContain('Below minimum $20.00');
        });

        it('should apply tiered multipliers', () => {
            const configWithTiers: CopyStrategyConfig = {
                ...baseConfig,
                tieredMultipliers: [
                    { min: 0, max: 50, multiplier: 2.0 },
                    { min: 50, max: 200, multiplier: 1.0 },
                    { min: 200, max: null, multiplier: 0.5 },
                ],
            };

            // Small trade: 2x multiplier
            const smallTrade = calculateOrderSize(configWithTiers, 25.0, 100.0, 0);
            expect(smallTrade.finalAmount).toBe(20.0); // 10 * 2

            // Medium trade: 1x multiplier
            const mediumTrade = calculateOrderSize(configWithTiers, 100.0, 100.0, 0);
            expect(mediumTrade.finalAmount).toBe(10.0); // 10 * 1

            // Large trade: 0.5x multiplier
            const largeTrade = calculateOrderSize(configWithTiers, 300.0, 100.0, 0);
            expect(largeTrade.finalAmount).toBe(5.0); // 10 * 0.5
        });
    });

    describe('getTradeMultiplier', () => {
        it('should return 1.0 when no multipliers configured', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            expect(getTradeMultiplier(config, 100.0)).toBe(1.0);
        });

        it('should use legacy single multiplier', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
                tradeMultiplier: 1.5,
            };

            expect(getTradeMultiplier(config, 100.0)).toBe(1.5);
        });

        it('should apply tiered multipliers correctly', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
                tieredMultipliers: [
                    { min: 0, max: 50, multiplier: 2.0 },
                    { min: 50, max: 200, multiplier: 1.0 },
                    { min: 200, max: null, multiplier: 0.5 },
                ],
            };

            expect(getTradeMultiplier(config, 25.0)).toBe(2.0);
            expect(getTradeMultiplier(config, 100.0)).toBe(1.0);
            expect(getTradeMultiplier(config, 300.0)).toBe(0.5);
        });

        it('should prioritize tiered multipliers over legacy multiplier', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
                tradeMultiplier: 1.5,
                tieredMultipliers: [
                    { min: 0, max: 100, multiplier: 2.0 },
                ],
            };

            expect(getTradeMultiplier(config, 50.0)).toBe(2.0);
        });
    });

    describe('validateCopyStrategyConfig', () => {
        it('should validate valid configuration', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toHaveLength(0);
        });

        it('should reject invalid copySize', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: -5.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('copySize must be positive');
        });

        it('should reject percentage > 100', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 150.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('copySize for PERCENTAGE strategy should be <= 100');
        });

        it('should reject invalid limits', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: -10.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('maxOrderSizeUSD must be positive');
        });

        it('should reject min > max order size', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 50.0,
                minOrderSizeUSD: 100.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('minOrderSizeUSD cannot be greater than maxOrderSizeUSD');
        });

        it('should require adaptive parameters for ADAPTIVE strategy', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.ADAPTIVE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('ADAPTIVE strategy requires adaptiveMinPercent and adaptiveMaxPercent');
        });

        it('should reject invalid adaptive parameters', () => {
            const config: CopyStrategyConfig = {
                strategy: CopyStrategy.ADAPTIVE,
                copySize: 10.0,
                adaptiveMinPercent: 15.0,
                adaptiveMaxPercent: 5.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const errors = validateCopyStrategyConfig(config);
            expect(errors).toContain('adaptiveMinPercent cannot be greater than adaptiveMaxPercent');
        });
    });

    describe('getRecommendedConfig', () => {
        it('should return conservative config for small balance', () => {
            const config = getRecommendedConfig(300.0);
            expect(config.strategy).toBe(CopyStrategy.PERCENTAGE);
            expect(config.copySize).toBe(5.0);
            expect(config.maxOrderSizeUSD).toBe(20.0);
            expect(config.minOrderSizeUSD).toBe(1.0);
        });

        it('should return balanced config for medium balance', () => {
            const config = getRecommendedConfig(1500.0);
            expect(config.strategy).toBe(CopyStrategy.PERCENTAGE);
            expect(config.copySize).toBe(10.0);
            expect(config.maxOrderSizeUSD).toBe(50.0);
        });

        it('should return adaptive config for large balance', () => {
            const config = getRecommendedConfig(3000.0);
            expect(config.strategy).toBe(CopyStrategy.ADAPTIVE);
            expect(config.copySize).toBe(10.0);
            expect(config.adaptiveMinPercent).toBe(5.0);
            expect(config.adaptiveMaxPercent).toBe(15.0);
        });
    });

    describe('parseTieredMultipliers', () => {
        it('should parse valid tier string', () => {
            const tiers = parseTieredMultipliers('1-10:2.0,10-100:1.0,100+:0.5');
            expect(tiers).toHaveLength(3);
            expect(tiers[0]).toEqual({ min: 1, max: 10, multiplier: 2.0 });
            expect(tiers[1]).toEqual({ min: 10, max: 100, multiplier: 1.0 });
            expect(tiers[2]).toEqual({ min: 100, max: null, multiplier: 0.5 });
        });

        it('should sort tiers by min value', () => {
            const tiers = parseTieredMultipliers('100-200:1.0,1-10:2.0,50-100:1.5');
            expect(tiers[0].min).toBe(1);
            expect(tiers[1].min).toBe(50);
            expect(tiers[2].min).toBe(100);
        });

        it('should handle empty string', () => {
            const tiers = parseTieredMultipliers('');
            expect(tiers).toHaveLength(0);
        });

        it('should throw on invalid format', () => {
            expect(() => parseTieredMultipliers('invalid')).toThrow('Invalid tier format');
        });

        it('should throw on invalid multiplier', () => {
            expect(() => parseTieredMultipliers('1-10:abc')).toThrow('Invalid multiplier');
        });

        it('should throw on negative multiplier', () => {
            expect(() => parseTieredMultipliers('1-10:-1.0')).toThrow('Invalid multiplier');
        });

        it('should throw on overlapping tiers', () => {
            expect(() => parseTieredMultipliers('1-10:1.0,5-15:2.0')).toThrow('Overlapping tiers');
        });

        it('should throw on infinite tier not being last', () => {
            expect(() => parseTieredMultipliers('100+:1.0,1-10:2.0')).toThrow('Tier with infinite upper bound must be last');
        });
    });
});