#!/usr/bin/env python3
"""Stamp a signature image onto a PDF page.

This produces a *simple electronic signature* (a graphical mark), not a
cryptographic PAdES signature. It does not use a certificate and does not
make the PDF tamper-evident.

Usage:
    python3 tools/sign_pdf.py --pdf order.pdf --sig signature.png --out signed.pdf
    python3 tools/sign_pdf.py --pdf order.pdf --sig signature.png --pos bottom-left \
        --page 2 --width 45 --date --preview preview.png
"""

from __future__ import annotations

import argparse
import io
import sys
from datetime import date

from pypdf import PdfReader, PdfWriter, Transformation
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

MM = 72.0 / 25.4  # points per millimetre

PRESETS = {
    "bottom-right": (1.0, 0.0),
    "bottom-left": (0.0, 0.0),
    "bottom-center": (0.5, 0.0),
    "top-right": (1.0, 1.0),
    "top-left": (0.0, 1.0),
    "center": (0.5, 0.5),
}


def _visual_size(width: float, height: float, rotation: int) -> tuple[float, float]:
    """Page size as the reader sees it, after /Rotate is applied."""
    return (height, width) if rotation in (90, 270) else (width, height)


def _overlay_transform(width: float, height: float, rotation: int) -> Transformation:
    """Map visual coordinates back into the page's unrotated user space.

    The overlay is drawn in visual space (what the reader sees). /Rotate is
    applied by the viewer to the whole page, so the overlay has to be rotated
    the opposite way before merging or the signature lands in the wrong corner
    lying on its side.
    """
    if rotation == 90:
        return Transformation().rotate(90).translate(width, 0)
    if rotation == 180:
        return Transformation().rotate(180).translate(width, height)
    if rotation == 270:
        return Transformation().rotate(270).translate(0, height)
    return Transformation()


def _resolve_xy(
    args: argparse.Namespace,
    vis_w: float,
    vis_h: float,
    sig_w: float,
    sig_h: float,
) -> tuple[float, float]:
    """Bottom-left corner of the signature box, in visual points."""
    if args.x is not None and args.y is not None:
        return args.x * MM, args.y * MM

    fx, fy = PRESETS[args.pos]
    margin = args.margin * MM
    x = fx * (vis_w - sig_w - 2 * margin) + margin
    y = fy * (vis_h - sig_h - 2 * margin) + margin
    return x, y


def build_overlay(
    sig_path: str,
    vis_w: float,
    vis_h: float,
    args: argparse.Namespace,
) -> tuple[bytes, tuple[float, float, float, float]]:
    """Render a transparent page holding just the signature (and date)."""
    image = Image.open(sig_path)
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    sig_w = args.width * MM
    sig_h = sig_w * image.height / image.width
    if sig_h > vis_h * 0.4:  # never let a stray aspect ratio swallow the page
        sig_h = vis_h * 0.4
        sig_w = sig_h * image.width / image.height

    x, y = _resolve_xy(args, vis_w, vis_h, sig_w, sig_h)

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(vis_w, vis_h))
    pdf.drawImage(
        ImageReader(image),
        x,
        y,
        width=sig_w,
        height=sig_h,
        mask="auto",  # honours the PNG alpha channel
        preserveAspectRatio=True,
    )

    if args.date:
        stamp = args.date_text or date.today().strftime("%d/%m/%Y")
        pdf.setFont("Helvetica", args.date_size)
        pdf.drawString(x, max(y - args.date_size - 2, 2), stamp)

    pdf.save()
    return buffer.getvalue(), (x, y, sig_w, sig_h)


def sign(args: argparse.Namespace) -> tuple[int, tuple[float, float, float, float]]:
    reader = PdfReader(args.pdf)
    total = len(reader.pages)

    index = total - 1 if args.page in (None, -1) else args.page - 1
    if not 0 <= index < total:
        raise SystemExit(f"page {args.page} out of range (PDF has {total} pages)")

    page = reader.pages[index]
    box = page.mediabox
    width = float(box.width)
    height = float(box.height)
    rotation = (page.rotation or 0) % 360

    vis_w, vis_h = _visual_size(width, height, rotation)
    overlay_bytes, placement = build_overlay(args.sig, vis_w, vis_h, args)
    overlay = PdfReader(io.BytesIO(overlay_bytes)).pages[0]

    transform = _overlay_transform(width, height, rotation)
    # A non-zero mediabox origin shifts the whole content stream; match it.
    if float(box.left) or float(box.bottom):
        transform = transform.translate(float(box.left), float(box.bottom))

    page.merge_transformed_page(overlay, transform, over=True)

    # append() copies the reader's pages as they stand now, so the merge above
    # is already baked in.
    writer = PdfWriter()
    writer.append(reader)

    with open(args.out, "wb") as handle:
        writer.write(handle)

    return index + 1, placement


def render_preview(pdf_path: str, page_number: int, out_path: str, scale: float = 1.6) -> None:
    import pypdfium2

    document = pypdfium2.PdfDocument(pdf_path)
    try:
        document[page_number - 1].render(scale=scale).to_pil().save(out_path)
    finally:
        document.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stamp a signature image onto a PDF.")
    parser.add_argument("--pdf", required=True, help="input PDF")
    parser.add_argument("--sig", required=True, help="signature image (PNG with alpha works best)")
    parser.add_argument("--out", required=True, help="output PDF")
    parser.add_argument("--page", type=int, default=None, help="1-based page number (default: last page)")
    parser.add_argument("--pos", choices=sorted(PRESETS), default="bottom-right", help="placement preset")
    parser.add_argument("--x", type=float, default=None, help="explicit X in mm from the left edge")
    parser.add_argument("--y", type=float, default=None, help="explicit Y in mm from the bottom edge")
    parser.add_argument("--width", type=float, default=45.0, help="signature width in mm (default 45)")
    parser.add_argument("--margin", type=float, default=15.0, help="margin in mm for presets (default 15)")
    parser.add_argument("--date", action="store_true", help="print a date under the signature")
    parser.add_argument("--date-text", default=None, help="override the date text")
    parser.add_argument("--date-size", type=float, default=9.0, help="date font size in points")
    parser.add_argument("--preview", default=None, help="also write a PNG preview of the signed page")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if (args.x is None) != (args.y is None):
        raise SystemExit("--x and --y must be given together")

    page_number, (x, y, w, h) = sign(args)
    print(f"signed page {page_number} of {args.pdf} -> {args.out}")
    print(f"  signature box: {w / MM:.1f}x{h / MM:.1f} mm at ({x / MM:.1f}, {y / MM:.1f}) mm")

    if args.preview:
        render_preview(args.out, page_number, args.preview)
        print(f"  preview: {args.preview}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
