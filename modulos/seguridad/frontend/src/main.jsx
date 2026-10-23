// Punto de entrada del frontend de Seguridad y Acceso — FASE 3.1.
//
// REGLA 1: este módulo es autónomo. No importa nada de ERP-R-DE-RICO/apps/ ni
// de otro módulo del ERP COMBINADO. Solo React y sus propios archivos.

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const contenedor = document.getElementById('root');

if (!contenedor) {
  throw new Error('No se encontró el nodo #root en index.html.');
}

createRoot(contenedor).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
