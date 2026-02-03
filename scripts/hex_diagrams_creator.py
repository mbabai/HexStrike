#!/usr/bin/env python3
"""
Hex diagram renderer (path-based, tight bounds, translucent path hexes, labels).

Encoding (path-based):
  Token = Position Action

  Position = sequence of Steps, where:
    Step = Dir [k?]
    Dir ∈ {F, L, R, B, BL, BR}
    k   ∈ positive integer, default 1

  Action ∈ {'a','b','m','c','j'}:
    a = attack (red hex, letter 'a')
    m = move   (green hex, letter 'm')
    j = jump   (blue hex, letter 'j')
    c = charge (red hex with inner green hex, letter 'c')
    b = block  (gold line on inward edge only)

Examples:
  "m"        -> F1 m (one forward move)
  "Ba"       -> B1 a (one back attack)
  "2a"       -> F2 a (two forward; bare leading number = F2)
  "Rj"       -> R1 j
  "F2Ra"     -> 2 forward then 1 right (diagonal off F2)
  "F2La-F2Ra" -> diagonals with path hexes along the shared F1/F2 cells

Multi-token spec:
  "m-Ba"     -> move forward, attack back
  "a-Rj-Lm"  -> attack front, jump right, move left

CSV mode:
  Looks for cells like "HexstrikeImages/a-Rj-Lm.png" and renders "a-Rj-Lm.png".
"""

from PIL import Image, ImageDraw, ImageFont
import math, csv, argparse, os

SQRT3 = math.sqrt(3)
SCENE_DEG = -60.0          # 60° CCW visually
TRIANGLE_DEG = -30.0       # 30° CCW visually for arrow
SCENE_RAD = math.radians(SCENE_DEG)
TRIANGLE_RAD = math.radians(TRIANGLE_DEG)

# Colors (RGBA)
RED   = (231, 76, 60, 255)
BLUE  = (52, 152, 219, 255)
GREEN = (46, 204, 113, 255)
GOLD  = (241, 196, 15, 255)
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)
HALFWHITE = (255, 255, 255, 128)

BLOCK_LINE_WIDTH = 10
INNER_HEX_SCALE = 0.60
SEP = '-'  # token separator

# Axial directions for flat-top hexes
DIRS = {
    "F":  (1, 0),
    "L":  (1, -1),
    "R":  (0, 1),
    "B":  (-1, 0),
    "BL": (-1, 1),
    "BR": (0, -1),
}

# Actions are LOWERCASE only; uppercase B/F/L/R/etc stay as directions
ACTIONS = set("abmcj")

# -------- path parsing --------

def _parse_path(path_str: str):
    """
    Parse the position part (before the action) into a list of (Dir, dist),
    and return (steps, (q,r)).

    - Supports explicit dirs: F, L, R, B, BL, BR
    - Optional integer after each dir
    - Bare leading integer = F distance, e.g. "2" -> F2
    """
    steps = []
    i = 0
    n = len(path_str)

    if n == 0:
        # default: one step forward
        steps.append(("F", 1))
    else:
        # leading bare number = Fk
        if path_str[0].isdigit():
            j = 0
            while j < n and path_str[j].isdigit():
                j += 1
            dist = int(path_str[:j])
            steps.append(("F", dist))
            i = j

        while i < n:
            # two-letter dirs first
            if path_str.startswith("BL", i):
                d = "BL"
                i += 2
            elif path_str.startswith("BR", i):
                d = "BR"
                i += 2
            else:
                ch = path_str[i]
                if ch in ("F", "L", "R", "B"):
                    d = ch
                    i += 1
                else:
                    raise ValueError(f"Invalid direction char '{ch}' in path '{path_str}'")

            # optional digits after this dir
            j = i
            while j < n and path_str[j].isdigit():
                j += 1
            dist = int(path_str[i:j]) if j > i else 1
            i = j
            steps.append((d, dist))

    q = r = 0
    for d, dist in steps:
        dq, dr = DIRS[d]
        q += dq * dist
        r += dr * dist

    return steps, (q, r)


def parse_tokens(spec: str):
    """
    Split spec on '-' and parse each token into:
        ((q,r), action, steps)

    where steps is a list of (Dir, dist).

    IMPORTANT: we only treat lowercase a/b/m/c/j as actions.
               Uppercase B/F/L/R/etc are ALWAYS directions.
    """
    placements = []
    tokens = [t.strip() for t in spec.split(SEP) if t.strip()]

    for tok in tokens:
        # find first *lowercase* action char
        idx = None
        for i, ch in enumerate(tok):
            if ch in ACTIONS:      # <-- FIX: no .lower() here
                idx = i
                break
        if idx is None:
            raise ValueError(f"No action letter found in token '{tok}'")

        path_str = tok[:idx]
        action = tok[idx]         # already lowercase from ACTIONS
        if idx + 1 != len(tok):
            extra = tok[idx+1:]
            raise ValueError(f"Garbage after action in token '{tok}': '{extra}'")

        steps, (q, r) = _parse_path(path_str)
        placements.append(((q, r), action, steps))

    return placements


def is_valid_spec(spec: str) -> bool:
    try:
        parse_tokens(spec)
        return True
    except Exception:
        return False


# -------- geometry helpers --------

def axial_to_pixel(q, r, size):
    return (size * (1.5 * q), size * (SQRT3 * (r + q/2.0)))


def rot(x, y, ang, cx=0.0, cy=0.0):
    dx, dy = x - cx, y - cy
    c, s = math.cos(ang), math.sin(ang)
    return (cx + dx*c - dy*s, cy + dx*s + dy*c)


def hex_polygon(cx, cy, size):
    return [(cx + size*math.cos(math.radians(60*i)),
             cy + size*math.sin(math.radians(60*i))) for i in range(6)]


def hex_polygon_rot(cx, cy, size, ang):
    return [rot(x, y, ang, cx, cy) for (x, y) in hex_polygon(cx, cy, size)]


def draw_text_center(draw, center, text, font, fill):
    cx, cy = center
    draw.text((cx, cy), text, font=font, fill=fill, anchor="mm")


def edge_midpoints(points):
    return [((points[i][0]+points[(i+1)%6][0])/2.0,
             (points[i][1]+points[(i+1)%6][1])/2.0) for i in range(6)]


def block_edge_segment(center, size, origin_center):
    cx, cy = center
    pts = hex_polygon_rot(cx, cy, size, SCENE_RAD)
    dirx, diry = origin_center[0] - cx, origin_center[1] - cy
    dlen = math.hypot(dirx, diry) or 1.0
    dirx, diry = dirx/dlen, diry/dlen
    target = (cx + dirx*(size*0.9), cy + diry*(size*0.9))
    mids = edge_midpoints(pts)
    best = min(range(6), key=lambda i: (mids[i][0]-target[0])**2 + (mids[i][1]-target[1])**2)
    x1, y1 = pts[best]
    x2, y2 = pts[(best+1)%6]
    inset = 2.0

    def inset_point(x, y):
        vx, vy = cx - x, cy - y
        vlen = math.hypot(vx, vy) or 1.0
        return (x + vx/vlen*inset, y + vy/vlen*inset)

    return inset_point(x1, y1), inset_point(x2, y2)


def collect_bounds(points, current_bounds):
    minx, miny, maxx, maxy = current_bounds
    for x, y in points:
        if x < minx: minx = x
        if y < miny: miny = y
        if x > maxx: maxx = x
        if y > maxy: maxy = y
    return (minx, miny, maxx, maxy)


# -------- rendering --------

def render_spec_tight(spec, out_dir, size=46):
    parsed = parse_tokens(spec)
    # (q,r) -> (action, steps)
    requested = {(q, r): (action, steps) for (q, r), action, steps in parsed}

    # placeholders: walk the full path from (0,0), add every intermediate hex
    placeholders = set()
    for (q_final, r_final), (action, steps) in requested.items():
        q = 0
        r = 0
        path_positions = []

        for dname, dist in steps:
            dq, dr = DIRS[dname]
            for _ in range(dist):
                q += dq
                r += dr
                path_positions.append((q, r))

        # sanity check
        if path_positions and path_positions[-1] != (q_final, r_final):
            raise ValueError(
                f"Path for token leads to {path_positions[-1]} "
                f"but stored coord is {(q_final, r_final)}"
            )

        for pos in path_positions[:-1]:  # all but final
            if pos not in requested:
                placeholders.add(pos)

    # centers (rotated)
    all_coords = [(0, 0)] + list(placeholders) + list(requested.keys())
    centers = [rot(*axial_to_pixel(q, r, size), SCENE_RAD, 0.0, 0.0)
               for (q, r) in all_coords]
    center_map = {qr: xy for qr, xy in zip(all_coords, centers)}
    origin_c = center_map[(0, 0)]

    # bounds
    INF = 10**9
    bounds = (INF, INF, -INF, -INF)

    ox, oy = origin_c
    origin_pts = hex_polygon_rot(ox, oy, size, SCENE_RAD)
    bounds = collect_bounds(origin_pts, bounds)

    tip = (ox + 0.9*size, oy)
    base_top = (ox + 0.2*size, oy - 0.3*SQRT3*size)
    base_bot = (ox + 0.2*size, oy + 0.3*SQRT3*size)
    tri_pts = [
        rot(*tip, TRIANGLE_RAD, ox, oy),
        rot(*base_top, TRIANGLE_RAD, ox, oy),
        rot(*base_bot, TRIANGLE_RAD, ox, oy),
    ]
    bounds = collect_bounds(tri_pts, bounds)

    for ax in placeholders:
        cx, cy = center_map[ax]
        pts = hex_polygon_rot(cx, cy, size, SCENE_RAD)
        bounds = collect_bounds(pts, bounds)

    for (q, r), (action, steps) in requested.items():
        cx, cy = center_map[(q, r)]
        if action == 'b':
            p1, p2 = block_edge_segment((cx, cy), size, origin_c)
            bounds = collect_bounds([p1, p2], bounds)
        else:
            pts = hex_polygon_rot(cx, cy, size, SCENE_RAD)
            bounds = collect_bounds(pts, bounds)
            if action == 'c':
                inner = hex_polygon_rot(cx, cy, size*INNER_HEX_SCALE, SCENE_RAD)
                bounds = collect_bounds(inner, bounds)

    pad = 1
    minx, miny, maxx, maxy = bounds
    W = int(math.ceil(maxx - minx)) + 2*pad
    H = int(math.ceil(maxy - miny)) + 2*pad

    im = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    draw = ImageDraw.Draw(im)

    def to_canvas_xy(x, y):
        return (int(round(x - minx + pad)), int(round(y - miny + pad)))

    # origin
    origin_canvas_pts = [to_canvas_xy(*p) for p in origin_pts]
    draw.polygon(origin_canvas_pts, fill=WHITE, outline=BLACK)
    tri_canvas = [to_canvas_xy(*p) for p in tri_pts]
    draw.polygon(tri_canvas, fill=BLACK)

    # placeholders: semi-transparent white + outline
    for ax in placeholders:
        cx, cy = center_map[ax]
        pts = [to_canvas_xy(*p) for p in hex_polygon_rot(cx, cy, size, SCENE_RAD)]
        draw.polygon(pts, fill=HALFWHITE, outline=BLACK)

    # font: scaled nicely to hex radius
    try:
        font = ImageFont.truetype("arial.ttf", int(size * 0.9))
    except Exception:
        font = ImageFont.load_default()

    # actions
    for (q, r), (action, steps) in requested.items():
        cx, cy = center_map[(q, r)]
        pts = [to_canvas_xy(*p) for p in hex_polygon_rot(cx, cy, size, SCENE_RAD)]
        center_px = to_canvas_xy(cx, cy)

        if action == 'a':
            draw.polygon(pts, fill=RED, outline=BLACK)
            draw_text_center(draw, center_px, "a", font, (0, 0, 0, 255))
        elif action == 'm':
            draw.polygon(pts, fill=GREEN, outline=BLACK)
            draw_text_center(draw, center_px, "m", font, (0, 0, 0, 255))
        elif action == 'j':
            draw.polygon(pts, fill=BLUE, outline=BLACK)
            draw_text_center(draw, center_px, "j", font, (0, 0, 0, 255))
        elif action == 'c':
            draw.polygon(pts, fill=RED, outline=BLACK)
            inner = [to_canvas_xy(*p) for p in hex_polygon_rot(cx, cy, size*INNER_HEX_SCALE, SCENE_RAD)]
            draw.polygon(inner, fill=GREEN, outline=BLACK)
            draw_text_center(draw, center_px, "c", font, (0, 0, 0, 255))
        elif action == 'b':
            p1, p2 = block_edge_segment((cx, cy), size, origin_c)
            draw.line([to_canvas_xy(*p1), to_canvas_xy(*p2)],
                      fill=GOLD, width=BLOCK_LINE_WIDTH)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{spec}.png")
    im.save(out_path)
    return out_path


# -------- CSV + CLI --------

def normalize_spec(s: str) -> str:
    s = s.strip()
    if s.lower().startswith("hexstrikeimages/"):
        s = s[len("HexstrikeImages/"):]
    if s.lower().endswith(".png"):
        s = s[:-4]
    return s


def render_from_csv(csv_path: str, out_dir: str, size: int = 46):
    generated = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            for cell in row:
                if not cell:
                    continue
                cell = cell.strip()
                if not (cell.lower().startswith("hexstrikeimages/") and cell.lower().endswith(".png")):
                    continue
                spec = normalize_spec(cell)
                if is_valid_spec(spec):
                    generated.append(render_spec_tight(spec, out_dir, size=size))
    return generated


def main():
    ap = argparse.ArgumentParser(description="Hex diagrams (path-based, tight, translucent path hexes, labels).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_r = sub.add_parser("render", help="Render one spec (e.g., 'F2Ra' or 'm-Ba').")
    ap_r.add_argument("spec", help="Spec string, with or without HexstrikeImages/ and .png")
    ap_r.add_argument("--outdir", default="public/images", help="Output directory")
    ap_r.add_argument("--size", type=int, default=46, help="Hex radius")

    ap_c = sub.add_parser("csv", help="Scan CSV for HexstrikeImages/[spec].png cells and render them.")
    ap_c.add_argument("csv_path", help="CSV path")
    ap_c.add_argument("--outdir", default="public/images", help="Output directory")
    ap_c.add_argument("--size", type=int, default=46, help="Hex radius")

    args = ap.parse_args()
    if args.cmd == "render":
        spec = normalize_spec(args.spec)
        print(render_spec_tight(spec, args.outdir, size=args.size))
    else:
        outs = render_from_csv(args.csv_path, args.outdir, size=args.size)
        for p in outs:
            print(p)


if __name__ == "__main__":
    main()
