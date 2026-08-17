import { useContext } from 'react'
import Button from '../../components/Button'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import FingerprintIcon from '../../icons/Fingerprint'
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
      <Header text='Keys' back={() => navigate('home')} />
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
                label={busy ? 'Enabling…' : 'Allow other devices'}
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
              role={setup.hardwareIsDemo ? 'Demo key' : 'With this device, moves everything'}
              fingerprint={setup.hardwarePub || status?.externalOwnerWalletPub}
            />
            <KeyCard icon={<ServerIcon />} title='Vault service' role='Daily only. Cannot spend Savings.' />

            <Text color='neutral-600' tiny>
              If you lose…
            </Text>
            <KeyCard
              title='This device'
              role={`Other device + Face ID, or hardware after 144 blocks (${waitSavings}).`}
            />
            <KeyCard title='Hardware' role={`This device after 6 blocks (${waitPhone}).`} />
            <KeyCard
              title='Savings'
              role='This device cannot spend it alone. Device + hardware now, or one key after the delay.'
            />
            {network === 'mutinynet' ? (
              <Text color='neutral-600' tiny wrap>
                On Mutinynet a stolen device with the passkey can wait 6 blocks and sweep Savings. Hardware has to move
                first. Those delays are a demo clock, not months.
              </Text>
            ) : null}
            {!addressCovered && status?.enrolled ? (
              <Text color='neutral-600' tiny wrap>
                Receive is off until this vault’s addresses are pinned.
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
