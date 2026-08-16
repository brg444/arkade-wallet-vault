import { useContext } from 'react'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { fingerprint } from '../../lib/vault/hex'
import { VaultContext } from '../../providers/vault'

function Role({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <FlexCol gap='0.15rem'>
      <Text bold small>
        {name}
      </Text>
      <Text tiny wrap>
        {value ? fingerprint(value, 6) : '—'}
      </Text>
      <Text color='neutral-600' tiny wrap>
        {note}
      </Text>
    </FlexCol>
  )
}

export default function VaultRoles() {
  const { descriptor, descriptorHash, navigate, status } = useContext(VaultContext)
  const keys = descriptor?.keys

  return (
    <>
      <Header text='Roles' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text color='neutral-600' tiny wrap>
              These are public identities. PhoneRoutine is software in the phone, not an attested hardware Bitcoin key.
            </Text>
            <Role
              name='PhoneDirectP256'
              value={keys?.phoneDirectP256 || status?.phoneDirectP256 || ''}
              note='PRF-derived. Signs the Arkade digest.'
            />
            <Role
              name='PhoneRoutineBIP340'
              value={keys?.phoneRoutineBip340 || status?.phoneRoutineBip340Pub || ''}
              note='Mandatory routine Bitcoin signature.'
            />
            <Role
              name='ExternalOwnerWallet'
              value={keys?.externalOwnerWallet || status?.externalOwnerWalletPub || ''}
              note='Admin / sweep only. Never used by routine UI.'
            />
            <Role
              name='RecoveryKey'
              value={keys?.recoveryKey || status?.recoveryKeyPub || ''}
              note='Admin cosigner and delayed recovery.'
            />
            <Role
              name='VaultCosigner'
              value={keys?.tweakedVaultCosigner || status?.tweakedVaultCosignerXOnly || ''}
              note='Tweaked authorizer key shown as the committed x-only identity.'
            />
            <Role
              name='ArkadeCosigner'
              value={keys?.tweakedArkadeCosigner || status?.tweakedArkadeCosignerXOnly || ''}
              note='Tweaked public emulator key.'
            />
            <Text tiny wrap>
              Descriptor hash {descriptorHash || 'unavailable until a full descriptor is imported'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
