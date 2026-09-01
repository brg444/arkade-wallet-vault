declare module 'vite-plugin-eslint' {
  import type { Plugin } from 'vite'

  const eslintPlugin: (options?: Record<string, unknown>) => Plugin
  export default eslintPlugin
}
