import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SidebarLayout } from './sidebar-layout'

describe('SidebarLayout', () => {
  it('uses a compact desktop sidebar and full-width content work surface', () => {
    const markup = renderToStaticMarkup(
      <SidebarLayout navbar={<span>Navbar</span>} sidebar={<span>Sidebar</span>}>
        <span>Content</span>
      </SidebarLayout>,
    )

    expect(markup).toContain('w-60')
    expect(markup).toContain('lg:pl-60')
    expect(markup).toContain('p-3 xl:p-4')
    expect(markup).toContain('overflow-x-hidden')
    expect(markup).toContain('min-h-full w-full max-w-none')
  })
})
