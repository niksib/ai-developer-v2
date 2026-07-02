import { describe, it, expect } from 'vitest'
import { formatPrice } from '../formatPrice'

describe('formatPrice', () => {
  it('prefixes the amount with a dollar sign', () => {
    expect(formatPrice(500)).toMatch(/^\$/)
  })
})
