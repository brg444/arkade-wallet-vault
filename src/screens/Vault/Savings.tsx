import { useContext } from 'react'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { VaultContext } from '../../providers/vault'

export default function VaultSavings() {
  const { navigate, savingsAddress } = useContext(VaultContext)
  return (
    <>
      <Header text='Savings' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              Savings cannot be spent with the passkey on this phone. Moving this bitcoin later needs hardware plus
              recovery. Do not fund this address from the faucet if you want to try a phone spend.
            </Text>
            {savingsAddress ? <QrCode value={savingsAddress} /> : null}
            <Text small wrap>
              {savingsAddress || 'No savings address yet.'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
