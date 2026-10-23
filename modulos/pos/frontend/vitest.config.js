import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vitest para el frontend del POS.
 *
 * CI-01: Ampliada con configuración de cobertura (provider v8) y thresholds
 * mínimos progresivos. Los thresholds subirán gradualmente conforme avance TS-01.
 *
 * NOTA: el alias @nuevo-pos/theme-engine NO se repite aquí — lo maneja
 * vite.config.js. Duplicarlo causaba ERR_MODULE_NOT_FOUND al resolver jsdom
 * cuando Vitest se invocaba fuera del directorio apps/pos.
 *
 * Referencia: PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.0
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Solo archivos JSX/TSX — los .test.js los corre el runner raíz (scripts/test.mjs).
    // Ampliar a .js causaba ERR_MODULE_NOT_FOUND de jsdom desde node_modules raíz.
    include: ['src/**/*.test.{jsx,tsx}'],
    exclude: ['node_modules', 'dist'],
    passWithNoTests: true,
    // Timeout global para tests que simulan delays (modales con setTimeout 1200ms).
    testTimeout: 10000,

    // ── CI-01: Cobertura con v8 ──────────────────────────────────────────────
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**', 'dist/**', 'coverage/**',
        '**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}',
        '**/vite.config.*', '**/vitest.config.*',
        '**/tailwind.config.*', '**/postcss.config.*',
        '**/test-utils/**', '**/__mocks__/**',
      ],
      // Thresholds progresivos: 0% (CI-01) → 40% (TS-01) → 60% (meta final).
      thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 },
    },
  },
});
