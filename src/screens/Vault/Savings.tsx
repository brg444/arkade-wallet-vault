import { useContext } from 'react'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { delayLabel } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { Detail, Pill, PolicyTimeline, SignerRow } from './ui'

export default function VaultSavings() {
  const { liveNetwork, navigate, savingsAddress, setup, status } = useContext(VaultContext)
  const network = status?.network || (liveNetwork ? 'mutinynet' : undefined)
  return (
    <>
      <Header text='Savings' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Pill>Locked</Pill>
              <Pill>Not the phone path</Pill>
            </div>
            <Text wrap>
              Savings cannot be spent with the passkey on this phone. Moving this bitcoin later needs hardware plus
              recovery, or recovery alone after a delay.
            </Text>
            <SignerRow title='This phone' detail='Cannot spend savings' state='unused' />
            <SignerRow title='Hardware + recovery' detail='Can sweep anytime' state='auto' />
            <SignerRow
              title='Recovery alone'
              detail={`After ${delayLabel(status?.savingsCsvBlocks || setup.savingsCsvBlocks, network)}`}
              state='auto'
            />
            {savingsAddress ? <QrCode value={savingsAddress} /> : null}
            <Detail label='Savings address' value={savingsAddress || 'No savings address yet.'} mono />
            <PolicyTimeline
              txCap={status?.txCap || setup.txCapSats}
              dailyLimit={status?.periodAllowance || setup.dailyLimitSats}
              operationalBlocks={status?.operationalCsvBlocks || setup.operationalCsvBlocks}
              savingsBlocks={status?.savingsCsvBlocks || setup.savingsCsvBlocks}
              network={network}
            />
            <Text color='neutral-600' tiny wrap>
              Do not fund this address from the faucet if you want to try a phone spend. Use Receive on the spending
              vault instead.
            </Text>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
