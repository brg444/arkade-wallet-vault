import * as Sentry from '@sentry/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import CenterScreen from '../../components/CenterScreen'
import Padded from '../../components/Padded'
import Text, { TextSecondary } from '../../components/Text'
import Content from './Content'
import Header from './Header'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Vault-owned crash boundary with no dependency on the general wallet shell. */
export default class VaultErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setExtra('componentStack', errorInfo.componentStack)
      Sentry.captureException(error)
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className='page'>
        <Header text='Something went wrong' />
        <Content noRefresh>
          <Padded>
            <CenterScreen>
              <Text>The app ran into an unexpected error</Text>
              <Text>Please reload to continue</Text>
              <TextSecondary centered>{this.state.error.message}</TextSecondary>
            </CenterScreen>
          </Padded>
        </Content>
        <ButtonsOnBottom>
          <Button label='Reload' onClick={() => window.location.reload()} />
        </ButtonsOnBottom>
      </div>
    )
  }
}
