import {
    BaseError,
    NetworkError,
    ValidationError,
    ExecutionError,
    DatabaseError,
    ApiError,
    InsufficientFundsError,
    CircuitBreakerError,
    ConfigurationError,
} from '../../errors';

describe('Error Classes', () => {
    describe('BaseError', () => {
        it('should create error with correct properties', () => {
            const error = new BaseError(
                'Test error message',
                'TEST_CODE',
                true,
                'high'
            );

            expect(error.message).toBe('Test error message');
            expect(error.code).toBe('TEST_CODE');
            expect(error.isRetryable).toBe(true);
            expect(error.severity).toBe('high');
            expect(error.name).toBe('BaseError');
        });

        it('should have default values', () => {
            const error = new BaseError('Test message', 'TEST_CODE');

            expect(error.isRetryable).toBe(false);
            expect(error.severity).toBe('medium');
        });
    });

    describe('NetworkError', () => {
        it('should create network error with correct defaults', () => {
            const error = new NetworkError('Connection failed');

            expect(error.message).toBe('Connection failed');
            expect(error.code).toBe('NETWORK_ERROR');
            expect(error.isRetryable).toBe(true);
            expect(error.severity).toBe('medium');
            expect(error.name).toBe('NetworkError');
        });

        it('should allow overriding retryable', () => {
            const error = new NetworkError('Connection failed', false);

            expect(error.isRetryable).toBe(false);
        });
    });

    describe('ValidationError', () => {
        it('should create validation error with correct defaults', () => {
            const error = new ValidationError('Invalid input');

            expect(error.message).toBe('Invalid input');
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.isRetryable).toBe(false);
            expect(error.severity).toBe('high');
            expect(error.name).toBe('ValidationError');
        });
    });

    describe('ExecutionError', () => {
        it('should create execution error with correct defaults', () => {
            const error = new ExecutionError('Execution failed');

            expect(error.message).toBe('Execution failed');
            expect(error.code).toBe('EXECUTION_ERROR');
            expect(error.isRetryable).toBe(false);
            expect(error.severity).toBe('high');
            expect(error.name).toBe('ExecutionError');
        });

        it('should allow overriding retryable', () => {
            const error = new ExecutionError('Execution failed', true);

            expect(error.isRetryable).toBe(true);
        });
    });

    describe('DatabaseError', () => {
        it('should create database error with correct defaults', () => {
            const error = new DatabaseError('Database connection failed');

            expect(error.message).toBe('Database connection failed');
            expect(error.code).toBe('DATABASE_ERROR');
            expect(error.isRetryable).toBe(true);
            expect(error.severity).toBe('high');
            expect(error.name).toBe('DatabaseError');
        });

        it('should allow overriding retryable', () => {
            const error = new DatabaseError('Database connection failed', false);

            expect(error.isRetryable).toBe(false);
        });
    });

    describe('ApiError', () => {
        it('should create API error with correct defaults', () => {
            const error = new ApiError('API request failed');

            expect(error.message).toBe('API request failed');
            expect(error.code).toBe('API_ERROR');
            expect(error.isRetryable).toBe(true);
            expect(error.severity).toBe('medium');
            expect(error.name).toBe('ApiError');
        });

        it('should allow overriding retryable', () => {
            const error = new ApiError('API request failed', false);

            expect(error.isRetryable).toBe(false);
        });
    });

    describe('InsufficientFundsError', () => {
        it('should create insufficient funds error with correct defaults', () => {
            const error = new InsufficientFundsError('Not enough balance');

            expect(error.message).toBe('Not enough balance');
            expect(error.code).toBe('INSUFFICIENT_FUNDS_ERROR');
            expect(error.isRetryable).toBe(false);
            expect(error.severity).toBe('critical');
            expect(error.name).toBe('InsufficientFundsError');
        });
    });

    describe('CircuitBreakerError', () => {
        it('should create circuit breaker error with correct defaults', () => {
            const error = new CircuitBreakerError('Circuit breaker open');

            expect(error.message).toBe('Circuit breaker open');
            expect(error.code).toBe('CIRCUIT_BREAKER_ERROR');
            expect(error.isRetryable).toBe(true);
            expect(error.severity).toBe('high');
            expect(error.name).toBe('CircuitBreakerError');
        });
    });

    describe('ConfigurationError', () => {
        it('should create configuration error with correct defaults', () => {
            const error = new ConfigurationError('Invalid configuration');

            expect(error.message).toBe('Invalid configuration');
            expect(error.code).toBe('CONFIGURATION_ERROR');
            expect(error.isRetryable).toBe(false);
            expect(error.severity).toBe('critical');
            expect(error.name).toBe('ConfigurationError');
        });
    });

    describe('Error inheritance', () => {
        it('should maintain instanceof relationships', () => {
            const networkError = new NetworkError('test');
            const validationError = new ValidationError('test');

            expect(networkError instanceof BaseError).toBe(true);
            expect(networkError instanceof Error).toBe(true);
            expect(validationError instanceof BaseError).toBe(true);
            expect(validationError instanceof Error).toBe(true);
        });

        it('should have correct prototype chain', () => {
            const apiError = new ApiError('test');

            expect(Object.getPrototypeOf(apiError)).toBe(ApiError.prototype);
            expect(Object.getPrototypeOf(ApiError.prototype)).toBe(BaseError.prototype);
            expect(Object.getPrototypeOf(BaseError.prototype)).toBe(Error.prototype);
        });
    });
});