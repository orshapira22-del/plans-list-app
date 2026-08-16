#!/usr/bin/env bash
# Install what tools/sign_pdf.py needs.
#
# Claude's container is wiped between sessions, so this has to be re-run at the
# start of each session before signing anything.
set -euo pipefail

# The Debian-packaged cryptography is built against a cffi that isn't present,
# which makes `import pypdf` blow up with a pyo3 panic. Installing cffi first
# repairs it.
python3 -m pip install --quiet --break-system-packages cffi
python3 -m pip install --quiet --break-system-packages pypdf reportlab pypdfium2 Pillow

python3 - <<'PY'
import pypdf, reportlab, pypdfium2, PIL
print("pypdf", pypdf.__version__, "| reportlab", reportlab.Version, "| pillow", PIL.__version__)
print("setup ok")
PY
