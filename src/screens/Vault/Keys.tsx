import { useContext } from 'react'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import FingerprintIcon from '../../icons/Fingerprint'
import SafeIcon from '../../icons/Safe'
import ServerIcon from '../../icons/Server'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import { VaultContext } from '../../providers/vault'
import { HubGroup, HubRow } from './ui'

export default function VaultKeys() {
  const { busy, enablePasskeyLogin, hasLocalEnrollment, openRecover, operationalAddress, setup, status } =
    useContext(VaultContext)
  const phoneCovered = Boolean(status?.enrolled)
  const devicesCovered = Boolean(status?.passkeyLoginAvailable)
  const canEnableOther = hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable
  const hasRecovery = Boolean(setup.recoveryPub || status?.recoveryPub)
  const addressCovered = Boolean(operationalAddress)

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
                status={!phoneCovered ? 'Needed' : devicesCovered ? 'Ready' : 'This phone'}
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
                status={setup.hardwareIsDemo ? 'Demo' : 'Ready'}
              />
              <HubRow icon={<ServerIcon />} title='Vault service' status='Daily only' />
              <HubRow
                icon={<SafeIcon />}
                title='Recovery'
                status={hasRecovery ? (setup.recoveryIsDemo ? 'Demo' : 'Ready') : 'Not added'}
              />
            </HubGroup>

            <HubGroup>
              <HubRow title='Recovery Kit' onClick={() => openRecover('kit', 'keys')} testId='security-kit' />
              <HubRow title='I lost a key' onClick={() => openRecover('lost', 'keys')} testId='security-lost' />
              {canEnableOther ? (
                <HubRow
                  title={busy ? 'Waiting for Face ID…' : 'Use on another phone'}
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
