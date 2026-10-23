"""La superficie del POS nuevo — FASE 5 (Superficie).

La superficie es lo último porque depende de todo lo anterior: no se pinta una
pared antes del cimiento (Plan de Construcción §7.1).

Este paquete materializa los 3 entregables de F5 (Plan §7.2):

  - Las **24 interfaces** del Documento 7 (`ESPECIFICACION_DE_INTERFACES_POS.md`).
  - La **regla responsiva** del Documento 6 (`ESPECIFICACION_RESPONSIVA_Y_ERGONOMIA_TACTIL.md`):
    los 28 contenedores nacen fluidos, no de ancho fijo.
  - La **paleta canónica** (`#c1d72e`, `#0a0a0a`, `#fdfbf7`, `rounded-[35px]`).

La puerta de salida (Plan §7.3) exige:

  - [ ] Paridad funcional con el POS actual (los 6 flujos E.1 a E.6 replicados).
  - [ ] Ningún contenedor crítico tiene ancho fijo en píxeles.
  - [ ] La paleta canónica se respeta en las 24 interfaces.

El registro (`registry.py`) es la fuente única de verdad: el test de la puerta
F5 lo recorre y verifica los 3 criterios sobre datos, no sobre intención.

DEFECTO DEL PLANO (26 vs 24). El Documento 7 dice "26 interfaces" en su título,
en §0.3 y en §10, pero su contenido enumerado y trazable es de 24: §6 se titula
"Fichas — Composición (4)", §8 enumera 24 filas (01–24), hay 24 fichas, y el
README declara "7 + 6 + 5 + 4 + 2". El "26" es un error aritmético del plano.
Este paquete se ancla a las 24 interfaces documentadas; NO se inventan
interfaces para forzar el 26.
"""

from __future__ import annotations

from .registry import (
    CONTENEDORES_CRITICOS,
    FLUJOS,
    INTERFACES,
    MODOS,
    PALETA_CANONICA,
    PATRON_ANCHO_FIJO,
    RADIOS_CANONICOS,
    REGLAS_DURAS,
    Interfaz,
    conteo_por_tipo,
    interfaces_con_ancho_fijo,
    interfaces_que_no_declaran_los_3_modos,
    listar_interfaces,
    matriz_interfaz_tipo,
)

__all__ = [
    # Datos canónicos
    "MODOS",
    "PALETA_CANONICA",
    "RADIOS_CANONICOS",
    "REGLAS_DURAS",
    "CONTENEDORES_CRITICOS",
    "FLUJOS",
    "PATRON_ANCHO_FIJO",
    # El registro
    "Interfaz",
    "INTERFACES",
    "listar_interfaces",
    "matriz_interfaz_tipo",
    "conteo_por_tipo",
    # Consultas de la puerta
    "interfaces_con_ancho_fijo",
    "interfaces_que_no_declaran_los_3_modos",
]
