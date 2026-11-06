"""Month Ahead: a whole-panel wall calendar.

The data comes from two widgets Tesserae already ships, asked directly through the plugin
registry rather than re-implemented here: ``calendar_month`` lays the events from Calendar
Feeds out over a rolling run of weeks (multi-day spans included, each event tagged with its
feed's colour), and ``weather_forecast`` brings Open-Meteo's next five days, cached. This
module joins them up for the client: event times written out in the app's own zone ("6:30p"),
each day's forecast and bins on the day itself, today and tomorrow picked out for the today
panel, and a ``sample`` flag while no calendar feed is set up, so the client can show made-up
events instead of an empty grid.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

from flask import current_app

try:  # inside Tesserae
    from app.tz_resolve import app_timezone
except Exception:  # pragma: no cover - outside the host (the tests patch this in)
    app_timezone = None

THEMES = ("noir", "paper", "poster", "ledger", "soft")
WEEKS = ("4", "5", "6")


def _plugin(key: str):
    registry = current_app.config.get("PLUGIN_REGISTRY")
    if registry is None:
        return None
    entry = registry.get(key)
    if entry is None or getattr(entry, "server_module", None) is None:
        return None
    return entry


def _zone():
    if app_timezone is None:
        return None
    try:
        return app_timezone()
    except Exception:
        return None


def clock(dt: datetime) -> str:
    """6p, 6:30p, 10a: short enough for a narrow tile."""
    h, m = dt.hour, dt.minute
    suffix = "a" if h < 12 else "p"
    h12 = h % 12 or 12
    return f"{h12}{f':{m:02d}' if m else ''}{suffix}"


def event_time(start: str, zone) -> str:
    """The start of a timed event as the wall shows it, in the app's zone ("" when unparseable)."""
    try:
        dt = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if dt.tzinfo is not None and zone is not None:
        dt = dt.astimezone(zone)
    return clock(dt)


def bins_for(day: date, bin_day: str, recycling: str, anchor: date | None) -> list[str]:
    """Which bins go out on ``day``: [] off bin night, ["trash"] or ["trash", "recycle"] on it.

    ``bin_day`` uses JavaScript's numbering (0 Sunday .. 6 Saturday), as the option does.
    Fortnightly recycling counts whole weeks from ``anchor``, a night it went out."""
    if bin_day == "" or bin_day is None:
        return []
    try:
        want = int(bin_day)
    except (TypeError, ValueError):
        return []
    if (day.weekday() + 1) % 7 != want:
        return []
    out = ["trash"]
    if recycling == "weekly":
        out.append("recycle")
    elif recycling == "fortnightly":
        start = anchor or day
        if ((day - start).days // 7) % 2 == 0:
            out.append("recycle")
    return out


def _anchor(raw: str, days: list[dict[str, Any]], bin_day: str) -> date | None:
    try:
        return date.fromisoformat(str(raw).strip())
    except ValueError:
        pass
    # Blank or unreadable: the first bin night in the grid starts the fortnight.
    for d in days:
        try:
            day = date.fromisoformat(d["date"])
        except (KeyError, ValueError):
            continue
        if bin_day not in ("", None) and (day.weekday() + 1) % 7 == int(bin_day):
            return day
    return None


def _feeds_set_up(core) -> bool:
    """True when Calendar Feeds has at least one enabled feed. With none, the grid shows sample
    events; with feeds but a quiet five weeks, it shows a quiet five weeks."""
    if core is None:
        return False
    try:
        feeds = core.server_module._load_feeds(Path(core.data_dir)).get("feeds") or []
    except Exception:
        return True  # can't tell: never pretend a real, empty calendar is a sample
    return any(f.get("enabled", True) for f in feeds if isinstance(f, dict))


def _calendar(options: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    cal = _plugin("calendar_month")
    if cal is None:
        return {"error": "The Calendar, Month widget isn't installed.", "days": []}
    weeks = str(options.get("weeks") or "5")
    try:
        per_day = max(1, min(8, int(options.get("max_events_per_day") or 4)))
    except (TypeError, ValueError):
        per_day = 4
    return cal.server_module.fetch(
        {
            "rolling_weeks": weeks if weeks in WEEKS else "5",
            "week_start": "sunday" if options.get("week_start") == "sunday" else "monday",
            "max_events_per_day": per_day,
            "feeds_filter": options.get("feeds_filter") or "",
        },
        {},
        ctx=ctx,
    )


def _weather(options: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    wx = _plugin("weather_forecast")
    if wx is None:
        return {}
    if options.get("latitude") in (None, "") or options.get("longitude") in (None, ""):
        return {}
    try:
        return wx.server_module.fetch(
            {
                "latitude": options.get("latitude"),
                "longitude": options.get("longitude"),
                "label": options.get("label") or "",
                "units": "imperial" if options.get("units") == "imperial" else "metric",
            },
            {},
            ctx={**ctx, "data_dir": str(wx.data_dir)},
        )
    except Exception as err:
        return {"error": f"{type(err).__name__}: {err}"}


def _forecast_day(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "date": d.get("date"),
        "code": d.get("code"),
        "cond": d.get("cond") or "",
        "hi": d.get("hi"),
        "lo": d.get("lo"),
        "rain": d.get("rain"),
    }


def build(
    cal: dict[str, Any],
    wx: dict[str, Any],
    options: dict[str, Any],
    *,
    zone=None,
    sample: bool = False,
) -> dict[str, Any]:
    """Join a calendar_month payload and a weather_forecast payload into the widget's own."""
    raw_days = list(cal.get("days") or [])
    forecast = {
        d.get("date"): _forecast_day(d) for d in (wx.get("days") or []) if isinstance(d, dict)
    }
    bin_day = str(options.get("bin_day") or "")
    recycling = str(options.get("recycling") or "fortnightly")
    anchor = _anchor(options.get("recycling_from") or "", raw_days, bin_day)

    days = []
    for d in raw_days:
        try:
            day = date.fromisoformat(d["date"])
        except (KeyError, ValueError):
            continue
        events = []
        for e in d.get("events") or []:
            events.append(
                {
                    "summary": str(e.get("summary") or ""),
                    "time": "" if e.get("all_day") else event_time(e.get("start") or "", zone),
                    "all_day": bool(e.get("all_day")),
                    "continued": bool(e.get("continued")),
                    "colour": e.get("colour") or "",
                }
            )
        days.append(
            {
                "date": d["date"],
                "day": d.get("day", day.day),
                "weekday": (day.weekday() + 1) % 7,
                "is_today": bool(d.get("is_today")),
                "events": events,
                "extra": int(d.get("extra") or 0),
                "bins": bins_for(day, bin_day, recycling, anchor),
                "wx": forecast.get(d["date"]),
            }
        )

    ti = next((i for i, d in enumerate(days) if d["is_today"]), 0)
    today = days[ti]["date"] if days else ""
    theme = options.get("theme") if options.get("theme") in THEMES else "noir"
    return {
        "days": days,
        "today": ti,
        "ahead": [forecast[k] for k in sorted(forecast) if today and k > today][:4],
        "place": wx.get("place") or wx.get("label") or "",
        "sample": sample,
        "look": {
            "theme": theme,
            "colour": options.get("colour") != "mono",
            "sidebar": options.get("sidebar", True) is not False,
        },
        "error": cal.get("error") or "",
    }


def fetch(
    options: dict[str, Any], settings: dict[str, Any], *, ctx: dict[str, Any]
) -> dict[str, Any]:
    del settings
    cal = _calendar(options, ctx)
    wx = _weather(options, ctx)
    core = _plugin("calendar_core")
    has_events = any(d.get("events") for d in cal.get("days") or [])
    sample = not has_events and not _feeds_set_up(core)
    return build(cal, wx, options, zone=_zone(), sample=sample)
