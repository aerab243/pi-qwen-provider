# pi-qwen-provider

A Pi extension to use Qwen AI models via OAuth authentication with qwen.ai.

## Installation

```
pi -p npm:pi-qwen-provider
```

Or via GitHub:

```
pi -p git:github.com/aerab243/pi-qwen-provider
```

## Features

- **OAuth Authentication**: Sign in with your qwen.ai account (free 1,000 requests/day)
- **Automatic Token Refresh**: Tokens are automatically refreshed when expired
- **Multiple Models**: Access to Qwen3 Coder Plus, Qwen3 Coder Flash, and more
- **Vision Support**: Some models support image input
- **Reasoning Models**: Extended thinking support for certain models

## Requirements

No external requirements! Just install and login.

## Usage

### 1. Install the extension

```
pi -p npm:pi-qwen-provider
```

### 2. Login with OAuth (recommended - free)

```
pi
/login qwen-ai
```

This will open a browser window for you to sign in with your qwen.ai account.

### 3. Use a model

```
pi --provider qwen-ai --model qwen3-coder-plus
```

Or select interactively:

```
pi
# Then select qwen-ai provider and a model
```

## Available Models

- **qwen3-coder-plus** - Advanced coding model (1M context)
- **qwen3-coder-flash** - Fast coding model (1M context)
- **qwen3-32b** - Large model with reasoning
- **qwen2.5-vl-32b-instruct** - Vision model for images
- **qwen-plus** - General purpose model
- **qwen3-8b** - Lightweight model

## Authentication

### OAuth (Recommended - Free)

Sign in with your qwen.ai account for 1,000 free requests per day.

```
/login qwen-ai
```

### API Key (Alternative)

If you prefer to use Dashscope API directly:

```bash
export DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
```

Get your API key from: [Dashscope Console](https://dashscope.console.aliyun.com/)

## License

MIT
