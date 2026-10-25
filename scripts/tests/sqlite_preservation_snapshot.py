#!/usr/bin/env python3
"""Fingerprint protected creator and commerce rows in a disposable package test."""

import hashlib
import sqlite3
import sys
from pathlib import Path


database = Path(sys.argv[1]).resolve()
connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
try:
    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("SQLite integrity check failed")
    digest = hashlib.sha256()
    for table in ("User", "ContentItem", "PaymentIntent", "Sale", "Entitlement"):
        digest.update(table.encode())
        for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
            digest.update(repr(row).encode())
    print(digest.hexdigest())
finally:
    connection.close()
