import axios, { AxiosError } from 'axios';
import { ENV } from '../config/env';
import { NetworkError, ApiError } from '../errors';
import { ErrorHandler } from './errorHandler';
import Logger from './logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkError = (error: unknown): boolean => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const code = axiosError.code;
        // Network timeout/connection errors
        return (
            code === 'ETIMEDOUT' ||
            code === 'ENETUNREACH' ||
            code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' ||
            !axiosError.response
        ); // No response = network issue
    }
    return false;
};

const isRetryableError = (error: unknown): boolean => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        // Retry on server errors (5xx) and network errors
        return !status || status >= 500 || isNetworkError(error);
    }
    return isNetworkError(error);
};

/**
 * Fetches data from a URL with retry logic, exponential backoff, and error classification.
 * Implements robust network handling with configurable retries, timeouts, and circuit breaker compatibility.
 * Automatically retries on network errors and server errors (5xx), with exponential backoff and jitter.
 *
 * @param {string} url - The URL to fetch data from.
 * @returns {Promise<any>} A promise that resolves to the response data from the API.
 *
 * @example
 * ```typescript
 * const data = await fetchData('https://api.polymarket.com/positions?user=0x...');
 * console.log('Fetched positions:', data);
 * ```
 *
 * @throws {NetworkError} If network connectivity fails after all retries.
 * @throws {ApiError} If the API returns an error response.
 */
const fetchData = async (url: string) => {
    const retries = ENV.NETWORK_RETRY_LIMIT;
    const timeout = ENV.REQUEST_TIMEOUT_MS;
    const baseDelay = 1000; // 1 second base delay
    const maxDelay = 30000; // Maximum 30 seconds delay

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, {
                timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                // Force IPv4 to avoid IPv6 connectivity issues
                family: 4,
            });
            return response.data;
        } catch (error) {
            const isLastAttempt = attempt === retries;
            const shouldRetry = isRetryableError(error) && !isLastAttempt;

            if (shouldRetry) {
                // Exponential backoff with jitter: baseDelay * 2^(attempt-1) + random jitter
                const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
                const jitter = Math.random() * 1000; // Up to 1 second jitter
                const delay = Math.min(exponentialDelay + jitter, maxDelay);

                Logger.warning(
                    `Network/API error (attempt ${attempt}/${retries}), retrying in ${(delay / 1000).toFixed(1)}s...`
                );
                await sleep(delay);
                continue;
            }

            // Classify and throw appropriate error
            if (isNetworkError(error)) {
                throw new NetworkError(
                    `Network request failed after ${retries} attempts: ${axios.isAxiosError(error) ? error.code : 'Unknown network error'}`,
                    false // Not retryable at this level
                );
            } else if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;
                throw new ApiError(
                    `API request failed: ${status ? `HTTP ${status}` : 'Unknown API error'} - ${axiosError.message}`,
                    status ? status >= 500 : false
                );
            } else {
                throw ErrorHandler.classifyError(error);
            }
        }
    }
};

export default fetchData;
