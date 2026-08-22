import ReactDOM from 'react-dom/client'
import './tokens.css'
import './app.css'
import './index.css'
import { ToastProvider } from './components/Toast'
import { VaultProvider } from './providers/vault'
import VaultApp from './VaultApp'
import ErrorBoundary from './screens/Vault/ErrorBoundary'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <ErrorBoundary>
    <ToastProvider>
      <VaultProvider>
        <VaultApp />
      </VaultProvider>
    </ToastProvider>
  </ErrorBoundary>,
)
