import path from 'path';
import { defineConfig, ViteUserConfig } from 'vitest/config';
import tsconfig from './tsconfig.json';

// Create an alias object from the paths in tsconfig.json
const pathAlias = Object.fromEntries(
  // For Each Path in tsconfig.json
  Object.entries(tsconfig.compilerOptions.paths).map(([key, [value]]) => [
    // Remove the "/*" from the key and resolve the path
    key.replace('/*', ''),
    // Remove the "/*" from the value Resolve the relative path
    path.resolve(__dirname, value.replace('/*', '')),
  ])
);

const reporters: Exclude<ViteUserConfig['test'], undefined>['reporters'] = ['default', 'html'];

if (process.env.GITHUB_ACTIONS) {
  reporters.push('github-actions');
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          setupFiles: ['./tests/configurations/vite.setup.ts'],
          include: ['tests/unit/**/*.spec.ts'],
          environment: 'node',
        },
        resolve: {
          alias: pathAlias,
        },
      },
      {
        test: {
          name: 'integration',
          setupFiles: ['./tests/configurations/vite.setup.ts'],
          include: ['tests/integration/**/*.spec.ts'],
          environment: 'node',
        },
        resolve: {
          alias: pathAlias,
        },
      },
    ],
    reporters,
    coverage: {
      enabled: true,
      reporter: ['text', 'html', 'json', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/vendor/**',
        'node_modules/**',
        // type-only files: no runtime code, can never show anything but 0%
        'src/common/interfaces.ts',
        'src/common/types.ts',
        'src/commands/common/types.ts',
        // bootstrap/composition-root: validated by running the CLI, not unit tests
        'src/index.ts',
        'src/cli.ts',
        'src/cliBuilderFactory.ts',
        'src/containerConfig.ts',
        'src/common/dependencyRegistration.ts',
        'src/common/config.ts',
        'src/common/tracing.ts',
        // thin DI factories: a few lines of container.resolve() calls, covered indirectly via the command factory tests
        'src/commands/create/createManagerFactory.ts',
        'src/commands/pgDump/pgDumpManagerFactory.ts',
        // error class boilerplate: constructors only, no branching logic
        'src/common/errors.ts',
      ],
      reportOnFailure: true,
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
