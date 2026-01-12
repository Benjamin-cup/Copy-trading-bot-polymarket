import { ENV } from '../config/env';
import { getUserActivityModel, getUserPositionModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import { CircuitBreakerRegistry } from '../utils/circuitBreaker';
import { DatabaseError, NetworkError } from '../errors';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const TOO_OLD_TIMESTAMP = ENV.TOO_OLD_TIMESTAMP;
const FETCH_INTERVAL = ENV.FETCH_INTERVAL;

if (!USER_ADDRESSES || USER_ADDRESSES.length === 0) {
    throw new Error('USER_ADDRESSES is not defined or empty');
}

// Create activity and position models for each user
const userModels = USER_ADDRESSES.map((address) => ({
    address,
    UserActivity: getUserActivityModel(address),
    UserPosition: getUserPositionModel(address),
}));

const init = async () => {
    // Get database counts with error handling
    const counts: number[] = [];
    for (const { address, UserActivity } of userModels) {
        try {
            const count = await ErrorHandler.withErrorHandling(
                () => UserActivity.countDocuments(),
                `Database count for ${address.slice(0, 6)}...${address.slice(-4)}`,
                'countDocuments'
            );
            counts.push(count || 0);
        } catch (error) {
            ErrorHandler.handle(error, `Database initialization for ${address.slice(0, 6)}...${address.slice(-4)}`);
            counts.push(0);
        }
    }
    Logger.clearLine();
    Logger.dbConnection(USER_ADDRESSES, counts);

    // Show your own positions first with circuit breaker protection
    const positionsBreaker = CircuitBreakerRegistry.getBreaker('polymarket-positions', 3, 30000);
    const balanceBreaker = CircuitBreakerRegistry.getBreaker('polymarket-balance', 3, 30000);

    try {
        const myPositionsUrl = `https://data-api.polymarket.com/positions?user=${ENV.PROXY_WALLET}`;
        const myPositions = await positionsBreaker.execute(() => fetchData(myPositionsUrl));

        // Get current USDC balance
        const getMyBalance = (await import('../utils/getMyBalance')).default;
        const currentBalance = await balanceBreaker.execute(() => getMyBalance(ENV.PROXY_WALLET));

        if (Array.isArray(myPositions) && myPositions.length > 0) {
            // Calculate your overall profitability and initial investment
            let totalValue = 0;
            let initialValue = 0;
            let weightedPnl = 0;
            myPositions.forEach((pos: any) => {
                const value = pos.currentValue || 0;
                const initial = pos.initialValue || 0;
                const pnl = pos.percentPnl || 0;
                totalValue += value;
                initialValue += initial;
                weightedPnl += value * pnl;
            });
            const myOverallPnl = totalValue > 0 ? weightedPnl / totalValue : 0;

            // Get top 5 positions by profitability (PnL)
            const myTopPositions = myPositions
                .sort((a: any, b: any) => (b.percentPnl || 0) - (a.percentPnl || 0))
                .slice(0, 5);

            Logger.clearLine();
            Logger.myPositions(
                ENV.PROXY_WALLET,
                myPositions.length,
                myTopPositions,
                myOverallPnl,
                totalValue,
                initialValue,
                currentBalance
            );
        } else {
            Logger.clearLine();
            Logger.myPositions(ENV.PROXY_WALLET, 0, [], 0, 0, 0, currentBalance);
        }
    } catch (error) {
        ErrorHandler.handle(error, 'Fetching user positions and balance');
        // Continue with empty positions display
        Logger.clearLine();
        Logger.myPositions(ENV.PROXY_WALLET, 0, [], 0, 0, 0, 0);
    }

    // Show current positions count with details for traders you're copying
    const positionCounts: number[] = [];
    const positionDetails: any[][] = [];
    const profitabilities: number[] = [];
    for (const { address, UserPosition } of userModels) {
        try {
            const positions = await ErrorHandler.withErrorHandling(
                () => UserPosition.find().exec(),
                `Database query for positions of ${address.slice(0, 6)}...${address.slice(-4)}`,
                'find positions'
            );

            if (positions) {
                positionCounts.push(positions.length);

                // Calculate overall profitability (weighted average by current value)
                let totalValue = 0;
                let weightedPnl = 0;
                positions.forEach((pos) => {
                    const value = pos.currentValue || 0;
                    const pnl = pos.percentPnl || 0;
                    totalValue += value;
                    weightedPnl += value * pnl;
                });
                const overallPnl = totalValue > 0 ? weightedPnl / totalValue : 0;
                profitabilities.push(overallPnl);

                // Get top 3 positions by profitability (PnL)
                const topPositions = positions
                    .sort((a, b) => (b.percentPnl || 0) - (a.percentPnl || 0))
                    .slice(0, 3)
                    .map((p) => p.toObject());
                positionDetails.push(topPositions);
            } else {
                positionCounts.push(0);
                positionDetails.push([]);
                profitabilities.push(0);
            }
        } catch (error) {
            ErrorHandler.handle(error, `Processing positions for ${address.slice(0, 6)}...${address.slice(-4)}`);
            positionCounts.push(0);
            positionDetails.push([]);
            profitabilities.push(0);
        }
    }
    Logger.clearLine();
    Logger.tradersPositions(USER_ADDRESSES, positionCounts, positionDetails, profitabilities);
};

const fetchTradeData = async () => {
    const activityBreaker = CircuitBreakerRegistry.getBreaker('polymarket-activity', 5, 60000);
    const positionsBreaker = CircuitBreakerRegistry.getBreaker('polymarket-user-positions', 3, 30000);

    for (const { address, UserActivity, UserPosition } of userModels) {
        try {
            // Fetch trade activities from Polymarket API with circuit breaker
            const apiUrl = `https://data-api.polymarket.com/activity?user=${address}&type=TRADE`;
            const activities = await activityBreaker.execute(() => fetchData(apiUrl));

            if (!Array.isArray(activities) || activities.length === 0) {
                continue;
            }

            // Process each activity with error handling
            for (const activity of activities) {
                try {
                    // Skip if too old
                    if (activity.timestamp < TOO_OLD_TIMESTAMP) {
                        continue;
                    }

                    // Check if this trade already exists in database
                    const existingActivity = await ErrorHandler.withErrorHandling(
                        () => UserActivity.findOne({ transactionHash: activity.transactionHash }).exec(),
                        `Database check for existing trade ${activity.transactionHash}`,
                        'findOne trade'
                    );

                    if (existingActivity) {
                        continue; // Already processed this trade
                    }

                    // Save new trade to database
                    const newActivity = new UserActivity({
                        proxyWallet: activity.proxyWallet,
                        timestamp: activity.timestamp,
                        conditionId: activity.conditionId,
                        type: activity.type,
                        size: activity.size,
                        usdcSize: activity.usdcSize,
                        transactionHash: activity.transactionHash,
                        price: activity.price,
                        asset: activity.asset,
                        side: activity.side,
                        outcomeIndex: activity.outcomeIndex,
                        title: activity.title,
                        slug: activity.slug,
                        icon: activity.icon,
                        eventSlug: activity.eventSlug,
                        outcome: activity.outcome,
                        name: activity.name,
                        pseudonym: activity.pseudonym,
                        bio: activity.bio,
                        profileImage: activity.profileImage,
                        profileImageOptimized: activity.profileImageOptimized,
                        bot: false,
                        botExcutedTime: 0,
                    });

                    await ErrorHandler.withErrorHandling(
                        () => newActivity.save(),
                        `Database save for new trade ${activity.transactionHash}`,
                        'save trade'
                    );

                    Logger.info(`New trade detected for ${address.slice(0, 6)}...${address.slice(-4)}`);
                } catch (error) {
                    ErrorHandler.handle(error, `Processing trade activity for ${address.slice(0, 6)}...${address.slice(-4)}`);
                    // Continue processing other activities
                }
            }

            // Also fetch and update positions with circuit breaker
            const positionsUrl = `https://data-api.polymarket.com/positions?user=${address}`;
            const positions = await positionsBreaker.execute(() => fetchData(positionsUrl));

            if (Array.isArray(positions) && positions.length > 0) {
                for (const position of positions) {
                    try {
                        // Update or create position
                        await ErrorHandler.withErrorHandling(
                            () => UserPosition.findOneAndUpdate(
                                { asset: position.asset, conditionId: position.conditionId },
                                {
                                    proxyWallet: position.proxyWallet,
                                    asset: position.asset,
                                    conditionId: position.conditionId,
                                    size: position.size,
                                    avgPrice: position.avgPrice,
                                    initialValue: position.initialValue,
                                    currentValue: position.currentValue,
                                    cashPnl: position.cashPnl,
                                    percentPnl: position.percentPnl,
                                    totalBought: position.totalBought,
                                    realizedPnl: position.realizedPnl,
                                    percentRealizedPnl: position.percentRealizedPnl,
                                    curPrice: position.curPrice,
                                    redeemable: position.redeemable,
                                    mergeable: position.mergeable,
                                    title: position.title,
                                    slug: position.slug,
                                    icon: position.icon,
                                    eventSlug: position.eventSlug,
                                    outcome: position.outcome,
                                    outcomeIndex: position.outcomeIndex,
                                    oppositeOutcome: position.oppositeOutcome,
                                    oppositeAsset: position.oppositeAsset,
                                    endDate: position.endDate,
                                    negativeRisk: position.negativeRisk,
                                },
                                { upsert: true }
                            ).exec(),
                            `Database update for position ${position.asset}`,
                            'update position'
                        );
                    } catch (error) {
                        ErrorHandler.handle(error, `Updating position ${position.asset} for ${address.slice(0, 6)}...${address.slice(-4)}`);
                        // Continue with other positions
                    }
                }
            }
        } catch (error) {
            ErrorHandler.handle(error, `Fetching data for ${address.slice(0, 6)}...${address.slice(-4)}`);
            // Continue with next user
        }
    }
};

// Track if this is the first run
let isFirstRun = true;
// Track if monitor should continue running
let isRunning = true;

/**
 * Stop the trade monitor gracefully
 */
export const stopTradeMonitor = () => {
    isRunning = false;
    Logger.info('Trade monitor shutdown requested...');
};

/**
 * Starts the trade monitoring service for copying trades from specified users.
 * This function initializes the database connections, displays initial positions and balances,
 * marks historical trades as processed on first run, and then continuously fetches new trade data
 * from Polymarket API at regular intervals.
 *
 * The monitor can be stopped gracefully using the stopTradeMonitor function.
 *
 * @returns {Promise<void>} A promise that resolves when the monitor is stopped.
 *
 * @example
 * ```typescript
 * // Start monitoring
 * tradeMonitor().then(() => {
 *   console.log('Monitoring stopped');
 * });
 *
 * // Later, stop monitoring
 * stopTradeMonitor();
 * ```
 *
 * @throws {Error} If USER_ADDRESSES environment variable is not defined or empty.
 */
const tradeMonitor = async () => {
    await init();
    Logger.success(`Monitoring ${USER_ADDRESSES.length} trader(s) every ${FETCH_INTERVAL}s`);
    Logger.separator();

    // On first run, mark all existing historical trades as already processed
    if (isFirstRun) {
        Logger.info('First run: marking all historical trades as processed...');
        for (const { address, UserActivity } of userModels) {
            const count = await UserActivity.updateMany(
                { bot: false },
                { $set: { bot: true, botExcutedTime: 999 } }
            );
            if (count.modifiedCount > 0) {
                Logger.info(
                    `Marked ${count.modifiedCount} historical trades as processed for ${address.slice(0, 6)}...${address.slice(-4)}`
                );
            }
        }
        isFirstRun = false;
        Logger.success('\nHistorical trades processed. Now monitoring for new trades only.');
        Logger.separator();
    }

    while (isRunning) {
        await fetchTradeData();
        if (!isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, FETCH_INTERVAL * 1000));
    }

    Logger.info('Trade monitor stopped');
};

export default tradeMonitor;
