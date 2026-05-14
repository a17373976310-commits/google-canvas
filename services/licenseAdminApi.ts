export interface LicenseRecord {
  license_key: string;
  customer_name: string;
  contact: string;
  expires_at: string;
  status: 'enabled' | 'disabled';
  max_devices: number;
  notes: string;
  created_at: string;
  updated_at: string;
  device_count?: number;
  pending_device_count?: number;
  disabled_device_count?: number;
  credit_balance?: number;
  credit_reserved_balance?: number;
  credit_available_balance?: number;
  credit_lifetime_granted?: number;
  credit_lifetime_spent?: number;
  credit_status?: 'enabled' | 'disabled';
  credit_updated_at?: string;
}

export interface DeviceRecord {
  device_id: string;
  license_key: string;
  customer_name?: string;
  license_status?: 'enabled' | 'disabled';
  license_expires_at?: string;
  nickname: string;
  hostname: string;
  os_name: string;
  app_version: string;
  status: 'pending' | 'enabled' | 'disabled';
  effective_status?: 'enabled' | 'pending' | 'disabled' | 'license_disabled';
  note: string;
  first_seen: string;
  approved_at?: string;
  last_seen: string;
}

export interface VersionConfig {
  id?: number;
  latest_version: string;
  min_version: string;
  download_url: string;
  release_notes: string;
  force_update: boolean | number;
  is_current?: boolean | number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface VersionRecord extends VersionConfig {
  id: number;
  is_current: boolean | number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface AnnouncementRecord {
  id: number;
  title: string;
  body: string;
  kind: 'normal' | 'important' | 'maintenance' | 'warning';
  scope_license_key: string;
  is_active: boolean | number;
  pinned: boolean | number;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementPayload {
  title: string;
  body: string;
  kind: 'normal' | 'important' | 'maintenance' | 'warning';
  scope_license_key?: string;
  is_active: boolean;
  pinned: boolean;
  start_at?: string;
  end_at?: string;
}

export interface ModelProviderRecord {
  id: number;
  name: string;
  group_name: string;
  provider_type: string;
  base_url: string;
  supported_models: string;
  status: 'enabled' | 'disabled';
  priority: number;
  cost_multiplier: number;
  notes: string;
  created_at: string;
  updated_at: string;
  route_count?: number;
  has_api_key?: boolean;
  api_key_preview?: string;
}

export interface ModelProviderPayload {
  name: string;
  group_name?: string;
  provider_type?: string;
  base_url?: string;
  api_key?: string;
  supported_models?: string;
  status?: 'enabled' | 'disabled';
  priority?: number;
  cost_multiplier?: number;
  notes?: string;
}

export interface ModelRouteRecord {
  id: number;
  model_id: string;
  display_name: string;
  model_group: string;
  provider_id: number;
  provider_name?: string;
  provider_group?: string;
  provider_status?: 'enabled' | 'disabled';
  route_name: string;
  status: 'enabled' | 'disabled';
  weight: number;
  token_cost: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ModelRoutePayload {
  model_id: string;
  display_name?: string;
  model_group?: string;
  provider_id: number;
  route_name?: string;
  status?: 'enabled' | 'disabled';
  weight?: number;
  token_cost?: number;
  notes?: string;
}

export interface ModelHealthBucket {
  index: number;
  start_at?: string;
  success_count?: number;
  failure_count?: number;
  total: number;
  avg_latency_ms?: number;
  status: 'empty' | 'ok' | 'warn' | 'bad';
}

export interface ModelHealthRoute {
  id?: number;
  model_id: string;
  display_name: string;
  model_group?: string;
  route_name: string;
  route_status: 'enabled' | 'disabled';
  provider_id?: number;
  provider_name?: string;
  provider_group?: string;
  provider_base_url?: string;
  provider_status?: 'enabled' | 'disabled';
  weight?: number;
  token_cost?: number;
  success_rate: number | null;
  total_calls: number;
  success_count?: number;
  failure_count?: number;
  avg_latency_ms: number | null;
  buckets: ModelHealthBucket[];
}

export interface ModelHealthGroup {
  model_group: string;
  routes: ModelHealthRoute[];
}

export interface ModelHealthSummary {
  generated_at: string;
  window_hours: number;
  bucket_minutes: number;
  bucket_count: number;
  groups: ModelHealthGroup[];
}

export interface CreditAccountRecord {
  license_key: string;
  customer_name?: string;
  license_status?: 'enabled' | 'disabled';
  balance: number;
  reserved_balance: number;
  available_balance: number;
  lifetime_granted: number;
  lifetime_spent: number;
  status: 'enabled' | 'disabled';
  updated_at: string;
}

export interface CreditTransactionRecord {
  id: number;
  license_key: string;
  customer_name?: string;
  amount: number;
  reserved_amount: number;
  settled_amount: number;
  transaction_type: string;
  status: string;
  reason: string;
  route_id?: number | null;
  device_id?: string;
  model_id?: string;
  model_group?: string;
  node_type?: string;
  request_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface LicenseCreatePayload {
  customer_name: string;
  contact?: string;
  expires_at: string;
  max_devices: number;
  notes?: string;
  license_key?: string;
  initial_credits?: number;
}

export interface LicenseUpdatePayload {
  customer_name?: string;
  contact?: string;
  expires_at?: string;
  status?: 'enabled' | 'disabled';
  max_devices?: number;
  notes?: string;
}

export interface DeviceUpdatePayload {
  status?: 'pending' | 'enabled' | 'disabled';
  note?: string;
  nickname?: string;
}

export interface LicenseAdminClientOptions {
  baseUrl: string;
  adminToken: string;
}

const trimBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '');

const readErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;

  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (Array.isArray(parsed.detail)) return parsed.detail.map((item) => item?.msg || item).join('; ');
  } catch {
    // Fall through to the raw body.
  }

  return text;
};

const request = async <T>(
  options: LicenseAdminClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const baseUrl = trimBaseUrl(options.baseUrl);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': options.adminToken,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
};

export const checkLicenseServerHealth = async (baseUrl: string) => {
  const response = await fetch(`${trimBaseUrl(baseUrl)}/health`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<{ ok: string; service: string; time: string }>;
};

export const listLicenses = (options: LicenseAdminClientOptions) =>
  request<LicenseRecord[]>(options, '/admin/licenses');

export const createLicense = (options: LicenseAdminClientOptions, payload: LicenseCreatePayload) =>
  request<LicenseRecord>(options, '/admin/licenses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateLicense = (
  options: LicenseAdminClientOptions,
  licenseKey: string,
  payload: LicenseUpdatePayload,
) =>
  request<LicenseRecord>(options, `/admin/licenses/${encodeURIComponent(licenseKey)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const listDevices = (options: LicenseAdminClientOptions) =>
  request<DeviceRecord[]>(options, '/admin/devices');

export const updateDevice = (
  options: LicenseAdminClientOptions,
  deviceId: string,
  payload: DeviceUpdatePayload,
) =>
  request<DeviceRecord>(options, `/admin/devices/${encodeURIComponent(deviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deleteDevice = (options: LicenseAdminClientOptions, deviceId: string) =>
  request<{ deleted: boolean; device_id: string }>(
    options,
    `/admin/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' },
  );

export const getVersionConfig = (options: LicenseAdminClientOptions) =>
  request<VersionRecord>(options, '/admin/version');

export const updateVersionConfig = (options: LicenseAdminClientOptions, payload: VersionConfig) =>
  request<VersionRecord>(options, '/admin/version', {
    method: 'PUT',
    body: JSON.stringify({
      ...payload,
      force_update: Boolean(payload.force_update),
    }),
  });

export const listVersions = (options: LicenseAdminClientOptions) =>
  request<VersionRecord[]>(options, '/admin/versions');

export const createVersion = (options: LicenseAdminClientOptions, payload: VersionConfig & { is_current?: boolean }) =>
  request<VersionRecord>(options, '/admin/versions', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      force_update: Boolean(payload.force_update),
      is_current: Boolean(payload.is_current),
    }),
  });

export const updateVersion = (
  options: LicenseAdminClientOptions,
  id: number,
  payload: Partial<VersionConfig>,
) =>
  request<VersionRecord>(options, `/admin/versions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...payload,
      ...(payload.force_update === undefined ? {} : { force_update: Boolean(payload.force_update) }),
    }),
  });

export const activateVersion = (options: LicenseAdminClientOptions, id: number) =>
  request<VersionRecord>(options, `/admin/versions/${id}/activate`, { method: 'POST' });

export const deleteVersion = (options: LicenseAdminClientOptions, id: number) =>
  request<{ deleted: boolean; id: number }>(options, `/admin/versions/${id}`, { method: 'DELETE' });

export const listAnnouncements = (options: LicenseAdminClientOptions) =>
  request<AnnouncementRecord[]>(options, '/admin/announcements');

export const createAnnouncement = (options: LicenseAdminClientOptions, payload: AnnouncementPayload) =>
  request<AnnouncementRecord>(options, '/admin/announcements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateAnnouncement = (
  options: LicenseAdminClientOptions,
  id: number,
  payload: Partial<AnnouncementPayload>,
) =>
  request<AnnouncementRecord>(options, `/admin/announcements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deleteAnnouncement = (options: LicenseAdminClientOptions, id: number) =>
  request<{ deleted: boolean; id: number }>(options, `/admin/announcements/${id}`, { method: 'DELETE' });

export const listModelProviders = (options: LicenseAdminClientOptions) =>
  request<ModelProviderRecord[]>(options, '/admin/model-providers');

export const createModelProvider = (options: LicenseAdminClientOptions, payload: ModelProviderPayload) =>
  request<ModelProviderRecord>(options, '/admin/model-providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateModelProvider = (
  options: LicenseAdminClientOptions,
  id: number,
  payload: Partial<ModelProviderPayload>,
) =>
  request<ModelProviderRecord>(options, `/admin/model-providers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const listModelRoutes = (options: LicenseAdminClientOptions) =>
  request<ModelRouteRecord[]>(options, '/admin/model-routes');

export const createModelRoute = (options: LicenseAdminClientOptions, payload: ModelRoutePayload) =>
  request<ModelRouteRecord>(options, '/admin/model-routes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateModelRoute = (
  options: LicenseAdminClientOptions,
  id: number,
  payload: Partial<ModelRoutePayload>,
) =>
  request<ModelRouteRecord>(options, `/admin/model-routes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const getModelHealth = (options: LicenseAdminClientOptions) =>
  request<ModelHealthSummary>(options, '/admin/model-health');

export const listCreditAccounts = (options: LicenseAdminClientOptions) =>
  request<CreditAccountRecord[]>(options, '/admin/credits/accounts');

export const adjustCreditAccount = (
  options: LicenseAdminClientOptions,
  payload: { license_key: string; amount: number; reason?: string },
) =>
  request<CreditAccountRecord>(options, '/admin/credits/adjust', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const listCreditTransactions = (options: LicenseAdminClientOptions, licenseKey = '', limit = 80) => {
  const params = new URLSearchParams();
  if (licenseKey) params.set('license_key', licenseKey);
  params.set('limit', String(limit));
  return request<CreditTransactionRecord[]>(options, `/admin/credits/transactions?${params.toString()}`);
};
