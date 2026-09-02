import { Component, type ReactNode } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import FlexRow from '../../components/FlexRow'
import SmallLogo from '../../components/SmallLogo'
import { createIncidentReference, recordVaultIncident } from '../../lib/logs'
import Content from './Content'
import Header from './Header'

interface Props {
  children: ReactNode
  reload?: () => void
}

interface State {
  crashed: boolean
  incidentReference: string
}

/** Vault-owned crash boundary with no dependency on the general wallet shell. */
export default class VaultErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, incidentReference: '' }

  static getDerivedStateFromError(): State {
    return { crashed: true, incidentReference: createIncidentReference() }
  }

  componentDidCatch(error: Error) {
    recordVaultIncident(this.state.incidentReference, error)
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div className='page vault-error-page' data-testid='vault-app'>
        <Header text='Arkade Vault' />
        <Content noRefresh className='vault-error-content'>
          <div className='vault-error-layout'>
            <div className='vault-error-mark' aria-hidden>
              <SmallLogo />
            </div>
            <div className='vault-error-copy'>
              <p>Arkade Vault could not display this screen.</p>
              <p className='vault-error-reference'>Incident reference: {this.state.incidentReference}</p>
            </div>
          </div>
        </Content>
        <ButtonsOnBottom>
          <FlexRow>
            <Button
              secondary
              label='Try again'
              onClick={() => this.setState({ crashed: false, incidentReference: '' })}
            />
            <Button label='Reload' onClick={this.props.reload || (() => window.location.reload())} />
          </FlexRow>
        </ButtonsOnBottom>
      </div>
    )
  }
}
