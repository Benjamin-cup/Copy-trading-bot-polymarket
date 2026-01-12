import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import Logger from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import { DatabaseError } from '../errors';
import {
    TradeWithUser,
    addToAggregationBuffer,
    getReadyAggregatedTrades,
    getAggregationBufferSize,
} from './TradeAggregator';

const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0; // Polymarket minimum
import { executeTrade, executeAggregatedTrades } from './ExecutionEngine';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const TRADE_AGGREGATION_ENABLED = ENV.TRADE_AGGREGATION_ENABLED;
const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;

// Create activity models for each user
const userActivityModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

const readTempTrades = async (): Promise<TradeWithUser[]> => {
    const allTrades: TradeWithUser[] = [];

    for (const { address, model } of userActivityModels) {
        try {
            // Only get trades that haven't been processed yet (bot: false AND botExcutedTime: 0)
            // This prevents processing the same trade multiple times
            const trades = await ErrorHandler.withErrorHandling(
                () => model
                    .find({
                        $and: [{ type: 'TRADE' }, { bot: false }, { botExcutedTime: 0 }],
                    })
                    .exec(),
                `Database query for pending trades of ${address.slice(0, 6)}...${address.slice(-4)}`,
                'find pending trades'
            );

            if (trades && trades.length > 0) {
                const tradesWithUser = trades.map((trade) => ({
                    ...(trade.toObject() as UserActivityInterface),
                    userAddress: address,
                }));
                allTrades.push(...tradesWithUser);
            }
        } catch (error) {
            ErrorHandler.handle(error, `Reading pending trades for ${address.slice(0, 6)}...${address.slice(-4)}`);
            // Continue with other users
        }
    }

    return allTrades;
};

// Track if executor should continue running
let isRunning = true;

/**
 * Stop the trade executor gracefully
 */
export const stopTradeExecutor = () => {
    isRunning = false;
    Logger.info('Trade executor shutdown requested...');
};

/**
 * Starts the trade execution service that processes pending trades from monitored users.
 * Continuously checks for new trades in the database and executes them either immediately
 * or through aggregation based on configuration. Supports both aggregated and non-aggregated modes.
 *
 * The executor can be stopped gracefully using the stopTradeExecutor function.
 *
 * @param {ClobClient} clobClient - The configured ClobClient instance for executing trades on Polymarket.
 * @returns {Promise<void>} A promise that resolves when the executor is stopped.
 *
 * @example
 * ```typescript
 * const client = await createClobClient();
 * tradeExecutor(client).then(() => {
 *   console.log('Trade executor stopped');
 * });
 *
 * // Later, stop the executor
 * stopTradeExecutor();
 * ```
 *
 * @throws {DatabaseError} If there are issues querying or updating the database.
 * @throws {Error} If trade execution fails through the ExecutionEngine.
 */
const tradeExecutor = async (clobClient: ClobClient) => {
    Logger.success(`Trade executor ready for ${USER_ADDRESSES.length} trader(s)`);
    if (TRADE_AGGREGATION_ENABLED) {
        Logger.info(
            `Trade aggregation enabled: ${TRADE_AGGREGATION_WINDOW_SECONDS}s window, $${TRADE_AGGREGATION_MIN_TOTAL_USD} minimum`
        );
    }

    let lastCheck = Date.now();
    while (isRunning) {
        try {
            const trades = await readTempTrades();

            if (TRADE_AGGREGATION_ENABLED) {
                // Process with aggregation logic
                if (trades.length > 0) {
                    Logger.clearLine();
                    Logger.info(
                        `📥 ${trades.length} new trade${trades.length > 1 ? 's' : ''} detected`
                    );

                    // Add trades to aggregation buffer
                    for (const trade of trades) {
                        try {
                            // Only aggregate BUY trades below minimum threshold
                            if (trade.side === 'BUY' && trade.usdcSize < TRADE_AGGREGATION_MIN_TOTAL_USD) {
                                Logger.info(
                                    `Adding $${trade.usdcSize.toFixed(2)} ${trade.side} trade to aggregation buffer for ${trade.slug || trade.asset}`
                                );
                                addToAggregationBuffer(trade);
                            } else {
                                // Execute large trades immediately (not aggregated)
                                Logger.clearLine();
                                Logger.header(`⚡ IMMEDIATE TRADE (above threshold)`);
                                await ErrorHandler.withErrorHandling(
                                    () => executeTrade(clobClient, trade, trade.userAddress),
                                    `Executing immediate trade for ${trade.userAddress.slice(0, 6)}...${trade.userAddress.slice(-4)}`,
                                    'execute immediate trade'
                                );
                            }
                        } catch (error) {
                            ErrorHandler.handle(error, `Processing trade for ${trade.userAddress.slice(0, 6)}...${trade.userAddress.slice(-4)}`);
                            // Continue with other trades
                        }
                    }
                    lastCheck = Date.now();
                }

                // Check for ready aggregated trades
                const readyAggregations = await getReadyAggregatedTrades();
                if (readyAggregations.length > 0) {
                    Logger.clearLine();
                    Logger.header(
                        `⚡ ${readyAggregations.length} AGGREGATED TRADE${readyAggregations.length > 1 ? 'S' : ''} READY`
                    );
                    await ErrorHandler.withErrorHandling(
                        () => executeAggregatedTrades(clobClient, readyAggregations),
                        'Executing aggregated trades',
                        'execute aggregated trades'
                    );
                    lastCheck = Date.now();
                }
    
                // Update waiting message
                if (trades.length === 0 && readyAggregations.length === 0) {
                    if (Date.now() - lastCheck > 300) {
                        const bufferedCount = getAggregationBufferSize();
                        if (bufferedCount > 0) {
                            Logger.waiting(
                                USER_ADDRESSES.length,
                                `${bufferedCount} trade group(s) pending`
                            );
                        } else {
                            Logger.waiting(USER_ADDRESSES.length);
                        }
                        lastCheck = Date.now();
                    }
                }
            } else {
                // Original non-aggregation logic
                if (trades.length > 0) {
                    Logger.clearLine();
                    Logger.header(
                        `⚡ ${trades.length} NEW TRADE${trades.length > 1 ? 'S' : ''} TO COPY`
                    );
                    for (const trade of trades) {
                        await ErrorHandler.withErrorHandling(
                            () => executeTrade(clobClient, trade, trade.userAddress),
                            `Executing trade for ${trade.userAddress.slice(0, 6)}...${trade.userAddress.slice(-4)}`,
                            'execute trade'
                        );
                    }
                    lastCheck = Date.now();
                } else {
                    // Update waiting message every 300ms for smooth animation
                    if (Date.now() - lastCheck > 300) {
                        Logger.waiting(USER_ADDRESSES.length);
                        lastCheck = Date.now();
                    }
                }
            }
        } catch (error) {
            ErrorHandler.handle(error, 'Trade executor main loop');
            // Continue running despite errors
        }

        if (!isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    Logger.info('Trade executor stopped');
};

export default tradeExecutor;
