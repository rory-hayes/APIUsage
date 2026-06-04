import type React from 'react'

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-[#eef3f8] p-3 text-slate-950">
      <div className="grid grow overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/70 lg:grid-cols-[minmax(0,0.92fr)_minmax(26rem,0.55fr)]">
        <section className="hidden min-h-[42rem] bg-[#071827] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-xs/5 font-semibold text-slate-200">
              Revenue Integrity OS
            </div>
            <div className="mt-10 max-w-xl">
              <h1 className="text-4xl/10 font-semibold tracking-normal">Usage revenue audits with control-room clarity.</h1>
              <p className="mt-4 text-base/7 font-medium text-slate-300">
                Invite-only workspaces for teams reconciling usage, billing, contracts, and AI/API margin leakage.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm/6">
            <div className="rounded-xl border border-white/10 bg-white/[0.08] p-4">
              <div className="text-2xl/7 font-semibold">Usage</div>
              <div className="mt-1 text-xs/5 text-slate-400">metering evidence</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.08] p-4">
              <div className="text-2xl/7 font-semibold">Billing</div>
              <div className="mt-1 text-xs/5 text-slate-400">invoice coverage</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.08] p-4">
              <div className="text-2xl/7 font-semibold">Close</div>
              <div className="mt-1 text-xs/5 text-slate-400">audit readiness</div>
            </div>
          </div>
        </section>
        <section className="flex min-h-[calc(100dvh-1.5rem)] items-center justify-center px-6 py-10 lg:min-h-0 lg:px-12">
          {children}
        </section>
      </div>
    </main>
  )
}
