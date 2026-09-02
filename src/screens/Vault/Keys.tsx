import { useContext } from 'react'
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

  return (
    <>
      <Header text='Security' />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.75rem'>
            <HubGroup label='Keys and service'>
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
              <HubRow
                icon={<ServerIcon />}
                title='Vault service'
                signal={readiness.state === 'checking' ? 'wait' : readiness.state === 'ready' ? 'ok' : 'bad'}
                status={
                  readiness.state === 'checking'
                    ? 'Checking…'
                    : readiness.state === 'ready'
                      ? 'Ready'
                      : readiness.state === 'unavailable'
                        ? 'Unavailable'
                        : 'Can’t reach'
                }
              />
              {hasRecovery ? (
                <HubRow
                  icon={<SafeIcon />}
                  title='Recovery'
                  detail='Starts a wait you can cancel'
                  status={shortKey(recoveryPub)}
                />
              ) : null}
            </HubGroup>

            <HubGroup label='Protection'>
              <HubRow
                title={protectionTier === 'advanced' ? 'Advanced' : 'Standard'}
                detail={protectionTier === 'advanced' ? 'Add a separate recovery key' : 'No separate recovery key'}
                status='Protection tier'
              />
              <HubRow
                title='Spending limits'
                detail={`${prettyAmount(perPayment)} per payment`}
                status={`${prettyAmount(limit)} / rolling 24 hours`}
              />
              <HubRow
                title='Recovery Kit'
                detail={hasRecoveryKit ? 'Available on this device' : 'Open to restore or save a copy'}
                status={hasRecoveryKit ? 'Available' : 'Review'}
                onClick={() => openRecover('kit', 'keys')}
                testId='security-kit'
              />
              <HubRow title='I lost a key' onClick={() => openRecover('lost', 'keys')} testId='security-lost' />
              {canEnableOther ? (
                <HubRow
                  title={busy ? 'Waiting for device unlock…' : 'Use on another device'}
                  onClick={() => {
                    if (!busy) void enablePasskeyLogin()
                  }}
                />
              ) : null}
            </HubGroup>

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
