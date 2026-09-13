// openGrid-style tile generator (simplified, from scratch)
// Grid pitch 28 mm. Full board 6.8 mm, Lite board 4 mm (per opengrid.world docs).
// Cell profile derived from the official openGrid snap geometry (see [Hidden] section).

/* [Board] */
// Full (6.8 mm, two-sided) or Lite (4 mm, one-sided)
Tile_Type = "Full"; // [Full, Lite]
// Number of cells across (X)
Columns = 4; // [1:1:16]
// Number of cells up (Y)
Rows = 4; // [1:1:16]

/* [Mounting] */
// Countersunk screw holes at interior intersections
Screw_Holes = false;
// Screw shank diameter
Screw_Diameter = 3.4; // [2:0.1:6]
// Countersink diameter at the front face
Countersink_Diameter = 6.5; // [3:0.1:12]
// Place a screw hole every N intersections (1 = every intersection)
Screw_Spacing = 2; // [1:1:8]

/* [Hidden] */
// Cell profile derived from the official openGrid snap (openGrid-3D/openGrid-openSCAD,
// monokini grip): 3.4 mm insertion, 26.4 mm catch bump at 0.4-1.0 mm depth, 25.0 mm tip.
Wall = 0.8;            // wall contributed by each tile edge -> 26.4 mm max opening
Face_Opening = 25.0;   // opening at the tile face (the lip the snap catches on)
Top_Chamfer = 0.4;     // face lip chamfer: 25.0 -> 26.4 over 0.4 mm
Capture_Depth = 2.4;   // 26.4 mm capture zone extends to this depth
Mid_Chamfer = 1.0;     // closes 26.4 -> 25.0 over 1.0 mm, reaching 25.0 at 3.4 mm depth
Snap_Depth = Capture_Depth + Mid_Chamfer; // 3.4
Post = 4.2;            // side length of solid posts at lattice intersections
$fn = 32;
pitch = 28;
T = (Tile_Type == "Full") ? 6.8 : 4;
eps = 0.01;

// One snap-side of the cell profile: face at z = 0, growing in +z into the tile.
// Convex (narrow-wide-narrow), so hull works.
module snap_barrel() {
    wide = pitch - 2 * Wall;
    hull() {
        translate([0, 0, -eps])                   linear_extrude(eps) square(Face_Opening, center = true);
        translate([0, 0, Top_Chamfer])            linear_extrude(Capture_Depth - Top_Chamfer) square(wide, center = true);
        translate([0, 0, Snap_Depth - eps])       linear_extrude(eps) square(Face_Opening, center = true);
    }
}

module cell_cutter() {
    if (Tile_Type == "Full") {
        // Two snap-sides back to back: 2 x 3.4 = 6.8
        snap_barrel();
        translate([0, 0, T]) mirror([0, 0, 1]) snap_barrel();
    } else {
        // Lite: snap-side on the front face (z = T); the remaining 0.6 mm at the back is a plain 25.0 opening
        translate([0, 0, T]) mirror([0, 0, 1]) snap_barrel();
        translate([0, 0, -eps]) linear_extrude(T - Snap_Depth + 2 * eps) square(Face_Opening, center = true);
    }
}

function has_screw(i, j) =
    Screw_Holes && i > 0 && j > 0 && i < Columns && j < Rows
    && i % Screw_Spacing == 0 && j % Screw_Spacing == 0;

module screw_hole() {
    translate([0, 0, -eps]) cylinder(d = Screw_Diameter, h = T + 2 * eps);
    // Countersink on the front (top) face
    translate([0, 0, T - (Countersink_Diameter - Screw_Diameter) / 2])
        cylinder(d1 = Screw_Diameter, d2 = Countersink_Diameter + 2 * eps,
                 h = (Countersink_Diameter - Screw_Diameter) / 2 + eps);
}

module tile() {
    W = Columns * pitch;
    H = Rows * pitch;
    difference() {
        union() {
            difference() {
                cube([W, H, T]);
                for (i = [0 : Columns - 1], j = [0 : Rows - 1])
                    translate([(i + 0.5) * pitch, (j + 0.5) * pitch, 0]) cell_cutter();
            }
            // Solid posts at every lattice intersection (including the outer border);
            // posts that carry a screw hole are widened into a boss around the countersink.
            for (i = [0 : Columns], j = [0 : Rows]) {
                boss = has_screw(i, j) ? Countersink_Diameter + 2 * Wall + 1 : Post;
                if (boss > 0)
                    translate([i * pitch, j * pitch, T / 2]) cube([boss, boss, T], center = true);
            }
        }
        for (i = [1 : Columns - 1], j = [1 : Rows - 1])
            if (has_screw(i, j)) translate([i * pitch, j * pitch, 0]) screw_hole();
    }
}

// Clip posts to the board footprint
intersection() {
    tile();
    cube([Columns * pitch, Rows * pitch, T]);
}
