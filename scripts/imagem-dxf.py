"""Desenha um DXF em PNG para conferir a olho: python scripts/imagem-dxf.py <entrada.dxf> <saida.png>"""
import sys

import ezdxf
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

if len(sys.argv) != 3:
    print("uso: python scripts/imagem-dxf.py <entrada.dxf> <saida.png>")
    sys.exit(2)

doc = ezdxf.readfile(sys.argv[1])
fig = plt.figure(figsize=(14, 14 * 113 / 124.6))
ax = fig.add_axes([0, 0, 1, 1])
Frontend(RenderContext(doc), MatplotlibBackend(ax)).draw_layout(doc.modelspace(), finalize=True)
fig.set_size_inches(14, 14 * 113 / 124.6)
fig.savefig(sys.argv[2], dpi=130)
