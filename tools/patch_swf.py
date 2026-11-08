"""Внедряет в cat.swf заглушку объекта `mdm` (API MDM Zinc).

Оригинальный ролик вызывает mdm.Application.exit/minimize/minimizeToTray и
mdm.Dialogs.prompt. В Ruffle этих объектов нет, поэтому создаём _global.mdm,
методы которого вызывают fscommand(...), а хост-приложение (Electron)
обрабатывает эти команды.

Использование: python patch_swf.py <вход.swf> <выход.swf>
"""
import struct, sys, zlib


def s(x):
    return x.encode("utf-8") + b"\0"


def act(code, payload=b""):
    if code < 0x80:
        return bytes([code])
    return bytes([code]) + struct.pack("<H", len(payload)) + payload


def push_str(*vals):
    return act(0x96, b"".join(b"\0" + s(v) for v in vals))


def push_int(n):
    return act(0x96, b"\x07" + struct.pack("<i", n))


GET_VAR, SET_MEMBER, INIT_OBJECT, POP = 0x1C, 0x4F, 0x43, 0x17


def get_url2():
    return act(0x9A, b"\0")


def func(params, body):
    """Анонимная DefineFunction (кладёт функцию на стек)."""
    payload = s("") + struct.pack("<H", len(params)) + b"".join(s(p) for p in params)
    payload += struct.pack("<H", len(body))
    return act(0x9B, payload) + body


def fscommand(cmd, arg_var=None):
    """fscommand(cmd, arg) == getURL2("FSCommand:"+cmd, arg)."""
    code = push_str("FSCommand:" + cmd)
    if arg_var:
        code += push_str(arg_var) + act(GET_VAR)
    else:
        code += push_str("")
    return code + get_url2()


def obj(pairs):
    code = b""
    for name, value_code in pairs:
        code += push_str(name) + value_code
    return code + push_int(len(pairs)) + act(INIT_OBJECT)


application = obj([
    ("exit", func([], fscommand("exit"))),
    ("minimize", func([], fscommand("minimize"))),
    ("minimizeToTray", func(["v"], fscommand("minimizeToTray", "v"))),
])
dialogs = obj([
    ("prompt", func(["t"], fscommand("prompt", "t"))),
])
shim = push_str("_global") + act(GET_VAR) + push_str("mdm") + obj([
    ("Application", application),
    ("Dialogs", dialogs),
]) + act(SET_MEMBER) + b"\0"


def tag(code, body):
    if len(body) < 63:
        return struct.pack("<H", (code << 6) | len(body)) + body
    return struct.pack("<HI", (code << 6) | 63, len(body)) + body


def iter_tags(body, p):
    """(код, начало тега, конец тега, данные) для тегов главной временной шкалы."""
    while p < len(body):
        h = struct.unpack("<H", body[p:p + 2])[0]
        code, ln, q = h >> 6, h & 63, p + 2
        if ln == 63:
            ln = struct.unpack("<I", body[q:q + 4])[0]
            q += 4
        yield code, p, q + ln, body[q:q + ln]
        p = q + ln
        if code == 0:
            break


def add_missing_phrase_labels(body, start):
    """В оригинале нет метки кадра «phr16» (есть только «phr16End»), хотя сама фраза
    в ролике есть. Скрипт выбирает фразу случайно: gotoAndPlay("phr" + 1..20), и при
    выпадении 16 переход никуда не ведёт — кот замирал. Ставим метку на кадр после «phr15End»."""
    labels, frame_pos, frame = {}, {}, 0
    for code, a, _b, data in iter_tags(body, start):
        frame_pos.setdefault(frame, a)
        if code == 43:
            labels[data.split(b"\0")[0].decode("latin1")] = frame
        if code == 1:
            frame += 1
    inserts = []
    for n in range(2, 21):
        name, prev_end = f"phr{n}", f"phr{n - 1}End"
        if name not in labels and prev_end in labels:
            target = labels[prev_end] + 1
            inserts.append((frame_pos[target], name))
            print(f"добавлена метка {name} на кадр {target + 1}")
    for pos, name in sorted(inserts, reverse=True):
        body = body[:pos] + tag(43, name.encode("latin1") + b"\0") + body[pos:]
    return body


def main(src, dst):
    data = open(src, "rb").read()
    sig, ver = data[:3], data[3]
    body = zlib.decompress(data[8:]) if sig == b"CWS" else data[8:]
    nbits = body[0] >> 3
    hdr_len = (5 + 4 * nbits + 7) // 8 + 4  # RECT + frame rate + frame count
    p = hdr_len
    h = struct.unpack("<H", body[p:p + 2])[0]
    if h >> 6 == 69:  # FileAttributes должен оставаться первым тегом
        ln = h & 63
        p += 2 + (struct.unpack("<I", body[p + 2:p + 6])[0] + 4 if ln == 63 else ln)
    body = body[:p] + tag(12, shim) + body[p:]
    body = add_missing_phrase_labels(body, p)
    out = b"CWS" + bytes([ver]) + struct.pack("<I", len(body) + 8) + zlib.compress(body, 9)
    open(dst, "wb").write(out)
    print(f"{dst}: {len(out)} bytes, shim {len(shim)} bytes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
