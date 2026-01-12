/**
 * Custom error classes for the copy trading bot
 */

export class BaseError extends Error {
    public readonly code: string;
    public readonly isRetryable: boolean;
    public readonly severity: 'low' | 'medium' | 'high' | 'critical';

    constructor(
        message: string,
        code: string,
        isRetryable: boolean = false,
        severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
    ) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.isRetryable = isRetryable;
        this.severity = severity;
    }
}

export class NetworkError extends BaseError {
    constructor(message: string, isRetryable: boolean = true) {
        super(message, 'NETWORK_ERROR', isRetryable, 'medium');
    }
}

export class ValidationError extends BaseError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR', false, 'high');
    }
}

export class ExecutionError extends BaseError {
    constructor(message: string, isRetryable: boolean = false) {
        super(message, 'EXECUTION_ERROR', isRetryable, 'high');
    }
}

export class DatabaseError extends BaseError {
    constructor(message: string, isRetryable: boolean = true) {
        super(message, 'DATABASE_ERROR', isRetryable, 'high');
    }
}

export class ApiError extends BaseError {
    constructor(message: string, isRetryable: boolean = true) {
        super(message, 'API_ERROR', isRetryable, 'medium');
    }
}

export class InsufficientFundsError extends BaseError {
    constructor(message: string) {
        super(message, 'INSUFFICIENT_FUNDS_ERROR', false, 'critical');
    }
}

export class CircuitBreakerError extends BaseError {
    constructor(message: string) {
        super(message, 'CIRCUIT_BREAKER_ERROR', true, 'high');
    }
}

export class ConfigurationError extends BaseError {
    constructor(message: string) {
        super(message, 'CONFIGURATION_ERROR', false, 'critical');
    }
}