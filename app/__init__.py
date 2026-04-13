"""Envelope — self-hosted secure env manager."""

import sys

_MIN_PYTHON = (3, 10)
if sys.version_info < _MIN_PYTHON:
    raise RuntimeError(
        "Envelope requires Python %d.%d or newer (you have %s). "
        "CI uses 3.12; on Windows try: py -3.12 -m unittest discover -s tests -v"
        % (_MIN_PYTHON[0], _MIN_PYTHON[1], ".".join(map(str, sys.version_info[:3])))
    )
