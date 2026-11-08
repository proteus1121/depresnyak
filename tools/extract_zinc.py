"""Достаёт оригинальный cat.swf из cat.exe (MDM Zinc 2.5, упакованный Thinstall).

Как устроено (выяснено разбором cat.exe):
  * в конце exe лежат zlib-потоки Zinc: XML проекта (<app ...>), данные ролика и каталог;
  * каталог — записи по 0x200+20 байт: имя (Pascal-строка), размер, размер сжатого,
    смещение, CRC32 сжатых... данных, флаги;
  * swfdata0  = base64( Blowfish-CFB8( первые 200000 байт SWF ) );
  * swfdatar0 = остаток SWF как есть;
  * ключ: DCPcrypt TDCP_blowfish.InitStr(swfpath + title, TDCP_sha1), т.е.
    key = SHA1(swfpath + title), IV = Blowfish_ECB(key, 0^8).

Использование: python extract_zinc.py cat.exe cat_original.swf
Нужен pycryptodome (pip install pycryptodome).
"""
import base64
import hashlib
import re
import struct
import sys
import zlib

from Crypto.Cipher import Blowfish


def zlib_streams(data):
    """Все zlib-потоки, которые удаётся распаковать: (смещение, длина сжатого, данные)."""
    out = []
    for m in re.finditer(rb"\x78[\x01\x5e\x9c\xda]", data):
        i = m.start()
        try:
            d = zlib.decompressobj()
            res = d.decompress(data[i:])
            if not d.eof or len(res) < 32:
                continue
            out.append((i, len(data) - i - len(d.unused_data), res))
        except zlib.error:
            pass
    return out


def main(exe, dst):
    data = open(exe, "rb").read()
    streams = zlib_streams(data)
    # данные ролика сжаты дважды: внутри внешнего потока — цепочка zlib-потоков
    for _, _, s in list(streams):
        if s[:1] == b"\x78":
            streams += zlib_streams(s)

    xml = next(s for _, _, s in streams if s.startswith(b"<app"))
    form = xml[xml.index(b'<forms num="1">'):].decode("cp1251", "replace")
    swfpath = re.search(r"<swfpath>(.*?)</swfpath>", form).group(1)
    title = re.search(r"<title>(.*?)</title>", form).group(1)

    dir_blob = next(s for _, _, s in streams if s[1:9] == b"swfdata0")
    entries = {}
    pos = 0
    while pos + 0x200 + 20 <= len(dir_blob):
        n = dir_blob[pos]
        name = dir_blob[pos + 1:pos + 1 + n].decode("latin1")
        size, csize, off, crc, _flags = struct.unpack("<IIIII", dir_blob[pos + 0x200:pos + 0x200 + 20])
        entries[name] = (size, csize, off, crc)
        pos += 0x200 + 20

    by_crc = {zlib.crc32(s): s for _, _, s in streams}
    enc_b64 = by_crc[entries["swfdata0"][3]]
    rest = by_crc[entries["swfdatar0"][3]]

    key = hashlib.sha1((swfpath + title).encode("cp1251")).digest()
    iv = Blowfish.new(key, Blowfish.MODE_ECB).encrypt(b"\0" * 8)
    head = Blowfish.new(key, Blowfish.MODE_CFB, iv=iv, segment_size=8).decrypt(base64.b64decode(enc_b64))
    swf = head + rest
    if swf[1:3] != b"WS":
        sys.exit("не удалось расшифровать: неверный заголовок SWF")
    open(dst, "wb").write(swf)
    print(f"{dst}: {len(swf)} байт, {swf[:3].decode()} v{swf[3]}, ключ из {swfpath!r} + {title!r}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
