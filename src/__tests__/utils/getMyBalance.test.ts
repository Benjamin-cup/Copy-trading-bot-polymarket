import { ethers } from 'ethers';
import getMyBalance from '../../utils/getMyBalance';
import { CircuitBreakerRegistry } from '../../utils/circuitBreaker';
import { ApiError } from '../../errors';

// Mock ethers
jest.mock('ethers');
const mockedEthers = jest.mocked(ethers);

// Mock circuit breaker
jest.mock('../../utils/circuitBreaker', () => ({
    CircuitBreakerRegistry: {
        getBreaker: jest.fn(),
    },
}));

// Mock environment
jest.mock('../../config/env', () => ({
    ENV: {
        RPC_URL: 'https://polygon-rpc.com',
        USDC_CONTRACT_ADDRESS: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    },
}));

describe('getMyBalance', () => {
    const mockAddress = '0x1234567890123456789012345678901234567890';
    const mockBalance = ethers.BigNumber.from('1000000000'); // 1000 USDC (6 decimals)
    const expectedBalance = 1000;

    let mockContract: jest.Mocked<ethers.Contract>;
    let mockProvider: jest.Mocked<ethers.providers.JsonRpcProvider>;
    let mockBreaker: { execute: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock ethers.JsonRpcProvider
        mockProvider = {
            getCode: jest.fn(),
        } as any;

        // Mock ethers.Contract
        mockContract = {
            balanceOf: jest.fn(),
        } as any;

        // Mock circuit breaker
        mockBreaker = {
            execute: jest.fn(),
        };

        (CircuitBreakerRegistry.getBreaker as jest.Mock).mockReturnValue(mockBreaker);
        mockedEthers.providers.JsonRpcProvider.mockImplementation(() => mockProvider as any);
        mockedEthers.Contract.mockImplementation(() => mockContract as any);
        mockedEthers.utils.formatUnits.mockReturnValue(expectedBalance.toString());
    });

    it('should return formatted USDC balance', async () => {
        mockContract.balanceOf.mockResolvedValue(mockBalance);
        mockBreaker.execute.mockImplementation((fn) => fn());

        const result = await getMyBalance(mockAddress);

        expect(result).toBe(expectedBalance);
        expect(CircuitBreakerRegistry.getBreaker).toHaveBeenCalledWith('polygon-balance', 3, 30000);
        expect(mockBreaker.execute).toHaveBeenCalledTimes(1);
        expect(ethers.providers.JsonRpcProvider).toHaveBeenCalledWith('https://polygon-rpc.com');
        expect(ethers.Contract).toHaveBeenCalledWith(
            '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
            ['function balanceOf(address owner) view returns (uint256)'],
            mockProvider
        );
        expect(mockContract.balanceOf).toHaveBeenCalledWith(mockAddress);
        expect(ethers.utils.formatUnits).toHaveBeenCalledWith(mockBalance, 6);
    });

    it('should throw ApiError on contract error', async () => {
        const contractError = new Error('Contract call failed');
        mockContract.balanceOf.mockRejectedValue(contractError);
        mockBreaker.execute.mockImplementation((fn) => fn());

        await expect(getMyBalance(mockAddress)).rejects.toThrow(ApiError);
        expect(mockContract.balanceOf).toHaveBeenCalledWith(mockAddress);
    });

    it('should handle circuit breaker failures', async () => {
        const breakerError = new Error('Circuit breaker open');
        mockBreaker.execute.mockRejectedValue(breakerError);

        await expect(getMyBalance(mockAddress)).rejects.toThrow(breakerError);
        expect(mockBreaker.execute).toHaveBeenCalledTimes(1);
        expect(mockContract.balanceOf).not.toHaveBeenCalled();
    });

    it('should handle provider connection errors', async () => {
        const providerError = new Error('RPC connection failed');
        mockedEthers.providers.JsonRpcProvider.mockImplementation(() => {
            throw providerError;
        });
        mockBreaker.execute.mockImplementation((fn) => fn());

        await expect(getMyBalance(mockAddress)).rejects.toThrow(ApiError);
    });

    it('should handle invalid balance format', async () => {
        mockContract.balanceOf.mockResolvedValue('invalid');
        (ethers.utils.formatUnits as jest.Mock).mockImplementation(() => {
            throw new Error('Invalid format');
        });
        mockBreaker.execute.mockImplementation((fn) => fn());

        await expect(getMyBalance(mockAddress)).rejects.toThrow(ApiError);
    });

    it('should handle zero balance', async () => {
        const zeroBalance = ethers.BigNumber.from('0');
        mockContract.balanceOf.mockResolvedValue(zeroBalance);
        (ethers.utils.formatUnits as jest.Mock).mockReturnValue('0');
        mockBreaker.execute.mockImplementation((fn) => fn());

        const result = await getMyBalance(mockAddress);

        expect(result).toBe(0);
    });

    it('should handle large balance values', async () => {
        const largeBalance = ethers.BigNumber.from('1000000000000'); // 1M USDC
        mockContract.balanceOf.mockResolvedValue(largeBalance);
        (ethers.utils.formatUnits as jest.Mock).mockReturnValue('1000000');
        mockBreaker.execute.mockImplementation((fn) => fn());

        const result = await getMyBalance(mockAddress);

        expect(result).toBe(1000000);
    });
});