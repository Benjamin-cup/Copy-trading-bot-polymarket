import { CircuitBreakerError } from '../errors';
import Logger from './logger';

/**
 * Circuit Breaker implementation for API calls
 */
export class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';

    constructor(
        private readonly name: string,
        private readonly failureThreshold: number = 5,
        private readonly recoveryTimeout: number = 60000, // 1 minute
        private readonly monitoringPeriod: number = 300000 // 5 minutes
    ) {}

    /**
     * Executes a function with circuit breaker protection, managing state transitions based on success/failure.
     * If the circuit is open, it may allow a trial call in half-open state after the recovery timeout.
     * Tracks failures and automatically opens the circuit when the failure threshold is reached.
     *
     * @template T - The return type of the operation.
     * @param {() => Promise<T>} operation - The async operation to execute with protection.
     * @returns {Promise<T>} A promise that resolves to the result of the operation if successful.
     *
     * @example
     * ```typescript
     * const breaker = CircuitBreakerRegistry.getBreaker('api-call');
     * try {
     *   const result = await breaker.execute(() => fetchData(url));
     *   console.log('Success:', result);
     * } catch (error) {
     *   console.log('Circuit breaker prevented call or operation failed');
     * }
     * ```
     *
     * @throws {CircuitBreakerError} If the circuit breaker is open and not ready for a trial call.
     * @throws {Error} If the operation fails, the original error is re-thrown after updating failure state.
     */
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
                this.state = 'half-open';
                Logger.info(`🔄 Circuit breaker '${this.name}' entering half-open state`);
            } else {
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.name}' is OPEN - service unavailable`
                );
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Handle successful operation
     */
    private onSuccess(): void {
        if (this.state === 'half-open') {
            this.reset();
            Logger.success(`✅ Circuit breaker '${this.name}' reset to closed state`);
        }
        // Reset failure count periodically
        if (Date.now() - this.lastFailureTime > this.monitoringPeriod) {
            this.failures = 0;
        }
    }

    /**
     * Handle failed operation
     */
    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.failureThreshold) {
            this.state = 'open';
            Logger.warning(
                `🚫 Circuit breaker '${this.name}' opened after ${this.failures} failures`
            );
        } else if (this.state === 'half-open') {
            this.state = 'open';
            Logger.warning(
                `🚫 Circuit breaker '${this.name}' re-opened due to failure in half-open state`
            );
        }
    }

    /**
     * Reset the circuit breaker
     */
    private reset(): void {
        this.failures = 0;
        this.state = 'closed';
        this.lastFailureTime = 0;
    }

    /**
     * Gets the current state of the circuit breaker for monitoring and debugging purposes.
     * Returns the current state ('closed', 'open', 'half-open'), failure count, and timestamp of last failure.
     *
     * @returns {{ state: string; failures: number; lastFailureTime: number }} An object containing the circuit breaker's current state information.
     *
     * @example
     * ```typescript
     * const breaker = CircuitBreakerRegistry.getBreaker('api-call');
     * const state = breaker.getState();
     * console.log(`Breaker state: ${state.state}, failures: ${state.failures}`);
     * ```
     */
    getState(): { state: string; failures: number; lastFailureTime: number } {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime
        };
    }

    /**
     * Forces a manual reset of the circuit breaker to closed state, clearing all failure counts.
     * This method is primarily intended for testing, administrative purposes, or emergency recovery.
     * Use with caution as it bypasses the normal circuit breaker recovery logic.
     *
     * @returns {void}
     *
     * @example
     * ```typescript
     * const breaker = CircuitBreakerRegistry.getBreaker('api-call');
     * breaker.forceReset(); // Manually reset the breaker
     * ```
     */
    forceReset(): void {
        this.reset();
        Logger.info(`🔧 Circuit breaker '${this.name}' manually reset`);
    }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
export class CircuitBreakerRegistry {
    private static breakers = new Map<string, CircuitBreaker>();

    /**
     * Gets or creates a circuit breaker instance by name, with optional configuration.
     * If a breaker with the given name already exists, returns the existing instance.
     * Otherwise, creates a new breaker with the specified parameters.
     *
     * @param {string} name - Unique identifier for the circuit breaker.
     * @param {number} [failureThreshold=5] - Number of consecutive failures before opening the circuit.
     * @param {number} [recoveryTimeout=60000] - Time in milliseconds to wait before attempting recovery.
     * @returns {CircuitBreaker} The circuit breaker instance for the given name.
     *
     * @example
     * ```typescript
     * const breaker = CircuitBreakerRegistry.getBreaker('polymarket-api', 3, 30000);
     * const result = await breaker.execute(() => apiCall());
     * ```
     */
    static getBreaker(
        name: string,
        failureThreshold: number = 5,
        recoveryTimeout: number = 60000
    ): CircuitBreaker {
        if (!this.breakers.has(name)) {
            this.breakers.set(
                name,
                new CircuitBreaker(name, failureThreshold, recoveryTimeout)
            );
        }
        return this.breakers.get(name)!;
    }

    /**
     * Gets the current state of all registered circuit breakers for monitoring purposes.
     * Returns a record mapping breaker names to their state information.
     *
     * @returns {Record<string, { state: string; failures: number; lastFailureTime: number }>} A record of all circuit breaker states.
     *
     * @example
     * ```typescript
     * const allStates = CircuitBreakerRegistry.getAllStates();
     * for (const [name, state] of Object.entries(allStates)) {
     *   console.log(`${name}: ${state.state} (${state.failures} failures)`);
     * }
     * ```
     */
    static getAllStates(): Record<string, { state: string; failures: number; lastFailureTime: number }> {
        const states: Record<string, { state: string; failures: number; lastFailureTime: number }> = {};
        for (const [name, breaker] of this.breakers) {
            states[name] = breaker.getState();
        }
        return states;
    }

    /**
     * Forces a manual reset of all registered circuit breakers to closed state.
     * This method is intended for emergency recovery or administrative purposes.
     * Use with caution as it bypasses normal circuit breaker recovery logic for all breakers.
     *
     * @returns {void}
     *
     * @example
     * ```typescript
     * // Reset all circuit breakers in case of widespread issues
     * CircuitBreakerRegistry.resetAll();
     * ```
     */
    static resetAll(): void {
        for (const breaker of this.breakers.values()) {
            breaker.forceReset();
        }
        Logger.info('🔧 All circuit breakers reset');
    }
}