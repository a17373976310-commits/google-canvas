import { defaultLicenseServerUrl } from '../config/appEdition';
import { isAdminEdition } from '../config/appEdition';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
export const LICENSE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const LICENSE_STATE_KEY = 'awei_client_license_state';
const DEVICE_ID_KEY = 'awei_client_device_id';

export type ClientLicenseStatus = 'unknown' | 'pending' | 'enabled' | 'disabled' | 'error';

export interface ClientVersionInfo {
  current_version?: string;
  latest_version: string;
  min_version: string;
  download_url?: string;
  release_notes?: string;
  force_update?: boolean;
  update_available?: boolean;
  must_update?: boolean;
}

export interface ClientAnnouncement {
  id: number;
  title: string;
  body: string;
  kind: 'normal' | 'important' | 'maintenance' | 'warning';
  scope_license_key?: string;
  is_active: boolean;
  pinned: boolean;
  start_at?: string;
  end_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientModelHealthBucket {
  index: number;
  status: 'empty' | 'ok' | 'warn' | 'bad';
  total: number;
}

export interface ClientModelHealthRoute {
  id?: number;
  model_group?: string;
  model_id: string;
  display_name: string;
  route_name: string;
  route_status: 'enabled' | 'disabled';
  provider_name?: string;
  provider_base_url?: string;
  provider_status: 'enabled' | 'disabled';
  success_rate: number | null;
  total_calls: number;
  avg_latency_ms: number | null;
  token_cost?: number;
  buckets: ClientModelHealthBucket[];
}

export interface ClientModelHealthGroup {
  model_group: string;
  routes: ClientModelHealthRoute[];
}

export interface ClientModelHealthSummary {
  generated_at: string;
  window_hours: number;
  bucket_minutes: number;
  bucket_count: number;
  groups: ClientModelHealthGroup[];
}

export interface ClientModelCallLogPayload {
  route_id?: number | null;
  provider_id?: number | null;
  provider_name?: string;
  provider_base_url?: string;
  license_key?: string;
  device_id?: string;
  model_id: string;
  model_group?: string;
  node_type?: string;
  success: boolean;
  latency_ms?: number;
  error_code?: string;
  error_message?: string;
  tokens_charged?: number;
}

export interface ClientCreditAccount {
  license_key: string;
  customer_name?: string;
  license_status?: string;
  balance: number;
  reserved_balance: number;
  available_balance: number;
  lifetime_granted: number;
  lifetime_spent: number;
  status: 'enabled' | 'disabled';
  updated_at: string;
}

export interface ClientCreditRouteQuote {
  id?: number;
  model_id?: string;
  display_name?: string;
  model_group?: string;
  route_name?: string;
  token_cost?: number;
}

export interface ClientCreditQuotePayload {
  model_id?: string;
  model_group?: string;
  node_type?: string;
  route_id?: number | null;
}

export interface ClientCreditQuoteResponse {
  estimated_credits: number;
  required_credits?: number;
  min_run_credits?: number;
  allowed: boolean;
  shortfall: number;
  route?: ClientCreditRouteQuote | null;
  account: ClientCreditAccount;
}

export interface ClientCreditReserveResponse {
  transaction_id: number;
  reserved_credits: number;
  estimated_credits: number;
  required_credits?: number;
  min_run_credits?: number;
  route?: ClientCreditRouteQuote | null;
  account: ClientCreditAccount;
}

export interface ClientExecutePayload {
  node_id: string;
  node_type: string;
  config: Record<string, any>;
  inputs: Record<string, any>;
  model_id?: string;
  model_group?: string;
  route_id?: number | null;
  request_id?: string;
}

export interface ClientExecuteResponse {
  output: any;
  meta?: Record<string, any> | null;
  route?: ClientCreditRouteQuote | null;
  account?: ClientCreditAccount;
  credits?: ClientCreditAccount;
}

export interface StoredLicenseState {
  licenseKey: string;
  nickname: string;
  deviceId: string;
  status: ClientLicenseStatus;
  lastVerifiedAt?: string;
  leaseUntil?: string;
  detail?: string;
  version?: ClientVersionInfo;
  announcements?: ClientAnnouncement[];
  credits?: ClientCreditAccount;
}

export interface ClientLicenseResponse {
  allowed: boolean;
  status?: ClientLicenseStatus;
  detail?: string;
  server_time?: string;
  lease_until?: string;
  license?: {
    license_key: string;
    customer_name: string;
    status: string;
  };
  device?: {
    device_id: string;
    nickname?: string;
    status: ClientLicenseStatus;
  };
  version?: ClientVersionInfo;
  announcements?: ClientAnnouncement[];
  credits?: ClientCreditAccount;
}

export class LicenseRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LicenseRequestError';
    this.status = status;
  }
}

const trimBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '');

const normalizeServerMessage = (message: string) => {
  const replacements: Array<[string, string]> = [
    ['License not found', '激活码不存在，请联系管理员确认。'],
    ['License disabled', '当前公司授权已被禁用，请联系管理员。'],
    ['License expired', '当前公司授权已到期，请联系管理员续费。'],
    ['Device is bound to another license', '这台设备已经绑定了其他激活码。'],
    ['Device disabled', '当前设备已被禁用，请联系管理员。'],
    ['Device not enabled', '当前设备尚未通过审核，请等待管理员同意。'],
    ['Device is not activated for this license', '当前设备尚未完成授权激活。'],
    ['Credit account disabled', '公司额度账户已停用，请联系管理员。'],
    ['Credit account unavailable', '公司额度账户暂时不可用，请稍后再试。'],
    ['Credit transaction not found', '代币流水不存在，请刷新后重试。'],
    ['Credit balance is insufficient for settlement', '公司额度不足，无法完成本次扣费。'],
  ];

  return replacements.reduce((current, [from, to]) => current.split(from).join(to), message);
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) return normalizeServerMessage(`${response.status} ${response.statusText}`);
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return normalizeServerMessage(parsed.detail);
  } catch {
    // Use raw body below.
  }
  return normalizeServerMessage(text);
};

export const getLicenseServerUrl = () => defaultLicenseServerUrl;

export const getOrCreateDeviceId = () => {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = `awei-${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return `awei-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
};

export const readStoredLicenseState = (): StoredLicenseState | null => {
  try {
    const raw = window.localStorage.getItem(LICENSE_STATE_KEY);
    return raw ? JSON.parse(raw) as StoredLicenseState : null;
  } catch {
    return null;
  }
};

export const saveStoredLicenseState = (state: StoredLicenseState) => {
  window.localStorage.setItem(LICENSE_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('awei-license-state-change', { detail: state }));
};

export const clearStoredLicenseState = () => {
  window.localStorage.removeItem(LICENSE_STATE_KEY);
};

export const hasValidLease = (state: StoredLicenseState | null) => {
  if (!state?.leaseUntil || state.status !== 'enabled') return false;
  const leaseTime = new Date(state.leaseUntil).getTime();
  return Number.isFinite(leaseTime) && leaseTime > Date.now();
};

export const shouldRefreshLicense = (state: StoredLicenseState | null) => {
  if (!state?.lastVerifiedAt) return true;
  const lastVerified = new Date(state.lastVerifiedAt).getTime();
  if (!Number.isFinite(lastVerified)) return true;
  return Date.now() - lastVerified >= LICENSE_CHECK_INTERVAL_MS;
};

const buildPayload = (state: Pick<StoredLicenseState, 'licenseKey' | 'deviceId' | 'nickname'>) => ({
  license_key: state.licenseKey.trim(),
  device_id: state.deviceId,
  nickname: state.nickname.trim(),
  hostname: 'Browser Client',
  os_name: navigator.platform || navigator.userAgent,
  app_version: APP_VERSION,
});

const requestClientLicense = async (
  path: '/client/activate' | '/client/verify',
  state: Pick<StoredLicenseState, 'licenseKey' | 'deviceId' | 'nickname'>,
) => {
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPayload(state)),
  });

  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }

  return response.json() as Promise<ClientLicenseResponse>;
};

export const activateClientLicense = (state: Pick<StoredLicenseState, 'licenseKey' | 'deviceId' | 'nickname'>) =>
  requestClientLicense('/client/activate', state);

export const verifyClientLicense = (state: Pick<StoredLicenseState, 'licenseKey' | 'deviceId' | 'nickname'>) =>
  requestClientLicense('/client/verify', state);

export const checkClientUpdate = async (appVersion = APP_VERSION) => {
  const params = new URLSearchParams({ app_version: appVersion });
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/update-check?${params.toString()}`);
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  return response.json() as Promise<ClientVersionInfo>;
};

export const checkClientAnnouncements = async (licenseKey = '') => {
  const params = new URLSearchParams();
  if (licenseKey) params.set('license_key', licenseKey);
  const query = params.toString();
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/announcements${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  return response.json() as Promise<ClientAnnouncement[]>;
};

export const checkClientModelHealth = async () => {
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/model-health`);
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  return response.json() as Promise<ClientModelHealthSummary>;
};

const getCreditIdentity = () => {
  const saved = readStoredLicenseState();
  if (!saved?.licenseKey || !saved.deviceId) {
    throw new Error('当前设备尚未完成授权，不能使用平台代币。');
  }
  return {
    license_key: saved.licenseKey,
    device_id: saved.deviceId,
  };
};

export const checkClientCredits = async () => {
  const identity = getCreditIdentity();
  const params = new URLSearchParams(identity);
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/credits?${params.toString()}`);
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const credits = await response.json() as ClientCreditAccount;
  const saved = readStoredLicenseState();
  if (saved) saveStoredLicenseState({ ...saved, credits });
  return credits;
};

export const quoteClientCredits = async (payload: ClientCreditQuotePayload) => {
  if (isAdminEdition) return null;
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/credits/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...getCreditIdentity(),
      model_id: payload.model_id || '',
      model_group: payload.model_group || '',
      node_type: payload.node_type || '',
      route_id: payload.route_id || null,
    }),
  });
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const result = await response.json() as ClientCreditQuoteResponse;
  const saved = readStoredLicenseState();
  if (saved && result.account) saveStoredLicenseState({ ...saved, credits: result.account });
  return result;
};

export const reserveClientCredits = async (payload: ClientCreditQuotePayload & { estimated_credits?: number; request_id?: string }) => {
  if (isAdminEdition) return null;
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/credits/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...getCreditIdentity(),
      model_id: payload.model_id || '',
      model_group: payload.model_group || '',
      node_type: payload.node_type || '',
      route_id: payload.route_id || null,
      estimated_credits: payload.estimated_credits,
      request_id: payload.request_id || '',
    }),
  });
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const result = await response.json() as ClientCreditReserveResponse;
  const saved = readStoredLicenseState();
  if (saved && result.account) saveStoredLicenseState({ ...saved, credits: result.account });
  return result;
};

export const settleClientCredits = async (transactionId: number, actualCredits?: number, success = true, reason = '') => {
  if (isAdminEdition) return null;
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/credits/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...getCreditIdentity(),
      transaction_id: transactionId,
      actual_credits: actualCredits,
      success,
      reason,
    }),
  });
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const result = await response.json() as { account?: ClientCreditAccount; settled_credits?: number };
  const saved = readStoredLicenseState();
  if (saved && result.account) saveStoredLicenseState({ ...saved, credits: result.account });
  return result;
};

export const refundClientCredits = async (transactionId: number, reason = '') => {
  if (isAdminEdition) return null;
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/credits/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...getCreditIdentity(),
      transaction_id: transactionId,
      reason,
    }),
  });
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const result = await response.json() as { account?: ClientCreditAccount; refunded_credits?: number };
  const saved = readStoredLicenseState();
  if (saved && result.account) saveStoredLicenseState({ ...saved, credits: result.account });
  return result;
};

export const executeClientNode = async (payload: ClientExecutePayload, options?: { signal?: AbortSignal }) => {
  if (isAdminEdition) return null;
  const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...getCreditIdentity(),
      node_id: payload.node_id || payload.request_id || '',
      node_type: payload.node_type || '',
      config: payload.config || {},
      inputs: payload.inputs || {},
      model_id: payload.model_id || '',
      model_group: payload.model_group || '',
      route_id: payload.route_id || null,
      request_id: payload.request_id || payload.node_id || '',
    }),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new LicenseRequestError(response.status, await readErrorMessage(response));
  }
  const result = await response.json() as ClientExecuteResponse;
  const account = result.account || result.credits;
  const saved = readStoredLicenseState();
  if (saved && account) saveStoredLicenseState({ ...saved, credits: account });
  return result;
};

export const reportClientModelCall = async (payload: ClientModelCallLogPayload) => {
  try {
    const saved = readStoredLicenseState();
    const enriched: ClientModelCallLogPayload = {
      ...payload,
      license_key: payload.license_key ?? saved?.licenseKey ?? '',
      device_id: payload.device_id ?? saved?.deviceId ?? getOrCreateDeviceId(),
      model_group: payload.model_group || 'General',
      latency_ms: Math.max(0, Math.round(Number(payload.latency_ms || 0))),
      error_message: String(payload.error_message || '').slice(0, 1000),
      tokens_charged: Math.max(0, Math.round(Number(payload.tokens_charged || 0))),
    };
    const response = await fetch(`${trimBaseUrl(getLicenseServerUrl())}/client/model-call-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
      keepalive: true,
    });
    if (!response.ok) {
      return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
};

export const toStoredLicenseState = (
  previous: Pick<StoredLicenseState, 'licenseKey' | 'deviceId' | 'nickname'>,
  response: ClientLicenseResponse,
): StoredLicenseState => ({
  licenseKey: previous.licenseKey.trim(),
  nickname: previous.nickname.trim(),
  deviceId: previous.deviceId,
  status: response.allowed ? 'enabled' : response.status || response.device?.status || 'pending',
  lastVerifiedAt: response.allowed ? new Date().toISOString() : undefined,
  leaseUntil: response.lease_until,
  detail: response.detail,
  version: response.version,
  announcements: response.announcements,
  credits: response.credits,
});

export const ensureClientLicenseFresh = async () => {
  if (isAdminEdition) return true;

  const saved = readStoredLicenseState();
  if (!saved?.licenseKey || saved.status !== 'enabled') {
    throw new Error('当前软件尚未完成授权审核，不能执行节点。');
  }

  if (!shouldRefreshLicense(saved)) return true;

  try {
    const response = await verifyClientLicense(saved);
    const next = toStoredLicenseState(saved, response);
    saveStoredLicenseState(next);
    if (!response.allowed) {
      throw new Error('当前设备授权仍在等待审核，不能执行节点。');
    }
    return true;
  } catch (error) {
    if (error instanceof LicenseRequestError) {
      const next: StoredLicenseState = {
        ...saved,
        status: 'disabled',
        detail: error.message,
      };
      saveStoredLicenseState(next);
      throw error;
    }
    if (hasValidLease(saved)) return true;
    throw error;
  }
};
