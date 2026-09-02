import type { ReactNode } from 'react'
import ButtonsOnBottom from '../../../components/ButtonsOnBottom'
import Content from '../Content'
import ErrorMessage from '../../../components/Error'
import FlexCol from '../../../components/FlexCol'
import Header from '../Header'
import Padded from '../../../components/Padded'
import Text from '../../../components/Text'
import { StepRail } from '../ui'

export function OnboardLayout({
  title,
  step,
  total = 6,
  error,
  onBack,
  children,
  actions,
}: {
  title: string
  step: number
  total?: number
  error?: string
  onBack?: () => void
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <>
      <Header text={title} back={onBack} />
      <Content noRefresh className='vault-onboard-content'>
        <Padded>
          <FlexCol gap='1.15rem' className='vault-onboard-flow'>
            <StepRail step={step} total={total} />
            <p className='vault-step-label' aria-live='polite'>
              <span>
                Step {step} of {total}
              </span>
            </p>
            {children}
            <ErrorMessage error={Boolean(error)} text={error || ''} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>{actions}</ButtonsOnBottom>
    </>
  )
}

export function ChoiceCard({
  title,
  detail,
  selected,
  onClick,
  testId,
}: {
  title: string
  detail: string
  selected: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className={selected ? 'vault-panel selected' : 'vault-panel'}
    >
      <Text bold small>
        {title}
      </Text>
      <Text color='neutral-600' tiny wrap>
        {detail}
      </Text>
    </button>
  )
}
