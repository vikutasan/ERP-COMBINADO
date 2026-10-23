"""Los 27 contratos entre módulos — FASE 2 (Frontera) + FASE 3.2 (Atómico) + FASE 7.0 (IA) + FASE 8.0 (CRM).

Este paquete es la FRONTERA del POS. Define, con tipos, cómo el POS habla con
los demás módulos. Regla de Oro #5: el POS no lee ni escribe tablas ajenas;
pide por operación.

Los 3 principios (Documento 9 §0):

  P-01  El dueño de la tabla es el único que la escribe.
  P-02  El consumidor pide por operación, no por tabla.
  P-03  El contrato es estable; la tabla es libre.

Cada contrato declara su firma (entrada/salida) y NUNCA expone una tabla:
todos exponen una operación. El test de arquitectura
(`tests/test_f2_frontera.py`) verifica que el POS no importe modelos ajenos.
"""

from __future__ import annotations

from .registry import CONTRATOS, Contrato, listar_contratos

__all__ = ["CONTRATOS", "Contrato", "listar_contratos"]
