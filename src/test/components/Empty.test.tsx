import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyLogsList } from '../../components/Empty'

describe('Empty component', () => {
  it('renders EmptyLogsList with the correct message', () => {
    render(<EmptyLogsList />)
    expect(screen.getByText('No logs available')).toBeInTheDocument()
    expect(screen.getByText('Start using the app to generate logs.')).toBeInTheDocument()
  })
})
