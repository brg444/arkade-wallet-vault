import type { ReactNode } from 'react'
import ButtonsOnBottom from '../../../components/ButtonsOnBottom'
import Content from '../../../components/Content'
import ErrorMessage from '../../../components/Error'
import FlexCol from '../../../components/FlexCol'
import Header from '../../../components/Header'
import Padded from '../../../components/Padded'
import Text from '../../../components/Text'
import { StepRail } from '../ui'

const STEP_LABELS = ['How it works', 'Hardware', 'Recovery', 'Limits', 'Review', 'This device']

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
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <StepRail step={step} total={total} />
            <Text color='neutral-600' tiny>
              {STEP_LABELS[step - 1] || `Step ${step}`} · {step} of {total}
            </Text>
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
