import { useContext } from 'react'
import { prettyAmount } from '../../lib/format'
import { shortKey } from '../../lib/vault/setupPlan'
import { VaultContext } from '../../vault/context'
import { useVaultReadiness } from '../../vault/useVaultReadiness'
import ProtectionModel from './qg/ProtectionModel'
import QgScreen, { QgPrimary } from './qg/QgScreen'

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

  const problem = !hasRecoveryKit
    ? {
        title: 'Recovery Kit not on this device',
        copy: 'Save a copy now. It is a map of this vault, not a seed.',
        action: 'Save Recovery Kit',
        onClick: () => openRecover('kit', 'keys'),
      }
    : readiness.state === 'unavailable' || readiness.state === 'unreachable'
      ? {
          title: 'Vault service unreachable',
          copy: 'Spending approvals need the service. Retry when you are online.',
          action: 'Open Settings',
          onClick: undefined,
        }
      : !addressCovered && status?.enrolled
        ? {
            title: 'Addresses are not restored',
            copy: 'Sign in again to restore Spending and Savings addresses on this device.',
            action: '',
            onClick: undefined,
          }
        : canEnableOther
          ? {
              title: 'Other devices cannot sign in yet',
              copy: 'Allow passkey sign-in on another device.',
              action: busy ? 'Waiting for passkey…' : 'Use on another device',
              onClick: () => {
                if (!busy) void enablePasskeyLogin()
              },
            }
          : null

  return (
    <QgScreen title='Security'>
      <p className='qg-eyebrow'>Vault protection</p>
      <h1>{problem ? problem.title : 'Your vault is ready'}</h1>
      <p className='qg-copy'>
        {problem
          ? problem.copy
          : 'Your passkey and the Vault service protect everyday payments. Your recovery path remains available.'}
      </p>
      {problem?.action && problem.onClick ? (
        <QgPrimary onClick={problem.onClick} disabled={busy} loading={busy} label={problem.action} />
      ) : null}

      <ProtectionModel compact />

      <section className='qg-summary' aria-label='Protection details'>
        <div>
          <span>Protection</span>
          <strong>{protectionTier === 'advanced' ? 'Advanced' : 'Standard'}</strong>
        </div>
        <div>
          <span>Per payment</span>
          <strong>{prettyAmount(perPayment)}</strong>
        </div>
        <div>
          <span>Rolling 24 hours</span>
          <strong>{prettyAmount(limit)}</strong>
        </div>
        <div data-testid='security-readiness'>
          <span>Vault service</span>
          <strong>{readinessLabel}</strong>
        </div>
      </section>

      <section className='qg-details' aria-label='Keys'>
        <div>
          <span>This device</span>
          <strong>{!phoneCovered ? 'Needed' : devicesCovered ? 'Ready' : 'This device only'}</strong>
        </div>
        <div>
          <span>Hardware</span>
          <strong>{shortKey(hardwarePub)}</strong>
        </div>
        {hasRecovery ? (
          <div>
            <span title='Recovery'>Recovery</span>
            <strong>{shortKey(recoveryPub)}</strong>
          </div>
        ) : null}
      </section>

      <div className='qg-methods'>
        <button type='button' data-testid='security-kit' onClick={() => openRecover('kit', 'keys')}>
          <span>
            <strong>Recovery Kit</strong>
            <small>{hasRecoveryKit ? 'On this device' : 'Restore or save a copy'}</small>
          </span>
        </button>
        <button type='button' data-testid='security-lost' onClick={() => openRecover('lost', 'keys')}>
          <span>
            <strong>I lost a key</strong>
            <small>Start a waiting period you can cancel</small>
          </span>
        </button>
      </div>
    </QgScreen>
  )
}
