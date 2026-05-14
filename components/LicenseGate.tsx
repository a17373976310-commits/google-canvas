import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  KeyRound,
  Loader2,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-react';
import { isAdminEdition } from '../config/appEdition';
import {
  activateClientLicense,
  APP_VERSION,
  checkClientAnnouncements,
  checkClientCredits,
  checkClientUpdate,
  clearStoredLicenseState,
  getLicenseServerUrl,
  getOrCreateDeviceId,
  hasValidLease,
  LICENSE_CHECK_INTERVAL_MS,
  LicenseRequestError,
  readStoredLicenseState,
  saveStoredLicenseState,
  shouldRefreshLicense,
  StoredLicenseState,
  toStoredLicenseState,
  verifyClientLicense,
  VERSION_CHECK_INTERVAL_MS,
} from '../services/licenseClientApi';

interface LicenseGateProps {
  children: React.ReactNode;
}

const normalizeCode = (value: string) => value.trim();
const normalizeNickname = (value: string) => Array.from(value.trim()).slice(0, 4).join('');
const UPDATE_DISMISS_KEY = 'awei_client_update_dismissed_version';

const getStatusTone = (status?: StoredLicenseState['status']) => {
  if (status === 'enabled') return 'ok';
  if (status === 'disabled' || status === 'error') return 'error';
  if (status === 'pending') return 'warn';
  return 'idle';
};

export const LicenseGate: React.FC<LicenseGateProps> = ({ children }) => {
  const [state, setState] = React.useState<StoredLicenseState | null>(() => readStoredLicenseState());
  const [licenseKey, setLicenseKey] = React.useState(() => readStoredLicenseState()?.licenseKey || '');
  const [nickname, setNickname] = React.useState(() => readStoredLicenseState()?.nickname || '');
  const [loading, setLoading] = React.useState(!isAdminEdition);
  const [message, setMessage] = React.useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [isComposingNickname, setIsComposingNickname] = React.useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = React.useState(() => {
    try {
      return window.localStorage.getItem(UPDATE_DISMISS_KEY) || '';
    } catch {
      return '';
    }
  });
  const [downloadCopied, setDownloadCopied] = React.useState(false);

  const persistState = React.useCallback((next: StoredLicenseState) => {
    saveStoredLicenseState(next);
    setState(next);
    setLicenseKey(next.licenseKey);
    setNickname(next.nickname);
  }, []);

  const verifySaved = React.useCallback(async (silent = false) => {
    const saved = readStoredLicenseState();
    if (!saved?.licenseKey || !saved.deviceId) {
      setState(null);
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const response = await verifyClientLicense(saved);
      const next = toStoredLicenseState(saved, response);
      persistState(next);
      if (response.allowed) {
        setMessage(null);
      } else {
        setMessage({ type: 'warn', text: '申请已提交，正在等待管理员审核。' });
      }
    } catch (error) {
      if (error instanceof LicenseRequestError) {
        const next: StoredLicenseState = {
          ...saved,
          status: 'disabled',
          detail: error.message,
        };
        saveStoredLicenseState(next);
        setState(next);
        setMessage({ type: 'error', text: error.message });
        return;
      }
      if (hasValidLease(saved)) {
        setState(saved);
        setMessage({ type: 'warn', text: '授权服务暂时不可用，已使用 24 小时租约继续进入。' });
      } else {
        const detail = error instanceof Error ? error.message : '授权验证失败';
        setState({ ...saved, status: 'error', detail });
        setMessage({ type: 'error', text: detail });
      }
    } finally {
      setLoading(false);
    }
  }, [persistState]);

  const refreshVersionOnly = React.useCallback(async () => {
    const saved = readStoredLicenseState();
    if (!saved?.licenseKey || saved.status !== 'enabled') return;

    try {
      const [version, announcements, credits] = await Promise.all([
        checkClientUpdate(),
        checkClientAnnouncements(saved.licenseKey),
        checkClientCredits().catch(() => saved.credits),
      ]);
      const next: StoredLicenseState = {
        ...saved,
        version,
        announcements,
        credits,
      };
      saveStoredLicenseState(next);
      setState((current) => {
        if (!current || current.deviceId !== saved.deviceId) return current;
        return { ...current, version, announcements, credits };
      });
    } catch {
      // Version checks are best-effort; authorization checks still handle hard failures.
    }
  }, []);

  React.useEffect(() => {
    if (isAdminEdition) {
      setLoading(false);
      return;
    }
    void verifySaved(false);
  }, [verifySaved]);

  React.useEffect(() => {
    if (isAdminEdition) return undefined;
    const hideSplash = (window as any).__AI_CANVAS_HIDE_SPLASH__;
    if (typeof hideSplash !== 'function') return undefined;

    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => hideSplash());
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, []);

  React.useEffect(() => {
    if (isAdminEdition) return undefined;
    const timer = window.setInterval(() => {
      const saved = readStoredLicenseState();
      if (saved?.status === 'enabled' && shouldRefreshLicense(saved)) {
        void verifySaved(true);
      }
    }, LICENSE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [verifySaved]);

  React.useEffect(() => {
    if (isAdminEdition) return undefined;

    const timer = window.setInterval(() => {
      void refreshVersionOnly();
    }, VERSION_CHECK_INTERVAL_MS);

    const onFocus = () => void refreshVersionOnly();
    const onVisibilityChange = () => {
      if (!document.hidden) void refreshVersionOnly();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshVersionOnly]);

  React.useEffect(() => {
    if (isAdminEdition) return undefined;
    const onLicenseStateChange = (event: Event) => {
      const detail = (event as CustomEvent<StoredLicenseState>).detail;
      if (detail?.deviceId) setState(detail);
    };
    window.addEventListener('awei-license-state-change', onLicenseStateChange);
    return () => window.removeEventListener('awei-license-state-change', onLicenseStateChange);
  }, []);

  const submitActivation = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = normalizeCode(licenseKey);
    const nick = normalizeNickname(nickname);

    if (!code) {
      setMessage({ type: 'error', text: '请输入激活码。' });
      return;
    }
    if (!nick) {
      setMessage({ type: 'error', text: '请输入 4 个字以内的设备备注，方便管理员识别。' });
      return;
    }

    const requestState = {
      licenseKey: code,
      nickname: nick,
      deviceId: getOrCreateDeviceId(),
    };

    setLoading(true);
    setMessage(null);
    try {
      const response = await activateClientLicense(requestState);
      const next = toStoredLicenseState(requestState, response);
      persistState(next);
      if (response.allowed) {
        setMessage({ type: 'ok', text: '授权验证成功，正在进入画布。' });
      } else {
        setMessage({ type: 'warn', text: '申请已提交，请等待管理员在母版控制台同意。' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '激活失败' });
    } finally {
      setLoading(false);
    }
  };

  const resetActivation = () => {
    clearStoredLicenseState();
    setState(null);
    setMessage(null);
  };

  const versionInfo = state?.version;
  const latestVersion = versionInfo?.latest_version || '';
  const downloadUrl = versionInfo?.download_url?.trim() || '';
  const hasUpdate = Boolean(versionInfo?.update_available && latestVersion);
  const requiresUpdate = Boolean(versionInfo?.must_update || (versionInfo?.force_update && versionInfo?.update_available));
  const showUpdateNotice = state?.status === 'enabled'
    && hasUpdate
    && (requiresUpdate || dismissedUpdateVersion !== latestVersion);
  const nicknameCount = Array.from(nickname.trim()).length;

  const dismissUpdate = () => {
    if (!latestVersion) return;
    try {
      window.localStorage.setItem(UPDATE_DISMISS_KEY, latestVersion);
    } catch {
      // Ignore hardened storage failures.
    }
    setDismissedUpdateVersion(latestVersion);
  };

  const openDownloadTarget = async () => {
    if (!downloadUrl) return;
    setDownloadCopied(false);
    if (/^(https?:\/\/|file:\/\/)/i.test(downloadUrl)) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await navigator.clipboard.writeText(downloadUrl);
      setDownloadCopied(true);
    } catch {
      setDownloadCopied(false);
    }
  };

  if (isAdminEdition || state?.status === 'enabled') {
    return (
      <>
        {children}
        {showUpdateNotice && (
          <div className={`license-update-notice ${requiresUpdate ? 'is-required' : 'is-optional'}`} role="dialog" aria-live="polite" aria-label="版本更新提示">
            <div className="license-update-card">
              {!requiresUpdate && (
                <button type="button" className="license-update-close" onClick={dismissUpdate} aria-label="稍后提醒">
                  <X size={15} />
                </button>
              )}
              <div className="license-update-icon">
                <Download size={18} />
              </div>
              <div className="license-update-copy">
                <span className="license-update-kicker">{requiresUpdate ? '需要更新后继续使用' : '发现新版本'}</span>
                <h2>AWEI Canvas {latestVersion}</h2>
                <p>
                  当前版本 {versionInfo?.current_version || APP_VERSION}
                  {versionInfo?.min_version ? ` · 最低可用 ${versionInfo.min_version}` : ''}
                </p>
                {versionInfo?.release_notes && (
                  <div className="license-update-notes">{versionInfo.release_notes}</div>
                )}
                {downloadCopied && (
                  <div className="license-update-copied">下载地址已复制。</div>
                )}
              </div>
              <div className="license-update-actions">
                <button type="button" disabled={!downloadUrl} onClick={() => void openDownloadTarget()} className="license-update-primary">
                  {downloadUrl && /^(https?:\/\/|file:\/\/)/i.test(downloadUrl) ? <Download size={15} /> : <Copy size={15} />}
                  {downloadUrl && /^(https?:\/\/|file:\/\/)/i.test(downloadUrl) ? '下载新版' : '复制下载地址'}
                </button>
                <button type="button" disabled={loading} onClick={() => void verifySaved(false)} className="license-update-secondary">
                  <RefreshCw size={14} />
                  重新检查
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const statusTone = message?.type || getStatusTone(state?.status);
  const isPending = state?.status === 'pending';
  const footerStatus = loading
    ? '正在连接授权服务'
    : statusTone === 'error'
      ? '授权服务需要处理'
      : isPending
        ? '等待管理员审核'
        : '系统连接正常';

  return (
    <div className={`license-gate-shell license-gate-tone-${statusTone}`}>
      <div className="license-gate-grid" aria-hidden="true" />
      <div className="license-gate-topbar" aria-hidden="true">
        <div className="license-gate-wordmark">awei</div>
        <div className="license-gate-engine-pill">
          <ShieldCheck size={16} />
          <span>Canvas Engine</span>
        </div>
      </div>

      <main className="license-gate-stage">
        <section className="license-gate-hero" aria-label="启动状态">
          <h1>
            <span>AWEI</span>
            <span>Canvas</span>
          </h1>
          <p>智能画布工作区启动中</p>
          <div className="license-gate-hero-rule" />
          <div className="license-gate-init-line">
            <span className="license-gate-live-dot" />
            <span>正在初始化 Canvas Engine {APP_VERSION}</span>
          </div>
        </section>

        <section className="license-gate-motion" aria-hidden="true">
          <div className="license-gate-fold-frame frame-a" />
          <div className="license-gate-fold-frame frame-b" />
          <div className="license-gate-fold-frame frame-c" />
          <div className="license-gate-path">
            <span />
          </div>
        </section>

        <aside className="license-gate-panel" aria-label="设备激活">
          <div className="license-gate-panel-glow" aria-hidden="true" />
          <div className="license-gate-panel-header">
            <div>
              <h2>激活设备</h2>
              <p>提交后等待管理员审核</p>
            </div>
          </div>

          <form onSubmit={submitActivation} className="license-gate-form">
            <label className="license-gate-field">
              <span>激活码</span>
              <div className="license-gate-input">
                <KeyRound size={16} />
                <input
                  value={licenseKey}
                  onChange={(event) => setLicenseKey(event.target.value)}
                  placeholder="输入管理员提供的激活码"
                  autoFocus
                />
              </div>
            </label>

            <label className="license-gate-field">
              <span>设备备注</span>
              <div className="license-gate-input">
                <PencilLine size={16} />
                <input
                  value={nickname}
                  onCompositionStart={() => setIsComposingNickname(true)}
                  onCompositionEnd={(event) => {
                    setIsComposingNickname(false);
                    setNickname(normalizeNickname(event.currentTarget.value));
                  }}
                  onChange={(event) => {
                    const next = event.target.value;
                    setNickname(isComposingNickname || (event.nativeEvent as InputEvent).isComposing ? next : normalizeNickname(next));
                  }}
                  onBlur={(event) => setNickname(normalizeNickname(event.target.value))}
                  placeholder="4字内，如张工"
                />
                <strong>{Math.min(nicknameCount, 4)}/4</strong>
              </div>
            </label>

            {(message || isPending) && (
              <div className={`license-gate-message is-${message?.type || 'warn'}`} aria-live="polite">
                {message?.type === 'ok' ? <CheckCircle2 size={15} /> : message?.type === 'error' ? <AlertCircle size={15} /> : <Clock3 size={15} />}
                <span>{message?.text || '申请已提交，等待通过。'}</span>
              </div>
            )}

            <button type="submit" disabled={loading} className="license-gate-primary">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              <span>{isPending ? '重新提交申请' : '提交申请'}</span>
            </button>

            <div className="license-gate-subactions">
              <button type="button" disabled={loading || !state} onClick={() => void verifySaved(false)}>
                <RefreshCw size={14} />
                重新验证
              </button>
              {state && (
                <button type="button" onClick={resetActivation}>
                  更换激活码
                </button>
              )}
            </div>
          </form>
        </aside>
      </main>

      <div className="license-gate-progress" aria-hidden="true">
        <div className="license-gate-progress-labels">
          <span>授权验证</span>
          <span>节点引擎</span>
          <span>工作区恢复</span>
        </div>
        <div className="license-gate-progress-track">
          <i />
          <b className="step-one" />
          <b className="step-two" />
          <b className="step-three" />
        </div>
      </div>

      <footer className="license-gate-footer" aria-hidden="true">
        <span>v{APP_VERSION}</span>
        <span className={`license-gate-server is-${statusTone}`}>
          <Wifi size={13} />
          {footerStatus}
        </span>
      </footer>

      <div className="license-gate-server-url" title={getLicenseServerUrl()}>
        授权服务：{getLicenseServerUrl()}
      </div>
    </div>
  );
};
