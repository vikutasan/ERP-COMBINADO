"""Verificación end-to-end de los contratos 7 y 8 contra la API viva.

Se ejecuta DENTRO del contenedor `api` (donde `localhost:5229` es la propia
API). No es una prueba unitaria: es la comprobación de que el contrato
funciona contra los datos reales importados de producción en la FASE 2.4.

Uso:
    docker compose exec -T api python verificar_contratos.py
"""

import json
import urllib.error
import urllib.request

BASE = "http://localhost:5229"


def _pedir(url: str, datos: dict | None = None) -> tuple[int, str]:
    """Devuelve (código HTTP, cuerpo como texto). Nunca lanza por 4xx/5xx."""
    cuerpo = None
    cabeceras = {}
    if datos is not None:
        cuerpo = json.dumps(datos).encode()
        cabeceras["Content-Type"] = "application/json"
    peticion = urllib.request.Request(url, data=cuerpo, headers=cabeceras)
    try:
        with urllib.request.urlopen(peticion) as respuesta:
            return respuesta.status, respuesta.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def main() -> int:
    fallos = 0

    def comprobar(etiqueta: str, obtenido: object, esperado: object) -> None:
        nonlocal fallos
        if obtenido == esperado:
            print(f"  OK   {etiqueta}: {obtenido!r}")
        else:
            fallos += 1
            print(f"  FALLO {etiqueta}: se esperaba {esperado!r}, llegó {obtenido!r}")

    print("\n[1/4] Salud del servicio")
    codigo, cuerpo = _pedir(f"{BASE}/health")
    comprobar("GET /health", codigo, 200)
    comprobar("estado", json.loads(cuerpo).get("status"), "ok")

    print("\n[2/4] Contrato 8 — PIN válido (3333, Alfa / MANAGER)")
    codigo, cuerpo = _pedir(
        f"{BASE}/security/employees/validate-pin", {"pin": "3333"}
    )
    comprobar("POST validate-pin", codigo, 200)
    salida = json.loads(cuerpo)
    comprobar("valido", salida.get("valido"), True)
    comprobar("campos exactos", sorted(salida), ["employee_id", "valido"])
    comprobar("el PIN no viaja en la respuesta", "pin" in cuerpo, False)
    employee_id = salida["employee_id"]

    print("\n[3/4] Contrato 7 — identidad del colaborador")
    codigo, cuerpo = _pedir(f"{BASE}/security/employees/{employee_id}")
    comprobar("GET employees/{id}", codigo, 200)
    identidad = json.loads(cuerpo)
    comprobar("campos exactos", sorted(identidad), ["employee_id", "nombre", "perfil", "permisos"])
    comprobar("employee_id coincide", identidad.get("employee_id"), employee_id)
    comprobar("nombre", identidad.get("nombre"), "Alfa")
    comprobar("perfil", identidad.get("perfil"), "MANAGER")
    comprobar("permisos es lista", isinstance(identidad.get("permisos"), list), True)
    comprobar("permisos no vacía", len(identidad.get("permisos", [])) > 0, True)
    comprobar("el PIN no se expone (RN-S01)", "pin" in cuerpo, False)

    print("\n[4/4] Caminos de error")
    # OJO: los PIN de producción son de 4 y 5 dígitos, y `9999` SÍ existe
    # (ARELY). Un PIN "libre" tiene que elegirse con una longitud válida y sin
    # colisión con los 64 colaboradores importados.
    codigo, _ = _pedir(f"{BASE}/security/employees/validate-pin", {"pin": "0000"})
    comprobar("PIN inexistente -> 401", codigo, 401)

    # RN-S04: un prefijo del PIN real, pero con longitud válida (4 dígitos).
    # `333` no sirve: el esquema lo rechaza con 422 antes de llegar al router,
    # y eso probaría la validación de forma, no la comparación exacta.
    codigo, _ = _pedir(f"{BASE}/security/employees/validate-pin", {"pin": "3330"})
    comprobar("prefijo del PIN -> 401 (RN-S04)", codigo, 401)

    codigo, _ = _pedir(f"{BASE}/security/employees/validate-pin", {"pin": "abc"})
    comprobar("PIN no numérico -> 422", codigo, 422)

    codigo, _ = _pedir(f"{BASE}/security/employees/validate-pin", {"pin": "333"})
    comprobar("PIN demasiado corto -> 422", codigo, 422)

    codigo, _ = _pedir(f"{BASE}/security/employees/00000000-0000-0000-0000-000000000000")
    comprobar("UUID inexistente -> 404", codigo, 404)

    codigo, _ = _pedir(f"{BASE}/security/employees/no-es-uuid")
    comprobar("UUID malformado -> 422", codigo, 422)

    print()
    if fallos:
        print(f"RESULTADO: {fallos} comprobación(es) fallaron.")
        return 1
    print("RESULTADO: todas las comprobaciones pasaron.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
