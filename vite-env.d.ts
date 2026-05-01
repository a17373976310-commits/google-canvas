/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_DEV_MODE_PASSWORD?: string;
  readonly VITE_NODE_VAULT_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
