use serde_json::json;

// Merge the user's changes into the newest version instead of replacing a whole
// section from a stale window. Conflicting edits are rejected, never discarded.
pub(crate) fn merge_change(base: &serde_json::Value, next: &serde_json::Value, current: &serde_json::Value) -> Result<serde_json::Value, String> {
    if next == base { return Ok(current.clone()); }
    if current == base || current == next { return Ok(next.clone()); }
    if let (Some(b), Some(n), Some(c)) = (base.as_object(), next.as_object(), current.as_object()) {
        let mut result = c.clone();
        let keys: std::collections::HashSet<_> = b.keys().chain(n.keys()).collect();
        for key in keys {
            let before = b.get(key); let after = n.get(key); let latest = c.get(key);
            if before == after { continue; }
            match (before, after, latest) {
                (Some(bv), Some(nv), Some(cv)) => { result.insert(key.clone(), merge_change(bv, nv, cv)?); },
                (None, Some(nv), None) | (Some(_), Some(nv), None) => { result.insert(key.clone(), nv.clone()); },
                (Some(bv), None, Some(cv)) if bv == cv => { result.remove(key); },
                (_, Some(nv), Some(cv)) if nv == cv => {},
                (Some(_), None, None) => {},
                _ => return Err("数据已在其他窗口发生冲突，请重新打开后重试".into()),
            }
        }
        return Ok(serde_json::Value::Object(result));
    }
    if let (Some(b), Some(n), Some(c)) = (base.as_array(), next.as_array(), current.as_array()) {
        let id = |v: &serde_json::Value| v.get("id").and_then(|v| v.as_str()).map(str::to_owned);
        if b.iter().chain(n).chain(c).all(|v| id(v).is_some()) {
            let mut result = c.clone();
            for before in b {
                let key = id(before).unwrap();
                let after = n.iter().find(|v| id(v).as_deref() == Some(&key));
                let pos = result.iter().position(|v| id(v).as_deref() == Some(&key));
                match (after, pos) {
                    (Some(a), Some(i)) => result[i] = merge_change(before, a, &result[i])?,
                    (None, Some(i)) if result[i] == *before => { result.remove(i); },
                    (None, None) => {},
                    (Some(a), None) if a == before => {},
                    _ => return Err("数据已在其他窗口发生冲突，请重新打开后重试".into()),
                }
            }
            for after in n {
                let key = id(after).unwrap();
                if !b.iter().any(|v| id(v).as_deref() == Some(&key)) {
                    if let Some(existing) = result.iter().find(|v| id(v).as_deref() == Some(&key)) {
                        if existing != after { return Err("数据已在其他窗口发生冲突，请重新打开后重试".into()); }
                    } else { result.insert(0, after.clone()); }
                }
            }
            return Ok(json!(result));
        }
    }
    Err("数据已在其他窗口发生冲突，请重新打开后重试".into())
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_edits_merge_and_conflicting_edits_fail() {
        let base = json!([{ "id": "a", "content": "old" }, { "id": "b", "content": "old" }]);
        let first = json!([{ "id": "a", "content": "new" }, { "id": "b", "content": "old" }]);
        let second = json!([{ "id": "a", "content": "old" }, { "id": "b", "content": "other" }]);
        let merged = merge_change(&base, &first, &second).unwrap();
        assert_eq!(merged[0]["content"], "new");
        assert_eq!(merged[1]["content"], "other");
        let conflicting = json!([{ "id": "a", "content": "conflict" }, { "id": "b", "content": "old" }]);
        assert!(merge_change(&base, &first, &conflicting).is_err());
    }
    #[test]
    fn concurrent_additions_survive_and_delete_conflicts_are_reported() {
        let base = json!([{ "id": "a", "value": 1 }]);
        let local = json!([{ "id": "a", "value": 1 }, { "id": "b", "value": 2 }]);
        let remote = json!([{ "id": "a", "value": 1 }, { "id": "c", "value": 3 }]);
        let merged = merge_change(&base, &local, &remote).unwrap();
        assert_eq!(merged.as_array().unwrap().len(), 3);
        assert!(merge_change(&base, &json!([]), &json!([{ "id": "a", "value": 4 }])).is_err());
    }

}
