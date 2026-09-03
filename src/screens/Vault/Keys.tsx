import { useContext, type ReactNode } from 'react'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import FingerprintIcon from '../../icons/Fingerprint'
import SafeIcon from '../../icons/Safe'
import ServerIcon from '../../icons/Server'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import { prettyAmount } from '../../lib/format'
import { shortKey } from '../../lib/vault/setupPlan'
import { VaultContext } from '../../vault/context'
import { useVaultReadiness } from '../../vault/useVaultReadiness'
import { HubGroup, HubRow } from './ui'

function SecurityTile({
  icon,
  label,
  value,
  detail,
  tone = 'purple',
  onClick,
  testId,
}: {
  icon: ReactNode
  label: string
  value: string
  detail?: string
  tone?: 'purple' | 'green' | 'orange' | 'ink'
  onClick?: () => void
  testId?: string
}) {
  const body = (
    <>
      <span className='vault-security-tile-icon' aria-hidden>
        {icon}
      </span>
      <span className='vault-security-tile-copy'>
        <span className='vault-security-tile-label'>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </>
  )
  return onClick ? (
    <button type='button' className={`vault-security-tile is-${tone}`} onClick={onClick} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={`vault-security-tile is-${tone}`} data-testid={testId}>
      {body}
    </div>
  )
}

export default function VaultKeys() {
  const {
    busy,
    enablePasskeyLogin,
    hasLocalEnrollment,
    hasRecoveryKit,
    openRecover,
    savingsAddress,
    setup,
    spendingArkAddress,
    status,
  } = useContext(VaultContext)
  const phoneCovered = Boolean(status?.enrolled)
  const devicesCovered = Boolean(status?.passkeyLoginAvailable)
  const canEnableOther = hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable
  const hardwarePub = status?.externalOwnerWalletPub || setup.hardwarePub
  const recoveryPub = status?.recoveryPub || setup.recoveryPub
  const hasRecovery = Boolean(recoveryPub)
  const addressCovered = Boolean(savingsAddress && spendingArkAddress)
  const readiness = useVaultReadiness()
  const protectionTier = status?.protectionTier || setup.protectionTier
  const limit = status?.periodAllowance || setup.dailyLimitSats
  const perPayment = status?.txCap || setup.txCapSats
  const readinessLabel =
    readiness.state === 'checking'
      ? 'Checking…'
      : readiness.state === 'ready'
        ? 'Ready'
        : readiness.state === 'unavailable'
          ? 'Unavailable'
          : 'Can’t reach'
  const vaultReady = phoneCovered && addressCovered && readiness.state === 'ready'

  return (
    <>
      <Header text='Security' />
      <Content noRefresh className='vault-security-content'>
        <Padded>
          <FlexCol gap='1.35rem' className='vault-security'>
            <section className='vault-security-hero' aria-label='Vault protection status'>
              <div className='vault-security-hero-head'>
                <strong>Vault protection</strong>
                <span className={vaultReady ? 'is-ready' : 'is-attention'}>{vaultReady ? 'Ready' : 'Review'}</span>
              </div>
              <h2>{vaultReady ? 'Your vault is ready.' : 'Review your vault.'}</h2>
              <p>
                {vaultReady
                  ? 'Your passkey and the Vault service protect everyday payments. Your recovery path remains available.'
                  : 'Check device access, addresses, and service readiness before relying on this vault.'}
              </p>
            </section>

            <div className='vault-security-grid'>
              <SecurityTile
                icon={<FingerprintIcon />}
                label='Protection tier'
                value={protectionTier === 'advanced' ? 'Advanced' : 'Standard'}
                detail={protectionTier === 'advanced' ? 'Separate recovery key' : 'No separate recovery key'}
              />
              <SecurityTile
                icon={<SafeIcon />}
                label='Recovery Kit'
                value={hasRecoveryKit ? 'Available' : 'Review'}
                detail={hasRecoveryKit ? 'On this device' : 'Restore or save a copy'}
                tone='green'
                onClick={() => openRecover('kit', 'keys')}
                testId='security-kit'
              />
              <SecurityTile
                icon={<ShieldCheckOutlineIcon />}
                label='Spending limits'
                value={`${prettyAmount(perPayment)} each`}
                detail={`${prettyAmount(limit)} / rolling 24 hours`}
                tone='orange'
              />
              <SecurityTile
                icon={<ServerIcon />}
                label='Vault service'
                value={readinessLabel}
                detail='Signing readiness'
                tone='ink'
                testId='security-readiness'
              />
            </div>

            <div className='vault-security-groups'>
              <HubGroup label='Keys'>
                <HubRow
                  icon={<FingerprintIcon />}
                  title='This device'
                  status={!phoneCovered ? 'Needed' : devicesCovered ? 'Ready' : 'This device only'}
                  onClick={
                    canEnableOther
                      ? () => {
                          if (!busy) void enablePasskeyLogin()
                        }
                      : undefined
                  }
                />
                <HubRow icon={<ShieldCheckOutlineIcon />} title='Hardware' status={shortKey(hardwarePub)} />
                {hasRecovery ? (
                  <HubRow
                    icon={<SafeIcon />}
                    title='Recovery'
                    detail='Starts a wait you can cancel'
                    status={shortKey(recoveryPub)}
                  />
                ) : null}
              </HubGroup>

              <HubGroup label='Recovery and access'>
                <HubRow title='I lost a key' onClick={() => openRecover('lost', 'keys')} testId='security-lost' />
                {canEnableOther ? (
                  <HubRow
                    title={busy ? 'Waiting for passkey…' : 'Use on another device'}
                    onClick={() => {
                      if (!busy) void enablePasskeyLogin()
                    }}
                  />
                ) : null}
              </HubGroup>
            </div>

            {!addressCovered && status?.enrolled ? (
              <Text color='neutral-600' tiny wrap>
                Vault addresses are not restored on this device. Sign in again to restore them.
              </Text>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
