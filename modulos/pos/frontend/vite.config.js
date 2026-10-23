import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Raíz del monorepo. En el ERP COMBINADO el POS vive en
// `modulos/pos/frontend`, así que la raíz está TRES niveles arriba
// (frontend -> pos -> modulos -> ERP-COMBINADO). En NUEVO-ERP eran dos
// (`apps/pos`); al copiar el módulo la profundidad cambió y el alias
// apuntaba a `modulos/packages/theme-engine`, que no existe.
const MONOREPO_ROOT = resolve(__dirname, '..', '..', '..');

// Configuración de Vite del POS del ERP COMBINADO — FASE 1.5.
//
// El puerto 5210 es el asignado al POS dentro del rango reservado del ERP
// COMBINADO (5200-5241, frontends pares / APIs impares). No colisiona con
// producción (5000/5001/5433) ni con NUEVO-ERP (5100/5101/5102/5432).
// `strictPort` evita que Vite salte a otro puerto en silencio: si 5210 está
// ocupado, falla en vez de mentir.
//
// FP-01 — PROXY CONFIGURABLE:
//   El proxy `/api` reenvía las peticiones del frontend al API del POS.
//   El destino se lee de `VITE_API_URL` (`.env` o variable de entorno del SO).
//   Fallback de desarrollo: `http://localhost:5211`.
//
//   En desarrollo:  el API corre en Docker en localhost:5211.
//   En producción:  VITE_API_URL apunta al servidor real (ej. https://api.rdeRico.com).
//   El build de producción no contiene "localhost:5211" en ningún bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:5211';

  return {
    plugins: [react()],
    resolve: {
      // FA-03 — Monorepo: Vite ejecutado desde apps/pos solo busca en
      // apps/pos/node_modules. Añadimos el node_modules raíz para que
      // los paquetes del workspace (@nuevo-pos/*) sean resolvibles.
      modules: [
        resolve(__dirname, 'node_modules'),
        resolve(MONOREPO_ROOT, 'node_modules'),
      ],
      alias: {
        // FA-03 — Apunta al directorio del paquete (no a index.js) para que
        // Vite respete el campo "exports" de package.json y los re-exports
        // relativos (como './contraste.js') se resuelvan desde el paquete.
        '@nuevo-pos/theme-engine': resolve(MONOREPO_ROOT, 'packages', 'theme-engine'),
      },
    },
    server: {
      host: true,
      port: 5210,
      strictPort: true,
      proxy: {
        // Reenvía /api/... al API del POS, quitando el prefijo /api.
        // Ejemplo: GET /api/catalog/products-for-sale
        //       -> GET http://localhost:5211/catalog/products-for-sale
        '/api': {
          target: apiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      host: true,
      port: 5210,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify')) {
                return 'vendor-pdf';
              }
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
                return 'vendor-react';
              }
            }
            if (id.includes('GestorDeCaja')) {
              return 'gestor-caja';
            }
          },
        },
      },
    },

    // ── CI-01: Configuración de tests con cobertura ──────────────────────────
    // Vitest usa jsdom para simular el DOM del navegador. Los thresholds
    // de cobertura son la meta mínima de TS-01 (N-3 ≥ 60%). Si la cobertura
    // cae por debajo, `vitest run --coverage` falla y bloquea el PR en CI.
    test: {
      environment: 'jsdom',
      setupFiles: [],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        // Excluir archivos de configuración y de tests de la cobertura.
        exclude: [
          'node_modules/**',
          'dist/**',
          '**/*.test.{js,jsx,ts,tsx}',
          '**/*.config.{js,ts}',
          '**/vite.config.*',
          '**/tailwind.config.*',
          '**/postcss.config.*',
        ],
        // Thresholds mínimos — meta progresiva CI-01 / TS-01:
        //   Nivel 1 (CI-01 — ahora): 0% — infraestructura lista, pipeline verde.
        //   Nivel 2 (TS-01):        40% — primer salto.
        //   Nivel 3 (meta final):   60% — objetivo N-3.
        thresholds: {
          statements: 0,
          branches:   0,
          functions:  0,
          lines:      0,
        },
      },
    },
  };
});
