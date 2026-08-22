// eslint-disable-next-line spaced-comment
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GIT_COMMIT?: string
  readonly VITE_VAULT_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
