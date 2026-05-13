export type AppEdition = 'admin' | 'client';

const requestedEdition = (import.meta.env.VITE_APP_EDITION || '').toLowerCase();
const fallbackEdition: AppEdition = import.meta.env.DEV ? 'admin' : 'client';

export const appEdition: AppEdition = requestedEdition === 'admin' ? 'admin'
  : requestedEdition === 'client' ? 'client'
    : fallbackEdition;

export const isAdminEdition = appEdition === 'admin';

export const defaultLicenseServerUrl =
  import.meta.env.VITE_LICENSE_SERVER_URL || 'http://127.0.0.1:8787';
