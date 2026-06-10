import type { CodegenConfig } from '@graphql-codegen/cli';

// Generates a type-safe `graphql()` against the API's SDL. We use the
// "string" document mode so documents work with our fetch-based client.
// Regenerate after schema or operation changes: `npm run codegen`
// (refresh the schema first with `npm run codegen:schema`).
const config: CodegenConfig = {
  documents: ['src/**/*.{ts,tsx}', '!src/lib/gql/**'],
  generates: {
    './src/lib/gql/': {
      config: {
        documentMode: 'string',
        // Keep generated types structurally compatible with our hand types.
        enumsAsTypes: true,
        scalars: { DateTime: 'string', UUID: 'string' },
      },
      preset: 'client',
    },
  },
  ignoreNoDocuments: true,
  schema: '../api/schema.graphql',
};

export default config;
