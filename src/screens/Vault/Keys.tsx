import { useContext, useEffect, useState } from 'react'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import FingerprintIcon from '../../icons/Fingerprint'
import SafeIcon from '../../icons/Safe'
import ServerIcon from '../../icons/Server'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import { isFixturePub, shortKey } from '../../lib/vault/setupPlan'
import { pingVaultService } from '../../lib/vault/status'
import { VaultContext } from '../../providers/vault'
import { HubGroup, HubRow } from './ui'

export default function VaultKeys() {
  const { busy, enablePasskeyLogin, hasLocalEnrollment, openRecover, operationalAddress, setup, status } =
    useContext(VaultContext)
  const phoneCovered = Boolean(status?.enrolled)
  const devicesCovered = Boolean(status?.passkeyLoginAvailable)
  const canEnableOther = hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable
  const hardwarePub = status?.externalOwnerWalletPub || setup.hardwarePub
  const recoveryPub = status?.recoveryPub || setup.recoveryPub
  const hasRecovery = Boolean(recoveryPub)
  const addressCovered = Boolean(operationalAddress)
  const [service, setService] = useState<'checking' | 'online' | 'down'>(status ? 'online' : 'checking')

  useEffect(() => {
    let live = true
    void pingVaultService().then((ok) => {
      if (live) setService(ok ? 'online' : 'down')
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <>
      <Header text='Security' />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.75rem'>
            <HubGroup>
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
              <HubRow
                icon={<ShieldCheckOutlineIcon />}
                title='Hardware'
                status={
                  setup.hardwareIsDemo || (hardwarePub && isFixturePub(hardwarePub)) ? 'Demo' : shortKey(hardwarePub)
                }
              />
              <HubRow
                icon={<ServerIcon />}
                title='Vault service'
                signal={service === 'checking' ? 'wait' : service === 'online' ? 'ok' : 'bad'}
                status={service === 'checking' ? 'Checking…' : service === 'online' ? 'Online' : 'Can’t reach'}
              />
              {hasRecovery ? (
                <HubRow
                  icon={<SafeIcon />}
                  title='Recovery'
                  detail='Starts a wait you can cancel'
                  status={setup.recoveryIsDemo ? 'Demo' : shortKey(recoveryPub)}
                />
              ) : null}
            </HubGroup>

            <HubGroup>
              <HubRow title='Recovery Kit' onClick={() => openRecover('kit', 'keys')} testId='security-kit' />
              <HubRow title='I lost a key' onClick={() => openRecover('lost', 'keys')} testId='security-lost' />
              {canEnableOther ? (
                <HubRow
                  title={busy ? 'Waiting for Face ID…' : 'Use on another device'}
                  onClick={() => {
                    if (!busy) void enablePasskeyLogin()
                  }}
                />
              ) : null}
            </HubGroup>

            {!addressCovered && status?.enrolled ? (
              <Text color='neutral-600' tiny wrap>
                Receive isn’t ready yet. Try again after setup finishes.
              </Text>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
