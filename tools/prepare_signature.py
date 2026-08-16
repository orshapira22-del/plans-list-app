#!/usr/bin/env python3
"""Turn a scanned signature into a transparent PNG fit for stamping.

A signature photographed or scanned on paper arrives as dark ink on an opaque
white field. Dropped onto a PDF as-is it paints a white rectangle over whatever
sits beneath it. This derives an alpha channel from luminance instead of
keying out one exact colour, so anti-aliased pen edges stay smooth.

Usage:
    python3 tools/prepare_signature.py --in scan.jpeg --out signature.png
    python3 tools/prepare_signature.py --in scan.jpeg --out signature.png \
        --crop-top 30 --white 245 --ink 60
"""

from __future__ import annotations

import argparse
import sys

from PIL import Image


def to_transparent(
    image: Image.Image,
    white: int,
    ink: int,
    haze: int,
) -> Image.Image:
    """Alpha from luminance: white -> clear, ink -> opaque, edges in between.

    Partially transparent pixels also get their colour corrected. A scan is
    already ink composited over white, so a half-covered pixel reads back as a
    pale wash. Keeping that observed colour leaves a white halo ringing every
    stroke once the page behind it is no longer white. Undoing the composite --
    solving observed = a*ink + (1-a)*white for ink -- recovers the true colour
    and keeps both the black type and the blue pen intact.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    source = rgb.load()

    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    target = out.load()

    span = max(white - ink, 1)
    for y in range(height):
        for x in range(width):
            r, g, b = source[x, y]
            lum = min(r, g, b)  # the darkest channel tracks pen strokes best
            if lum >= white:
                continue
            alpha = 255 if lum <= ink else int(255 * (white - lum) / span)
            if alpha <= haze:  # JPEG ringing around the strokes
                continue
            if alpha < 255:
                scale = alpha / 255
                r, g, b = (
                    min(255, max(0, int((channel - 255 * (1 - scale)) / scale)))
                    for channel in (r, g, b)
                )
            target[x, y] = (r, g, b, alpha)
    return out


def trim(image: Image.Image, padding: int) -> Image.Image:
    box = image.getbbox()  # bbox of everything with alpha > 0
    if box is None:
        raise SystemExit("image is fully transparent - check --white/--ink")
    left, top, right, bottom = box
    return image.crop((
        max(left - padding, 0),
        max(top - padding, 0),
        min(right + padding, image.width),
        min(bottom + padding, image.height),
    ))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Make a signature PNG transparent.")
    parser.add_argument("--in", dest="src", required=True, help="scanned signature")
    parser.add_argument("--out", required=True, help="output PNG")
    parser.add_argument("--crop-top", type=int, default=0,
                        help="drop N rows off the top first, to remove crop debris")
    parser.add_argument("--crop-bottom", type=int, default=0, help="drop N rows off the bottom")
    parser.add_argument("--white", type=int, default=245,
                        help="luminance at or above which a pixel is background (default 245)")
    parser.add_argument("--ink", type=int, default=60,
                        help="luminance at or below which a pixel is solid ink (default 60)")
    parser.add_argument("--haze", type=int, default=18,
                        help="drop alpha values at or below this (default 18)")
    parser.add_argument("--padding", type=int, default=6, help="transparent padding kept around the ink")
    args = parser.parse_args(argv)

    image = Image.open(args.src)
    if args.crop_top or args.crop_bottom:
        image = image.crop((0, args.crop_top, image.width, image.height - args.crop_bottom))

    result = trim(to_transparent(image, args.white, args.ink, args.haze), args.padding)
    result.save(args.out)

    opaque = sum(1 for _, _, _, a in result.getdata() if a > 200)
    print(f"{args.out}: {result.width}x{result.height}, "
          f"{100 * opaque / (result.width * result.height):.1f}% solid ink")
    return 0


if __name__ == "__main__":
    sys.exit(main())
