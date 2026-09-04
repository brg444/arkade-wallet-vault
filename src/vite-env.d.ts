// eslint-disable-next-line spaced-comment
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GIT_COMMIT?: string
  readonly VITE_VAULT_API?: string
  readonly VITE_VAULT_RELEASE_NETWORK?: string
  readonly VITE_VAULT_LIGHTNING_SEND?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
