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

const readErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    // Use raw body below.
  }
  return text;
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
