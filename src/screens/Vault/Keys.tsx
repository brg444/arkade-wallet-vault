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
import { delayLabel } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { Detail, KeyCard, PolicyTimeline } from './ui'

export default function VaultKeys() {
  const { busy, enablePasskeyLogin, hasLocalEnrollment, liveNetwork, navigate, setup, status } =
    useContext(VaultContext)
  const network = status?.network || (liveNetwork ? 'mutinynet' : undefined)
  return (
    <>
      <Header text='Keys' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              Industry vaults treat keys as devices you can check, not hex strings you memorize. You hold hardware and
              recovery. This phone only spends the daily path.
            </Text>
            <KeyCard
              icon={<FingerprintIcon />}
              title='This phone'
              role={
                status?.passkeyLoginAvailable
                  ? 'Passkey sign-in enabled for other devices'
                  : status?.enrolled
                    ? 'Passkey enrolled on this origin'
                    : 'Preview — no passkey yet'
              }
              status={status?.enrolled ? 'Healthy' : 'Preview'}
            />
            {hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable ? (
              <Button
                onClick={() => void enablePasskeyLogin()}
                disabled={busy}
                label={busy ? 'Enabling…' : 'Enable sign-in on other devices'}
              />
            ) : null}
            <KeyCard
              icon={<ShieldCheckOutlineIcon />}
              title='Hardware'
              role={setup.hardwareIsDemo ? 'Demo key — not yours' : 'Required to sweep or change the vault'}
              fingerprint={setup.hardwarePub || status?.externalOwnerWalletPub}
              status={setup.hardwarePub ? 'Confirmed' : 'Missing'}
            />
            <KeyCard
              icon={<SafeIcon />}
              title='Recovery'
              role={`Delayed path after ${delayLabel(status?.operationalCsvBlocks || setup.operationalCsvBlocks, network)}`}
              fingerprint={setup.recoveryPub || status?.recoveryKeyPub}
              status={setup.recoveryPub ? 'Confirmed' : 'Missing'}
            />
            <KeyCard
              icon={<ServerIcon />}
              title='Vault service'
              role='Cosigns daily spends inside the limit. Cannot move savings or change the vault alone.'
              status='Cannot spend alone'
            />
            <PolicyTimeline
              txCap={status?.txCap || setup.txCapSats}
              dailyLimit={status?.periodAllowance || setup.dailyLimitSats}
              operationalBlocks={status?.operationalCsvBlocks || setup.operationalCsvBlocks}
              savingsBlocks={status?.savingsCsvBlocks || setup.savingsCsvBlocks}
              network={network}
            />
            {status?.clientOrigin ? <Detail label='Passkeys are bound to' value={status.clientOrigin} mono /> : null}
            <Text color='neutral-600' tiny wrap>
              A health check here means the public key is the one this vault expects. Signing still happens on the
              device that holds the private key.
            </Text>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
