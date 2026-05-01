import type { ChatProtocol, ImageProtocol, ReasoningProtocol } from '../types';
import type { ImageHistoryItem } from '../types';

type ProviderApiSettings = {
    providerName?: string;
    apiKey: string;
    baseUrl: string;
    chatProtocol?: ChatProtocol;
    reasoningProtocol?: ReasoningProtocol;
    imageProtocol?: ImageProtocol;
};

export type AgentBatchItemPayload = {
    id?: string;
    title: string;
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    imageUrls?: string[];
    status?: string;
    error?: string;
    result?: any;
    nodeId?: string;
};

export type AgentBatchPayload = {
    id?: string;
    name?: string;
    summary?: string;
    requirementText?: string;
    status?: string;
    modelId?: string;
    imageModelId?: string;
    referenceImageCount?: number;
    referenceImages?: string[];
    documentAssets?: any[];
    items?: AgentBatchItemPayload[];
    approvedAt?: number | null;
};

export type AgentBatchSummary = {
    id: string;
    name?: string;
    summary?: string;
    status?: string;
    modelId?: string;
    imageModelId?: string;
    referenceImageCount?: number;
    itemCount?: number;
    statusCounts?: Record<string, number>;
    createdAt?: number;
    updatedAt?: number;
};

export type AgentBatchRecord = AgentBatchPayload & {
    id: string;
    createdAt?: number;
    updatedAt?: number;
};

export class AIService {
    private baseUrl: string;
    private executeTimeoutMs: number;

    constructor() {
        this.baseUrl = import.meta.env.VITE_BACKEND_URL || '';
        const parsedTimeout = Number(import.meta.env.VITE_EXECUTE_TIMEOUT_MS ?? 0);
        this.executeTimeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 0;
    }

    async executeNode(nodeId: string, nodeType: string, config: any, inputs: Record<string, any>, apiSettings: ProviderApiSettings) {
        const controller = this.executeTimeoutMs > 0 ? new AbortController() : null;
        const timeoutId = this.executeTimeoutMs > 0
            ? window.setTimeout(() => controller?.abort(), this.executeTimeoutMs)
            : null;

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    node_id: nodeId,
                    node_type: nodeType,
                    config,
                    inputs,
                    provider_name: apiSettings.providerName,
                    api_key: apiSettings.apiKey,
                    base_url: apiSettings.baseUrl,
                    chat_protocol: apiSettings.chatProtocol,
                    reasoning_protocol: apiSettings.reasoningProtocol,
                    image_protocol: apiSettings.imageProtocol,
                }),
                ...(controller ? { signal: controller.signal } : {}),
            });
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw new Error(`Node request timed out (${Math.round(this.executeTimeoutMs / 1000)}s). Check the model, Base URL, or network.`);
            }
            throw error;
        } finally {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData.detail || errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }

        const data = await response.json();
        return {
            output: data.output,
            meta: data.meta || null,
        };
    }

    async testProviderConnection(apiSettings: ProviderApiSettings & { model?: string }) {
        const response = await fetch(`${this.baseUrl}/test-provider`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                provider_name: apiSettings.providerName,
                api_key: apiSettings.apiKey,
                base_url: apiSettings.baseUrl,
                model: apiSettings.model,
                chat_protocol: apiSettings.chatProtocol,
                reasoning_protocol: apiSettings.reasoningProtocol,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }

        return {
            ok: !!data.ok,
            message: data.message || (data.ok ? 'Connection OK' : 'Connection failed'),
            code: data.code,
            latencyMs: data.latencyMs,
            model: data.model,
            detail: data.detail,
        };
    }

    async testImageProviderConnection(apiSettings: ProviderApiSettings & { model?: string }) {
        const response = await fetch(`${this.baseUrl}/test-provider-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                provider_name: apiSettings.providerName,
                api_key: apiSettings.apiKey,
                base_url: apiSettings.baseUrl,
                model: apiSettings.model,
                image_protocol: apiSettings.imageProtocol,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }

        return {
            ok: !!data.ok,
            message: data.message || (data.ok ? 'Image model connection OK' : 'Image model connection failed'),
            code: data.code,
            latencyMs: data.latencyMs,
            model: data.model,
            detail: data.detail,
        };
    }

    async listImageHistory(limit = 300) {
        const response = await fetch(`${this.baseUrl}/history/images?limit=${encodeURIComponent(String(limit))}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return {
            items: Array.isArray(data.items) ? data.items as ImageHistoryItem[] : [],
            storageRoot: typeof data.storageRoot === 'string' ? data.storageRoot : '',
        };
    }

    async saveImageHistoryItem(item: ImageHistoryItem) {
        const response = await fetch(`${this.baseUrl}/history/images`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(item),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return {
            item: data.item as ImageHistoryItem,
            storageRoot: typeof data.storageRoot === 'string' ? data.storageRoot : '',
        };
    }

    async deleteImageHistoryItem(id: string) {
        const response = await fetch(`${this.baseUrl}/history/images/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return { ok: !!data.ok };
    }

    async clearImageHistory() {
        const response = await fetch(`${this.baseUrl}/history/images`, {
            method: 'DELETE',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return { ok: !!data.ok };
    }

    async saveAgentBatch(batch: AgentBatchPayload) {
        const method = batch.id ? 'PUT' : 'POST';
        const url = batch.id
            ? `${this.baseUrl}/agent/batches/${encodeURIComponent(batch.id)}`
            : `${this.baseUrl}/agent/batches`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(batch),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return data.item;
    }

    async listAgentBatches(limit = 50) {
        const response = await fetch(`${this.baseUrl}/agent/batches?limit=${encodeURIComponent(String(limit))}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return Array.isArray(data.items) ? data.items as AgentBatchSummary[] : [];
    }

    async getAgentBatch(batchId: string) {
        const response = await fetch(`${this.baseUrl}/agent/batches/${encodeURIComponent(batchId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return data.item as AgentBatchRecord;
    }

    async deleteAgentBatch(batchId: string) {
        const response = await fetch(`${this.baseUrl}/agent/batches/${encodeURIComponent(batchId)}`, {
            method: 'DELETE',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return { ok: !!data.ok };
    }

    async patchAgentBatchItem(batchId: string, itemId: string, patch: Record<string, any>) {
        const response = await fetch(`${this.baseUrl}/agent/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(patch),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return data.item;
    }

    async parseRequirementDocument(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.baseUrl}/agent/parse-document`, {
            method: 'POST',
            body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
        }
        return {
            text: String(data.text || ''),
            images: Array.isArray(data.images) ? data.images.map(String).filter(Boolean) : [],
            imageCount: Number(data.imageCount || 0),
            truncated: !!data.truncated,
        };
    }
}
