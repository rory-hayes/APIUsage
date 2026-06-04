import { describe, expect, it } from 'vitest'

import { dashboardLayout } from './dashboard-layout'

describe('dashboardLayout', () => {
  it('keeps the overview dashboard on a full-width work surface', () => {
    expect(dashboardLayout.page).toContain('w-full')
    expect(dashboardLayout.page).toContain('max-w-none')
    expect(dashboardLayout.page).toContain('min-h-[calc(100svh-2rem)]')
    expect(dashboardLayout.page).toContain('overflow-x-hidden')
    expect(dashboardLayout.page).toContain('grid')
    expect(dashboardLayout.page).toContain('grid-rows-[auto_auto_auto_1fr]')
    expect(dashboardLayout.page).toContain('gap-3')
  })

  it('uses compact desktop grids so the first viewport shows the cockpit, not a card feed', () => {
    expect(dashboardLayout.header).toContain('min-w-0')
    expect(dashboardLayout.header).toContain('gap-2')
    expect(dashboardLayout.headerActions).toContain('min-w-0')
    expect(dashboardLayout.headerActions).toContain('overflow-x-auto')
    expect(dashboardLayout.kpiGrid).toContain('min-w-0')
    expect(dashboardLayout.kpiGrid).toContain('lg:grid-cols-3')
    expect(dashboardLayout.kpiGrid).toContain('xl:grid-cols-5')
    expect(dashboardLayout.kpiGrid).not.toContain('mt-')
    expect(dashboardLayout.primaryGrid).toContain('min-w-0')
    expect(dashboardLayout.primaryGrid).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(15.5rem,0.44fr)]')
    expect(dashboardLayout.primaryGrid).toContain('xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.9fr)_minmax(16rem,0.48fr)]')
    expect(dashboardLayout.primaryGrid).toContain('2xl:grid-cols-[minmax(0,1.6fr)_minmax(23rem,0.88fr)_minmax(16rem,0.42fr)]')
    expect(dashboardLayout.primaryGrid).not.toContain('mt-')
    expect(dashboardLayout.trendPanel).toContain('lg:row-span-2')
    expect(dashboardLayout.trendPanel).toContain('xl:row-span-1')
    expect(dashboardLayout.leakageTypeRow).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(dashboardLayout.secondaryGrid).toContain('min-w-0')
    expect(dashboardLayout.secondaryGrid).toContain('items-start')
    expect(dashboardLayout.secondaryGrid).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.28fr)]')
    expect(dashboardLayout.secondaryGrid).not.toContain('mt-')
    expect(dashboardLayout.panel).toContain('min-w-0')
  })
})
