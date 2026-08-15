/**
 * The spinner, for a control that is waiting on the network.
 *
 * Not for a screen that is loading. A screen gets a skeleton shaped like the
 * content, because a spinner on an empty page says only that something is
 * happening, while a skeleton says what is about to arrive.
 *
 * It is one of the two loops allowed in the system, and it stops the moment the
 * answer arrives.
 */
export function Spinner({ label }: { readonly label?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="neu-spin inline-block size-16 shrink-0 rounded-full border-2 border-current border-t-transparent"
    />
  );
}
