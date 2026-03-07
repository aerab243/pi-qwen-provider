# pi-qwen-provider

Qwen AI provider extension for [Pi](https://github.com/badlogic/pi) - AI coding assistant.

## Features

- 🔐 **OAuth Authentication** - Sign in with your qwen.ai account (free 1,000 requests/day)
- 🔑 **API Key Fallback** - Also supports Dashscope API key authentication
- 📦 **Dynamic Models** - Automatically fetches available Qwen models
- 🚀 **Qwen3 Coder** - Optimized for code generation with Qwen3-Coder models

## Installation

```bash
# Install from git repository
pi install git:github.com/VOTRE_USERNAME/pi-qwen-provider

# Or local development
pi install ./path/to/pi-qwen-provider
```

## Authentication

### Option 1: OAuth (Recommended - Free)

```bash
# Start pi and login
pi
/login qwen-ai
```

This opens a browser window for you to sign in with your qwen.ai account.
- Free: 1,000 requests/day
- No API key needed
- Models are automatically updated

### Option 2: API Key (Dashscope)

If you prefer to use Dashscope API directly:

```bash
# Set your API key
export DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx

# Or add to auth.json
echo '{"qwen-ai": {"type": "api_key", "key": "sk-xxx"}}' > ~/.pi/agent/auth.json
```

Get your API key from: [Dashscope Console](https://dashscope.console.aliyun.com/)

## Available Models

With OAuth (qwen.ai), you get access to all Qwen models available through their service:

- **Qwen3 Coder Plus** - Advanced coding model (1M context)
- **Qwen3 Coder Flash** - Fast coding model (1M context)
- **Qwen3 32B** - Large model with reasoning (131K context)
- **Qwen2.5 VL** - Vision model for images
- And more...

With API key, you can configure custom models in your settings.

## Usage

```bash
# Start a coding session with Qwen
pi --provider qwen-ai --model qwen3-coder-plus

# Or select interactively
pi
# Then select qwen-ai provider and a model
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DASHSCOPE_API_KEY` | Your Dashscope API key (for API key auth) |

## License

MIT
