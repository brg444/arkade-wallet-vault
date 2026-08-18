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
import { waitLabel } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { KeyCard, PolicyTimeline, Section } from './ui'

export default function VaultKeys() {
  const { busy, enablePasskeyLogin, hasLocalEnrollment, liveNetwork, openRecover, operationalAddress, setup, status } =
    useContext(VaultContext)
  const network = status?.network || (liveNetwork ? 'mutinynet' : undefined)
  const waitPhone = waitLabel(status?.operationalCsvBlocks || setup.operationalCsvBlocks, network)
  const waitSavings = waitLabel(status?.savingsCsvBlocks || setup.savingsCsvBlocks, network)
  const phoneCovered = Boolean(status?.enrolled)
  const devicesCovered = Boolean(status?.passkeyLoginAvailable)
  const addressCovered = Boolean(operationalAddress)
  const canEnableOther = hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable
  const hasRecovery = Boolean(setup.recoveryPub || status?.recoveryPub)

  return (
    <>
      <Header text='Security' />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.5rem'>
            <Section label='Your keys'>
              <KeyCard
                icon={<FingerprintIcon />}
                title='This device'
                role={
                  !phoneCovered
                    ? 'No passkey yet'
                    : devicesCovered
                      ? 'Daily spend · other devices can sign in'
                      : 'Daily spend · this device only'
                }
                status={phoneCovered ? 'Covered' : 'Needed'}
              />
              <KeyCard
                icon={<ShieldCheckOutlineIcon />}
                title='Hardware'
                role={setup.hardwareIsDemo ? 'Demo key' : 'This phone + hardware moves everything'}
                fingerprint={setup.hardwarePub || status?.externalOwnerWalletPub}
              />
              <KeyCard icon={<ServerIcon />} title='Vault service' role='Helps with daily spend. Can’t move Savings.' />
              {hasRecovery ? (
                <KeyCard
                  icon={<SafeIcon />}
                  title='Recovery'
                  role={setup.recoveryIsDemo ? 'Demo recovery key' : 'Starts a waiting period you can cancel'}
                  fingerprint={setup.recoveryPub || status?.recoveryPub}
                />
              ) : (
                <KeyCard
                  icon={<SafeIcon />}
                  title='Recovery'
                  role='Not added. This vault is this phone plus hardware.'
                />
              )}
            </Section>

            <Section label='If something happens'>
              <KeyCard
                title='Recovery Kit'
                role='Last-resort file if this app is gone. Not a seed.'
                onClick={() => openRecover('kit', 'keys')}
                testId='security-kit'
              />
              <KeyCard
                title='I lost a key'
                role='Start a waiting period. Cancel if it wasn’t you.'
                onClick={() => openRecover('lost', 'keys')}
                testId='security-lost'
              />
              {canEnableOther ? (
                <KeyCard
                  title={busy ? 'Waiting for Face ID…' : 'Use on another phone'}
                  role='Let another device sign in. Don’t create a new passkey there.'
                  onClick={() => {
                    if (!busy) void enablePasskeyLogin()
                  }}
                />
              ) : null}
              {hasLocalEnrollment && status?.passkeyLoginAvailable ? (
                <Text color='neutral-600' tiny wrap>
                  Another device can sign in and scan the QR from here. Don’t create a new passkey.
                </Text>
              ) : null}
            </Section>

            <Section label='If you lose one'>
              <Text color='neutral-600' tiny wrap>
                This phone: sign in on another phone, or start recovery with hardware ({waitSavings}). Hardware: start
                recovery from this phone ({waitPhone}).
              </Text>
              {network === 'mutinynet' ? (
                <Text color='neutral-600' tiny wrap>
                  Testnet waits are short on purpose. They start when recovery confirms.
                </Text>
              ) : null}
              {!addressCovered && status?.enrolled ? (
                <Text color='neutral-600' tiny wrap>
                  Receive isn’t ready yet. Try again after setup finishes.
                </Text>
              ) : null}
            </Section>

            <PolicyTimeline
              txCap={status?.txCap || setup.txCapSats}
              dailyLimit={status?.periodAllowance || setup.dailyLimitSats}
              operationalBlocks={status?.operationalCsvBlocks || setup.operationalCsvBlocks}
              savingsBlocks={status?.savingsCsvBlocks || setup.savingsCsvBlocks}
              network={network}
            />
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
