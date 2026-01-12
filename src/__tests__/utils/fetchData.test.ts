import axios from 'axios';
import fetchData from '../../utils/fetchData';
import { NetworkError, ApiError } from '../../errors';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock environment
jest.mock('../../config/env', () => ({
    ENV: {
        NETWORK_RETRY_LIMIT: 3,
        REQUEST_TIMEOUT_MS: 5000,
    },
}));

describe('fetchData', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should return data on successful request', async () => {
        const mockData = { test: 'data' };
        mockedAxios.get.mockResolvedValueOnce({ data: mockData });

        const result = await fetchData('https://api.example.com/test');

        expect(result).toEqual(mockData);
        expect(mockedAxios.get).toHaveBeenCalledWith('https://api.example.com/test', {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            family: 4,
        });
    });

    it('should retry on network errors', async () => {
        const networkError = new Error('Network timeout') as Error & { code: string };
        networkError.code = 'ETIMEDOUT';

        mockedAxios.get
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(networkError)
            .mockResolvedValueOnce({ data: { success: true } });

        const result = await fetchData('https://api.example.com/test');

        expect(result).toEqual({ success: true });
        expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should throw NetworkError after max retries on network errors', async () => {
        const networkError = new Error('Connection refused') as Error & { code: string };
        networkError.code = 'ECONNREFUSED';

        mockedAxios.get.mockRejectedValue(networkError);

        await expect(fetchData('https://api.example.com/test')).rejects.toThrow(NetworkError);
        expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should retry on 5xx server errors', async () => {
        const serverError = {
            response: { status: 500 },
            isAxiosError: true,
        };

        mockedAxios.get
            .mockRejectedValueOnce(serverError)
            .mockResolvedValueOnce({ data: { success: true } });

        const result = await fetchData('https://api.example.com/test');

        expect(result).toEqual({ success: true });
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should throw ApiError on 4xx client errors without retry', async () => {
        const clientError = {
            response: { status: 404 },
            isAxiosError: true,
            message: 'Not Found',
        };

        mockedAxios.get.mockRejectedValue(clientError);

        await expect(fetchData('https://api.example.com/test')).rejects.toThrow(ApiError);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should implement exponential backoff with jitter', async () => {
        const networkError = new Error('Timeout') as Error & { code: string };
        networkError.code = 'ETIMEDOUT';

        mockedAxios.get
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(networkError)
            .mockResolvedValueOnce({ data: { success: true } });

        const fetchPromise = fetchData('https://api.example.com/test');

        // Advance timers to simulate delays
        jest.advanceTimersByTime(1000); // First retry delay
        jest.advanceTimersByTime(2000); // Second retry delay

        await fetchPromise;

        expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should respect maximum delay limit', async () => {
        const networkError = new Error('Timeout') as Error & { code: string };
        networkError.code = 'ETIMEDOUT';

        // Mock multiple failures to trigger longer delays
        mockedAxios.get.mockRejectedValue(networkError);

        const fetchPromise = fetchData('https://api.example.com/test');

        // Advance through multiple retry attempts
        for (let i = 0; i < 10; i++) {
            jest.advanceTimersByTime(30000); // Max delay
        }

        await expect(fetchPromise).rejects.toThrow(NetworkError);
    });

    it('should handle non-axios errors', async () => {
        mockedAxios.get.mockRejectedValue(new Error('Unknown error'));

        await expect(fetchData('https://api.example.com/test')).rejects.toThrow();
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should handle axios errors without response', async () => {
        const axiosError = {
            isAxiosError: true,
            code: 'ENOTFOUND',
            message: 'DNS lookup failed',
        };

        mockedAxios.get.mockRejectedValue(axiosError);

        await expect(fetchData('https://api.example.com/test')).rejects.toThrow(NetworkError);
    });
});