"""Servicios internos del POS nuevo — FASE 7.5.

Un servicio interno es lógica de dominio que NO es un router (no habla HTTP) y
que varios routers pueden compartir. Aquí vive la lectura de la configuración
transversal (DT-06) y la proyección ticket → pedido (contrato 15).
"""
