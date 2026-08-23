import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import QrCode from './QrCode'

describe('QrCode', () => {
  it('uses CSS sizing without an invalid SVG height attribute', () => {
    const { container } = render(<QrCode value='bitcoin:tb1qexample?ark=tark1example' />)
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg?.hasAttribute('height')).toBe(false)
    expect(svg?.style.height).toBe('auto')
  })
})
