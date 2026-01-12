import { ethers } from 'ethers';
import { ENV } from '../config/env';
import { ErrorHandler } from './errorHandler';
import { CircuitBreakerRegistry } from './circuitBreaker';
import { ApiError } from '../errors';

const RPC_URL = ENV.RPC_URL;
const USDC_CONTRACT_ADDRESS = ENV.USDC_CONTRACT_ADDRESS;

const USDC_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/**
 * Retrieves the USDC balance for a given Ethereum address on the Polygon network.
 * Uses circuit breaker protection to handle RPC failures gracefully.
 * The balance is returned in human-readable format (not in wei).
 *
 * @param {string} address - The Ethereum address to check the USDC balance for.
 * @returns {Promise<number>} A promise that resolves to the USDC balance as a number.
 *
 * @example
 * ```typescript
 * const balance = await getMyBalance('0x1234567890abcdef...');
 * console.log(`USDC Balance: ${balance}`);
 * ```
 *
 * @throws {ApiError} If the RPC call fails or the contract interaction encounters an error.
 */
const getMyBalance = async (address: string): Promise<number> => {
    const balanceBreaker = CircuitBreakerRegistry.getBreaker('polygon-balance', 3, 30000);

    return await balanceBreaker.execute(async () => {
        try {
            const rpcProvider = new ethers.providers.JsonRpcProvider(RPC_URL);
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, rpcProvider);
            const balance_usdc = await usdcContract.balanceOf(address);
            const balance_usdc_real = ethers.utils.formatUnits(balance_usdc, 6);
            return parseFloat(balance_usdc_real);
        } catch (error) {
            if (error instanceof Error) {
                throw new ApiError(`Failed to get balance for ${address.slice(0, 6)}...${address.slice(-4)}: ${error.message}`, true);
            }
            throw ErrorHandler.classifyError(error);
        }
    });
};

export default getMyBalance;
