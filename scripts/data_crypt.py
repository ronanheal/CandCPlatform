#!/usr/bin/env python3
"""Encrypt / decrypt the synced data files (shared format with lib/crypt.js).

Layout of a <name>.json.enc file:
    b"CCE1" + 12-byte random nonce + AES-256-GCM(gzip(original bytes)) + 16-byte tag
Key: env DATA_KEY, 64 hex characters. Never printed.

Usage:
    data_crypt.py encrypt <src.json> <dst.json.enc>   # leaves dst alone if it already holds src
    data_crypt.py decrypt <src.json.enc> <dst.json>
    data_crypt.py check-key            # exit 0 if DATA_KEY is usable
"""
import gzip
import os
import re
import sys

MAGIC = b"CCE1"


def key():
    k = os.environ.get("DATA_KEY", "")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", k):
        sys.exit("DATA_KEY missing or not 64 hex characters")
    return bytes.fromhex(k)


def encrypt_bytes(data, k):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    # mtime=0 so identical data gives identical gzip bytes (the nonce still makes each .enc unique)
    return MAGIC + nonce + AESGCM(k).encrypt(nonce, gzip.compress(data, compresslevel=9, mtime=0), None)


def decrypt_bytes(blob, k):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if len(blob) < 32 or blob[:4] != MAGIC:
        raise ValueError("not a CCE1 file")
    return gzip.decompress(AESGCM(k).decrypt(blob[4:16], blob[16:], None))


def main(argv):
    if len(argv) == 2 and argv[1] == "check-key":
        k = key()
        decrypt_bytes(encrypt_bytes(b"{}", k), k)  # also proves the cryptography package is installed
        return 0
    if len(argv) != 4 or argv[1] not in ("encrypt", "decrypt"):
        sys.exit(__doc__)
    k = key()
    with open(argv[2], "rb") as f:
        src = f.read()
    if argv[1] == "encrypt" and os.path.exists(argv[3]):
        # Unchanged data keeps its existing .enc (random nonces would otherwise make every
        # publish a "change" and push a new commit every cycle).
        try:
            with open(argv[3], "rb") as f:
                if decrypt_bytes(f.read(), k) == src:
                    return 0
        except Exception:
            pass  # unreadable / old key: re-encrypt
    out = encrypt_bytes(src, k) if argv[1] == "encrypt" else decrypt_bytes(src, k)
    tmp = argv[3] + ".tmp"
    with open(tmp, "wb") as f:
        f.write(out)
    os.replace(tmp, argv[3])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
