import React from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clipboard,
  KeyRound,
  Loader2,
  Megaphone,
  Monitor,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { defaultLicenseServerUrl, appEdition } from '../config/appEdition';
import {
  AnnouncementPayload,
  AnnouncementRecord,
  activateVersion,
  checkLicenseServerHealth,
  createAnnouncement,
  createLicense,
  createVersion,
  deleteAnnouncement,
  deleteDevice,
  deleteVersion,
  DeviceRecord,
  getVersionConfig,
  LicenseRecord,
  LicenseUpdatePayload,
  listDevices,
  listLicenses,
  listAnnouncements,
  listVersions,
  updateAnnouncement,
  updateDevice,
  updateLicense,
  updateVersion,
  VersionConfig,
  VersionRecord,
} from '../services/licenseAdminApi';

type AdminTab = 'overview' | 'licenses' | 'devices' | 'announcements' | 'version';

interface LicenseAdminPanelProps {
  onClose: () => void;
}

const TOKEN_STORAGE_KEY = 'awei_license_admin_token';
const SERVER_STORAGE_KEY = 'awei_license_server_url';

const readStorage = (key: string, fallback = '') => {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
};

const oneYearFromNow = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
};

const emptyVersion: VersionConfig = {
  latest_version: '1.0.0',
  min_version: '1.0.0',
  download_url: '',
  release_notes: '',
  force_update: false,
};

const emptyAnnouncement: AnnouncementPayload = {
  title: '',
  body: '',
  kind: 'normal',
  scope_license_key: '',
  is_active: true,
  pinned: false,
  start_at: '',
  end_at: '',
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isExpired = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
};

const statusLabel = (status: string) => {
  if (status === 'enabled') return '可用';
  if (status === 'pending') return '待审核';
  if (status === 'license_disabled') return '授权禁用';
  return '禁用';
};

const getDeviceEffectiveStatus = (device: DeviceRecord) => {
  return device.effective_status || (device.license_status === 'disabled' ? 'license_disabled' : device.status);
};

const normalizeVersion = (version: VersionConfig): VersionConfig => ({
  latest_version: version.latest_version || '1.0.0',
  min_version: version.min_version || '1.0.0',
  download_url: version.download_url || '',
  release_notes: version.release_notes || '',
  force_update: Boolean(version.force_update),
  updated_at: version.updated_at,
});

const normalizeAnnouncement = (announcement: AnnouncementPayload): AnnouncementPayload => ({
  title: announcement.title.trim(),
  body: announcement.body.trim(),
  kind: announcement.kind || 'normal',
  scope_license_key: announcement.scope_license_key?.trim() || '',
  is_active: Boolean(announcement.is_active),
  pinned: Boolean(announcement.pinned),
  start_at: announcement.start_at?.trim() || '',
  end_at: announcement.end_at?.trim() || '',
});

const announcementKindLabel = (kind: string) => {
  if (kind === 'important') return '重要';
  if (kind === 'maintenance') return '维护';
  if (kind === 'warning') return '提醒';
  return '普通';
};

export const LicenseAdminPanel: React.FC<LicenseAdminPanelProps> = ({ onClose }) => {
  const [tab, setTab] = React.useState<AdminTab>('overview');
  const [serverUrl, setServerUrl] = React.useState(() => readStorage(SERVER_STORAGE_KEY, defaultLicenseServerUrl));
  const [adminToken, setAdminToken] = React.useState(() => readStorage(TOKEN_STORAGE_KEY, ''));
  const [rememberToken, setRememberToken] = React.useState(() => Boolean(readStorage(TOKEN_STORAGE_KEY, '')));
  const [loading, setLoading] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [licenses, setLicenses] = React.useState<LicenseRecord[]>([]);
  const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
  const [announcements, setAnnouncements] = React.useState<AnnouncementRecord[]>([]);
  const [versionRecords, setVersionRecords] = React.useState<VersionRecord[]>([]);
  const [versionDraft, setVersionDraft] = React.useState<VersionConfig>(emptyVersion);
  const [licenseQuery, setLicenseQuery] = React.useState('');
  const [deviceQuery, setDeviceQuery] = React.useState('');
  const [announcementQuery, setAnnouncementQuery] = React.useState('');
  const [licenseDrafts, setLicenseDrafts] = React.useState<Record<string, LicenseUpdatePayload>>({});
  const [deviceDrafts, setDeviceDrafts] = React.useState<Record<string, { note: string }>>({});
  const [announcementDrafts, setAnnouncementDrafts] = React.useState<Record<number, AnnouncementPayload>>({});
  const [versionDrafts, setVersionDrafts] = React.useState<Record<number, VersionConfig>>({});
  const [announcementForm, setAnnouncementForm] = React.useState<AnnouncementPayload>(emptyAnnouncement);
  const [createForm, setCreateForm] = React.useState({
    customer_name: '',
    contact: '',
    expires_at: oneYearFromNow(),
    max_devices: 3,
    notes: '',
    license_key: '',
  });

  const clientOptions = React.useMemo(() => ({
    baseUrl: serverUrl,
    adminToken,
  }), [adminToken, serverUrl]);

  const canUseAdminApi = serverUrl.trim().length > 0 && adminToken.trim().length > 0;

  const saveConnection = React.useCallback(() => {
    writeStorage(SERVER_STORAGE_KEY, serverUrl.trim());
    writeStorage(TOKEN_STORAGE_KEY, rememberToken ? adminToken.trim() : '');
    setMessage({ type: 'ok', text: '连接配置已保存到本机。' });
  }, [adminToken, rememberToken, serverUrl]);

  const loadAll = React.useCallback(async () => {
    if (!canUseAdminApi) {
      setMessage({ type: 'error', text: '请先填写授权服务地址和管理员 Token。' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const [licenseRows, deviceRows, announcementRows, versionRows, version] = await Promise.all([
        listLicenses(clientOptions),
        listDevices(clientOptions),
        listAnnouncements(clientOptions),
        listVersions(clientOptions),
        getVersionConfig(clientOptions),
      ]);
      setLicenses(licenseRows);
      setDevices(deviceRows);
      setAnnouncements(announcementRows);
      setVersionRecords(versionRows);
      setVersionDraft(normalizeVersion(version));
      setLicenseDrafts({});
      setDeviceDrafts({});
      setAnnouncementDrafts({});
      setVersionDrafts({});
      setHasLoaded(true);
      saveConnection();
      setMessage({ type: 'ok', text: '用户控制台数据已刷新。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '加载失败' });
    } finally {
      setLoading(false);
    }
  }, [canUseAdminApi, clientOptions, saveConnection]);

  React.useEffect(() => {
    if (canUseAdminApi) void loadAll();
    // Run once when the drawer opens with saved credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testConnection = async () => {
    if (!serverUrl.trim()) {
      setMessage({ type: 'error', text: '请先填写授权服务地址。' });
      return;
    }
    setTesting(true);
    setMessage(null);
    try {
      const health = await checkLicenseServerHealth(serverUrl);
      writeStorage(SERVER_STORAGE_KEY, serverUrl.trim());
      setMessage({ type: 'ok', text: `连接正常：${health.service}。加载数据还需要管理员 Token。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleCreateLicense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canUseAdminApi) {
      setMessage({ type: 'error', text: '请先填写授权服务地址和管理员 Token。' });
      return;
    }
    if (!createForm.customer_name.trim()) {
      setMessage({ type: 'error', text: '客户名称不能为空。' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const created = await createLicense(clientOptions, {
        customer_name: createForm.customer_name.trim(),
        contact: createForm.contact.trim(),
        expires_at: createForm.expires_at.trim(),
        max_devices: Number(createForm.max_devices) || 1,
        notes: createForm.notes.trim(),
        license_key: createForm.license_key.trim() || undefined,
      });
      setCreateForm({
        customer_name: '',
        contact: '',
        expires_at: oneYearFromNow(),
        max_devices: 3,
        notes: '',
        license_key: '',
      });
      await loadAll();
      setMessage({ type: 'ok', text: `已创建授权：${created.license_key}` });
      setTab('licenses');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '创建授权失败' });
    } finally {
      setLoading(false);
    }
  };

  const patchLicenseDraft = (licenseKey: string, patch: LicenseUpdatePayload) => {
    setLicenseDrafts((prev) => ({
      ...prev,
      [licenseKey]: {
        ...(prev[licenseKey] || {}),
        ...patch,
      },
    }));
  };

  const saveLicense = async (license: LicenseRecord) => {
    const draft = licenseDrafts[license.license_key] || {};
    const payload: LicenseUpdatePayload = {
      customer_name: draft.customer_name ?? license.customer_name,
      contact: draft.contact ?? license.contact,
      expires_at: draft.expires_at ?? license.expires_at,
      max_devices: Number(draft.max_devices ?? license.max_devices) || 1,
      notes: draft.notes ?? license.notes,
      status: draft.status ?? license.status,
    };

    setLoading(true);
    setMessage(null);
    try {
      await updateLicense(clientOptions, license.license_key, payload);
      await loadAll();
      setMessage({ type: 'ok', text: '授权信息已保存。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存授权失败' });
    } finally {
      setLoading(false);
    }
  };

  const toggleLicense = async (license: LicenseRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateLicense(clientOptions, license.license_key, {
        status: license.status === 'enabled' ? 'disabled' : 'enabled',
      });
      await loadAll();
      setMessage({ type: 'ok', text: `授权已${license.status === 'enabled' ? '禁用' : '启用'}。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '操作授权失败' });
    } finally {
      setLoading(false);
    }
  };

  const patchDeviceDraft = (deviceId: string, note: string) => {
    setDeviceDrafts((prev) => ({
      ...prev,
      [deviceId]: { note },
    }));
  };

  const saveDeviceNote = async (device: DeviceRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateDevice(clientOptions, device.device_id, {
        status: device.status,
        note: deviceDrafts[device.device_id]?.note ?? device.note ?? '',
      });
      await loadAll();
      setMessage({ type: 'ok', text: '设备备注已保存。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存设备失败' });
    } finally {
      setLoading(false);
    }
  };

  const approveDevice = async (device: DeviceRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateDevice(clientOptions, device.device_id, {
        status: 'enabled',
        note: deviceDrafts[device.device_id]?.note ?? device.note ?? '',
      });
      await loadAll();
      setMessage({ type: 'ok', text: '设备申请已通过。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '审核设备失败' });
    } finally {
      setLoading(false);
    }
  };

  const toggleDevice = async (device: DeviceRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateDevice(clientOptions, device.device_id, {
        status: device.status === 'disabled' ? 'enabled' : 'disabled',
        note: deviceDrafts[device.device_id]?.note ?? device.note ?? '',
      });
      await loadAll();
      setMessage({ type: 'ok', text: `设备已${device.status === 'enabled' ? '禁用' : '启用'}。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '操作设备失败' });
    } finally {
      setLoading(false);
    }
  };

  const unbindDevice = async (device: DeviceRecord) => {
    const confirmed = window.confirm(
      `确认解绑设备 ${device.device_id}？解绑会释放设备名额，客户下次需要重新激活。`,
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage(null);
    try {
      await deleteDevice(clientOptions, device.device_id);
      setDeviceDrafts((prev) => {
        const next = { ...prev };
        delete next[device.device_id];
        return next;
      });
      await loadAll();
      setMessage({ type: 'ok', text: '设备已解绑，设备名额已释放。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '解绑设备失败' });
    } finally {
      setLoading(false);
    }
  };

  const saveVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = normalizeVersion(versionDraft);
    if (!payload.latest_version || !payload.min_version) {
      setMessage({ type: 'error', text: '最新版本和最低可用版本不能为空。' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const saved = await createVersion(clientOptions, { ...payload, is_current: true });
      setVersionDraft(normalizeVersion(saved));
      await loadAll();
      setMessage({ type: 'ok', text: '新版已发布，并设为当前生效版本。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '发布版本失败' });
    } finally {
      setLoading(false);
    }
  };

  const patchVersionDraft = (version: VersionRecord, patch: Partial<VersionConfig>) => {
    setVersionDrafts((prev) => ({
      ...prev,
      [version.id]: {
        latest_version: version.latest_version,
        min_version: version.min_version,
        download_url: version.download_url || '',
        release_notes: version.release_notes || '',
        force_update: Boolean(version.force_update),
        ...(prev[version.id] || {}),
        ...patch,
      },
    }));
  };

  const saveVersionRecord = async (version: VersionRecord) => {
    const draft = versionDrafts[version.id];
    if (!draft) {
      setMessage({ type: 'ok', text: '版本没有改动。' });
      return;
    }
    const payload = normalizeVersion(draft);
    if (!payload.latest_version || !payload.min_version) {
      setMessage({ type: 'error', text: '版本号不能为空。' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await updateVersion(clientOptions, version.id, payload);
      await loadAll();
      setMessage({ type: 'ok', text: '版本记录已保存。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存版本失败' });
    } finally {
      setLoading(false);
    }
  };

  const activateVersionRecord = async (version: VersionRecord) => {
    if (Boolean(version.is_current)) {
      setMessage({ type: 'ok', text: '这个版本已经是当前生效版本。' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await activateVersion(clientOptions, version.id);
      await loadAll();
      setMessage({ type: 'ok', text: `当前生效版本已切换到 ${version.latest_version}。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '切换当前版本失败' });
    } finally {
      setLoading(false);
    }
  };

  const removeVersionRecord = async (version: VersionRecord) => {
    const confirmed = window.confirm(
      `确认删除版本 ${version.latest_version}？${Boolean(version.is_current) ? ' 当前版本删除后会自动切换到最近的历史版本。' : ''}`,
    );
    if (!confirmed) return;
    setLoading(true);
    setMessage(null);
    try {
      await deleteVersion(clientOptions, version.id);
      await loadAll();
      setMessage({ type: 'ok', text: '版本记录已删除。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除版本失败' });
    } finally {
      setLoading(false);
    }
  };

  const createAnnouncementItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = normalizeAnnouncement(announcementForm);
    if (!payload.title || !payload.body) {
      setMessage({ type: 'error', text: '公告标题和内容不能为空。' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await createAnnouncement(clientOptions, payload);
      setAnnouncementForm(emptyAnnouncement);
      await loadAll();
      setTab('announcements');
      setMessage({ type: 'ok', text: '公告已发布。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '发布公告失败' });
    } finally {
      setLoading(false);
    }
  };

  const patchAnnouncementDraft = (announcement: AnnouncementRecord, patch: Partial<AnnouncementPayload>) => {
    setAnnouncementDrafts((prev) => ({
      ...prev,
      [announcement.id]: {
        title: announcement.title,
        body: announcement.body,
        kind: announcement.kind,
        scope_license_key: announcement.scope_license_key || '',
        is_active: Boolean(announcement.is_active),
        pinned: Boolean(announcement.pinned),
        start_at: announcement.start_at || '',
        end_at: announcement.end_at || '',
        ...(prev[announcement.id] || {}),
        ...patch,
      },
    }));
  };

  const saveAnnouncement = async (announcement: AnnouncementRecord) => {
    const draft = announcementDrafts[announcement.id];
    if (!draft) {
      setMessage({ type: 'ok', text: '公告没有改动。' });
      return;
    }
    const payload = normalizeAnnouncement(draft);
    if (!payload.title || !payload.body) {
      setMessage({ type: 'error', text: '公告标题和内容不能为空。' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await updateAnnouncement(clientOptions, announcement.id, payload);
      await loadAll();
      setMessage({ type: 'ok', text: '公告已保存。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存公告失败' });
    } finally {
      setLoading(false);
    }
  };

  const toggleAnnouncement = async (announcement: AnnouncementRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateAnnouncement(clientOptions, announcement.id, {
        is_active: !Boolean(announcement.is_active),
      });
      await loadAll();
      setMessage({ type: 'ok', text: `公告已${Boolean(announcement.is_active) ? '停用' : '启用'}。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '操作公告失败' });
    } finally {
      setLoading(false);
    }
  };

  const toggleAnnouncementPinned = async (announcement: AnnouncementRecord) => {
    setLoading(true);
    setMessage(null);
    try {
      await updateAnnouncement(clientOptions, announcement.id, {
        pinned: !Boolean(announcement.pinned),
      });
      await loadAll();
      setMessage({ type: 'ok', text: `公告已${Boolean(announcement.pinned) ? '取消置顶' : '置顶'}。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '操作置顶失败' });
    } finally {
      setLoading(false);
    }
  };

  const removeAnnouncement = async (announcement: AnnouncementRecord) => {
    const confirmed = window.confirm(`确认删除公告「${announcement.title}」？`);
    if (!confirmed) return;
    setLoading(true);
    setMessage(null);
    try {
      await deleteAnnouncement(clientOptions, announcement.id);
      await loadAll();
      setMessage({ type: 'ok', text: '公告已删除。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除公告失败' });
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: 'ok', text: '已复制到剪贴板。' });
    } catch {
      setMessage({ type: 'error', text: '复制失败，请手动选择。' });
    }
  };

  const filteredLicenses = React.useMemo(() => {
    const q = licenseQuery.trim().toLowerCase();
    if (!q) return licenses;
    return licenses.filter((item) => (
      item.license_key.toLowerCase().includes(q)
      || item.customer_name.toLowerCase().includes(q)
      || (item.contact || '').toLowerCase().includes(q)
      || (item.notes || '').toLowerCase().includes(q)
    ));
  }, [licenseQuery, licenses]);

  const filteredDevices = React.useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((item) => (
      item.device_id.toLowerCase().includes(q)
      || item.license_key.toLowerCase().includes(q)
      || (item.nickname || '').toLowerCase().includes(q)
      || (item.customer_name || '').toLowerCase().includes(q)
      || (item.hostname || '').toLowerCase().includes(q)
      || (item.note || '').toLowerCase().includes(q)
    ));
  }, [deviceQuery, devices]);

  const filteredAnnouncements = React.useMemo(() => {
    const q = announcementQuery.trim().toLowerCase();
    if (!q) return announcements;
    return announcements.filter((item) => (
      item.title.toLowerCase().includes(q)
      || item.body.toLowerCase().includes(q)
      || (item.scope_license_key || '').toLowerCase().includes(q)
      || announcementKindLabel(item.kind).toLowerCase().includes(q)
    ));
  }, [announcementQuery, announcements]);

  const stats = React.useMemo(() => {
    const enabledLicenses = licenses.filter((item) => item.status === 'enabled' && !isExpired(item.expires_at)).length;
    const disabledLicenses = licenses.filter((item) => item.status !== 'enabled').length;
    const expiredLicenses = licenses.filter((item) => isExpired(item.expires_at)).length;
    const pendingDevices = devices.filter((item) => getDeviceEffectiveStatus(item) === 'pending').length;
    const disabledDevices = devices.filter((item) => getDeviceEffectiveStatus(item) !== 'enabled' && getDeviceEffectiveStatus(item) !== 'pending').length;
    const activeAnnouncements = announcements.filter((item) => Boolean(item.is_active)).length;
    return {
      enabledLicenses,
      disabledLicenses,
      expiredLicenses,
      totalDevices: devices.length,
      pendingDevices,
      disabledDevices,
      activeAnnouncements,
    };
  }, [announcements, devices, licenses]);

  const currentVersionRecord = React.useMemo(
    () => versionRecords.find((item) => Boolean(item.is_current)) || null,
    [versionRecords],
  );

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ElementType }> = [
    { id: 'overview', label: '总览', icon: ShieldCheck },
    { id: 'licenses', label: '授权', icon: KeyRound },
    { id: 'devices', label: '设备', icon: Monitor },
    { id: 'announcements', label: '公告', icon: Megaphone },
    { id: 'version', label: '版本', icon: Rocket },
  ];

  return (
    <div className="license-admin-drawer">
      <div className="license-admin-header">
        <div className="flex items-center gap-3 min-w-0">
          <div className="license-admin-mark">
            <ShieldCheck size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black theme-text-primary">用户控制台</h2>
            <p className="truncate text-[10px] theme-text-muted">
              {appEdition === 'admin' ? '母版管理：授权、设备、版本策略' : '当前不是母版模式'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="license-admin-icon-button"
            title="刷新数据"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="license-admin-icon-button"
            title="关闭用户控制台"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="license-admin-connect">
        <label className="license-admin-field flex-[1.3]">
          <span>授权服务</span>
          <div className="license-admin-input-with-icon">
            <Server size={14} />
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:8787"
            />
          </div>
        </label>
        <label className="license-admin-field flex-1">
          <span>管理员 Token</span>
          <div className="license-admin-input-with-icon">
            <KeyRound size={14} />
            <input
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="LICENSE_ADMIN_TOKEN"
              type="password"
            />
          </div>
        </label>
        <button type="button" onClick={() => void testConnection()} disabled={testing} className="license-admin-button">
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
          测试
        </button>
        <button type="button" onClick={() => void loadAll()} disabled={loading} className="license-admin-button is-primary">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          加载
        </button>
      </div>

      <label className="license-admin-remember">
        <input
          type="checkbox"
          checked={rememberToken}
          onChange={(event) => setRememberToken(event.target.checked)}
        />
        <span>在这台母版电脑保存 Token。不要在客户子版里配置这个值。</span>
      </label>

      {message && (
        <div className={`license-admin-message ${message.type === 'ok' ? 'is-ok' : 'is-error'}`}>
          {message.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="license-admin-tabs">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`license-admin-tab ${tab === item.id ? 'is-active' : ''}`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="license-admin-body custom-scrollbar">
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="license-admin-stat-grid">
              <div className="license-admin-stat">
                <span>可用客户</span>
                <strong>{stats.enabledLicenses}</strong>
              </div>
              <div className="license-admin-stat">
                <span>绑定设备</span>
                <strong>{stats.totalDevices}</strong>
              </div>
              <div className="license-admin-stat">
                <span>禁用授权</span>
                <strong>{stats.disabledLicenses}</strong>
              </div>
              <div className="license-admin-stat">
                <span>过期授权</span>
                <strong>{stats.expiredLicenses}</strong>
              </div>
            </div>

            <form onSubmit={handleCreateLicense} className="license-admin-card">
              <div className="license-admin-section-title">
                <Users size={15} />
                新建客户授权
              </div>
              <div className="license-admin-form-grid">
                <label className="license-admin-field">
                  <span>客户/公司</span>
                  <input
                    className="license-admin-input"
                    value={createForm.customer_name}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                    placeholder="例如：杭州某某科技"
                  />
                </label>
                <label className="license-admin-field">
                  <span>联系人/备注</span>
                  <input
                    className="license-admin-input"
                    value={createForm.contact}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, contact: event.target.value }))}
                    placeholder="销售、微信、合同编号"
                  />
                </label>
                <label className="license-admin-field">
                  <span>到期时间</span>
                  <input
                    className="license-admin-input"
                    value={createForm.expires_at}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, expires_at: event.target.value }))}
                  />
                </label>
                <label className="license-admin-field">
                  <span>设备上限</span>
                  <input
                    className="license-admin-input"
                    value={createForm.max_devices}
                    min={1}
                    max={999}
                    type="number"
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, max_devices: Number(event.target.value) }))}
                  />
                </label>
                <label className="license-admin-field license-admin-span-2">
                  <span>自定义授权码（可选）</span>
                  <input
                    className="license-admin-input"
                    value={createForm.license_key}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, license_key: event.target.value }))}
                    placeholder="留空自动生成"
                  />
                </label>
                <label className="license-admin-field license-admin-span-2">
                  <span>内部备注</span>
                  <textarea
                    className="license-admin-input min-h-[64px]"
                    value={createForm.notes}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="这里给自己看，客户不会看到"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="license-admin-button is-primary" disabled={loading}>
                  <Plus size={14} />
                  创建授权
                </button>
              </div>
            </form>

            <div className="license-admin-card">
              <div className="license-admin-section-title">
                <Monitor size={15} />
                最近上线设备
              </div>
              <div className="space-y-2">
                {devices.slice(0, 5).map((device) => (
                  <div key={device.device_id} className="license-admin-mini-row">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-bold theme-text-primary">{device.hostname || device.device_id}</div>
                      <div className="truncate text-[10px] theme-text-muted">{device.customer_name || device.license_key} · {formatDate(device.last_seen)}</div>
                    </div>
                    <span className={`license-admin-pill ${device.status === 'enabled' ? 'is-ok' : 'is-danger'}`}>
                      {statusLabel(device.status)}
                    </span>
                  </div>
                ))}
                {devices.length === 0 && <div className="license-admin-empty">还没有设备激活记录。</div>}
              </div>
            </div>
          </div>
        )}

        {tab === 'licenses' && (
          <div className="space-y-3">
            <div className="license-admin-search">
              <Search size={14} />
              <input
                value={licenseQuery}
                onChange={(event) => setLicenseQuery(event.target.value)}
                placeholder="搜索授权码、客户、联系人、备注"
              />
            </div>
            {filteredLicenses.map((license) => {
              const draft = licenseDrafts[license.license_key] || {};
              const expired = isExpired(license.expires_at);
              return (
                <div key={license.license_key} className={`license-admin-record ${license.status !== 'enabled' || expired ? 'is-muted' : ''}`}>
                  <div className="license-admin-record-head">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`license-admin-pill ${license.status === 'enabled' && !expired ? 'is-ok' : 'is-danger'}`}>
                          {expired ? '已过期' : statusLabel(license.status)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyText(license.license_key)}
                          className="license-admin-copy"
                          title="复制授权码"
                        >
                          <Clipboard size={13} />
                          <code>{license.license_key}</code>
                        </button>
                      </div>
                      <div className="mt-1 text-[10px] theme-text-muted">
                        设备 {license.device_count || 0} / {license.max_devices} · 到期 {formatDate(license.expires_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleLicense(license)}
                      className={`license-admin-button ${license.status === 'enabled' ? 'is-danger' : 'is-primary'}`}
                    >
                      {license.status === 'enabled' ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                      {license.status === 'enabled' ? '禁用' : '启用'}
                    </button>
                  </div>

                  <div className="license-admin-form-grid mt-3">
                    <label className="license-admin-field">
                      <span>客户/公司</span>
                      <input
                        className="license-admin-input"
                        value={draft.customer_name ?? license.customer_name}
                        onChange={(event) => patchLicenseDraft(license.license_key, { customer_name: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>联系人/合同</span>
                      <input
                        className="license-admin-input"
                        value={draft.contact ?? license.contact ?? ''}
                        onChange={(event) => patchLicenseDraft(license.license_key, { contact: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>到期时间</span>
                      <input
                        className="license-admin-input"
                        value={draft.expires_at ?? license.expires_at}
                        onChange={(event) => patchLicenseDraft(license.license_key, { expires_at: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>设备上限</span>
                      <input
                        className="license-admin-input"
                        type="number"
                        min={1}
                        max={999}
                        value={draft.max_devices ?? license.max_devices}
                        onChange={(event) => patchLicenseDraft(license.license_key, { max_devices: Number(event.target.value) })}
                      />
                    </label>
                    <label className="license-admin-field license-admin-span-2">
                      <span>内部备注</span>
                      <textarea
                        className="license-admin-input min-h-[56px]"
                        value={draft.notes ?? license.notes ?? ''}
                        onChange={(event) => patchLicenseDraft(license.license_key, { notes: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => void saveLicense(license)} className="license-admin-button">
                      <Save size={14} />
                      保存修改
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredLicenses.length === 0 && (
              <div className="license-admin-empty">
                {!canUseAdminApi
                  ? '请输入管理员 Token，然后点击加载。'
                  : hasLoaded
                    ? '没有匹配的授权记录。'
                    : '点击加载读取服务器里的授权记录。'}
              </div>
            )}
          </div>
        )}

        {tab === 'devices' && (
          <div className="space-y-3">
            <div className="license-admin-search">
              <Search size={14} />
              <input
                value={deviceQuery}
                onChange={(event) => setDeviceQuery(event.target.value)}
                placeholder="搜索设备、客户、授权码、备注"
              />
            </div>
            {filteredDevices.map((device) => {
              const effectiveStatus = getDeviceEffectiveStatus(device);
              return (
              <div key={device.device_id} className={`license-admin-record ${effectiveStatus !== 'enabled' && effectiveStatus !== 'pending' ? 'is-muted' : ''}`}>
                <div className="license-admin-record-head">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`license-admin-pill ${effectiveStatus === 'enabled' ? 'is-ok' : effectiveStatus === 'pending' ? 'is-warning' : 'is-danger'}`}>
                        {statusLabel(effectiveStatus)}
                      </span>
                      {device.nickname && (
                        <span className="license-admin-pill is-name">{device.nickname}</span>
                      )}
                      <code className="truncate text-[11px] theme-text-primary">{device.device_id}</code>
                    </div>
                    <div className="mt-1 text-[10px] theme-text-muted">
                      {device.customer_name || '未知客户'} · {device.hostname || '未知电脑'} · {device.os_name || '未知系统'} · v{device.app_version || '-'}
                    </div>
                    <div className="mt-1 text-[10px] theme-text-muted">
                      首次 {formatDate(device.first_seen)} · 最近 {formatDate(device.last_seen)}
                    </div>
                  </div>
                  {device.status === 'pending' && device.license_status !== 'disabled' && (
                    <button
                      type="button"
                      onClick={() => void approveDevice(device)}
                      className="license-admin-button is-primary"
                    >
                      <CheckCircle2 size={14} />
                      同意
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={device.license_status === 'disabled'}
                    onClick={() => {
                      if (device.license_status !== 'disabled') void toggleDevice(device);
                    }}
                    className={`license-admin-button ${device.license_status === 'disabled' ? 'is-danger' : device.status === 'disabled' ? 'is-primary' : 'is-danger'}`}
                  >
                    {device.status === 'disabled' && device.license_status !== 'disabled' ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                    {device.license_status === 'disabled' ? '大组已禁用' : device.status === 'disabled' ? '启用' : device.status === 'pending' ? '拒绝' : '禁用'}
                  </button>
                </div>
                <label className="license-admin-field mt-3">
                  <span>设备备注</span>
                  <textarea
                    className="license-admin-input min-h-[56px]"
                    value={deviceDrafts[device.device_id]?.note ?? device.note ?? ''}
                    onChange={(event) => patchDeviceDraft(device.device_id, event.target.value)}
                    placeholder="例如：张三设计部电脑 / 财务电脑 / 已离职"
                  />
                </label>
                <div className="mt-3 flex flex-wrap justify-between gap-2">
                  <button type="button" onClick={() => void copyText(device.license_key)} className="license-admin-button">
                    <Clipboard size={14} />
                    复制授权码
                  </button>
                  <button type="button" onClick={() => void unbindDevice(device)} className="license-admin-button is-danger">
                    <Trash2 size={14} />
                    解绑设备
                  </button>
                  <button type="button" onClick={() => void saveDeviceNote(device)} className="license-admin-button">
                    <Save size={14} />
                    保存备注
                  </button>
                </div>
              </div>
            );
            })}
            {filteredDevices.length === 0 && (
              <div className="license-admin-empty">
                {!canUseAdminApi
                  ? '请输入管理员 Token，然后点击加载。'
                  : hasLoaded
                    ? '没有匹配的设备记录。'
                    : '点击加载读取服务器里的设备记录。'}
              </div>
            )}
          </div>
        )}

        {tab === 'announcements' && (
          <div className="space-y-4">
            <form onSubmit={createAnnouncementItem} className="license-admin-card">
              <div className="license-admin-section-title">
                <Megaphone size={15} />
                发布公告
              </div>
              <div className="license-admin-form-grid">
                <label className="license-admin-field">
                  <span>公告标题</span>
                  <input
                    className="license-admin-input"
                    value={announcementForm.title}
                    onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="例如：周末维护通知"
                  />
                </label>
                <label className="license-admin-field">
                  <span>公告类型</span>
                  <select
                    className="license-admin-input"
                    value={announcementForm.kind}
                    onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, kind: event.target.value as AnnouncementPayload['kind'] }))}
                  >
                    <option value="normal">普通</option>
                    <option value="important">重要</option>
                    <option value="maintenance">维护</option>
                    <option value="warning">提醒</option>
                  </select>
                </label>
                <label className="license-admin-field">
                  <span>指定授权码（可选）</span>
                  <input
                    className="license-admin-input"
                    value={announcementForm.scope_license_key || ''}
                    onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, scope_license_key: event.target.value }))}
                    placeholder="留空代表全部客户"
                  />
                </label>
                <label className="license-admin-field">
                  <span>显示窗口（可选）</span>
                  <input
                    className="license-admin-input"
                    value={announcementForm.end_at || ''}
                    onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, end_at: event.target.value }))}
                    placeholder="结束时间，留空长期有效"
                  />
                </label>
                <label className="license-admin-field license-admin-span-2">
                  <span>公告内容</span>
                  <textarea
                    className="license-admin-input min-h-[96px]"
                    value={announcementForm.body}
                    onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, body: event.target.value }))}
                    placeholder="这段内容会出现在子版公告栏里。"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4">
                  <label className="license-admin-inline-check">
                    <input
                      type="checkbox"
                      checked={announcementForm.is_active}
                      onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                    />
                    <span>立即启用</span>
                  </label>
                  <label className="license-admin-inline-check">
                    <input
                      type="checkbox"
                      checked={announcementForm.pinned}
                      onChange={(event) => setAnnouncementForm((prev) => ({ ...prev, pinned: event.target.checked }))}
                    />
                    <span>置顶显示</span>
                  </label>
                </div>
                <button type="submit" className="license-admin-button is-primary" disabled={loading}>
                  <Megaphone size={14} />
                  发布公告
                </button>
              </div>
            </form>

            <div className="license-admin-section-title mb-0">
              <Megaphone size={15} />
              公告历史
            </div>

            <div className="license-admin-search">
              <Search size={14} />
              <input
                value={announcementQuery}
                onChange={(event) => setAnnouncementQuery(event.target.value)}
                placeholder="搜索公告标题、内容、授权码"
              />
            </div>

            {filteredAnnouncements.map((announcement) => {
              const draft = announcementDrafts[announcement.id] || {
                title: announcement.title,
                body: announcement.body,
                kind: announcement.kind,
                scope_license_key: announcement.scope_license_key || '',
                is_active: Boolean(announcement.is_active),
                pinned: Boolean(announcement.pinned),
                start_at: announcement.start_at || '',
                end_at: announcement.end_at || '',
              };
              return (
                <div key={announcement.id} className={`license-admin-record ${!Boolean(announcement.is_active) ? 'is-muted' : ''}`}>
                  <div className="license-admin-record-head">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`license-admin-pill ${Boolean(announcement.is_active) ? 'is-ok' : 'is-danger'}`}>
                          {Boolean(announcement.is_active) ? '启用' : '停用'}
                        </span>
                        <span className={`license-admin-pill is-announcement-${announcement.kind}`}>
                          {announcementKindLabel(announcement.kind)}
                        </span>
                        {Boolean(announcement.pinned) && <span className="license-admin-pill is-name">置顶</span>}
                        <span className="truncate text-[12px] font-black theme-text-primary">{announcement.title}</span>
                      </div>
                      <div className="mt-1 text-[10px] theme-text-muted">
                        {announcement.scope_license_key ? `指定授权：${announcement.scope_license_key}` : '全部客户'} · 更新 {formatDate(announcement.updated_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAnnouncementPinned(announcement)}
                      className="license-admin-button"
                    >
                      {Boolean(announcement.pinned) ? <PinOff size={14} /> : <Pin size={14} />}
                      {Boolean(announcement.pinned) ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleAnnouncement(announcement)}
                      className={`license-admin-button ${Boolean(announcement.is_active) ? 'is-danger' : 'is-primary'}`}
                    >
                      {Boolean(announcement.is_active) ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                      {Boolean(announcement.is_active) ? '停用' : '启用'}
                    </button>
                  </div>

                  <div className="license-admin-form-grid mt-3">
                    <label className="license-admin-field">
                      <span>标题</span>
                      <input
                        className="license-admin-input"
                        value={draft.title}
                        onChange={(event) => patchAnnouncementDraft(announcement, { title: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>类型</span>
                      <select
                        className="license-admin-input"
                        value={draft.kind}
                        onChange={(event) => patchAnnouncementDraft(announcement, { kind: event.target.value as AnnouncementPayload['kind'] })}
                      >
                        <option value="normal">普通</option>
                        <option value="important">重要</option>
                        <option value="maintenance">维护</option>
                        <option value="warning">提醒</option>
                      </select>
                    </label>
                    <label className="license-admin-field">
                      <span>指定授权码</span>
                      <input
                        className="license-admin-input"
                        value={draft.scope_license_key || ''}
                        onChange={(event) => patchAnnouncementDraft(announcement, { scope_license_key: event.target.value })}
                        placeholder="留空全部客户"
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>结束时间</span>
                      <input
                        className="license-admin-input"
                        value={draft.end_at || ''}
                        onChange={(event) => patchAnnouncementDraft(announcement, { end_at: event.target.value })}
                        placeholder="可选"
                      />
                    </label>
                    <label className="license-admin-field license-admin-span-2">
                      <span>内容</span>
                      <textarea
                        className="license-admin-input min-h-[86px]"
                        value={draft.body}
                        onChange={(event) => patchAnnouncementDraft(announcement, { body: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-4">
                      <label className="license-admin-inline-check">
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(event) => patchAnnouncementDraft(announcement, { is_active: event.target.checked })}
                        />
                        <span>启用</span>
                      </label>
                      <label className="license-admin-inline-check">
                        <input
                          type="checkbox"
                          checked={draft.pinned}
                          onChange={(event) => patchAnnouncementDraft(announcement, { pinned: event.target.checked })}
                        />
                        <span>置顶</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void removeAnnouncement(announcement)} className="license-admin-button is-danger">
                        <Trash2 size={14} />
                        删除
                      </button>
                      <button type="button" onClick={() => void saveAnnouncement(announcement)} className="license-admin-button">
                        <Save size={14} />
                        保存
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredAnnouncements.length === 0 && (
              <div className="license-admin-empty">
                {!canUseAdminApi
                  ? '请输入管理员 Token，然后点击加载。'
                  : hasLoaded
                    ? '没有匹配的公告。'
                    : '点击加载读取服务器里的公告。'}
              </div>
            )}
          </div>
        )}

        {tab === 'version' && (
          <div className="space-y-4">
            <div className="license-admin-card">
              <div className="license-admin-section-title">
                <Rocket size={15} />
                当前生效版本
              </div>
              {currentVersionRecord ? (
                <div className="license-admin-mini-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="license-admin-pill is-ok">生效中</span>
                      <strong className="text-sm theme-text-primary">{currentVersionRecord.latest_version}</strong>
                      <span className="text-[10px] theme-text-muted">最低 {currentVersionRecord.min_version}</span>
                      {Boolean(currentVersionRecord.force_update) && <span className="license-admin-pill is-warning">强制更新</span>}
                    </div>
                    <div className="mt-1 truncate text-[10px] theme-text-muted">
                      更新 {formatDate(currentVersionRecord.updated_at)} · {currentVersionRecord.download_url || '未填写下载地址'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="license-admin-empty">还没有版本记录。</div>
              )}
            </div>

            <form onSubmit={saveVersion} className="license-admin-card">
              <div className="license-admin-section-title">
                <Plus size={15} />
                发布新版本
              </div>
              <div className="license-admin-form-grid">
                <label className="license-admin-field">
                  <span>最新版本</span>
                  <input
                    className="license-admin-input"
                    value={versionDraft.latest_version}
                    onChange={(event) => setVersionDraft((prev) => ({ ...prev, latest_version: event.target.value }))}
                    placeholder="1.0.1"
                  />
                </label>
                <label className="license-admin-field">
                  <span>最低可用版本</span>
                  <input
                    className="license-admin-input"
                    value={versionDraft.min_version}
                    onChange={(event) => setVersionDraft((prev) => ({ ...prev, min_version: event.target.value }))}
                    placeholder="1.0.0"
                  />
                </label>
                <label className="license-admin-field license-admin-span-2">
                  <span>新版下载地址</span>
                  <input
                    className="license-admin-input"
                    value={versionDraft.download_url}
                    onChange={(event) => setVersionDraft((prev) => ({ ...prev, download_url: event.target.value }))}
                    placeholder="https://..."
                  />
                </label>
                <label className="license-admin-field license-admin-span-2">
                  <span>更新说明</span>
                  <textarea
                    className="license-admin-input min-h-[110px]"
                    value={versionDraft.release_notes}
                    onChange={(event) => setVersionDraft((prev) => ({ ...prev, release_notes: event.target.value }))}
                    placeholder="写给客户看的更新说明"
                  />
                </label>
              </div>
              <label className="license-admin-remember my-3">
                <input
                  type="checkbox"
                  checked={Boolean(versionDraft.force_update)}
                  onChange={(event) => setVersionDraft((prev) => ({ ...prev, force_update: event.target.checked }))}
                />
                <span>强制更新：低版本客户会看到更新提示；发布的新版本会自动设为当前生效版本。</span>
              </label>
              <div className="flex items-center justify-end gap-3">
                <button type="submit" className="license-admin-button is-primary" disabled={loading}>
                  <Rocket size={14} />
                  发布并设为当前
                </button>
              </div>
            </form>

            <div className="license-admin-section-title mb-0">
              <Rocket size={15} />
              版本历史
            </div>

            {versionRecords.map((version) => {
              const draft = versionDrafts[version.id] || {
                latest_version: version.latest_version,
                min_version: version.min_version,
                download_url: version.download_url || '',
                release_notes: version.release_notes || '',
                force_update: Boolean(version.force_update),
              };
              return (
                <div key={version.id} className={`license-admin-record ${!Boolean(version.is_current) ? 'is-muted' : ''}`}>
                  <div className="license-admin-record-head">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`license-admin-pill ${Boolean(version.is_current) ? 'is-ok' : 'is-name'}`}>
                          {Boolean(version.is_current) ? '当前' : '历史'}
                        </span>
                        {Boolean(version.force_update) && <span className="license-admin-pill is-warning">强制</span>}
                        <strong className="theme-text-primary">{version.latest_version}</strong>
                        <span className="text-[10px] theme-text-muted">最低 {version.min_version}</span>
                      </div>
                      <div className="mt-1 text-[10px] theme-text-muted">
                        创建 {formatDate(version.created_at)} · 更新 {formatDate(version.updated_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void activateVersionRecord(version)}
                        disabled={Boolean(version.is_current)}
                        className="license-admin-button is-primary"
                      >
                        <CheckCircle2 size={14} />
                        设为当前
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeVersionRecord(version)}
                        disabled={versionRecords.length <= 1}
                        className="license-admin-button is-danger"
                        title={versionRecords.length <= 1 ? '至少保留一个版本策略' : '删除版本记录'}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="license-admin-form-grid mt-3">
                    <label className="license-admin-field">
                      <span>版本号</span>
                      <input
                        className="license-admin-input"
                        value={draft.latest_version}
                        onChange={(event) => patchVersionDraft(version, { latest_version: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field">
                      <span>最低可用版本</span>
                      <input
                        className="license-admin-input"
                        value={draft.min_version}
                        onChange={(event) => patchVersionDraft(version, { min_version: event.target.value })}
                      />
                    </label>
                    <label className="license-admin-field license-admin-span-2">
                      <span>下载地址</span>
                      <input
                        className="license-admin-input"
                        value={draft.download_url}
                        onChange={(event) => patchVersionDraft(version, { download_url: event.target.value })}
                        placeholder="https://..."
                      />
                    </label>
                    <label className="license-admin-field license-admin-span-2">
                      <span>更新说明</span>
                      <textarea
                        className="license-admin-input min-h-[82px]"
                        value={draft.release_notes}
                        onChange={(event) => patchVersionDraft(version, { release_notes: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <label className="license-admin-inline-check">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.force_update)}
                        onChange={(event) => patchVersionDraft(version, { force_update: event.target.checked })}
                      />
                      <span>强制更新</span>
                    </label>
                    <button type="button" onClick={() => void saveVersionRecord(version)} className="license-admin-button">
                      <Save size={14} />
                      保存记录
                    </button>
                  </div>
                </div>
              );
            })}

            {versionRecords.length === 0 && (
              <div className="license-admin-empty">
                {!canUseAdminApi
                  ? '请输入管理员 Token，然后点击加载。'
                  : hasLoaded
                    ? '还没有版本历史。'
                    : '点击加载读取服务器里的版本历史。'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
