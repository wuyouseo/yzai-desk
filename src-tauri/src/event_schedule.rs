use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};

fn default_event_kind() -> String {
    "schedule".to_string()
}

fn default_event_remind() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct EventItem {
    pub id: String,
    pub title: String,
    pub time: String, // ISO String
    #[serde(default = "default_event_kind")]
    pub kind: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_event_remind")]
    pub remind: bool,
    #[serde(default)]
    pub notified_at: Option<String>,
    pub recurring: String, // "none", "daily", "weekly", "monthly", "yearly"
    #[serde(default)]
    pub recurring_day: Option<u32>,
    pub done: bool,
}

pub(crate) fn next_recurring(event: &mut EventItem, now: DateTime<Local>) -> Option<DateTime<Local>> {
    let previous = DateTime::parse_from_rfc3339(&event.time).ok()?.with_timezone(&Local);
    let day = *event.recurring_day.get_or_insert(previous.day());
    match event.recurring.as_str() {
        "daily" | "weekly" => {
            let step = if event.recurring == "daily" { 1 } else { 7 };
            let elapsed = (now - previous).num_days().max(0);
            Some(previous + ChronoDuration::days((elapsed / step + 1) * step))
        },
        "monthly" | "yearly" => {
            let mut year = previous.year();
            let mut month = previous.month();
            for _ in 0..24000 {
                if event.recurring == "yearly" { year += 1; }
                else { month += 1; if month > 12 { month = 1; year += 1; } }
                let last = (28..=31).rev().find(|d| chrono::NaiveDate::from_ymd_opt(year, month, *d).is_some())?;
                let date = chrono::NaiveDate::from_ymd_opt(year, month, day.min(last))?;
                let naive = date.and_hms_opt(previous.hour(), previous.minute(), previous.second())?;
                if let Some(target) = Local.from_local_datetime(&naive).earliest() {
                    if target > now { return Some(target); }
                }
            }
            None
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn monthly_recurrence_returns_to_original_day() {
        let january = Local.with_ymd_and_hms(2028, 1, 31, 9, 0, 0).single().unwrap();
        let mut event = EventItem { id: "1".into(), title: "test".into(), time: january.to_rfc3339(), kind: "reminder".into(), notes: "".into(), remind: true, notified_at: None, recurring: "monthly".into(), recurring_day: None, done: false };
        let february = next_recurring(&mut event, january).unwrap();
        assert_eq!((february.month(), february.day()), (2, 29));
        event.time = february.to_rfc3339();
        let march = next_recurring(&mut event, february).unwrap();
        assert_eq!((march.month(), march.day()), (3, 31));
    }
    #[test]
    fn yearly_leap_day_and_old_daily_events_advance_without_flooding() {
        let leap = Local.with_ymd_and_hms(2028, 2, 29, 9, 0, 0).single().unwrap();
        let mut event = EventItem { id: "2".into(), title: "test".into(), time: leap.to_rfc3339(), kind: "reminder".into(), notes: "".into(), remind: true, notified_at: None, recurring: "yearly".into(), recurring_day: None, done: false };
        let next = next_recurring(&mut event, leap).unwrap();
        assert_eq!((next.year(), next.month(), next.day()), (2029, 2, 28));
        event.time = next.to_rfc3339();
        let after = Local.with_ymd_and_hms(2031, 3, 1, 9, 0, 0).single().unwrap();
        let next_leap = next_recurring(&mut event, after).unwrap();
        assert_eq!((next_leap.year(), next_leap.month(), next_leap.day()), (2032, 2, 29));
        event.recurring = "daily".into(); event.time = leap.to_rfc3339();
        let future = Local.with_ymd_and_hms(2028, 3, 10, 12, 0, 0).single().unwrap();
        assert_eq!(next_recurring(&mut event, future).unwrap().day(), 11);
    }

}
