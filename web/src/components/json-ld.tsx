/** Emits a `<script type="application/ld+json">` tag for structured data.
 *  Server- and client-safe: it renders into the initial SSR HTML so crawlers
 *  that don't execute JS still read it. Pass a single schema.org object or an
 *  array of them. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // The payload is built from trusted, static app data — not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
