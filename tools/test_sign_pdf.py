#!/usr/bin/env python3
"""End-to-end checks for sign_pdf.py.

The interesting failure mode is page rotation: a PDF whose /Rotate is 90 or 270
displays landscape while its user space is still portrait. If the overlay is
merged without compensating, the signature lands in the wrong corner and lies on
its side. These tests render the signed output and assert on actual pixels.

Run: python3 tools/test_sign_pdf.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import pypdfium2
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
SIGN = HERE / "sign_pdf.py"

SIG_W, SIG_H = 300, 100  # a deliberately wide 3:1 mark, so orientation shows up


def make_signature(path: Path) -> None:
    """A blue, asymmetric, 3:1 mark on a transparent background."""
    image = Image.new("RGBA", (SIG_W, SIG_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line([(10, 80), (120, 20), (200, 75), (290, 25)], fill=(0, 40, 220, 255), width=12)
    draw.rectangle([10, 10, 40, 30], fill=(0, 40, 220, 255))
    image.save(path)


def make_pdf(path: Path, rotation: int) -> None:
    plain = path.with_suffix(".plain.pdf")
    pdf = canvas.Canvas(str(plain), pagesize=A4)
    pdf.setFont("Helvetica", 14)
    pdf.drawString(60, A4[1] - 60, f"Test order - page /Rotate={rotation}")
    pdf.save()

    reader = PdfReader(str(plain))
    writer = PdfWriter()
    page = reader.pages[0]
    if rotation:
        page.rotate(rotation)
    writer.add_page(page)
    with open(path, "wb") as handle:
        writer.write(handle)
    plain.unlink()


def blue_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    pixels = rgb.load()
    width, height = rgb.size
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if b > 140 and r < 110 and g < 110:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise AssertionError("no signature ink found in the rendered page")
    return min(xs), min(ys), max(xs), max(ys)


def check(rotation: int, workdir: Path) -> None:
    pdf = workdir / f"order_{rotation}.pdf"
    sig = workdir / "sig.png"
    out = workdir / f"signed_{rotation}.pdf"

    make_pdf(pdf, rotation)
    result = subprocess.run(
        [sys.executable, str(SIGN), "--pdf", str(pdf), "--sig", str(sig),
         "--out", str(out), "--pos", "bottom-right", "--width", "45", "--date"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"rotate={rotation}: signing failed\n{result.stderr}"

    document = pypdfium2.PdfDocument(str(out))
    try:
        rendered = document[0].render(scale=2.0).to_pil()
    finally:
        document.close()

    page_w, page_h = rendered.size
    x0, y0, x1, y1 = blue_bbox(rendered)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    # 1. The mark must sit in the bottom-right quadrant *as displayed*.
    assert cx > page_w * 0.55, (
        f"rotate={rotation}: signature too far left (cx={cx:.0f} of {page_w})")
    assert cy > page_h * 0.55, (
        f"rotate={rotation}: signature too high (cy={cy:.0f} of {page_h})")

    # 2. It must be upright. Comparing the ink bbox to the source aspect ratio
    # is brittle (stroke width and padding shift it), but the wide/tall
    # distinction is not: a 3:1 mark rendered sideways would come out under 1:1.
    aspect = (x1 - x0) / max(y1 - y0, 1)
    assert aspect > 1.8, (
        f"rotate={rotation}: signature looks rotated 90 degrees "
        f"(aspect={aspect:.2f}, a wide mark should stay well above 1.0)")

    print(f"  /Rotate={rotation:<3} ok  centroid=({cx / page_w:.2f}, {cy / page_h:.2f}) "
          f"aspect={aspect:.2f}")


def check_multipage_default(workdir: Path) -> None:
    """With no --page, the last page gets signed and earlier pages stay clean."""
    src = workdir / "multi.pdf"
    pdf = canvas.Canvas(str(src), pagesize=A4)
    for n in range(3):
        pdf.setFont("Helvetica", 14)
        pdf.drawString(60, A4[1] - 60, f"page {n + 1}")
        pdf.showPage()
    pdf.save()

    out = workdir / "multi_signed.pdf"
    result = subprocess.run(
        [sys.executable, str(SIGN), "--pdf", str(src), "--sig", str(workdir / "sig.png"),
         "--out", str(out)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert len(PdfReader(str(out)).pages) == 3, "page count changed"

    document = pypdfium2.PdfDocument(str(out))
    try:
        pages = [document[i].render(scale=1.5).to_pil() for i in range(3)]
    finally:
        document.close()

    for i in (0, 1):
        try:
            blue_bbox(pages[i])
        except AssertionError:
            continue
        raise AssertionError(f"page {i + 1} should not carry a signature")
    blue_bbox(pages[2])
    print("  multipage ok  only the last page signed, 3 pages preserved")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        make_signature(workdir / "sig.png")

        print("rotation handling:")
        for rotation in (0, 90, 180, 270):
            check(rotation, workdir)

        print("page selection:")
        check_multipage_default(workdir)

    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
