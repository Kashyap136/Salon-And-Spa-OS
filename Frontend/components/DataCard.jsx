/**
 * Narrow-width presentation for tabular data.
 *
 * The list tables (bookings, invoices, services, staff, packages, offers,
 * memberships, products) are 640-880px wide. Below 640px they can only be
 * shown inside a horizontal scroller, which means 2x scrolling at 320px and
 * 6-8x at 132px — technically overflow-free, practically unusable. So each
 * table is paired with a card list that takes over below Tailwind's `sm`
 * breakpoint, and the table is kept intact for tablet and desktop.
 *
 * `Row` is the label/value pair used inside a card. It sits side by side while
 * there is room and stacks the value under its label below 220px, where a
 * label and a value can no longer share a line.
 */
export function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0 max-tiny:flex-col max-tiny:items-start max-tiny:gap-0">
      <dt className="text-xs text-ledger-creamDim shrink-0">{label}</dt>
      <dd className="text-sm min-w-0 text-right break-words max-tiny:text-left">{children}</dd>
    </div>
  );
}

/** The card list itself — hidden from 640px up, where the table takes over. */
export function CardList({ children, className = "" }) {
  return <ul className={`sm:hidden space-y-2 min-w-0 ${className}`}>{children}</ul>;
}

export function CardItem({ children, className = "" }) {
  return <li className={`ledger-panel panel-pad min-w-0 ${className}`}>{children}</li>;
}
