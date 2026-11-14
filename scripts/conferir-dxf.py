"""Confere um DXF com o ezdxf: python scripts/conferir-dxf.py <arquivo>"""
import sys

import ezdxf

if len(sys.argv) != 2:
    print("uso: python scripts/conferir-dxf.py <arquivo>")
    sys.exit(2)

doc = ezdxf.readfile(sys.argv[1])
auditoria = doc.audit()
if auditoria.has_errors:
    for erro in auditoria.errors:
        print("ERRO", erro.code, erro.message)
    sys.exit(1)
print("OK %d entidades" % len(doc.modelspace()))
