import { UserActivityInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import Logger from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import { DatabaseError } from '../errors';

const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;
const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0; // Polymarket minimum

interface TradeWithUser extends UserActivityInterface {
    userAddress: string;
}

interface AggregatedTrade {
    userAddress: string;
    conditionId: string;
    asset: string;
    side: string;
    slug?: string;
    eventSlug?: string;
    trades: TradeWithUser[];
    totalUsdcSize: number;
    averagePrice: number;
    firstTradeTime: number;
    lastTradeTime: number;
}

// Buffer for aggregating trades
const tradeAggregationBuffer: Map<string, AggregatedTrade> = new Map();

/**
 * Generate a unique key for trade aggregation based on user, market, side
 */
const getAggregationKey = (trade: TradeWithUser): string => {
    return `${trade.userAddress}:${trade.conditionId}:${trade.asset}:${trade.side}`;
};

/**
 * Adds a trade to the aggregation buffer or updates an existing aggregation.
 * If an aggregation for the same user, condition, asset, and side already exists, it updates the total size and recalculates the average price.
 * Otherwise, creates a new aggregation entry.
 *
 * @param {TradeWithUser} trade - The trade to add to the buffer, including user address.
 * @returns {void}
 *
 * @example
 * ```typescript
 * const trade: TradeWithUser = {
 *   userAddress: '0x...',
 *   conditionId: '0x...',
 *   asset: '0x...',
 *   side: 'BUY',
 *   usdcSize: 100,
 *   price: 0.5,
 *   // ... other properties
 * };
 * addToAggregationBuffer(trade);
 * ```
 */
const addToAggregationBuffer = (trade: TradeWithUser): void => {
    const key = getAggregationKey(trade);
    const existing = tradeAggregationBuffer.get(key);
    const now = Date.now();

    if (existing) {
        // Update existing aggregation
        existing.trades.push(trade);
        existing.totalUsdcSize += trade.usdcSize;
        // Recalculate weighted average price
        const totalValue = existing.trades.reduce((sum, t) => sum + t.usdcSize * t.price, 0);
        existing.averagePrice = totalValue / existing.totalUsdcSize;
        existing.lastTradeTime = now;
    } else {
        // Create new aggregation
        tradeAggregationBuffer.set(key, {
            userAddress: trade.userAddress,
            conditionId: trade.conditionId,
            asset: trade.asset,
            side: trade.side || 'BUY',
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            trades: [trade],
            totalUsdcSize: trade.usdcSize,
            averagePrice: trade.price,
            firstTradeTime: now,
            lastTradeTime: now,
        });
    }
};

/**
 * Checks the aggregation buffer and returns aggregated trades that are ready for execution.
 * Trades are considered ready if they meet both criteria:
 * 1. Total USDC size is greater than or equal to the minimum threshold
 * 2. The aggregation time window has passed since the first trade in the group
 *
 * Trades that don't meet the minimum size are marked as processed and skipped.
 *
 * @returns {Promise<AggregatedTrade[]>} A promise that resolves to an array of ready aggregated trades.
 *
 * @example
 * ```typescript
 * const readyTrades = await getReadyAggregatedTrades();
 * for (const trade of readyTrades) {
 *   // Execute the aggregated trade
 *   console.log(`Executing ${trade.totalUsdcSize} USDC trade for ${trade.userAddress}`);
 * }
 * ```
 *
 * @throws {DatabaseError} If there's an error updating trade status in the database.
 */
const getReadyAggregatedTrades = async (): Promise<AggregatedTrade[]> => {
    const ready: AggregatedTrade[] = [];
    const now = Date.now();
    const windowMs = TRADE_AGGREGATION_WINDOW_SECONDS * 1000;

    for (const [key, agg] of tradeAggregationBuffer.entries()) {
        const timeElapsed = now - agg.firstTradeTime;

        // Check if aggregation is ready
        if (timeElapsed >= windowMs) {
            if (agg.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD) {
                // Aggregation meets minimum and window passed - ready to execute
                ready.push(agg);
            } else {
                // Window passed but total too small - mark individual trades as skipped
                Logger.info(
                    `Trade aggregation for ${agg.userAddress} on ${agg.slug || agg.asset}: $${agg.totalUsdcSize.toFixed(2)} total from ${agg.trades.length} trades below minimum ($${TRADE_AGGREGATION_MIN_TOTAL_USD}) - skipping`
                );

                // Mark all trades in this aggregation as processed (bot: true)
                for (const trade of agg.trades) {
                    try {
                        const UserActivity = getUserActivityModel(trade.userAddress);
                        await ErrorHandler.withErrorHandling(
                            () => UserActivity.updateOne({ _id: trade._id }, { bot: true }).exec(),
                            `Marking aggregated trade as processed for ${trade.userAddress}`,
                            'update aggregated trade status'
                        );
                    } catch (error) {
                        ErrorHandler.handle(error, `Failed to mark aggregated trade ${trade._id} as processed`);
                        // Continue with other trades
                    }
                }
            }
            // Remove from buffer either way
            tradeAggregationBuffer.delete(key);
        }
    }

    return ready;
};

/**
 * Gets the current number of trade groups in the aggregation buffer.
 * This represents the number of unique trade aggregations currently being accumulated.
 *
 * @returns {number} The number of trade groups in the buffer.
 *
 * @example
 * ```typescript
 * const bufferSize = getAggregationBufferSize();
 * console.log(`Currently aggregating ${bufferSize} trade groups`);
 * ```
 */
const getAggregationBufferSize = (): number => {
    return tradeAggregationBuffer.size;
};

export {
    TradeWithUser,
    AggregatedTrade,
    addToAggregationBuffer,
    getReadyAggregatedTrades,
    getAggregationBufferSize,
};
