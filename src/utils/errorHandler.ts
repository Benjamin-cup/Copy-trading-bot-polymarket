import Logger from './logger';
import {
    BaseError,
    NetworkError,
    ValidationError,
    ExecutionError,
    DatabaseError,
    ApiError,
    InsufficientFundsError,
    CircuitBreakerError,
    ConfigurationError
} from '../errors';

/**
 * Centralized error handling utility
 */
export class ErrorHandler {
    /**
     * Handle an error with appropriate logging and recovery actions
     */
    static handle(error: unknown, context: string, operation?: string): void {
        const errorContext = operation ? `${context} - ${operation}` : context;

        if (error instanceof BaseError) {
            this.handleCustomError(error, errorContext);
        } else if (error instanceof Error) {
            this.handleGenericError(error, errorContext);
        } else {
            this.handleUnknownError(error, errorContext);
        }
    }

    /**
     * Handle custom application errors
     */
    private static handleCustomError(error: BaseError, context: string): void {
        const logMessage = `${context}: ${error.message}`;

        const meta = {
            code: error.code,
            severity: error.severity,
            isRetryable: error.isRetryable,
            context,
            type: 'custom_error'
        };

        switch (error.severity) {
            case 'critical':
                Logger.critical(`🚨 CRITICAL: ${logMessage}`, meta);
                break;
            case 'high':
                Logger.error(`❌ HIGH: ${logMessage}`, meta);
                break;
            case 'medium':
                Logger.warning(`⚠️  MEDIUM: ${logMessage}`, meta);
                break;
            case 'low':
                Logger.info(`ℹ️  LOW: ${logMessage}`, meta);
                break;
        }

        // Log additional context for retryable errors
        if (error.isRetryable) {
            Logger.info(`🔄 Error is retryable: ${error.code}`, { code: error.code, type: 'retryable_error' });
        }
    }

    /**
     * Handle generic JavaScript errors
     */
    private static handleGenericError(error: Error, context: string): void {
        Logger.error(`${context}: ${error.message}`, { context, stack: error.stack, type: 'generic_error' });
    }

    /**
     * Handle unknown error types
     */
    private static handleUnknownError(error: unknown, context: string): void {
        Logger.error(`${context}: Unknown error occurred`, { error: String(error), context, type: 'unknown_error' });
    }

    /**
     * Wrap async operations with error handling
     */
    static async withErrorHandling<T>(
        operation: () => Promise<T>,
        context: string,
        operationName?: string
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            this.handle(error, context, operationName || 'async operation');
            return null;
        }
    }

    /**
     * Wrap sync operations with error handling
     */
    static withSyncErrorHandling<T>(
        operation: () => T,
        context: string,
        operationName?: string
    ): T | null {
        try {
            return operation();
        } catch (error) {
            this.handle(error, context, operationName || 'sync operation');
            return null;
        }
    }

    /**
     * Classify and convert errors to custom error types
     */
    static classifyError(error: unknown): BaseError {
        if (error instanceof BaseError) {
            return error;
        }

        if (error instanceof Error) {
            const message = error.message.toLowerCase();

            // Network-related errors
            if (message.includes('timeout') || message.includes('network') ||
                message.includes('connection') || message.includes('enotfound') ||
                message.includes('econnrefused')) {
                return new NetworkError(error.message, true);
            }

            // Database-related errors
            if (message.includes('mongo') || message.includes('database') ||
                message.includes('connection') && message.includes('failed')) {
                return new DatabaseError(error.message, true);
            }

            // API-related errors
            if (message.includes('api') || message.includes('http') ||
                message.includes('request') && message.includes('failed')) {
                return new ApiError(error.message, true);
            }

            // Insufficient funds
            if (message.includes('insufficient') && message.includes('balance')) {
                return new InsufficientFundsError(error.message);
            }

            // Validation errors
            if (message.includes('validation') || message.includes('invalid')) {
                return new ValidationError(error.message);
            }

            // Default to execution error
            return new ExecutionError(error.message, false);
        }

        return new ExecutionError('Unknown error occurred', false);
    }

    /**
     * Check if an error should trigger recovery mechanisms
     */
    static shouldRecover(error: BaseError): boolean {
        return error.isRetryable && error.severity !== 'critical';
    }

    /**
     * Get recovery strategy for an error
     */
    static getRecoveryStrategy(error: BaseError): 'retry' | 'circuit_break' | 'skip' | 'shutdown' {
        if (!this.shouldRecover(error)) {
            return error.severity === 'critical' ? 'shutdown' : 'skip';
        }

        if (error instanceof NetworkError || error instanceof ApiError) {
            return 'retry';
        }

        if (error instanceof DatabaseError) {
            return 'circuit_break';
        }

        return 'skip';
    }

    /**
     * Attempt recovery for an error
     */
    static async attemptRecovery(error: BaseError, context: string): Promise<boolean> {
        const strategy = this.getRecoveryStrategy(error);

        const meta = { code: error.code, context, strategy, type: 'recovery_attempt' };

        switch (strategy) {
            case 'retry':
                Logger.info(`🔄 Attempting retry recovery for ${error.code} in ${context}`, meta);
                // For retry, the calling code should handle the retry logic
                return true;

            case 'circuit_break':
                Logger.warning(`🔌 Circuit breaker activated for ${error.code} in ${context}`, meta);
                // Circuit breaker is already handled at the call site
                return true;

            case 'shutdown':
                Logger.critical(`🚨 Critical error ${error.code} in ${context} - initiating shutdown`, meta);
                // In a real application, this might trigger graceful shutdown
                process.exit(1);

            case 'skip':
            default:
                Logger.warning(`⏭️  Skipping operation due to ${error.code} in ${context}`, meta);
                return false;
        }
    }

    /**
     * Create a retry wrapper with recovery
     */
    static async withRetry<T>(
        operation: () => Promise<T>,
        context: string,
        maxRetries: number = 3,
        baseDelay: number = 1000
    ): Promise<T | null> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const classifiedError = this.classifyError(error);

                if (attempt === maxRetries || !classifiedError.isRetryable) {
                    this.handle(classifiedError, context, `attempt ${attempt}/${maxRetries}`);
                    await this.attemptRecovery(classifiedError, context);
                    return null;
                }

                const delay = baseDelay * Math.pow(2, attempt - 1);
                Logger.warning(
                    `⚠️  ${context} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
                    { context, attempt, maxRetries, delay, type: 'retry_attempt' }
                );
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        return null;
    }
}