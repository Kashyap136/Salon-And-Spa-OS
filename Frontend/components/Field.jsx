/**
 * Shared form primitives.
 *
 * Every page carried its own byte-identical copy of `FieldLabel` / `Input`
 * (seven duplicates). Centralising them also centralises the responsive
 * behaviour: `.field-label` steps its type down inside the ultra-narrow band
 * and breaks long labels at word boundaries instead of letting them overflow,
 * and `.field` guarantees the control can never be pushed wider than its
 * column by an intrinsic width (native date inputs were the worst offender).
 */
export function FieldLabel({ children, className = "" }) {
  return <span className={`field-label ${className}`}>{children}</span>;
}

/** A visible-label text input. Label sits above the control, always. */
export function Input({ label, value, onChange, className = "", ...rest }) {
  return (
    <label className="field">
      <FieldLabel>{label}</FieldLabel>
      <input
        className={`w-full ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </label>
  );
}

/** A visible-label native date/month/other picker. */
export function DateInput({ label, className = "", ...rest }) {
  return (
    <label className="field">
      <FieldLabel>{label}</FieldLabel>
      <input className={`w-full ${className}`} {...rest} />
    </label>
  );
}

/** A visible-label `<select>`. `options` is a list of {value, label}. */
export function Select({ label, options, className = "", ...rest }) {
  return (
    <label className="field">
      <FieldLabel>{label}</FieldLabel>
      <select className={`w-full ${className}`} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className={o.className}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
