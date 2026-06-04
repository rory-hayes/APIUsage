import { requireInternalAdmin } from '@/lib/auth/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireInternalAdmin()

  return children
}
