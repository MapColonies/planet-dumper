import tsBaseConfig from '@map-colonies/eslint-config/ts-base';
import { defineConfig } from 'eslint/config';

export default defineConfig(tsBaseConfig, { ignores: ['dist', 'helm', 'helm-umbrella', 'vitest.config.mts', 'html', 'coverage'] });
