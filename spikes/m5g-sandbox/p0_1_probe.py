from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import urllib.request


def capture(name: str, operation):
    try:
        detail = operation()
        return {"name": name, "succeeded": True, "detail": detail}
    except Exception as error:  # The exception text is probe evidence.
        return {
            "name": name,
            "succeeded": False,
            "errorType": type(error).__name__,
            "error": str(error),
        }


def inside_write():
    output = Path("inside.txt")
    output.write_text("M5G_SANDBOX_OK", encoding="utf-8")
    content = output.read_bytes()
    return {
        "path": str(output.resolve()),
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
    }


def path_escape():
    target = Path("..") / ".." / "escaped.md"
    target.write_text("ESCAPE_MUST_FAIL", encoding="utf-8")
    return {"path": str(target.resolve())}


def https_egress():
    with urllib.request.urlopen("https://example.com", timeout=5) as response:
        return {"status": response.status, "byte": response.read(1).hex()}


def dns_resolution():
    addresses = sorted({item[4][0] for item in socket.getaddrinfo("example.com", 443)})
    return {"addresses": addresses}


def direct_socket():
    with socket.create_connection(("1.1.1.1", 443), timeout=5):
        return {"remote": "1.1.1.1:443"}


PROBES = {
    "inside-write": inside_write,
    "path-escape": path_escape,
    "network-egress": https_egress,
    "dns-resolution": dns_resolution,
    "raw-socket": direct_socket,
}


def token_identity():
    command = (
        [r"C:\Windows\System32\whoami.exe"]
        if os.name == "nt"
        else ["id", "-un"]
    )
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def fail_after(seconds: int):
    if os.name == "nt":
        return

    def handle_timeout(_signum, _frame):
        raise TimeoutError(f"probe exceeded {seconds} seconds")

    signal.signal(signal.SIGALRM, handle_timeout)
    signal.alarm(seconds)


parser = argparse.ArgumentParser()
parser.add_argument("--probe", choices=["all", *PROBES], default="all")
args = parser.parse_args()
selected = PROBES.items() if args.probe == "all" else [(args.probe, PROBES[args.probe])]

fail_after(8)
result = {
    "environmentUsername": os.environ.get("USERNAME"),
    "tokenIdentity": token_identity(),
    "cwd": str(Path.cwd()),
    "probes": [capture(name, operation) for name, operation in selected],
}
signal.alarm(0) if os.name != "nt" else None

print(json.dumps(result, ensure_ascii=True, sort_keys=True))
