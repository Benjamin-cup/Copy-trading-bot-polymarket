import mongoose from 'mongoose';
import {
    addToAggregationBuffer,
    getReadyAggregatedTrades,
    getAggregationBufferSize,
    TradeWithUser,
    AggregatedTrade,
} from '../../services/TradeAggregator';

// Mock dependencies
jest.mock('../../utils/logger', () => ({
    Logger: {
        info: jest.fn(),
    },
}));

jest.mock('../../models/userHistory', () => ({
    getUserActivityModel: jest.fn(() => ({
        updateOne: jest.fn().mockResolvedValue({}),
    })),
}));

jest.mock('../../utils/errorHandler', () => ({
    ErrorHandler: {
        withErrorHandling: jest.fn((fn) => fn()),
    },
}));

// Mock environment
jest.mock('../../config/env', () => ({
    ENV: {
        TRADE_AGGREGATION_WINDOW_SECONDS: 60,
    },
}));

describe('TradeAggregator', () => {
    beforeEach(() => {
        // Clear the aggregation buffer before each test
        jest.clearAllMocks();
        // Reset the module to clear the buffer
        jest.resetModules();
    });

    const createMockTrade = (overrides: Partial<TradeWithUser> = {}): TradeWithUser => ({
        _id: new mongoose.Types.ObjectId(),
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
        userAddress: '0x123',
        ...overrides,
    });

    describe('addToAggregationBuffer', () => {
        it('should create new aggregation for first trade', () => {
            const trade = createMockTrade();

            addToAggregationBuffer(trade);

            expect(getAggregationBufferSize()).toBe(1);
        });

        it('should aggregate multiple trades with same key', async () => {
            const trade1 = createMockTrade({
                usdcSize: 100,
                price: 1.0,
            });

            const trade2 = createMockTrade({
                usdcSize: 50,
                price: 1.1,
            });

            addToAggregationBuffer(trade1);
            addToAggregationBuffer(trade2);

            expect(getAggregationBufferSize()).toBe(1);

            // Check that trades are ready (simulate time passing)
            jest.advanceTimersByTime(65 * 1000);
            const readyTrades = await getReadyAggregatedTrades();
            expect(readyTrades).toHaveLength(1);
            expect(readyTrades[0].totalUsdcSize).toBe(150);
            expect(readyTrades[0].trades).toHaveLength(2);
        });

        it('should calculate weighted average price correctly', () => {
            const trade1: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            const trade2: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 200,
                price: 1.5,
                _id: 'trade2',
            };

            addToAggregationBuffer(trade1);
            addToAggregationBuffer(trade2);

            const readyTrades = getReadyAggregatedTrades();
            // Weighted average: (100*1.0 + 200*1.5) / 300 = 350 / 300 = 1.166...
            expect(readyTrades[0].averagePrice).toBeCloseTo(1.1667, 4);
        });

        it('should handle different aggregation keys separately', () => {
            const trade1: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            const trade2: TradeWithUser = {
                userAddress: '0x456',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 50,
                price: 1.1,
                _id: 'trade2',
            };

            addToAggregationBuffer(trade1);
            addToAggregationBuffer(trade2);

            expect(getAggregationBufferSize()).toBe(2);
        });
    });

    describe('getReadyAggregatedTrades', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should return empty array when no trades are ready', () => {
            const trade: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            addToAggregationBuffer(trade);

            // Time hasn't passed enough
            jest.advanceTimersByTime(30 * 1000); // 30 seconds

            const readyTrades = getReadyAggregatedTrades();
            expect(readyTrades).toHaveLength(0);
        });

        it('should return trades when window time has passed', () => {
            const trade: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            addToAggregationBuffer(trade);

            // Advance time past the window
            jest.advanceTimersByTime(65 * 1000); // 65 seconds

            const readyTrades = getReadyAggregatedTrades();
            expect(readyTrades).toHaveLength(1);
            expect(readyTrades[0].userAddress).toBe('0x123');
            expect(readyTrades[0].totalUsdcSize).toBe(100);
        });

        it('should skip aggregations below minimum size', () => {
            const trade: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 0.5, // Below minimum of 1.0
                price: 1.0,
                _id: 'trade1',
            };

            addToAggregationBuffer(trade);

            // Advance time past the window
            jest.advanceTimersByTime(65 * 1000);

            const readyTrades = getReadyAggregatedTrades();
            expect(readyTrades).toHaveLength(0);
            expect(getAggregationBufferSize()).toBe(0); // Should be cleared
        });

        it('should mark individual trades as processed when skipping small aggregations', async () => {
            const { getUserActivityModel } = require('../../models/userHistory');
            const { ErrorHandler } = require('../../utils/errorHandler');

            const mockModel = {
                updateOne: jest.fn().mockResolvedValue({}),
            };
            getUserActivityModel.mockReturnValue(mockModel);
            ErrorHandler.withErrorHandling.mockImplementation((fn) => fn());

            const trade: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 0.5,
                price: 1.0,
                _id: 'trade1',
            };

            addToAggregationBuffer(trade);

            jest.advanceTimersByTime(65 * 1000);

            const readyTrades = getReadyAggregatedTrades();

            expect(readyTrades).toHaveLength(0);
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: 'trade1' },
                { bot: true }
            );
        });

        it('should handle multiple ready aggregations', () => {
            const trade1: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            const trade2: TradeWithUser = {
                userAddress: '0x456',
                conditionId: 'cond2',
                asset: 'asset2',
                side: 'SELL',
                usdcSize: 200,
                price: 1.5,
                _id: 'trade2',
            };

            addToAggregationBuffer(trade1);
            addToAggregationBuffer(trade2);

            jest.advanceTimersByTime(65 * 1000);

            const readyTrades = getReadyAggregatedTrades();
            expect(readyTrades).toHaveLength(2);
            expect(getAggregationBufferSize()).toBe(0); // Should be cleared
        });
    });

    describe('getAggregationBufferSize', () => {
        it('should return 0 for empty buffer', () => {
            expect(getAggregationBufferSize()).toBe(0);
        });

        it('should return correct size after adding trades', () => {
            const trade1: TradeWithUser = {
                userAddress: '0x123',
                conditionId: 'cond1',
                asset: 'asset1',
                side: 'BUY',
                usdcSize: 100,
                price: 1.0,
                _id: 'trade1',
            };

            const trade2: TradeWithUser = {
                userAddress: '0x456',
                conditionId: 'cond2',
                asset: 'asset2',
                side: 'SELL',
                usdcSize: 200,
                price: 1.5,
                _id: 'trade2',
            };

            addToAggregationBuffer(trade1);
            expect(getAggregationBufferSize()).toBe(1);

            addToAggregationBuffer(trade2);
            expect(getAggregationBufferSize()).toBe(2);
        });
    });
});