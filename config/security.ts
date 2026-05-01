const readEnv = (value?: string): string => (value || '').trim();
const DEFAULT_VAULT_PASSWORD = '810526';

export const getDevModePassword = (): string => readEnv(import.meta.env.VITE_DEV_MODE_PASSWORD);

export const getVaultPassword = (): string => DEFAULT_VAULT_PASSWORD;

export const isDevModePasswordConfigured = (): boolean => getDevModePassword().length > 0;

export const isVaultPasswordConfigured = (): boolean => getVaultPassword().length > 0;

export const verifyDevModePassword = (password: string): boolean => {
  const configured = getDevModePassword();
  return !!configured && password === configured;
};

export const verifyVaultPassword = (password: string): boolean => {
  const configured = getVaultPassword();
  return !!configured && password === configured;
};
