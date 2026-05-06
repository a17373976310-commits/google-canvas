import { APIProvider, ImageProtocol, ModelCapabilities } from '../types';

// Default capabilities fallback for models that don't have explicit bounds
export const DEFAULT_IMAGE_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4', '21:9'],
    allowedImageSizes: ['1K', '2K', '4K'],
    supportsImageRefs: true,
    supportsImageSize: true,
    imageSizeMeaning: 'resolution',
};

export const DEFAULT_VIDEO_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: ['16:9', '9:16', '1:1'],
    allowedDurations: ['5', '10'],
    supportsImageSize: false,
};

const GEMINI_ADVANCED_IMAGE_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: [
        '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4',
        '21:9', '1:4', '4:1', '8:1', '1:8'
    ],
    allowedImageSizes: ['512px', '1K', '2K', '4K'],
    supportsImageRefs: true,
    supportsImageSize: true,
    imageSizeMeaning: 'resolution-and-clarity',
};

const GEMINI_PRO_IMAGE_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4', '21:9'],
    allowedImageSizes: ['1K', '2K', '4K'],
    supportsImageRefs: true,
    supportsImageSize: true,
    imageSizeMeaning: 'resolution-and-clarity',
};

const GEMINI_FLASH_IMAGE_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4', '21:9'],
    supportsImageRefs: true,
    supportsImageSize: false,
    imageSizeMeaning: 'resolution',
};

const GPT_IMAGE_2_CAPABILITIES: ModelCapabilities = {
    allowedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4', '21:9', '46:19'],
    allowedImageSizes: ['1K', '2K', '4K'],
    supportsImageRefs: true,
    supportsImageSize: true,
    imageSizeMeaning: 'resolution',
};

// Model-specific overrides registry
export const MODEL_CAPABILITIES_REGISTRY: Record<string, ModelCapabilities> = {
    'gpt-image-2': GPT_IMAGE_2_CAPABILITIES,
    'gemini-3-pro-image-preview': GEMINI_PRO_IMAGE_CAPABILITIES,
    'gemini-3.1-flash-image-preview': GEMINI_ADVANCED_IMAGE_CAPABILITIES,
    'gemini-3.1-flash-image-preview-4k': GEMINI_ADVANCED_IMAGE_CAPABILITIES,
    'gemini-2.0-flash-preview-image-generation': GEMINI_ADVANCED_IMAGE_CAPABILITIES,
    'gemini-2.5-flash-image': GEMINI_FLASH_IMAGE_CAPABILITIES,
    'dall-e-3': {
        allowedAspectRatios: ['1:1', '16:9', '9:16'],
        allowedImageSizes: ['1K'],
        supportsImageRefs: false,
        supportsImageSize: true,
        imageSizeMeaning: 'resolution',
    },
    'midjourney-v6': {
        allowedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4'],
        allowedImageSizes: ['1K', '2K'],
        supportsImageRefs: true,
        supportsImageSize: true,
        imageSizeMeaning: 'resolution',
    },
    'sora-2': {
        allowedAspectRatios: ['16:9', '1:1', '9:16'],
        allowedDurations: ['5', '10', '15'],
        supportsImageSize: false,
    },
    'sora-2-pro': {
        allowedAspectRatios: ['16:9', '1:1', '9:16'],
        allowedDurations: ['5', '10', '15', '25'],
        supportsImageSize: false,
    },
    'veo3.1-fast': {
        allowedAspectRatios: ['16:9', '9:16', '1:1'],
        supportsImageRefs: true,
        supportsImageSize: false,
    },
    'veo3.1-pro': {
        allowedAspectRatios: ['16:9', '9:16', '1:1'],
        supportsImageRefs: true,
        supportsImageSize: false,
    },
    'veo3.1-pro-4k': {
        allowedAspectRatios: ['16:9', '9:16', '1:1'],
        supportsImageRefs: true,
        supportsImageSize: false,
    }
};

const MODEL_PREFIX_RULES: { prefix: string; capabilities: ModelCapabilities }[] = [
    { prefix: 'gpt-image-2', capabilities: GPT_IMAGE_2_CAPABILITIES },
    { prefix: 'gemini-3-pro-image', capabilities: GEMINI_PRO_IMAGE_CAPABILITIES },
    { prefix: 'gemini-3.1-flash-image', capabilities: GEMINI_ADVANCED_IMAGE_CAPABILITIES },
    { prefix: 'gemini-2.5-flash-image', capabilities: GEMINI_FLASH_IMAGE_CAPABILITIES },
    { prefix: 'gemini-2.0-flash', capabilities: GEMINI_ADVANCED_IMAGE_CAPABILITIES },
];

type ProviderFamily = 'yunwu' | 'bltcy' | 'generic';
type ModelCapabilityContext = Partial<Pick<APIProvider, 'name' | 'baseUrl' | 'imageProtocol'>> | null | undefined;

type ImageCapabilityOverride = {
    protocol: ImageProtocol;
    providerFamilies?: ProviderFamily[];
    modelPrefixes: string[];
    capabilities: Partial<ModelCapabilities>;
};

const IMAGE_CAPABILITY_OVERRIDES: ImageCapabilityOverride[] = [
    {
        protocol: 'gemini-native',
        providerFamilies: ['yunwu', 'bltcy', 'generic'],
        modelPrefixes: ['gemini-3-pro-image-preview'],
        capabilities: {
            allowedImageSizes: ['1K', '2K', '4K'],
            supportsImageSize: true,
            imageSizeMeaning: 'resolution-and-clarity',
        },
    },
    {
        protocol: 'gemini-native',
        providerFamilies: ['yunwu', 'bltcy', 'generic'],
        modelPrefixes: ['gemini-3.1-flash-image-preview', 'gemini-2.0-flash-preview-image-generation'],
        capabilities: {
            allowedImageSizes: ['512px', '1K', '2K', '4K'],
            supportsImageSize: true,
            imageSizeMeaning: 'resolution-and-clarity',
        },
    },
    {
        protocol: 'gemini-native',
        providerFamilies: ['yunwu', 'bltcy', 'generic'],
        modelPrefixes: ['gemini-2.5-flash-image'],
        capabilities: {
            allowedImageSizes: [],
            supportsImageSize: false,
            imageSizeMeaning: 'resolution',
        },
    },
];

function looksLikeGeminiModel(modelId: string | undefined): boolean {
    return /gemini/i.test(String(modelId || '').trim());
}

function detectProviderFamily(context: ModelCapabilityContext): ProviderFamily {
    const fingerprint = `${context?.name || ''} ${context?.baseUrl || ''}`.toLowerCase();
    if (fingerprint.includes('yunwu')) return 'yunwu';
    if (fingerprint.includes('bltcy') || fingerprint.includes('gpt-best') || fingerprint.includes('gptbest')) return 'bltcy';
    return 'generic';
}

function resolveEffectiveImageProtocol(modelId: string | undefined, context: ModelCapabilityContext): ImageProtocol {
    const requested = context?.imageProtocol || 'auto';
    if (requested === 'auto') {
        return looksLikeGeminiModel(modelId) ? 'gemini-native' : 'openai-images';
    }
    return requested;
}

function findModelCapabilities(modelId: string | undefined): ModelCapabilities | undefined {
    if (!modelId) return undefined;
    const exact = MODEL_CAPABILITIES_REGISTRY[modelId];
    if (exact) return exact;

    const lowerModelId = modelId.toLowerCase();
    const prefixMatch = MODEL_PREFIX_RULES.find(rule => lowerModelId.startsWith(rule.prefix));
    return prefixMatch?.capabilities;
}

function applyImageCapabilityOverrides(
    base: ModelCapabilities,
    modelId: string | undefined,
    protocol: ImageProtocol,
    providerFamily: ProviderFamily
): ModelCapabilities {
    const lowerModelId = String(modelId || '').toLowerCase();
    let result = { ...base };

    IMAGE_CAPABILITY_OVERRIDES.forEach((rule) => {
        if (rule.protocol !== protocol) return;
        if (rule.providerFamilies?.length && !rule.providerFamilies.includes(providerFamily)) return;
        if (!rule.modelPrefixes.some(prefix => lowerModelId.startsWith(prefix))) return;

        result = {
            ...result,
            ...rule.capabilities,
        };
    });

    return result;
}

function resolveOpenAIImageCapabilities(modelId: string | undefined): ModelCapabilities {
    const matched = findModelCapabilities(modelId);
    const merged = mergeCapabilities(
        {
            ...matched,
            supportsImageSize: true,
            imageSizeMeaning: 'resolution',
            allowedImageSizes: matched?.allowedImageSizes?.length
                ? matched.allowedImageSizes
                : DEFAULT_IMAGE_CAPABILITIES.allowedImageSizes,
        },
        DEFAULT_IMAGE_CAPABILITIES
    );

    return {
        ...merged,
        supportsImageSize: true,
        imageSizeMeaning: 'resolution',
    };
}

function resolveGeminiNativeCapabilities(modelId: string | undefined, providerFamily: ProviderFamily): ModelCapabilities {
    const matched = findModelCapabilities(modelId);
    const merged = mergeCapabilities(
        matched || {
            supportsImageRefs: true,
            supportsImageSize: false,
            allowedImageSizes: [],
            imageSizeMeaning: 'resolution',
        },
        DEFAULT_IMAGE_CAPABILITIES
    );

    return applyImageCapabilityOverrides(merged, modelId, 'gemini-native', providerFamily);
}

function mergeCapabilities(source: ModelCapabilities, fallback: ModelCapabilities): ModelCapabilities {
    const supportsImageSize = source.supportsImageSize
        ?? (source.allowedImageSizes !== undefined ? source.allowedImageSizes.length > 0 : fallback.supportsImageSize)
        ?? false;

    return {
        allowedAspectRatios: source.allowedAspectRatios ?? fallback.allowedAspectRatios,
        allowedImageSizes: supportsImageSize
            ? (source.allowedImageSizes ?? fallback.allowedImageSizes)
            : [],
        allowedDurations: source.allowedDurations ?? fallback.allowedDurations,
        supportsImageRefs: source.supportsImageRefs !== undefined ? source.supportsImageRefs : fallback.supportsImageRefs,
        supportsImageSize,
        imageSizeMeaning: source.imageSizeMeaning ?? fallback.imageSizeMeaning,
    };
}

/**
 * Helper function to retrieve capabilities for a given model ID.
 * Lookup order: exact match -> prefix match -> modality default.
 */
export function getModelCapabilities(
    modelId: string | undefined,
    modality: 'image' | 'video',
    context?: ModelCapabilityContext
): ModelCapabilities {
    const fallback = modality === 'image' ? DEFAULT_IMAGE_CAPABILITIES : DEFAULT_VIDEO_CAPABILITIES;

    if (!modelId) return fallback;

    if (modality === 'image') {
        const providerFamily = detectProviderFamily(context);
        const effectiveProtocol = resolveEffectiveImageProtocol(modelId, context);

        if (effectiveProtocol === 'openai-images') {
            return resolveOpenAIImageCapabilities(modelId);
        }

        if (effectiveProtocol === 'gemini-native') {
            return resolveGeminiNativeCapabilities(modelId, providerFamily);
        }
    }

    const exact = MODEL_CAPABILITIES_REGISTRY[modelId];
    if (exact) {
        return mergeCapabilities(exact, fallback);
    }

    const lowerModelId = modelId.toLowerCase();
    const prefixMatch = MODEL_PREFIX_RULES.find(rule => lowerModelId.startsWith(rule.prefix));
    if (prefixMatch) {
        return mergeCapabilities(prefixMatch.capabilities, fallback);
    }

    return fallback;
}
