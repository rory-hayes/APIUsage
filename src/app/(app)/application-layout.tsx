'use client'

import { Avatar } from '@/components/avatar'
import type { AuditWorkspace } from '@/lib/audit/workspaces'
import type { Session } from '@/lib/auth/access'
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from '@/components/dropdown'
import { Navbar, NavbarItem, NavbarSection, NavbarSpacer } from '@/components/navbar'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
  SidebarSpacer,
} from '@/components/sidebar'
import { SidebarLayout } from '@/components/sidebar-layout'
import {
  ArrowRightStartOnRectangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog8ToothIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@heroicons/react/16/solid'
import {
  ArrowPathIcon,
  ChartBarSquareIcon,
  ClipboardDocumentCheckIcon,
  CloudArrowUpIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  HomeIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon as ShieldCheckIcon20,
  UserGroupIcon,
} from '@heroicons/react/20/solid'
import { usePathname } from 'next/navigation'

function AccountDropdownMenu({ anchor }: { anchor: 'top start' | 'bottom end' }) {
  return (
    <DropdownMenu className="min-w-64" anchor={anchor}>
      <DropdownItem href="#">
        <UserCircleIcon />
        <DropdownLabel>My account</DropdownLabel>
      </DropdownItem>
      <DropdownItem href="/settings/security">
        <ShieldCheckIcon />
        <DropdownLabel>Security</DropdownLabel>
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem href="/logout">
        <ArrowRightStartOnRectangleIcon />
        <DropdownLabel>Sign out</DropdownLabel>
      </DropdownItem>
    </DropdownMenu>
  )
}

function WorkspaceMark({ initials, color = 'bg-blue-600' }: { initials: string; color?: string }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-md text-xs/6 font-semibold text-white ${color}`}
    >
      {initials}
    </span>
  )
}

export function ApplicationLayout({
  children,
  session,
  workspaces,
  currentWorkspace,
}: {
  children: React.ReactNode
  session: Session
  workspaces: AuditWorkspace[]
  currentWorkspace: AuditWorkspace | null
}) {
  const pathname = usePathname()
  const isInternalAdmin = session.role === 'internal_admin'
  const currentWorkspaceName = currentWorkspace?.organizationName ?? session.organizationName
  const currentWorkspaceInitials = toInitials(currentWorkspaceName)
  const initials = session.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const roleLabel = session.role.replaceAll('_', ' ')

  return (
    <SidebarLayout
      navbar={
        <Navbar>
          <NavbarSpacer />
          <NavbarSection>
            <Dropdown>
              <DropdownButton as={NavbarItem}>
                <Avatar initials={initials} square className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" />
              </DropdownButton>
              <AccountDropdownMenu anchor="bottom end" />
            </Dropdown>
          </NavbarSection>
        </Navbar>
      }
      sidebar={
        <Sidebar>
          <SidebarHeader>
            <Dropdown>
              <DropdownButton as={SidebarItem}>
                <WorkspaceMark initials={currentWorkspaceInitials} />
                <SidebarLabel>{currentWorkspaceName}</SidebarLabel>
                <ChevronDownIcon />
              </DropdownButton>
              <DropdownMenu className="min-w-80 lg:min-w-64" anchor="bottom start">
                <DropdownItem href="/settings">
                  <Cog8ToothIcon />
                  <DropdownLabel>Workspace settings</DropdownLabel>
                </DropdownItem>
                <DropdownDivider />
                {workspaces.map((workspace) => (
                  <DropdownItem href={workspaceSelectHref(workspace.id, pathname)} key={workspace.id}>
                    <WorkspaceMark initials={toInitials(workspace.organizationName)} />
                    <DropdownLabel>{workspace.organizationName}</DropdownLabel>
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
          </SidebarHeader>

          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/" current={pathname === '/'}>
                <HomeIcon />
                <SidebarLabel>Overview</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/workspaces" current={pathname.startsWith('/workspaces')}>
                <FolderOpenIcon />
                <SidebarLabel>Workspaces</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/intake" current={pathname.startsWith('/intake')}>
                <ClipboardDocumentCheckIcon />
                <SidebarLabel>Intake</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/uploads" current={pathname.startsWith('/uploads')}>
                <CloudArrowUpIcon />
                <SidebarLabel>Uploads</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/status" current={pathname.startsWith('/status')}>
                <ArrowPathIcon />
                <SidebarLabel>Status</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/findings" current={pathname.startsWith('/findings')}>
                <ExclamationTriangleIcon />
                <SidebarLabel>Findings</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/evidence-pack" current={pathname.startsWith('/evidence-pack')}>
                <DocumentTextIcon />
                <SidebarLabel>Evidence pack</SidebarLabel>
              </SidebarItem>
            </SidebarSection>

            {isInternalAdmin ? (
              <SidebarSection>
                <SidebarHeading>Internal</SidebarHeading>
                <SidebarItem href="/admin" current={pathname === '/admin'}>
                  <FolderOpenIcon />
                  <SidebarLabel>Review queue</SidebarLabel>
                </SidebarItem>
                <SidebarItem href="/admin/customers" current={pathname.startsWith('/admin/customers')}>
                  <UserGroupIcon />
                  <SidebarLabel>Customers</SidebarLabel>
                </SidebarItem>
                <SidebarItem href="/admin/workspaces" current={pathname.startsWith('/admin/workspaces')}>
                  <Cog6ToothIcon />
                  <SidebarLabel>Workspaces</SidebarLabel>
                </SidebarItem>
                <SidebarItem href="/admin/runs" current={pathname.startsWith('/admin/runs')}>
                  <ChartBarSquareIcon />
                  <SidebarLabel>Runs</SidebarLabel>
                </SidebarItem>
              </SidebarSection>
            ) : null}

            <SidebarSpacer />

            <SidebarSection>
              <SidebarItem href="/settings/team" current={pathname.startsWith('/settings/team')}>
                <UserGroupIcon />
                <SidebarLabel>Team</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="/settings/security" current={pathname.startsWith('/settings/security')}>
                <ShieldCheckIcon20 />
                <SidebarLabel>Security</SidebarLabel>
              </SidebarItem>
              <SidebarItem href="#">
                <QuestionMarkCircleIcon />
                <SidebarLabel>Support</SidebarLabel>
              </SidebarItem>
            </SidebarSection>
          </SidebarBody>

          <SidebarFooter className="max-lg:hidden">
            <Dropdown>
              <DropdownButton as={SidebarItem}>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar initials={initials} className="size-10 bg-blue-600 text-white" square />
                  <span className="min-w-0">
                    <span className="block truncate text-sm/5 font-medium text-white">{session.name}</span>
                    <span className="block truncate text-xs/5 font-normal text-sky-100/60">{roleLabel}</span>
                  </span>
                </span>
                <ChevronUpIcon />
              </DropdownButton>
              <AccountDropdownMenu anchor="top start" />
            </Dropdown>
          </SidebarFooter>
        </Sidebar>
      }
    >
      {children}
    </SidebarLayout>
  )
}

function toInitials(value: string): string {
  const initials = value
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return initials || 'WS'
}

function workspaceSelectHref(workspaceId: string, nextPath: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/select?next=${encodeURIComponent(nextPath || '/')}`
}
