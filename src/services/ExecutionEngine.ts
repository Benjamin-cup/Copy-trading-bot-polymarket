import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import postOrder from '../utils/postOrder';
import Logger from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import { DatabaseError } from '../errors';
import { validateTrade, ValidationResult } from './OrderValidator';
import { AggregatedTrade } from './TradeAggregator';

/**
 * Executes a single trade by validating it, posting the order to Polymarket, and updating the database.
 * Marks the trade as processing, validates balance and positions, executes the order via postOrder,
 * and marks the trade as completed or failed based on the outcome.
 *
 * @param {ClobClient} clobClient - The configured ClobClient instance for API interactions.
 * @param {UserActivityInterface} trade - The trade activity to execute.
 * @param {string} userAddress - The address of the user whose trade is being copied.
 * @returns {Promise<void>} A promise that resolves when the trade execution is complete.
 *
 * @example
 * ```typescript
 * const client = await createClobClient();
 * const trade: UserActivityInterface = { ... };
 * await executeTrade(client, trade, '0x123...');
 * ```
 *
 * @throws {DatabaseError} If database operations fail.
 * @throws {Error} If order posting or validation fails.
 */
const executeTrade = async (
    clobClient: ClobClient,
    trade: UserActivityInterface,
    userAddress: string
): Promise<void> => {
    try {
        // Mark trade as being processed immediately to prevent duplicate processing
        const UserActivity = getUserActivityModel(userAddress);
        await ErrorHandler.withErrorHandling(
            () => UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } }).exec(),
            `Marking trade as processing for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`,
            'mark trade processing'
        );

        Logger.trade(userAddress, trade.side || 'UNKNOWN', {
            asset: trade.asset,
            side: trade.side,
            amount: trade.usdcSize,
            price: trade.price,
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            transactionHash: trade.transactionHash,
        });

        // Validate the trade
        const validation: ValidationResult = await validateTrade(trade, userAddress);

        if (!validation.isValid) {
            Logger.error(`Trade validation failed: ${validation.reason}`);
            // Mark as failed
            await ErrorHandler.withErrorHandling(
                () => UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: -1 } }).exec(),
                `Marking failed validation trade for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`,
                'mark validation failure'
            );
            return;
        }

        Logger.balance(validation.myBalance!, validation.userBalance!, userAddress);

        // Execute the trade
        await ErrorHandler.withErrorHandling(
            () => postOrder(
                clobClient,
                trade.side === 'BUY' ? 'buy' : 'sell',
                validation.myPosition,
                validation.userPosition,
                trade,
                validation.myBalance!,
                validation.userBalance!,
                userAddress
            ),
            `Executing ${trade.side} trade for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`,
            'execute trade order'
        );

        Logger.separator();
    } catch (error) {
        ErrorHandler.handle(error, `Trade execution for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`);
        // Mark as failed if not already marked
        try {
            const UserActivity = getUserActivityModel(userAddress);
            await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: -1 } }).exec();
        } catch (markError) {
            ErrorHandler.handle(markError, `Failed to mark trade as failed for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`);
        }
    }
};

/**
 * Executes multiple aggregated trades that have met the aggregation criteria.
 * For each aggregated trade, validates the combined position, creates a synthetic trade object
 * with aggregated values, and executes the order. Marks all individual trades in the aggregation
 * as processed or failed based on the outcome.
 *
 * @param {ClobClient} clobClient - The configured ClobClient instance for API interactions.
 * @param {AggregatedTrade[]} aggregatedTrades - Array of aggregated trades ready for execution.
 * @returns {Promise<void>} A promise that resolves when all aggregated trades have been processed.
 *
 * @example
 * ```typescript
 * const client = await createClobClient();
 * const readyTrades = await getReadyAggregatedTrades();
 * await executeAggregatedTrades(client, readyTrades);
 * ```
 *
 * @throws {DatabaseError} If database operations fail.
 * @throws {Error} If order posting or validation fails.
 */
const executeAggregatedTrades = async (
    clobClient: ClobClient,
    aggregatedTrades: AggregatedTrade[]
): Promise<void> => {
    for (const agg of aggregatedTrades) {
        try {
            Logger.header(`📊 AGGREGATED TRADE (${agg.trades.length} trades combined)`);
            Logger.info(`Market: ${agg.slug || agg.asset}`);
            Logger.info(`Side: ${agg.side}`);
            Logger.info(`Total volume: $${agg.totalUsdcSize.toFixed(2)}`);
            Logger.info(`Average price: $${agg.averagePrice.toFixed(4)}`);

            // Mark all individual trades as being processed
            for (const trade of agg.trades) {
                try {
                    const UserActivity = getUserActivityModel(trade.userAddress);
                    await ErrorHandler.withErrorHandling(
                        () => UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } }).exec(),
                        `Marking aggregated trade as processing for ${trade.userAddress.slice(0, 6)}...${trade.userAddress.slice(-4)}`,
                        'mark aggregated trade processing'
                    );
                } catch (error) {
                    ErrorHandler.handle(error, `Failed to mark aggregated trade ${trade._id} as processing`);
                    // Continue with other trades
                }
            }

            // Validate using the first trade as representative
            const validation: ValidationResult = await validateTrade(agg.trades[0], agg.userAddress);

            if (!validation.isValid) {
                Logger.error(`Aggregated trade validation failed: ${validation.reason}`);
                // Mark all trades as failed
                for (const trade of agg.trades) {
                    try {
                        const UserActivity = getUserActivityModel(trade.userAddress);
                        await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: -1 } }).exec();
                    } catch (error) {
                        ErrorHandler.handle(error, `Failed to mark aggregated trade ${trade._id} as failed`);
                    }
                }
                continue;
            }

            Logger.balance(validation.myBalance!, validation.userBalance!, agg.userAddress);

            // Create a synthetic trade object for postOrder using aggregated values
            const syntheticTrade: UserActivityInterface = {
                ...agg.trades[0], // Use first trade as template
                usdcSize: agg.totalUsdcSize,
                price: agg.averagePrice,
                side: agg.side as 'BUY' | 'SELL',
            };

            // Execute the aggregated trade
            await ErrorHandler.withErrorHandling(
                () => postOrder(
                    clobClient,
                    agg.side === 'BUY' ? 'buy' : 'sell',
                    validation.myPosition,
                    validation.userPosition,
                    syntheticTrade,
                    validation.myBalance!,
                    validation.userBalance!,
                    agg.userAddress
                ),
                `Executing aggregated ${agg.side} trade for ${agg.userAddress.slice(0, 6)}...${agg.userAddress.slice(-4)}`,
                'execute aggregated trade order'
            );

            Logger.separator();
        } catch (error) {
            ErrorHandler.handle(error, `Aggregated trade execution for ${agg.userAddress.slice(0, 6)}...${agg.userAddress.slice(-4)}`);
            // Mark all trades as failed
            for (const trade of agg.trades) {
                try {
                    const UserActivity = getUserActivityModel(trade.userAddress);
                    await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: -1 } }).exec();
                } catch (markError) {
                    ErrorHandler.handle(markError, `Failed to mark aggregated trade ${trade._id} as failed`);
                }
            }
        }
    }
};

export { executeTrade, executeAggregatedTrades };
