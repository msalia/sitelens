/** Right-aligned "Optional" marker for a field label — drop inside a shadcn
 *  `FieldLabel` (which is a flex row) so it sits flush right. */
export function OptionalBadge() {
  return <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>;
}
