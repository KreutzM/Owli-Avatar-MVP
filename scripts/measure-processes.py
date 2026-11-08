#!/usr/bin/env python3
"""Sample owned process trees on Linux. No command lines or input data are read."""
import argparse
import json
import os
import time
from pathlib import Path


def snapshot():
    result = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit():
            continue
        try:
            # comm may contain spaces or parentheses; the final ')' ends it.
            fields = (item / "stat").read_text().rsplit(")", 1)[1].split()
            pid = int(item.name)
            result[pid] = {
                "parent": int(fields[1]),
                "ticks": int(fields[11]) + int(fields[12]),
                "start": int(fields[19]),
                "rss": int(fields[21]) * os.sysconf("SC_PAGE_SIZE"),
            }
        except (OSError, ValueError, IndexError):
            continue
    return result


def sample(roots, data):
    descendants = set(roots)
    while True:
        added = {pid for pid, row in data.items() if row["parent"] in descendants} - descendants
        if not added:
            break
        descendants.update(added)
    return {pid: data[pid] for pid in descendants if pid in data}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, action="append", required=True, help="root PID of an owned process; repeat as needed")
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()
    if args.interval < 0.2:
        parser.error("interval must be at least 0.2 seconds")
    first = snapshot()
    if any(pid not in first for pid in args.pid):
        parser.error("a root PID does not exist")
    roots = {pid: first[pid]["start"] for pid in args.pid}
    previous = {}
    previous_time = time.monotonic()
    ticks_per_second = os.sysconf("SC_CLK_TCK")
    while True:
        data = snapshot()
        if not any(pid in data and data[pid]["start"] == start for pid, start in roots.items()):
            break
        live_roots = [pid for pid, start in roots.items() if pid in data and data[pid]["start"] == start]
        current = sample(live_roots, data)
        now = time.monotonic()
        elapsed = now - previous_time
        delta = sum(max(0, row["ticks"] - previous[pid]["ticks"])
                    for pid, row in current.items()
                    if pid in previous and row["start"] == previous[pid]["start"])
        cpu = 100 * delta / ticks_per_second / elapsed if previous and elapsed > 0 else 0
        print(json.dumps({"elapsed_s": round(now - beginning, 2), "cpu_percent_one_core": round(cpu, 2),
                          "rss_sum_bytes": sum(row["rss"] for row in current.values())}), flush=True)
        previous, previous_time = current, now
        time.sleep(args.interval)


if __name__ == "__main__":
    beginning = time.monotonic()
    main()
