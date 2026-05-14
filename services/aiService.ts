import type { ChatProtocol, ImageProtocol, ReasoningProtocol } from '../types';
import type { ImageHistoryItem } from '../types';
import { isAdminEdition } from '../config/appEdition';
import {
    executeClientNode,
    quoteClientCredits,
    refundClientCredits,
    reportClientModelCall,
    reserveClientCredits,
    settleClientCredits,
    type ClientCreditQuoteResponse,
} from './licenseClientApi';

type ProviderApiSettings = {
    providerName?: string;
    apiKey: string;
    baseUrl: string;
    chatProtocol?: ChatProtocol;
    reasoningProtocol?: ReasoningProtocol;
    imageProtocol?: ImageProtocol;
};

const inferModelId = (nodeType: string, config: any): string => {
    const candidates = [
        config?.modelId,
        config?.model,
        config?.chatModelId,
        config?.imageModelId,
        config?.audioModelId,
        config?.videoModelId,
    ];
    const direct = candidates.find((value) => typeof value === 'string' && value.trim());
    if (direct) return direct.trim();
    return nodeType ? `${nodeType}-unknown` : 'unknown';
};

const inferModelGroup = (nodeType: string): string => {
    const normalized = String(nodeType || '').toLowerCase();
    if (normalized.includes('image') || normalized.includes('imagen')) return 'image';
    if (normalized.includes('audio')) return 'audio';
    if (normalized.includes('video')) return 'video';
    return 'chat';
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error || 'Unknown error');
};

const describeCreditRoute = (quote?: ClientCreditQuoteResponse | null) => {
    const route = quote?.route;
    const name = route?.display_name || route?.route_name || route?.model_id || '';
    return name ? `，线路：${name}` : '';
};

const buildCreditBlockMessage = (quote: ClientCreditQuoteResponse) => {
    const available = Number(quote.account?.available_balance ?? quote.account?.balance ?? 0);
    const estimated = Number(quote.estimated_credits || 0);
    const required = Number(quote.required_credits || estimated || 1);
    const shortfall = Number(quote.shortfall || Math.max(0, required - available));
    if (quote.account?.status !== 'enabled') {
        return '公司额度账户已停用，请联系管理员。';
    }
    return `公司代币余额不足：当前可用 ${available}，本次预计消耗 ${estimated}，启动前至少需要 ${required}，还差 ${shortfall}。请联系管理员续费${describeCreditRoute(quote)}。`;
};

export type AgentBatchItemPayload = {
    id?: string;
    title: string;
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    imageUrls?: string[];
    imageRefs?: string[];
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
    fileReadIssues?: any[];
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

    async executeNode(
        nodeId: string,
        nodeType: string,
        config: any,
        inputs: Record<string, any>,
        apiSettings: ProviderApiSettings,
        options?: { signal?: AbortSignal | null }
    ) {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const modelId = inferModelId(nodeType, config);
        const modelGroup = inferModelGroup(nodeType);
        const internalController = this.executeTimeoutMs > 0 ? new AbortController() : null;
        const timeoutId = this.executeTimeoutMs > 0
            ? window.setTimeout(() => internalController?.abort(), this.executeTimeoutMs)
            : null;
        const mergedSignal = options?.signal || internalController?.signal || undefined;

        if (!isAdminEdition) {
            try {
                const data = await executeClientNode({
                    node_id: nodeId,
                    node_type: nodeType,
                    config,
                    inputs,
                    model_id: modelId,
                    model_group: modelGroup,
                    request_id: nodeId,
                }, { signal: mergedSignal });
                return {
                    output: data?.output,
                    meta: data?.meta || null,
                };
            } catch (error: any) {
                if (error?.name === 'AbortError') {
                    throw new Error(`请求被${options?.signal ? '取消' : `超时 (${Math.round(this.executeTimeoutMs / 1000)}s)`}。`);
                }
                throw error;
            } finally {
                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                }
            }
        }

        let creditReservation: { transaction_id: number; reserved_credits: number } | null = null;
        let hasReportedCall = false;
        const reportCall = (success: boolean, detail?: { errorCode?: string; errorMessage?: string }) => {
            if (hasReportedCall || !modelId) return;
            hasReportedCall = true;
            const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            void reportClientModelCall({
                provider_name: apiSettings.providerName || '',
                provider_base_url: apiSettings.baseUrl || '',
                model_id: modelId,
                model_group: modelGroup,
                node_type: nodeType,
                success,
                latency_ms: endedAt - startedAt,
                error_code: detail?.errorCode || '',
                error_message: detail?.errorMessage || '',
                tokens_charged: creditReservation?.reserved_credits || 0,
            });
        };
        let response: Response;
        try {
            const creditQuote = await quoteClientCredits({
                model_id: modelId,
                model_group: modelGroup,
                node_type: nodeType,
            });
            if (creditQuote && !creditQuote.allowed) {
                throw new Error(buildCreditBlockMessage(creditQuote));
            }
            creditReservation = await reserveClientCredits({
                model_id: modelId,
                model_group: modelGroup,
                node_type: nodeType,
                estimated_credits: creditQuote?.estimated_credits,
                request_id: nodeId,
            });
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
                ...(mergedSignal ? { signal: mergedSignal } : {}),
            });
        } catch (error: any) {
            if (creditReservation?.transaction_id) {
                await refundClientCredits(creditReservation.transaction_id, getErrorMessage(error)).catch(() => null);
            }
            if (error?.name === 'AbortError') {
                const message = `请求被${options?.signal ? '取消' : `超时 (${Math.round(this.executeTimeoutMs / 1000)}s)`}。`;
                reportCall(false, { errorCode: options?.signal ? 'ABORTED' : 'TIMEOUT', errorMessage: message });
                throw new Error(message);
            }
            reportCall(false, { errorCode: 'NETWORK_ERROR', errorMessage: getErrorMessage(error) });
            throw error;
        } finally {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData.detail || errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;
            if (creditReservation?.transaction_id) {
                await refundClientCredits(creditReservation.transaction_id, message).catch(() => null);
            }
            reportCall(false, { errorCode: `HTTP_${response.status}`, errorMessage: message });
            throw new Error(message);
        }

        const data = await response.json();
        if (creditReservation?.transaction_id) {
            const settled = await settleClientCredits(
                creditReservation.transaction_id,
                creditReservation.reserved_credits,
                true,
                'Node execution completed',
            ).catch(() => null);
            if (settled?.settled_credits !== undefined) {
                creditReservation = {
                    ...creditReservation,
                    reserved_credits: Number(settled.settled_credits || creditReservation.reserved_credits),
                };
            }
        }
        reportCall(true);
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
