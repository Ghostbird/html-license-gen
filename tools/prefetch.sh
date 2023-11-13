#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
mkdir -p "$SCRIPT_DIR/prefetched"
while read p; do
    if ! [ -f "$SCRIPT_DIR/prefetched/$p.txt" ]; then
        echo "Downloading $p"
        curl -s -o "$SCRIPT_DIR/prefetched/$p.txt" https://raw.githubusercontent.com/spdx/license-list-data/master/text/$p.txt
    fi
done < "$SCRIPT_DIR/prefetched.txt"
mkdir -p "$SCRIPT_DIR/../build/spdx"
cp -p -r $SCRIPT_DIR/prefetched/* "$SCRIPT_DIR/../build/spdx"