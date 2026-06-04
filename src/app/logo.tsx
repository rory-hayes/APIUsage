export function Logo({ className, ...props }: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg fill="none" viewBox="0 0 228 32" {...props} className={className} aria-label="Usage Revenue Integrity OS">
      <rect width="32" height="32" rx="8" className="fill-zinc-950 dark:fill-white" />
      <path
        d="M9 11.25h14M9 16h10M9 20.75h14"
        className="stroke-white dark:stroke-zinc-950"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text
        x="44"
        y="21"
        className="fill-zinc-950 text-[16px] font-semibold dark:fill-white"
        fontFamily="Inter, sans-serif"
      >
        Revenue Integrity OS
      </text>
    </svg>
  )
}
