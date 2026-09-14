// openGrid tile connector peg, modelled to the dimensions of the official
// "openGrid Connector.3mf" (David D, openGrid release on Printables, CC-BY-NC-SA):
// 5.00 x 9.92 x 2.20 mm capsule with a shallow waist (4.52 mm) at the seam.
// It presses into the connector cutouts on a tile edge (cutout: 5.2 x 10.4 x 2.4 mm)
// and joins two boards. One connector fits both Full and Lite tiles.

/* [Layout] */
// How many connectors to lay out on the plate
Count = 12; // [1:1:80]
// Gap between connectors on the plate
Spacing = 3; // [1:0.5:10]

/* [Fit] */
// Grow (+) or shrink (-) the outline for printers that run loose or tight
Tolerance = 0; // [-0.3:0.05:0.3]

/* [Hidden] */
Width = 5.0;
Length = 9.92;
Thickness = 2.2;
Waist_Width = 4.52;   // narrowest width at the seam
Waist_Span = 2.5;     // length of the waist arc along the connector
$fn = 48;

// Arc radius that gives the waist depth over its span (chord = span, sagitta = depth)
waist_depth = (Width - Waist_Width) / 2;
waist_r = (pow(Waist_Span / 2, 2) + pow(waist_depth, 2)) / (2 * waist_depth);

module connector_profile() {
    offset(delta = Tolerance)
    difference() {
        hull() {
            translate([0, -(Length / 2 - Width / 2)]) circle(d = Width);
            translate([0,  (Length / 2 - Width / 2)]) circle(d = Width);
        }
        for (s = [-1, 1])
            translate([s * (Width / 2 - waist_depth + waist_r), 0]) circle(r = waist_r);
    }
}

module connector() {
    linear_extrude(Thickness) connector_profile();
}

// Lay out in a near-square grid
cols = ceil(sqrt(Count));
px = Width + Spacing;
py = Length + Spacing;
for (i = [0 : Count - 1])
    translate([(i % cols) * px, floor(i / cols) * py, 0]) connector();
