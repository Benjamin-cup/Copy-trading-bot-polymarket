# Polymarket Copy Trading Bot

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

An automated copy trading bot for Polymarket that monitors selected traders and replicates their trades in real-time.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or cloud)
- Ethereum wallet with USDC on Polygon
- Polymarket API credentials

### Installation

```bash
git clone <repository-url>
cd polymarket-copy-trading-bot
npm install
```

### Setup

Choose one of two setup methods:

#### Option 1: Interactive Setup (Recommended)
```bash
npm run setup
```

#### Option 2: Manual Configuration
Copy `.env.example` to `.env` and fill in your values.

### Health Check
```bash
npm run health-check
```

### Start Trading
```bash
npm start
```

## 📋 What You Need

| Component | Status | Notes |
|-----------|--------|-------|
| ✅ Node.js 18+ | Required | Runtime environment |
| ✅ MongoDB | Required | Data storage |
| ✅ Ethereum Wallet | Required | Trading wallet |
| ✅ USDC on Polygon | Required | Trading capital |
| ✅ Polymarket Account | Required | API access |
| ✅ RPC Endpoint | Required | Polygon network access |

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Trade Monitor │───▶│  Trade Executor │───▶│ Execution Engine│
│                 │    │                 │    │                 │
│ • API Polling   │    │ • Aggregation   │    │ • Order Posting │
│ • Data Storage  │    │ • Validation    │    │ • Error Handling│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Circuit       │    │   Order         │    │   Polymarket    │
│   Breaker       │    │   Validator     │    │   API           │
│                 │    │                 │    │                 │
│ • Failure       │    │ • Balance Check │    │ • Trade Orders  │
│ • Recovery      │    │ • Position Val. │    │ • Market Data   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

- **Trade Monitor**: Continuously monitors selected traders' activities
- **Trade Aggregator**: Groups small trades to meet minimum order sizes
- **Order Validator**: Ensures trades can be executed safely
- **Execution Engine**: Places orders on Polymarket
- **Circuit Breaker**: Prevents cascading failures
- **Error Handler**: Comprehensive error management and recovery

## 📖 Usage

### Basic Commands

```bash
# Start the bot
npm start

# Interactive setup
npm run setup

# Health check
npm run health-check

# View all commands
npm run help

# Generate API documentation
npm run docs
```

### Advanced Commands

```bash
# Check your positions
npm run check-stats

# Check trader positions
npm run check-pnl

# Run simulations
npm run simulate

# Close positions
npm run close-resolved
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | ✅ |
| `PROXY_WALLET` | Your trading wallet address | ✅ |
| `PRIVATE_KEY` | Wallet private key | ✅ |
| `USER_ADDRESSES` | Trader addresses to copy (comma-separated) | ✅ |
| `CLOB_HTTP_URL` | Polymarket API URL | ✅ |
| `RPC_URL` | Polygon RPC endpoint | ✅ |
| `USDC_CONTRACT_ADDRESS` | USDC contract on Polygon | ✅ |

### Optional Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_INTERVAL` | 30 | Seconds between API checks |
| `TRADE_AGGREGATION_ENABLED` | true | Enable trade aggregation |
| `TRADE_AGGREGATION_WINDOW_SECONDS` | 300 | Aggregation time window |
| `LOG_LEVEL` | INFO | Logging verbosity |

## 🔧 Troubleshooting

### Common Issues

#### "Invalid wallet address"
- Ensure your `PROXY_WALLET` starts with `0x` and is 42 characters long
- Verify the address checksum

#### "Database connection failed"
- Check your `MONGODB_URI` format
- Ensure MongoDB is running and accessible
- Verify network connectivity

#### "Insufficient balance"
- Ensure your wallet has enough USDC for trades
- Check the balance on Polygon network
- Verify the `USDC_CONTRACT_ADDRESS` is correct

#### "Circuit breaker open"
- External API is failing repeatedly
- Check Polymarket API status
- Wait for automatic recovery or restart the bot

### Getting Help

1. Run `npm run health-check` for diagnostics
2. Check `docs/GETTING_STARTED.md` for detailed setup
3. Review logs in the `logs/` directory
4. Open an issue on GitHub

## 📚 Documentation

- [Getting Started Guide](docs/GETTING_STARTED.md)
- [API Documentation](docs/api/) - Run `npm run docs` to generate
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Simulation Guide](docs/SIMULATION_GUIDE.md)
- [Improvements](docs/IMPROVEMENTS.md)

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 📊 Monitoring

The bot provides comprehensive monitoring:

- **Real-time Logging**: Color-coded console output
- **Health Checks**: System component validation
- **Position Tracking**: Portfolio monitoring
- **Performance Metrics**: Trade success rates
- **Error Recovery**: Automatic failure handling

## 🔒 Security

- Private keys are encrypted in memory
- No sensitive data in logs
- Circuit breakers prevent cascade failures
- Input validation on all user data
- Secure API key handling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is for educational and research purposes. Trading cryptocurrencies and prediction markets involves significant risk. Always trade with caution and never invest more than you can afford to lose. The authors are not responsible for any financial losses incurred through the use of this software.

---

**Happy Trading! 🚀**