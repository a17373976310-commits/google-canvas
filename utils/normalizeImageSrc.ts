function stripWrappingQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    if (trimmed.startsWith("b'") && trimmed.endsWith("'")) {
        return trimmed.slice(2, -1).trim();
    }
    if (trimmed.startsWith('b"') && trimmed.endsWith('"')) {
        return trimmed.slice(2, -1).trim();
    }
    return trimmed;
}

function sanitizeBase64Payload(value: string): string {
    return value
        .replace(/^base64,/i, '')
        .replace(/[\s\r\n\t]+/g, '')
        .trim();
}

function normalizeDataImageUri(value: string): string | null {
    const cleaned = stripWrappingQuotes(value);
    if (!/^data:image\//i.test(cleaned)) {
        return null;
    }

    const normalized = cleaned.replace(/[\r\n\t]+/g, '').trim();
    const commaIndex = normalized.indexOf(',');
    if (commaIndex >= 0) {
        const header = normalized.slice(0, commaIndex);
        const payload = sanitizeBase64Payload(normalized.slice(commaIndex + 1));
        if (!payload) return null;
        return `${header},${payload}`;
    }

    const base64Match = normalized.match(/^(data:image\/[^;]+;base64)(.+)$/i);
    if (base64Match) {
        const payload = sanitizeBase64Payload(base64Match[2]);
        if (!payload) return null;
        return `${base64Match[1]},${payload}`;
    }

    return normalized;
}

/**
 * normalizeImageSrc:
 * Clean AI image outputs into a stable value for <img src>.
 */
export function normalizeImageSrc(raw: unknown): string | null {
    if (!raw) return null;

    if (Array.isArray(raw)) {
        return raw.length > 0 ? normalizeImageSrc(raw[0]) : null;
    }

    if (typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        if (obj.data && Array.isArray(obj.data)) {
            return normalizeImageSrc(obj.data);
        }
        if (typeof obj.localCacheUrl === 'string' && obj.localCacheUrl.trim()) {
            return normalizeImageSrc(obj.localCacheUrl);
        }
        if (typeof obj.primaryUrl === 'string' && obj.primaryUrl.trim()) {
            return normalizeImageSrc(obj.primaryUrl);
        }
        if (Array.isArray(obj.urls) && obj.urls.length > 0) {
            return normalizeImageSrc(obj.urls[0]);
        }
        if (obj.url) return normalizeImageSrc(obj.url);
        if (obj.b64_json) {
            const existingDataUri = normalizeDataImageUri(String(obj.b64_json));
            if (existingDataUri) return existingDataUri;
            return `data:image/png;base64,${sanitizeBase64Payload(String(obj.b64_json))}`;
        }
        if (obj.output) return normalizeImageSrc(obj.output);
        return null;
    }

    if (typeof raw !== 'string') return null;

    const trimmed = stripWrappingQuotes(raw);
    if (!trimmed) return null;

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }

    const normalizedDataUri = normalizeDataImageUri(trimmed);
    if (normalizedDataUri) {
        return normalizedDataUri;
    }

    if (trimmed.startsWith('/history-assets/')) {
        const backendBaseUrl = String(import.meta.env.VITE_BACKEND_URL || '').trim().replace(/\/$/, '');
        return backendBaseUrl ? `${backendBaseUrl}${trimmed}` : trimmed;
    }

    const mdMatch = trimmed.match(/!?\[.*?\]\((.*?)\)/);
    if (mdMatch && mdMatch[1]) {
        return normalizeImageSrc(mdMatch[1]);
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            const item = parsed?.data?.[0] || parsed;
            if (item?.url) return normalizeImageSrc(item.url);
            if (item?.b64_json) return normalizeImageSrc(item.b64_json);
        } catch {
            // Ignore invalid JSON-looking strings and keep probing below.
        }
    }

    const cleaned = sanitizeBase64Payload(trimmed);
    if (/^[A-Za-z0-9+/=]{100,}$/.test(cleaned)) {
        return `data:image/png;base64,${cleaned}`;
    }

    if (/^base64,/i.test(trimmed)) {
        return `data:image/png;base64,${sanitizeBase64Payload(trimmed)}`;
    }

    return trimmed;
}
