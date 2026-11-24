# Garante que `harmonia_ai` seja importável quando o CI roda `pytest` direto (sem `python -m`).
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
