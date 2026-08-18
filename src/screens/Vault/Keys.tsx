import { useContext } from 'react'
import Button from '../../components/Button'
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
import { KeyCard, PolicyTimeline } from './ui'

export default function VaultKeys() {
  const { busy, enablePasskeyLogin, hasLocalEnrollment, liveNetwork, navigate, operationalAddress, setup, status } =
    useContext(VaultContext)
  const network = status?.network || (liveNetwork ? 'mutinynet' : undefined)
  const waitPhone = waitLabel(status?.operationalCsvBlocks || setup.operationalCsvBlocks, network)
  const waitSavings = waitLabel(status?.savingsCsvBlocks || setup.savingsCsvBlocks, network)
  const phoneCovered = Boolean(status?.enrolled)
  const devicesCovered = Boolean(status?.passkeyLoginAvailable)
  const addressCovered = Boolean(operationalAddress)

  return (
    <>
      <Header text='Security' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
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
            {hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable ? (
              <Button
                onClick={() => void enablePasskeyLogin()}
                disabled={busy}
                label={busy ? 'Enabling…' : 'Use on another phone'}
              />
            ) : null}
            {hasLocalEnrollment && status?.passkeyLoginAvailable ? (
              <Text color='neutral-600' tiny wrap>
                Another device can sign in and scan the QR from here. Don’t create a new passkey.
              </Text>
            ) : null}
            <KeyCard
              icon={<ShieldCheckOutlineIcon />}
              title='Hardware'
              role={setup.hardwareIsDemo ? 'Demo key' : 'This phone + hardware moves everything'}
              fingerprint={setup.hardwarePub || status?.externalOwnerWalletPub}
            />
            {setup.recoveryPub || status?.recoveryPub ? (
              <KeyCard
                icon={<SafeIcon />}
                title='Recovery'
                role={setup.recoveryIsDemo ? 'Demo recovery key' : 'Starts a waiting period you can cancel'}
                fingerprint={setup.recoveryPub || status?.recoveryPub}
              />
            ) : (
              <KeyCard icon={<SafeIcon />} title='Recovery' role='Not added. This vault is this phone plus hardware.' />
            )}
            <KeyCard icon={<ServerIcon />} title='Vault service' role='Helps with daily spend. Can’t move Savings.' />

            <Text color='neutral-600' tiny>
              If you lose one
            </Text>
            <KeyCard
              title='This phone'
              role={`Sign in on another phone, or start recovery with hardware (${waitSavings}).`}
            />
            <KeyCard title='Hardware' role={`Start recovery from this phone (${waitPhone}).`} />
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
