# PDF signature stamping

`sign_pdf.py` overlays a signature image onto a page of a PDF.

## What this is and is not

This produces a **simple electronic signature** — a picture of a signature
placed on the page. That is what most commercial orders, POs and approvals
actually need, and it is what this tool does well.

It is **not** a cryptographic signature. It uses no certificate, it will not
show as "Signed and all signatures are valid" in Adobe Reader, and it does not
make the document tamper-evident. If a counterparty requires a certified
signature (חתימה אלקטרונית מאושרת), this tool is the wrong instrument — that
requires a certificate whose private key must stay under the signer's sole
control, which is exactly why it cannot be delegated to an agent.

## Setup

The container is wiped between sessions, so run this first every time:

```bash
bash tools/setup.sh
```

## Usage

```bash
# Simplest: sign the last page, bottom right
python3 tools/sign_pdf.py --pdf order.pdf --sig signature.png --out signed.pdf

# Pick a page and corner, add a date, and render a preview to eyeball
python3 tools/sign_pdf.py \
    --pdf order.pdf --sig signature.png --out signed.pdf \
    --page 2 --pos bottom-left --width 45 --date --preview preview.png

# Exact placement, in millimetres from the bottom-left of the page as displayed
python3 tools/sign_pdf.py --pdf order.pdf --sig signature.png --out signed.pdf \
    --x 120 --y 40
```

| Flag | Meaning |
| --- | --- |
| `--page` | 1-based page number. Default: the last page. |
| `--pos` | `bottom-right` (default), `bottom-left`, `bottom-center`, `top-right`, `top-left`, `center` |
| `--x` / `--y` | Explicit position in mm, overrides `--pos`. Must be given together. |
| `--width` | Signature width in mm. Default 45. Height follows the aspect ratio. |
| `--margin` | Margin in mm used by the presets. Default 15. |
| `--date` | Print today's date under the signature (`--date-text` to override). |
| `--preview` | Also write a PNG of the signed page. |

Coordinates and presets are in **visual** space — the page as the reader sees
it. Pages carrying a `/Rotate` of 90/180/270 are handled: the overlay is
counter-rotated before merging so the signature lands in the corner you asked
for, right way up.

The signature image should be a **PNG with a transparent background**. The
alpha channel is honoured, so a signature scanned onto white paper should have
its background removed first or it will paint a white box over the document.

## Tests

```bash
python3 tools/test_sign_pdf.py
```

Renders the signed output and asserts on pixels: the mark lands in the correct
visual quadrant at each of the four page rotations, stays upright, and only the
intended page is touched.

## Getting documents in and out

Both routes below were verified against the live connectors, not assumed.

**Gmail cannot supply the file.** `get_message` returns attachment *metadata
only* — `filename`, `mimeType` and an opaque `id`. There is no `content` field
and no tool that exchanges that id for bytes. Claude can see that an email
carries `order.pdf` and report its name, but cannot open it.

**Google Drive can.** `download_file_content` returns real bytes; a
create → download round trip came back byte-identical. So the working intake is
Drive, not the mailbox.

So there are two ways in, and one way out:

| Step | Mechanism |
| --- | --- |
| In, option A | Drop the PDF in Drive from the phone, Claude downloads it |
| In, option B | Attach the PDF to the chat message directly |
| Out | Gmail `send_message` with an attachment, up to 25MB |

### The size ceiling on Drive intake

Downloaded content arrives as base64 *inside the conversation*, so file size
is spent from the context window at roughly 1.4 characters per byte. A 300KB
PDF is fine. A 2MB scan is not — it would arrive as ~2.8M characters and
overrun the window. For large scanned drawings, send only the page that needs
signing rather than the full set.

The same arithmetic applies to the signature image, and it is paid on *every*
session that fetches it from Drive. Keeping the signature in the repository
instead makes it free — it arrives with the clone — at the cost of living
permanently in git history.
