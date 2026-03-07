/**
 * Qwen Provider Extension for Pi
 *
 * Provides access to Qwen AI models via OAuth authentication with qwen.ai.
 * Free tier: 1,000 requests/day through qwen.ai OAuth.
 *
 * Usage:
 *   pi install git:github.com/VOTRE_USERNAME/pi-qwen-provider
 *   # Then /login qwen-ai, or set DASHSCOPE_API_KEY=... for API key auth
 *
 * Features:
 *   - OAuth device code flow with qwen.ai
 *   - Automatic token refresh
 *   - Dynamic model list
 *   - Fallback to API key (Dashscope)
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

// OAuth endpoints (same as qwen-cli example)
const QWEN_DEVICE_CODE_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/device/code";
const QWEN_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token";
const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_SCOPE = "openid profile email model.completion";
const QWEN_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

// API endpoints
const QWEN_DEFAULT_BASE_URL = "https://portal.qwen.ai/v1";
const QWEN_MODELS_ENDPOINT = "https://portal.qwen.ai/v1/models";

// Timing
const QWEN_POLL_INTERVAL_MS = 2000;
const MODELS_FETCH_TIMEOUT_MS = 10_000;

// =============================================================================
// PKCE Helpers (for secure OAuth)
// =============================================================================

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	const verifier = btoa(String.fromCharCode(...array))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return { verifier, challenge };
}

// =============================================================================
// OAuth Types
// =============================================================================

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	expires_in: number;
	interval?: number;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	token_type: string;
	expires_in: number;
	resource_url?: string;
}

// =============================================================================
// OAuth Implementation
// =============================================================================

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Login cancelled"));
			},
			{ once: true },
		);
	});
}

async function startDeviceFlow(): Promise<{ deviceCode: DeviceCodeResponse; verifier: string }> {
	const { verifier, challenge } = await generatePKCE();

	const body = new URLSearchParams({
		client_id: QWEN_CLIENT_ID,
		scope: QWEN_SCOPE,
		code_challenge: challenge,
		code_challenge_method: "S256",
	});

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
	};
	const requestId = globalThis.crypto?.randomUUID?.();
	if (requestId) headers["x-request-id"] = requestId;

	const response = await fetch(QWEN_DEVICE_CODE_ENDPOINT, {
		method: "POST",
		headers,
		body: body.toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Device code request failed: ${response.status} ${text}`);
	}

	const data = (await response.json()) as DeviceCodeResponse;

	if (!data.device_code || !data.user_code || !data.verification_uri) {
		throw new Error("Invalid device code response: missing required fields");
	}

	return { deviceCode: data, verifier };
}

async function pollForToken(
	deviceCode: string,
	verifier: string,
	intervalSeconds: number | undefined,
	expiresIn: number,
	signal?: AbortSignal,
): Promise<TokenResponse> {
	const deadline = Date.now() + expiresIn * 1000;
	const resolvedIntervalSeconds =
		typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds) && intervalSeconds > 0
			? intervalSeconds
			: QWEN_POLL_INTERVAL_MS / 1000;
	let intervalMs = Math.max(1000, Math.floor(resolvedIntervalSeconds * 1000));

	const handleTokenError = async (error: string, description?: string): Promise<boolean> => {
		switch (error) {
			case "authorization_pending":
				await abortableSleep(intervalMs, signal);
				return true;
			case "slow_down":
				intervalMs = Math.min(intervalMs + 5000, 10000);
				await abortableSleep(intervalMs, signal);
				return true;
			case "expired_token":
				throw new Error("Device code expired. Please restart authentication.");
			case "access_denied":
				throw new Error("Authorization denied by user.");
			default:
				throw new Error(`Token request failed: ${error} - ${description || ""}`);
		}
	};

	while (Date.now() < deadline) {
		if (signal?.aborted) {
			throw new Error("Login cancelled");
		}

		const body = new URLSearchParams({
			grant_type: QWEN_GRANT_TYPE,
			client_id: QWEN_CLIENT_ID,
			device_code: deviceCode,
			code_verifier: verifier,
		});

		const response = await fetch(QWEN_TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: body.toString(),
		});

		const responseText = await response.text();
		let data: (TokenResponse & { error?: string; error_description?: string }) | null = null;
		if (responseText) {
			try {
				data = JSON.parse(responseText) as TokenResponse & { error?: string; error_description?: string };
			} catch {
				data = null;
			}
		}

		const error = data?.error;
		const errorDescription = data?.error_description;

		if (!response.ok) {
			if (error && (await handleTokenError(error, errorDescription))) {
				continue;
			}
			throw new Error(`Token request failed: ${response.status} ${response.statusText}. Response: ${responseText}`);
		}

		if (data?.access_token) {
			return data;
		}

		if (error && (await handleTokenError(error, errorDescription))) {
			continue;
		}

		throw new Error("Token request failed: missing access token in response");
	}

	throw new Error("Authentication timed out. Please try again.");
}

async function loginQwen(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { deviceCode, verifier } = await startDeviceFlow();

	// Show verification URL and user code to user
	const authUrl = deviceCode.verification_uri_complete || deviceCode.verification_uri;
	const instructions = deviceCode.verification_uri_complete
		? undefined // Code is already embedded in the URL
		: `Enter code: ${deviceCode.user_code}`;
	callbacks.onAuth({ url: authUrl, instructions });

	// Poll for token
	const tokenResponse = await pollForToken(
		deviceCode.device_code,
		verifier,
		deviceCode.interval,
		deviceCode.expires_in,
		callbacks.signal,
	);

	// Calculate expiry with 5-minute buffer
	const expiresAt = Date.now() + tokenResponse.expires_in * 1000 - 5 * 60 * 1000;

	return {
		refresh: tokenResponse.refresh_token || "",
		access: tokenResponse.access_token,
		expires: expiresAt,
		enterpriseUrl: tokenResponse.resource_url,
	};
}

async function refreshQwenToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: credentials.refresh,
		client_id: QWEN_CLIENT_ID,
	});

	const response = await fetch(QWEN_TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Token refresh failed: ${response.status} ${text}`);
	}

	const data = (await response.json()) as TokenResponse;

	if (!data.access_token) {
		throw new Error("Token refresh failed: no access token in response");
	}

	const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

	return {
		refresh: data.refresh_token || credentials.refresh,
		access: data.access_token,
		expires: expiresAt,
		enterpriseUrl: data.resource_url ?? credentials.enterpriseUrl,
	};
}

function getQwenBaseUrl(resourceUrl?: string): string {
	if (!resourceUrl) {
		return QWEN_DEFAULT_BASE_URL;
	}

	let url = resourceUrl.startsWith("http") ? resourceUrl : `https://${resourceUrl}`;
	if (!url.endsWith("/v1")) {
		url = `${url}/v1`;
	}
	return url;
}

// =============================================================================
// Dynamic Model Fetching
// =============================================================================

interface DashscopeModel {
	model_id: string;
	name: string;
	owner: string;
	context_window?: number;
	max_output_tokens?: number;
	capabilities?: string[];
}

interface DashscopeModelsResponse {
	request_id: string;
	code: string;
	message: string;
	data: {
		models: DashscopeModel[];
	};
}

function parsePrice(price: string | null | undefined): number {
	if (!price) return 0;
	const parsed = parseFloat(price);
	if (isNaN(parsed)) return 0;
	return parsed * 1_000_000;
}

function mapDashscopeModel(m: DashscopeModel): ProviderModelConfig {
	const contextWindow = m.context_window || 100000;
	const maxTokens = m.max_output_tokens || Math.ceil(contextWindow * 0.2);
	
	// Determine if model supports vision
	const capabilities = m.capabilities || [];
	const supportsVision = capabilities.some(c => 
		c.toLowerCase().includes("vision") || c.toLowerCase().includes("image")
	);
	
	// Determine if model supports reasoning (extended thinking)
	const supportsReasoning = capabilities.some(c =>
		c.toLowerCase().includes("reasoning") || c.toLowerCase().includes("thinking")
	);

	return {
		id: m.model_id,
		name: m.name || m.model_id,
		reasoning: supportsReasoning,
		input: supportsVision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Free via OAuth
		contextWindow: contextWindow,
		maxTokens: maxTokens,
		compat: {
			supportsDeveloperRole: false,
			thinkingFormat: "qwen",
		},
	};
}

async function fetchQwenModels(_token?: string): Promise<ProviderModelConfig[]> {
	// Note: qwen.ai doesn't expose a public models endpoint
	// Using default models instead
	return getDefaultModels();
}

// Default models fallback
function getDefaultModels(): ProviderModelConfig[] {
	return [
		{
			id: "qwen3-coder-plus",
			name: "Qwen3 Coder Plus",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
			compat: { supportsDeveloperRole: false },
		},
		{
			id: "qwen3-coder-flash",
			name: "Qwen3 Coder Flash",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
			compat: { supportsDeveloperRole: false },
		},
		{
			id: "qwen3-32b",
			name: "Qwen3 32B",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131072,
			maxTokens: 32768,
			compat: { supportsDeveloperRole: false, thinkingFormat: "qwen" },
		},
		{
			id: "qwen2.5-vl-32b-instruct",
			name: "Qwen2.5 VL 32B (Vision)",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
			compat: { supportsDeveloperRole: false },
		},
		{
			id: "qwen3-8b",
			name: "Qwen3 8B",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131072,
			maxTokens: 8192,
			compat: { supportsDeveloperRole: false },
		},
		{
			id: "qwen-plus",
			name: "Qwen Plus",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
			compat: { supportsDeveloperRole: false },
		},
	];
}

// =============================================================================
// Provider Config
// =============================================================================

const QWEN_PROVIDER_CONFIG = {
	baseUrl: QWEN_DEFAULT_BASE_URL,
	apiKey: "DASHSCOPE_API_KEY",
	api: "openai-completions" as const,
	headers: {
		"User-Agent": "pi-qwen-provider",
	},
};

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	// Fetch default models at load time so the provider is immediately usable.
	const defaultModels = getDefaultModels();

	// Full model list cached after login.
	let cachedAllModels: ProviderModelConfig[] = [];

	function makeOAuthConfig() {
		return {
			name: "Qwen AI (OAuth)",
			login: async (callbacks: OAuthLoginCallbacks) => {
				const cred = await loginQwen(callbacks);
				// Cache full models after successful login
				cachedAllModels = await fetchQwenModels(cred.access).catch(() => []);
				return cred;
			},
			refreshToken: refreshQwenToken,
			getApiKey: (cred: OAuthCredentials) => cred.access,
			modifyModels: (models: any[], cred: OAuthCredentials) => {
				// Update baseUrl based on OAuth credentials (important!)
				const baseUrl = getQwenBaseUrl(cred.enterpriseUrl as string | undefined);
				
				// If we have cached models, use them with updated baseUrl
				if (cachedAllModels.length > 0) {
					const template = models.find((m: any) => m.provider === "qwen-ai");
					if (!template) return models;
					const nonQwen = models.filter((m: any) => m.provider !== "qwen-ai");
					const fullModels = cachedAllModels.map((m) => ({
						...template,
						id: m.id,
						name: m.name,
						reasoning: m.reasoning,
						input: m.input,
						cost: m.cost,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
						compat: m.compat,
						baseUrl: baseUrl, // Use OAuth-specific base URL!
					}));
					return [...nonQwen, ...fullModels];
				}
				
				// Update default models with OAuth baseUrl
				return models.map((m: any) => 
					m.provider === "qwen-ai" ? { ...m, baseUrl } : m
				);
			},
		};
	}

	// Register provider with default models
	pi.registerProvider("qwen-ai", {
		...QWEN_PROVIDER_CONFIG,
		models: defaultModels,
		oauth: makeOAuthConfig(),
	});

	// After session starts, pre-fetch all models if already logged in
	pi.on("session_start", async (_event, ctx) => {
		const cred = ctx.modelRegistry.authStorage.get("qwen-ai");
		if (cred?.type !== "oauth") return;

		// Get the correct baseUrl from OAuth credentials
		const enterpriseUrl = (cred as any).enterpriseUrl;
		const baseUrl = getQwenBaseUrl(enterpriseUrl);

		cachedAllModels = await fetchQwenModels(cred.access).catch(() => []);
		if (cachedAllModels.length > 0) {
			// Re-register to trigger modifyModels with the cached data
			ctx.modelRegistry.registerProvider("qwen-ai", {
				...QWEN_PROVIDER_CONFIG,
				baseUrl: baseUrl, // Use OAuth-specific base URL!
				models: defaultModels,
				oauth: makeOAuthConfig(),
			});
		}
	});

	// Print welcome message on first use
	let welcomeShown = false;

	pi.on("before_agent_start", async (_event, ctx) => {
		if (welcomeShown) return;
		if (ctx.model?.provider !== "qwen-ai") return;

		welcomeShown = true;

		const cred = ctx.modelRegistry.authStorage.get("qwen-ai");
		const authMethod = cred?.type === "oauth" ? "OAuth (qwen.ai)" : "API Key (Dashscope)";

		return {
			message: {
				customType: "qwen-welcome",
				content: `Connected to Qwen AI via ${authMethod}. Free tier: 1,000 requests/day via qwen.ai OAuth.`,
				display: "inline",
			},
		};
	});
}
