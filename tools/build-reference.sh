#!/bin/sh
# Builds the standalone C++ oracles used for parity testing (docs 13).
# Needs only g++ and libm — no SDL.
set -e
cd "$(dirname "$0")/reference"
g++ -O2 -o /tmp/rotate_gen rotate_gen.cpp -lm
g++ -O2 -o /tmp/render_gen render_gen.cpp -lm
g++ -O2 -o /tmp/sim_gen sim_gen.cpp -lm
echo "built /tmp/rotate_gen /tmp/render_gen /tmp/sim_gen"
