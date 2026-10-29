#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect { pub x: i32, pub y: i32, pub width: i32, pub height: i32 }

pub fn contain(mut rect: Rect, area: Rect) -> Rect {
    rect.width = rect.width.max(1).min(area.width.max(1));
    rect.height = rect.height.max(1).min(area.height.max(1));
    rect.x = rect.x.clamp(area.x, area.x + area.width - rect.width);
    rect.y = rect.y.clamp(area.y, area.y + area.height - rect.height);
    rect
}

// Snap in physical coordinates; callers convert the logical threshold and gap by DPI.
pub fn snap(rect: Rect, area: Rect, peers: &[Rect], threshold: i32, gap: i32) -> (Rect, Option<i32>, Option<i32>) {
    let mut xs = vec![area.x, area.x + area.width];
    let mut ys = vec![area.y, area.y + area.height];
    for peer in peers {
        if rect.y <= peer.y + peer.height + gap * 4 && peer.y <= rect.y + rect.height + gap * 4 {
            xs.extend([peer.x, peer.x + peer.width, peer.x + peer.width / 2, peer.x - gap, peer.x + peer.width + gap]);
        }
        if rect.x <= peer.x + peer.width + gap * 4 && peer.x <= rect.x + rect.width + gap * 4 {
            ys.extend([peer.y, peer.y + peer.height, peer.y + peer.height / 2, peer.y - gap, peer.y + peer.height + gap]);
        }
    }
    fn closest(edges: [i32; 3], candidates: &[i32], limit: i32) -> Option<(i32, i32)> {
        let mut best = None;
        for edge in edges { for target in candidates {
            let delta = *target - edge;
            if delta.abs() <= limit && best.is_none_or(|(old, _): (i32, i32)| delta.abs() < old.abs()) { best = Some((delta, *target)); }
        }}
        best
    }
    let mut next = rect;
    let mut x = None; let mut y = None;
    if let Some((delta, guide)) = closest([rect.x, rect.x + rect.width, rect.x + rect.width / 2], &xs, threshold) {
        if rect.x + delta >= area.x && rect.x + delta + rect.width <= area.x + area.width { next.x += delta; x = Some(guide); }
    }
    if let Some((delta, guide)) = closest([rect.y, rect.y + rect.height, rect.y + rect.height / 2], &ys, threshold) {
        if rect.y + delta >= area.y && rect.y + delta + rect.height <= area.y + area.height { next.y += delta; y = Some(guide); }
    }
    (next, x, y)
}

pub fn resize(start: Rect, edge: &str, dx: i32, dy: i32, min: (i32, i32), area: Rect) -> Rect {
    let (mut left, mut top, mut right, mut bottom) = (start.x, start.y, start.x + start.width, start.y + start.height);
    let min_w = min.0.min(area.width); let min_h = min.1.min(area.height);
    if edge.contains('w') { left = (left + dx).clamp(area.x, right - min_w); }
    if edge.contains('e') { right = (right + dx).clamp(left + min_w, area.x + area.width); }
    if edge.contains('n') { top = (top + dy).clamp(area.y, bottom - min_h); }
    if edge.contains('s') { bottom = (bottom + dy).clamp(top + min_h, area.y + area.height); }
    contain(Rect { x: left, y: top, width: right - left, height: bottom - top }, area)
}

pub fn snap_resize(rect: Rect, edge: &str, area: Rect, peers: &[Rect], threshold: i32, gap: i32, minimum: (i32, i32)) -> (Rect, Option<i32>, Option<i32>) {
    let mut result = rect; let mut gx = None; let mut gy = None;
    let xs: Vec<_> = [area.x, area.x + area.width].into_iter().chain(peers.iter().flat_map(|r| [r.x, r.x + r.width, r.x - gap, r.x + r.width + gap])).collect();
    let ys: Vec<_> = [area.y, area.y + area.height].into_iter().chain(peers.iter().flat_map(|r| [r.y, r.y + r.height, r.y - gap, r.y + r.height + gap])).collect();
    let nearest = |value: i32, candidates: &[i32]| candidates.iter().copied().filter(|v| (*v - value).abs() <= threshold).min_by_key(|v| (*v - value).abs());
    if edge.contains('w') { if let Some(x) = nearest(rect.x, &xs) { if rect.x + rect.width - x >= minimum.0 && x >= area.x { result.x = x; result.width = rect.x + rect.width - x; gx = Some(x); } } }
    if edge.contains('e') { if let Some(x) = nearest(rect.x + rect.width, &xs) { if x - rect.x >= minimum.0 && x <= area.x + area.width { result.width = x - rect.x; gx = Some(x); } } }
    if edge.contains('n') { if let Some(y) = nearest(rect.y, &ys) { if rect.y + rect.height - y >= minimum.1 && y >= area.y { result.y = y; result.height = rect.y + rect.height - y; gy = Some(y); } } }
    if edge.contains('s') { if let Some(y) = nearest(rect.y + rect.height, &ys) { if y - rect.y >= minimum.1 && y <= area.y + area.height { result.height = y - rect.y; gy = Some(y); } } }
    (result, gx, gy)
}

#[cfg(test)] mod tests {
    use super::*;
    const AREA: Rect = Rect { x: -1920, y: 0, width: 1920, height: 1040 };
    #[test] fn contains_entire_window_on_negative_monitor() {
        let r = contain(Rect { x: -100, y: 980, width: 320, height: 300 }, AREA);
        assert_eq!((r.x, r.y), (-320, 740));
        let r = contain(Rect { width: 3000, height: 2000, ..r }, AREA);
        assert_eq!(r, AREA);
    }
    #[test] fn snaps_to_work_area_and_peer_gap() {
        let r = Rect { x: -1915, y: 400, width: 300, height: 200 };
        assert_eq!(snap(r, AREA, &[], 8, 16).0.x, -1920);
        let peer = Rect { x: -1500, y: 400, ..r };
        let r = Rect { x: -1190, ..r };
        assert_eq!(snap(r, AREA, &[peer], 8, 16).0.x, -1184);
    }
    #[test] fn resize_preserves_opposite_edge_and_minimum() {
        let start = Rect { x: -1500, y: 100, width: 320, height: 300 };
        let r = resize(start, "nw", 1000, 1000, (260, 220), AREA);
        assert_eq!((r.x + r.width, r.y + r.height), (-1180, 400));
        assert_eq!((r.width, r.height), (260, 220));
    }
    #[test] fn resize_snaps_only_dragged_edge() {
        let r = Rect { x: -1500, y: 100, width: 495, height: 300 };
        let peer = Rect { x: -1000, y: 500, width: 300, height: 200 };
        let (result, x, _) = snap_resize(r, "e", AREA, &[peer], 8, 16, (260, 220));
        assert_eq!((result.x, result.width, x), (-1500, 500, Some(-1000)));
    }
}
