// openGrid-style tile generator (simplified, from scratch)
// Grid pitch 28 mm. Full board 6.8 mm, Lite board 4 mm (per opengrid.world docs).
// Wall/lip profile is an approximation, not the official spec.

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
// Lattice profile constants (approximation of the openGrid wall/lip shape)
Wall = 0.8;          // wall contributed by each tile edge (wall between cells = 1.6)
Lip = 1.0;           // how far the front/back lip protrudes into the cell
Lip_Chamfer = 1.2;   // chamfer height of the lip
Post = 4.2;          // side length of solid posts at lattice intersections
$fn = 32;
pitch = 28;
T = (Tile_Type == "Full") ? 6.8 : 4;
eps = 0.01;

module cell_cutter() {
    // Cross-section: narrow at faces (lip), wide in the middle. Convex, so hull works.
    wide   = pitch - 2 * Wall;
    narrow = wide - 2 * Lip;
    if (Tile_Type == "Full") {
        hull() {
            translate([0, 0, -eps])            linear_extrude(eps)  square(narrow, center = true);
            translate([0, 0, Lip_Chamfer])     linear_extrude(T - 2 * Lip_Chamfer) square(wide, center = true);
            translate([0, 0, T])               linear_extrude(eps)  square(narrow, center = true);
        }
    } else {
        // Lite: lip on the front (top) face only; back face fully open
        hull() {
            translate([0, 0, -eps])            linear_extrude(eps)  square(wide, center = true);
            translate([0, 0, 0])               linear_extrude(T - Lip_Chamfer) square(wide, center = true);
            translate([0, 0, T])               linear_extrude(eps)  square(narrow, center = true);
        }
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
