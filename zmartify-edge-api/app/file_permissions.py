from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def normalize_mosquitto_file_permissions(path: str | Path) -> None:
    target = Path(path)
    if not target.exists():
        return

    uid = _int_env("ZMART_EDGE_MQTT_FILE_UID", 1883)
    gid = _int_env("ZMART_EDGE_MQTT_FILE_GID", 1883)
    mode = _int_env("ZMART_EDGE_MQTT_FILE_MODE", 0o600)

    # Always enforce file mode; ownership may be best-effort in unprivileged envs.
    os.chmod(target, mode)

    strict_owner = os.getenv("ZMART_EDGE_STRICT_FILE_OWNERSHIP", "0").strip() in {"1", "true", "yes", "on"}
    try:
        os.chown(target, uid, gid)
        return
    except PermissionError:
        pass

    # Fallback for containerized runtime where direct chown may be blocked.
    docker_cmd = os.getenv("ZMART_EDGE_DOCKER_BIN", "docker")
    helper_image = os.getenv("ZMART_EDGE_CHOWN_HELPER_IMAGE", "alpine:latest")
    parent_dir = str(target.parent.resolve())
    file_name = target.name
    cmd = [
        docker_cmd,
        "run",
        "--rm",
        "-v",
        f"{parent_dir}:/cfg",
        helper_image,
        "sh",
        "-lc",
        f"chown {uid}:{gid} /cfg/{shlex.quote(file_name)} && chmod {oct(mode)[2:]} /cfg/{shlex.quote(file_name)}",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and strict_owner:
        raise PermissionError(
            f"failed to normalize ownership for {target}: {result.stderr.strip() or result.stdout.strip()}"
        )
