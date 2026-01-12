import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface } from '../../interfaces/User';
import { executeTrade, executeAggregatedTrades } from '../../services/ExecutionEngine';
import { validateTrade } from '../../services/OrderValidator';
import { addToAggregationBuffer, getReadyAggregatedTrades } from '../../services/TradeAggregator';
import { calculateOrderSize, CopyStrategy } from '../../config/copyStrategy';

// Mock all external dependencies
jest.mock('@polymarket/clob-client');
jest.mock('../../services/OrderValidator');
jest.mock('../../utils/postOrder');
jest.mock('../../utils/logger');
jest.mock('../../models/userHistory');
jest.mock('../../utils/errorHandler');

describe('Trade Flow Integration Tests', () => {
    let mockClobClient: jest.Mocked<ClobClient>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClobClient = new ClobClient({} as any) as jest.Mocked<ClobClient>;
    });

    describe('Single Trade Execution Flow', () => {
        it('should execute a valid trade successfully', async () => {
            const mockTrade: UserActivityInterface = {
                _id: 'trade1' as any,
                proxyWallet: '0xproxy',
                timestamp: Date.now(),
                conditionId: 'cond1',
                type: 'trade',
                size: 100,
                usdcSize: 100,
                transactionHash: '0xhash',
                price: 1.0,
                asset: 'asset1',
                side: 'BUY',
                outcomeIndex: 0,
                title: 'Test Market',
                slug: 'test-market',
                icon: 'icon',
                eventSlug: 'event',
                outcome: 'outcome',
                name: 'Test User',
                pseudonym: 'testuser',
                bio: 'bio',
                profileImage: 'image',
                profileImageOptimized: 'optimized',
                bot: false,
                botExcutedTime: 0,
            };

            const mockValidation = {
                isValid: true,
                myPosition: undefined,
                userPosition: undefined,
                myBalance: 1000,
                userBalance: 5000,
            };

            // Mock validation
            (validateTrade as jest.Mock).mockResolvedValue(mockValidation);

            // Mock postOrder to succeed
            const { postOrder } = require('../../utils/postOrder');
            postOrder.mockResolvedValue(undefined);

            // Mock database operations
            const { getUserActivityModel } = require('../../models/userHistory');
            const mockModel = {
                updateOne: jest.fn().mockResolvedValue({}),
            };
            getUserActivityModel.mockReturnValue(mockModel);

            // Mock error handler
            const { ErrorHandler } = require('../../utils/errorHandler');
            ErrorHandler.withErrorHandling.mockImplementation((fn) => fn());

            await executeTrade(mockClobClient, mockTrade, '0xuser');

            expect(validateTrade).toHaveBeenCalledWith(mockTrade, '0xuser');
            expect(postOrder).toHaveBeenCalled();
            expect(mockModel.updateOne).toHaveBeenCalledTimes(2); // Mark processing and completed
        });

        it('should handle validation failure', async () => {
            const mockTrade: UserActivityInterface = {
                _id: 'trade1' as any,
                proxyWallet: '0xproxy',
                timestamp: Date.now(),
                conditionId: 'cond1',
                type: 'trade',
                size: 100,
                usdcSize: 100,
                transactionHash: '0xhash',
                price: 1.0,
                asset: 'asset1',
                side: 'BUY',
                outcomeIndex: 0,
                title: 'Test Market',
                slug: 'test-market',
                icon: 'icon',
                eventSlug: 'event',
                outcome: 'outcome',
                name: 'Test User',
                pseudonym: 'testuser',
                bio: 'bio',
                profileImage: 'image',
                profileImageOptimized: 'optimized',
                bot: false,
                botExcutedTime: 0,
            };

            const mockValidation = {
                isValid: false,
                reason: 'Insufficient balance',
            };

            (validateTrade as jest.Mock).mockResolvedValue(mockValidation);

            const { getUserActivityModel } = require('../../models/userHistory');
            const mockModel = {
                updateOne: jest.fn().mockResolvedValue({}),
            };
            getUserActivityModel.mockReturnValue(mockModel);

            const { ErrorHandler } = require('../../utils/errorHandler');
            ErrorHandler.withErrorHandling.mockImplementation((fn) => fn());

            await executeTrade(mockClobClient, mockTrade, '0xuser');

            expect(validateTrade).toHaveBeenCalledWith(mockTrade, '0xuser');
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: 'trade1' },
                { $set: { botExcutedTime: -1 } }
            );
        });
    });

    describe('Trade Aggregation Flow', () => {
        it('should aggregate and execute multiple trades', async () => {
            const trades = [
                {
                    userAddress: '0xuser',
                    conditionId: 'cond1',
                    asset: 'asset1',
                    side: 'BUY',
                    usdcSize: 50,
                    price: 1.0,
                    _id: 'trade1' as any,
                },
                {
                    userAddress: '0xuser',
                    conditionId: 'cond1',
                    asset: 'asset1',
                    side: 'BUY',
                    usdcSize: 75,
                    price: 1.1,
                    _id: 'trade2' as any,
                },
            ];

            // Add trades to aggregation
            trades.forEach(trade => addToAggregationBuffer(trade as any));

            // Mock time passing
            jest.useFakeTimers();
            jest.advanceTimersByTime(70 * 1000); // Past aggregation window

            // Mock validation and execution
            (validateTrade as jest.Mock).mockResolvedValue({
                isValid: true,
                myBalance: 1000,
                userBalance: 5000,
            });

            const { postOrder } = require('../../utils/postOrder');
            postOrder.mockResolvedValue(undefined);

            const { getUserActivityModel } = require('../../models/userHistory');
            const mockModel = {
                updateOne: jest.fn().mockResolvedValue({}),
            };
            getUserActivityModel.mockReturnValue(mockModel);

            const { ErrorHandler } = require('../../utils/errorHandler');
            ErrorHandler.withErrorHandling.mockImplementation((fn) => fn());

            const aggregatedTrades = await getReadyAggregatedTrades();
            await executeAggregatedTrades(mockClobClient, aggregatedTrades);

            expect(aggregatedTrades).toHaveLength(1);
            expect(aggregatedTrades[0].totalUsdcSize).toBe(125);
            expect(postOrder).toHaveBeenCalledTimes(1);
        });
    });

    describe('Order Size Calculation Integration', () => {
        it('should integrate with copy strategy configuration', () => {
            const config = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 10.0,
                maxOrderSizeUSD: 100.0,
                minOrderSizeUSD: 1.0,
            };

            const result = calculateOrderSize(config, 200.0, 500.0, 0);

            expect(result.baseAmount).toBe(20.0); // 10% of 200
            expect(result.finalAmount).toBe(20.0);
            expect(result.strategy).toBe('PERCENTAGE');
            expect(result.cappedByMax).toBe(false);
            expect(result.reducedByBalance).toBe(false);
            expect(result.belowMinimum).toBe(false);
        });

        it('should handle balance constraints', () => {
            const config = {
                strategy: CopyStrategy.PERCENTAGE,
                copySize: 50.0,
                maxOrderSizeUSD: 1000.0,
                minOrderSizeUSD: 1.0,
            };

            const result = calculateOrderSize(config, 200.0, 50.0, 0); // Low balance

            expect(result.finalAmount).toBe(49.95); // 50 * 0.99
            expect(result.reducedByBalance).toBe(true);
        });
    });
});