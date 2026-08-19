import { describe, expect, it } from 'vitest'
import { V5_SCHEMA, V5_TEMPLATE } from './constants'
import { V5_FIXTURE } from './fixtures'
import { previewV5Descriptor } from './preview'

describe('preview family', () => {
  it('builds a local kit from setup keys and fixture cosigners', () => {
    const d = previewV5Descriptor({
      hardwarePub: V5_FIXTURE.hardwarePub,
      recoveryPub: V5_FIXTURE.recoveryPub,
    })
    expect(d.schema).toBe(V5_SCHEMA)
    expect(d.templateVersion).toBe(V5_TEMPLATE)
    expect(d.arkadeCosigner.origin).toBe('preview')
    expect(d.keys.hardware).toBe(V5_FIXTURE.hardwarePub)
    expect(d.keys.recovery).toBe(V5_FIXTURE.recoveryPub)
    expect(d.daily.address.startsWith('tb1p') || d.daily.address.startsWith('bcrt1')).toBe(true)
  })
})
