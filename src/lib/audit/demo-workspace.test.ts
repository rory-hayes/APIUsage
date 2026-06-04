import { describe, expect, it } from 'vitest'

import { statusColor } from './demo-workspace'

describe('audit demo workspace display helpers', () => {
  it('treats reviewed customer-visible finding statuses as positive', () => {
    expect(statusColor('approved_internal')).toBe('green')
    expect(statusColor('published')).toBe('green')
    expect(statusColor('accepted')).toBe('green')
    expect(statusColor('fixed')).toBe('green')
  })

  it('colors open issue tracking states by urgency', () => {
    expect(statusColor('open')).toBe('amber')
    expect(statusColor('investigating')).toBe('amber')
    expect(statusColor('monitoring')).toBe('blue')
    expect(statusColor('ignored')).toBe('zinc')
  })

  it('colors intake progress states distinctly', () => {
    expect(statusColor('in_progress')).toBe('amber')
    expect(statusColor('not_started')).toBe('zinc')
  })
})
