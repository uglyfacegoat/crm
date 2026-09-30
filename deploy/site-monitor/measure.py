#!/usr/bin/env python3
"""Record real website and VPS observations in the CRM (run on the VPS host)."""

from __future__ import annotations

import datetime as dt
import os
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request


ORGANIZATION_ID = "36e439b8-157b-4927-8658-200c906b3331"
WEBSITE_ID = "8bf1b9f4-7ef3-41ce-87ee-b8eba6bd8929"
WEBSITE_URL = "https://www.tehstroinvest.ru/"
WEBSITE_HOST = "www.tehstroinvest.ru"
DATABASE_CONTAINER = "crm-production-database-1"


def cpu_ticks() -> tuple[int, int]:
    with open("/proc/stat", encoding="utf-8") as source:
        fields = [int(value) for value in source.readline().split()[1:]]
    return sum(fields), fields[3] + fields[4]


def cpu_percent() -> float:
    total_before, idle_before = cpu_ticks()
    time.sleep(0.3)
    total_after, idle_after = cpu_ticks()
    total_delta = max(1, total_after - total_before)
    return round(max(0, min(100, 100 * (1 - (idle_after - idle_before) / total_delta))), 2)


def memory_mb() -> tuple[int, int]:
    values: dict[str, int] = {}
    with open("/proc/meminfo", encoding="utf-8") as source:
        for line in source:
            key, value = line.split(":", 1)
            if key in {"MemTotal", "MemAvailable"}:
                values[key] = int(value.strip().split()[0])
    total = max(1, round(values["MemTotal"] / 1024))
    used = max(0, round((values["MemTotal"] - values["MemAvailable"]) / 1024))
    return used, total


def disk_mb() -> tuple[int, int]:
    stats = os.statvfs("/")
    total = max(1, round(stats.f_blocks * stats.f_frsize / 1_048_576))
    used = max(0, round((stats.f_blocks - stats.f_bfree) * stats.f_frsize / 1_048_576))
    return used, total


def website_probe() -> tuple[str, int, str | None]:
    start = time.monotonic()
    try:
        with urllib.request.urlopen(WEBSITE_URL, timeout=10) as response:
            response.read(1)
            status = "healthy" if 200 <= response.status < 300 else "degraded"
    except urllib.error.HTTPError:
        status = "degraded"
    except (urllib.error.URLError, TimeoutError, OSError):
        status = "down"
    elapsed_ms = min(600000, round((time.monotonic() - start) * 1000))

    expires_on = None
    try:
        context = ssl.create_default_context()
        with socket.create_connection((WEBSITE_HOST, 443), timeout=5) as connection:
            with context.wrap_socket(connection, server_hostname=WEBSITE_HOST) as secure:
                certificate = secure.getpeercert()
                expires_on = dt.datetime.fromtimestamp(
                    ssl.cert_time_to_seconds(certificate["notAfter"]), dt.timezone.utc
                ).date().isoformat()
    except (OSError, ssl.SSLError, KeyError, ValueError):
        pass
    return status, elapsed_ms, expires_on


def save_snapshot(status: str, response_ms: int, expires_on: str | None) -> None:
    cpu = cpu_percent()
    memory_used, memory_capacity = memory_mb()
    disk_used, disk_capacity = disk_mb()
    ssl_date = f"'{expires_on}'" if expires_on else "NULL"
    # All interpolated values above come from fixed identifiers or measured numeric/date values.
    statement = f"""
        WITH recent AS (
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE health_status = 'healthy') AS healthy
          FROM website_health_snapshots
          WHERE organization_id = '{ORGANIZATION_ID}'
            AND website_id = '{WEBSITE_ID}'
            AND source = 'monitor'
            AND measured_at >= now() - interval '24 hours'
        )
        INSERT INTO website_health_snapshots
          (organization_id, website_id, health_status, uptime_percent,
           response_time_ms, cpu_load_percent, memory_used_mb, disk_used_mb,
           memory_capacity_mb, disk_capacity_mb, ssl_expires_on, source)
        SELECT '{ORGANIZATION_ID}', '{WEBSITE_ID}', '{status}',
               round(100.0 * (healthy + {int(status == 'healthy')}) / (total + 1), 2),
               {response_ms}, {cpu}, {memory_used}, {disk_used},
               {memory_capacity}, {disk_capacity}, {ssl_date}, 'monitor'
        FROM recent;
    """
    subprocess.run(
        ["docker", "exec", "-i", DATABASE_CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "crm_app", "-d", "crm"],
        input=statement,
        text=True,
        check=True,
        timeout=20,
    )
    print(f"{dt.datetime.now(dt.timezone.utc).isoformat()} status={status} response_ms={response_ms} cpu={cpu}% memory={memory_used}/{memory_capacity}MB disk={disk_used}/{disk_capacity}MB ssl={expires_on}")


if __name__ == "__main__":
    save_snapshot(*website_probe())
