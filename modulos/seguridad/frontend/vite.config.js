import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración de Vite de Seguridad y Acceso — FASE 3.1.
//
// El puerto 5228 es el asignado a este módulo dentro del rango reservado del
// ERP COMBINADO (5200-5241, frontends pares / APIs impares). No colisiona con
// producción (5000/5001/5433), con NUEVO-ERP (5100/5101/5102/5432) ni con el
// POS del ERP COMBINADO (5210/5211/5440).
//
// `strictPort` evita que Vite salte a otro puerto en silencio: si 5228 está
// ocupado, falla en vez de mentir. Ese salto silencioso es exactamente lo que
// hace imposible diagnosticar un módulo que "no carga".
//
// PROXY `/api`:
//   Reenvía las peticiones del frontend al API de Seguridad (5229) quitando el
//   prefijo `/api`. Ejemplo:
//     GET /api/security/employees/<uuid>
//       -> GET http://localhost:5229/security/employees/<uuid>
//   El destino se lee de `VITE_API_URL`; el fallback de desarrollo es
//   `http://localhost:5229`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:5229';

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5228,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      host: true,
      port: 5228,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 600,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}'],
    },
  };
});
