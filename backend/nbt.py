"""Minimal big-endian NBT reader and item fingerprinting.

Mirrors the parser in src/lib.js so the backend groups auctions into the
same variants the browser does. Stdlib only (struct, gzip, base64) -- no
pynbt/nbtlib dependency for a format this small.
"""
import base64
import gzip
import json
import re
import struct


class _Cursor:
    __slots__ = ("buf", "pos")

    def __init__(self, buf):
        self.buf = buf
        self.pos = 0


def _byte(c):
    v = struct.unpack_from(">b", c.buf, c.pos)[0]
    c.pos += 1
    return v


def _ubyte(c):
    v = struct.unpack_from(">B", c.buf, c.pos)[0]
    c.pos += 1
    return v


def _short(c):
    v = struct.unpack_from(">h", c.buf, c.pos)[0]
    c.pos += 2
    return v


def _int(c):
    v = struct.unpack_from(">i", c.buf, c.pos)[0]
    c.pos += 4
    return v


def _long(c):
    v = struct.unpack_from(">q", c.buf, c.pos)[0]
    c.pos += 8
    return v


def _float(c):
    v = struct.unpack_from(">f", c.buf, c.pos)[0]
    c.pos += 4
    return v


def _double(c):
    v = struct.unpack_from(">d", c.buf, c.pos)[0]
    c.pos += 8
    return v


def _string(c):
    length = struct.unpack_from(">H", c.buf, c.pos)[0]
    c.pos += 2
    s = c.buf[c.pos:c.pos + length].decode("utf-8")
    c.pos += length
    return s


def _payload(c, tag_type):
    if tag_type == 1:
        return _byte(c)
    if tag_type == 2:
        return _short(c)
    if tag_type == 3:
        return _int(c)
    if tag_type == 4:
        return _long(c)
    if tag_type == 5:
        return _float(c)
    if tag_type == 6:
        return _double(c)
    if tag_type == 7:
        n = _int(c)
        return [_byte(c) for _ in range(n)]
    if tag_type == 8:
        return _string(c)
    if tag_type == 9:
        t = _ubyte(c)
        n = _int(c)
        return [_payload(c, t) for _ in range(n)]
    if tag_type == 10:
        obj = {}
        while True:
            t = _ubyte(c)
            if t == 0:
                break
            name = _string(c)  # must read before _payload -- Python evaluates
            obj[name] = _payload(c, t)  # dict-subscript RHS before the key expr
        return obj
    if tag_type == 11:
        n = _int(c)
        return [_int(c) for _ in range(n)]
    if tag_type == 12:
        n = _int(c)
        return [_long(c) for _ in range(n)]
    raise ValueError(f"unknown NBT tag type {tag_type}")


def parse_nbt(buf):
    c = _Cursor(buf)
    root_type = _ubyte(c)
    _string(c)  # root name, unused
    return _payload(c, root_type)


def decode_item_bytes(b64):
    raw = gzip.decompress(base64.b64decode(b64))
    return parse_nbt(raw).get("i", [])


# Kept identical to the JS version in src/lib.js so both sides group auctions
# into the same variants -- this is what lets /api/history correlate backend
# sale records with fingerprints the frontend computes independently.
_LEVEL_RE = re.compile(r"\[Lvl (\d+)\]")


def fingerprint(item_id, ea, display_name=None):
    parts = [item_id or "UNKNOWN"]
    if not ea:
        return parts[0]
    if ea.get("rarity_upgrades"):
        parts.append("R")
    stars = ea.get("upgrade_level") or ea.get("dungeon_item_level")
    if stars:
        parts.append(f"S{stars}")
    hpb = ea.get("hot_potato_count")
    if hpb and hpb > 10:
        parts.append(f"FPB{hpb - 10}")
    ench = ea.get("enchantments")
    if ench:
        # every enchantment counts, not just the "meaningful" high ones -- a Sharpness 5
        # sword and a bare one are different items and shouldn't be treated as comparable.
        entries = sorted(f"{name}{lvl}" for name, lvl in ench.items())
        if entries:
            parts.append(",".join(entries))
    if item_id == "PET" and ea.get("petInfo"):
        try:
            p = json.loads(ea["petInfo"])
            m = _LEVEL_RE.search(display_name or "")
            band = (int(m.group(1)) // 20 * 20) if m else 0
            parts.append(f"PET:{p.get('type')}:{p.get('tier')}:{band}:{p.get('heldItem', '')}")
        except (json.JSONDecodeError, TypeError):
            pass
    if ea.get("new_years_cake"):
        parts.append(f"CAKE{ea['new_years_cake']}")
    if ea.get("party_hat_color"):
        parts.append(f"HAT{ea['party_hat_color']}{ea.get('party_hat_emoji', '')}")
    return "|".join(parts)
