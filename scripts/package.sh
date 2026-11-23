#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later

set -eu

source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
output_dir=${1:-"$source_dir/dist"}
archive_name=kimpanel-osk-bridge@chenxiex.github.io.shell-extension.zip

if [ "$#" -gt 1 ]; then
    printf 'Usage: %s [output-directory]\n' "$0" >&2
    exit 2
fi

set -- metadata.json extension.js candidateRow.js prefs.js LICENSE \
    schemas/org.gnome.shell.extensions.kimpanel-osk-bridge.gschema.xml
for file do
    if [ ! -f "$source_dir/$file" ]; then
        printf 'Missing extension file: %s\n' "$file" >&2
        exit 1
    fi
done

mkdir -p -- "$output_dir"
output_dir=$(CDPATH='' cd -- "$output_dir" && pwd -P)
staging_dir=$(mktemp -d -- "$output_dir/.package.XXXXXX")
trap 'rm -rf -- "$staging_dir"' EXIT

mkdir -p -- "$staging_dir/schemas"
for file do
    cp -- "$source_dir/$file" "$staging_dir/$file"
done
glib-compile-schemas --strict "$staging_dir/schemas"

cd -- "$staging_dir"
zip -q "$archive_name" "$@" schemas/gschemas.compiled
mv -fT -- "$staging_dir/$archive_name" "$output_dir/$archive_name"
printf '%s\n' "$output_dir/$archive_name"
