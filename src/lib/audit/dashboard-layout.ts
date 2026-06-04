export const dashboardLayout = {
  page: 'grid min-h-[calc(100svh-2rem)] w-full max-w-none grid-rows-[auto_auto_auto_1fr] gap-4 overflow-x-hidden bg-[#f4f7fb] text-slate-950',
  header:
    'grid min-w-0 gap-4 rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm shadow-slate-200/70 md:grid-cols-[minmax(0,1fr)_auto] md:items-start xl:px-5',
  headerActions:
    'flex max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-end md:overflow-visible md:pb-0 md:pt-0.5',
  kpiGrid: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
  primaryGrid:
    'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15.5rem,0.44fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.9fr)_minmax(16rem,0.48fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(23rem,0.88fr)_minmax(16rem,0.42fr)]',
  trendPanel: 'lg:row-span-2 xl:row-span-1',
  leakageTypeRow: 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs/5',
  secondaryGrid: 'grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.28fr)]',
  panel: 'min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70',
} as const
