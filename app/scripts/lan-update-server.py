"""Serve immutable LAN update files with Android DownloadManager resume support."""

import argparse
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RangeRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.partition("?")[0] == "/version.json":
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.partition("?")[0] != "/version.json":
            self.send_error(405, "Method not allowed")
            return

        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            self.send_error(404, "File not found")
            return None

        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(403, "Cannot open file")
            return None

        stat = os.fstat(source.fileno())
        size = stat.st_size
        etag = f'"{size:x}-{stat.st_mtime_ns:x}"'
        range_header = self.headers.get("Range")
        if range_header and self.headers.get("If-Range") not in (None, etag):
            range_header = None
        if range_header and self.headers.get("If-Match") not in (None, etag):
            source.close()
            self.send_response(412)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        start, end = 0, size - 1
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match or not any(match.groups()) or size == 0:
                return self.reject_range(source, size, etag)
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            else:
                suffix_length = int(last)
                start = max(0, size - suffix_length)
            if start >= size or end < start:
                return self.reject_range(source, size, etag)

        self.send_response(206 if range_header else 200)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.send_header("ETag", etag)
        self.send_header("Accept-Ranges", "bytes")
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        self.range_start = start
        self.range_remaining = end - start + 1
        return source

    def reject_range(self, source, size, etag):
        source.close()
        self.send_response(416)
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.send_header("ETag", etag)
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return None

    def copyfile(self, source, outputfile):
        source.seek(self.range_start)
        remaining = self.range_remaining
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18767)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    handler = partial(RangeRequestHandler, directory=str(directory))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
